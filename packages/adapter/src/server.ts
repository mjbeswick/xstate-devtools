// Server entrypoint — exposes a WebSocket bridge so the DevTools panel
// can connect to actors running in Node.
import type { ExtensionToPageMessage, PageToExtensionMessage } from '@xstate-devtools/protocol'
import { createInspector, type Transport } from './core.js'

export interface ServerAdapterOptions {
  /** Port to listen on. Defaults to env XSTATE_DEVTOOLS_PORT or 9301. */
  port?: number
  /** Host to bind. Defaults to '127.0.0.1'. */
  host?: string
  /** Max events to buffer before the first panel connects. Default 200. */
  bufferSize?: number
}

interface ClientLike {
  send(data: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
  readyState: number
}

const OPEN_STATE = 1

type ActorRegistered = Extract<PageToExtensionMessage, { type: 'XSTATE_ACTOR_REGISTERED' }>

interface LiveActor {
  /** The registration message, kept immutable so its snapshot stays the
   *  registration-time one (the panel's time-travel floor). */
  reg: ActorRegistered
  /** Latest snapshot seen for this actor (the registration snapshot until updated). */
  snapshot: ActorRegistered['snapshot']
}

interface CachedServer {
  clients: Set<ClientLike>
  dispatchHandlers: Set<(msg: ExtensionToPageMessage) => void>
  /** Currently-live actors (immutable registration + latest snapshot). */
  liveActors: Map<string, LiveActor>
  /** Pre-first-connection event/snapshot backlog, flushed once to the first panel. */
  recentEvents: string[]
  bufferSize: number
  /** Set once the first panel connects and drains the backlog. */
  activated: boolean
  close: () => void
}

/** Track live-actor state so it can be replayed to every connecting panel. */
function trackLive(server: CachedServer, message: PageToExtensionMessage): void {
  switch (message.type) {
    case 'XSTATE_ACTOR_REGISTERED':
      server.liveActors.set(message.sessionId, { reg: message, snapshot: message.snapshot })
      break
    case 'XSTATE_SNAPSHOT': {
      const live = server.liveActors.get(message.sessionId)
      if (live) { live.snapshot = message.snapshot }
      break
    }
    case 'XSTATE_EVENT': {
      const live = server.liveActors.get(message.sessionId)
      if (live) { live.snapshot = message.snapshotAfter }
      break
    }
    case 'XSTATE_ACTOR_STOPPED':
      server.liveActors.delete(message.sessionId)
      break
  }
}

/**
 * Start a local WebSocket server that the DevTools panel can connect to.
 * Returns the inspector callback. Multiple panels can connect simultaneously.
 *
 * The WS server, connected clients, dispatch handlers, and the live-actor
 * registry are all stashed on globalThis keyed by port. This makes the function
 * idempotent across HMR re-evaluation: subsequent calls reuse the existing
 * server and only register new inspector hooks.
 *
 * Every connecting panel — including a reconnect after the editor/host restarts
 * — is replayed the current set of live actors (with their latest snapshots),
 * so actors registered at boot stay visible across reconnects (not just for
 * the first panel). The pre-connection event backlog, by contrast, is flushed
 * only to the very first panel; replaying it on every reconnect would re-flood
 * the log with stale events.
 */
export function createServerAdapter(options: ServerAdapterOptions = {}) {
  const port = options.port
    ?? (Number(process.env.XSTATE_DEVTOOLS_PORT) || 9301)
  const host = options.host ?? '127.0.0.1'
  const bufferSize = options.bufferSize ?? 200

  const key = `__xstate_devtools_server_${port}__`
  const cache = (globalThis as Record<string, unknown>)[key] as CachedServer | undefined

  let server: CachedServer
  if (cache) {
    server = cache
    // honour the most recent caller's buffer size if larger
    if (bufferSize > server.bufferSize) server.bufferSize = bufferSize
  } else {
    const clients = new Set<ClientLike>()
    const dispatchHandlers = new Set<(msg: ExtensionToPageMessage) => void>()
    const liveActors = new Map<string, LiveActor>()
    const recentEvents: string[] = []
    let wss: any = null
    let closed = false

    server = {
      clients, dispatchHandlers, liveActors, recentEvents, bufferSize,
      activated: false,
      close: () => {
        closed = true
        try { wss?.close() } catch { /* noop */ }
        clients.clear()
        dispatchHandlers.clear()
        liveActors.clear()
        recentEvents.length = 0
        delete (globalThis as Record<string, unknown>)[key]
      },
    }

    // Lazily import ws so this module is import-safe in environments that
    // never use the server entrypoint (or where ws isn't installed).
    void (async () => {
      try {
        const mod = await import('ws')
        const WSServer = (mod as any).WebSocketServer ?? (mod as any).Server
        if (closed) return
        wss = new WSServer({ port, host })
        wss.on('connection', (ws: ClientLike) => {
          // Replay current live actors to every connecting panel, so reconnects
          // see the current set. Send the immutable registration (carrying the
          // registration-time snapshot → correct time-travel floor), then a
          // snapshot update if the actor has advanced since.
          for (const { reg, snapshot } of server.liveActors.values()) {
            try { ws.send(JSON.stringify({ ...reg, __xstateDevtools: true })) } catch { /* ignore */ }
            if (snapshot !== reg.snapshot) {
              try {
                ws.send(JSON.stringify({
                  type: 'XSTATE_SNAPSHOT', sessionId: reg.sessionId, snapshot,
                  timestamp: reg.timestamp, globalSeq: reg.globalSeq, __xstateDevtools: true,
                }))
              } catch { /* ignore */ }
            }
          }
          // Flush the pre-connection event backlog once, to the first panel only.
          if (!server.activated) {
            server.activated = true
            for (const payload of server.recentEvents) {
              try { ws.send(payload) } catch { /* ignore */ }
            }
            server.recentEvents.length = 0
          }
          server.clients.add(ws)
          ws.on('message', (raw: unknown) => {
            try {
              const text = typeof raw === 'string' ? raw : (raw as Buffer).toString('utf8')
              const msg = JSON.parse(text) as ExtensionToPageMessage
              for (const cb of server.dispatchHandlers) cb(msg)
            } catch {
              // ignore malformed messages
            }
          })
          ws.on('close', () => server.clients.delete(ws))
          ws.on('error', () => server.clients.delete(ws))
        })
        wss.on('error', (err: Error) => {
          console.warn('[xstate-devtools] WS server error:', err.message)
        })
      } catch (e) {
        console.warn(
          '[xstate-devtools] could not start server adapter — install `ws` to enable.',
          (e as Error).message,
        )
      }
    })()

    ;(globalThis as Record<string, unknown>)[key] = server
  }

  const transport: Transport = {
    send(message: PageToExtensionMessage) {
      // Maintain the live-actor registry so any panel that connects (or
      // reconnects) later can be replayed the current state.
      trackLive(server, message)
      const payload = JSON.stringify({ ...message, __xstateDevtools: true })
      // Buffer events only until the first panel connects; afterwards the log
      // streams live and the backlog is no longer replayed (avoids reconnect
      // re-flooding the log with stale events).
      if (!server.activated && (message.type === 'XSTATE_EVENT' || message.type === 'XSTATE_SNAPSHOT')) {
        server.recentEvents.push(payload)
        if (server.recentEvents.length > server.bufferSize) server.recentEvents.shift()
      }
      for (const ws of server.clients) {
        if (ws.readyState === OPEN_STATE) {
          try { ws.send(payload) } catch { /* ignore */ }
        }
      }
    },
    subscribe(handler) {
      server.dispatchHandlers.add(handler)
      return () => server.dispatchHandlers.delete(handler)
    },
  }

  const inspector = createInspector(transport, 'srv')
  return { ...inspector, close: server.close }
}
