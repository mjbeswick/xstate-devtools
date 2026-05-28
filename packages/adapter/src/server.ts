// Server entrypoint — exposes a WebSocket bridge so the DevTools panel
// can connect to actors running in Node.
import { createServer as createTcpServer } from 'node:net'
import type {
  ExtensionToPageMessage,
  PageToExtensionMessage,
} from '../../extension/src/shared/types.js'
import { createInspector, type Transport } from './core.js'
import {
  debugLog as baseDebugLog,
  infoLog as baseInfoLog,
  warnLog as baseWarnLog,
} from './logging.js'
import { sanitize } from './sanitize.js'

/**
 * Find the lowest TCP port >= `start` that is not currently in use.
 * Uses a temporary TCP server to probe; the port is released before resolving.
 */
function getAvailablePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createTcpServer()
    probe.unref()
    probe.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(getAvailablePort(start + 1))
      } else {
        reject(err)
      }
    })
    probe.listen(start, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port
      probe.close(() => resolve(port))
    })
  })
}

export interface ServerAdapterOptions {
  /** Port to listen on. Defaults to env XSTATE_DEVTOOLS_PORT or 9301. */
  port?: number
  /** Host to bind. Defaults to '127.0.0.1'. */
  host?: string
  /** Max messages to buffer while no panel is connected. Default 200. */
  bufferSize?: number
}

interface ClientLike {
  send(data: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
  readyState: number
}

const OPEN_STATE = 1

function summarizeMessage(message: ExtensionToPageMessage | PageToExtensionMessage) {
  const summary: Record<string, unknown> = { type: message.type }
  if ('sessionId' in message) summary.sessionId = message.sessionId
  if ('parentSessionId' in message && message.parentSessionId) {
    summary.parentSessionId = message.parentSessionId
  }
  if ('globalSeq' in message) summary.globalSeq = message.globalSeq
  if ('timestamp' in message) summary.timestamp = message.timestamp
  if (
    'event' in message &&
    message.event &&
    typeof message.event === 'object' &&
    'type' in message.event
  ) {
    summary.eventType = message.event.type
  }
  return summary
}

function debugLog(message: string, details?: unknown) {
  baseDebugLog('server', message, details)
}

function infoLog(message: string, details?: unknown) {
  baseInfoLog('server', message, details)
}

function warnLog(message: string, details?: unknown) {
  baseWarnLog('server', message, details)
}

function stringifyOutgoingMessage(message: PageToExtensionMessage): string | null {
  const payload = { ...message, __xstateDevtools: true as const }

  try {
    return JSON.stringify(payload)
  } catch (error) {
    warnLog('failed to stringify adapter message; retrying with sanitized payload', {
      error,
      message: summarizeMessage(message),
    })
  }

  try {
    return JSON.stringify(sanitize(payload))
  } catch (error) {
    warnLog('dropping adapter message that could not be stringified', {
      error,
      message: summarizeMessage(message),
    })
    return null
  }
}

interface CachedServer {
  clients: Set<ClientLike>
  dispatchHandlers: Set<(msg: ExtensionToPageMessage) => void>
  buffer: string[]
  bufferSize: number
  activated: boolean
  /** Resolves with the actual TCP port once the WS server is listening. */
  port: Promise<number>
  close: () => void
}

/**
 * Start a local WebSocket server that the DevTools panel can connect to.
 * Returns the inspector callback. Multiple panels can connect simultaneously.
 *
 * The WS server, connected clients, dispatch handlers, and pre-connection
 * buffer are all stashed on globalThis keyed by port. This makes the function
 * idempotent across HMR re-evaluation: subsequent calls reuse the existing
 * server and only register new inspector hooks.
 *
 * Inspection events emitted before the first panel connects are buffered (up
 * to `bufferSize`, default 200) and flushed to the first connecting client so
 * actors registered at boot are visible.
 */
export function createServerAdapter(options: ServerAdapterOptions = {}) {
  const port = options.port ?? (Number(process.env.XSTATE_DEVTOOLS_PORT) || 9301)
  const host = options.host ?? '127.0.0.1'
  const bufferSize = options.bufferSize ?? 200
  infoLog('createServerAdapter called', { host, port, bufferSize })

  const key = `__xstate_devtools_server_${port}__`
  const cache = (globalThis as Record<string, unknown>)[key] as CachedServer | undefined

  let server: CachedServer
  if (cache) {
    server = cache
    infoLog('reusing cached WebSocket server', {
      host,
      port,
      clientCount: server.clients.size,
      bufferedMessages: server.buffer.length,
    })
    // honour the most recent caller's buffer size if larger
    if (bufferSize > server.bufferSize) server.bufferSize = bufferSize
  } else {
    const clients = new Set<ClientLike>()
    const dispatchHandlers = new Set<(msg: ExtensionToPageMessage) => void>()
    const buffer: string[] = []
    let wss: any = null
    let closed = false

    let portResolve!: (port: number) => void
    let portReject!: (err: unknown) => void
    const portPromise = new Promise<number>((res, rej) => {
      portResolve = res
      portReject = rej
    })

    server = {
      clients,
      dispatchHandlers,
      buffer,
      bufferSize,
      activated: false,
      port: portPromise,
      close: () => {
        closed = true
        infoLog('closing WebSocket server', { host, port, clientCount: clients.size })
        try {
          wss?.close()
        } catch {
          /* noop */
        }
        clients.clear()
        dispatchHandlers.clear()
        buffer.length = 0
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
        const actualPort = await getAvailablePort(port)
        if (closed) return
        wss = new WSServer({ port: actualPort, host })
        process.env.XSTATE_DEVTOOLS_PORT = String(actualPort)
        portResolve(actualPort)
        infoLog('WebSocket server listening', { host, port: actualPort })
        wss.on('connection', (ws: ClientLike) => {
          infoLog('panel connected to WebSocket server', {
            host,
            port,
            activated: server.activated,
            bufferedMessages: server.buffer.length,
          })
          // Drain bootstrap buffer to the first client only.
          if (!server.activated) {
            server.activated = true
            infoLog('flushing bootstrap buffer to first panel', {
              host,
              port,
              bufferedMessages: server.buffer.length,
            })
            for (const payload of server.buffer) {
              try {
                ws.send(payload)
              } catch {
                /* ignore */
              }
            }
            server.buffer.length = 0
          }
          server.clients.add(ws)
          ws.on('message', (raw: unknown) => {
            try {
              const text = typeof raw === 'string' ? raw : (raw as Buffer).toString('utf8')
              const msg = JSON.parse(text) as ExtensionToPageMessage
              debugLog('received dispatch from panel', summarizeMessage(msg))
              for (const cb of server.dispatchHandlers) cb(msg)
            } catch (error) {
              warnLog('failed to parse panel message', { error })
            }
          })
          ws.on('close', () => {
            server.clients.delete(ws)
            infoLog('panel disconnected from WebSocket server', {
              host,
              port,
              clientCount: server.clients.size,
            })
          })
          ws.on('error', (error: unknown) => {
            server.clients.delete(ws)
            warnLog('WebSocket client error', { error })
          })
        })
        wss.on('error', (err: Error) => {
          warnLog('WS server error', { host, port, message: err.message })
        })
      } catch (e) {
        portReject(e)
        warnLog('could not start server adapter — install `ws` to enable', {
          host,
          port,
          message: (e as Error).message,
        })
      }
    })()

    ;(globalThis as Record<string, unknown>)[key] = server
  }

  const transport: Transport = {
    send(message: PageToExtensionMessage) {
      const payload = stringifyOutgoingMessage(message)
      if (payload === null) return

      if (!server.activated) {
        // No panel has connected yet — buffer for the first one.
        if (server.buffer.length >= server.bufferSize) server.buffer.shift()
        server.buffer.push(payload)
        debugLog('buffered outgoing adapter message; no panel connected yet', {
          bufferedMessages: server.buffer.length,
          message: summarizeMessage(message),
        })
        return
      }
      let sentCount = 0
      for (const ws of server.clients) {
        if (ws.readyState === OPEN_STATE) {
          try {
            ws.send(payload)
            sentCount += 1
          } catch {
            /* ignore */
          }
        }
      }
      debugLog('sent adapter message to connected panels', {
        sentCount,
        clientCount: server.clients.size,
        message: summarizeMessage(message),
      })
    },
    subscribe(handler) {
      server.dispatchHandlers.add(handler)
      debugLog('registered dispatch handler', { handlerCount: server.dispatchHandlers.size })
      return () => {
        server.dispatchHandlers.delete(handler)
        debugLog('removed dispatch handler', { handlerCount: server.dispatchHandlers.size })
      }
    },
  }

  const inspector = createInspector(transport, 'srv')
  return { ...inspector, close: server.close, port: server.port }
}
