// Server entrypoint — exposes a WebSocket bridge so the DevTools panel
// can connect to actors running in Node.
import type { ExtensionToPageMessage, PageToExtensionMessage } from '../../extension/src/shared/types.js'
import { createInspector, type Transport } from './core.js'

export interface ServerAdapterOptions {
  /** Port to listen on. Defaults to env XSTATE_DEVTOOLS_PORT or 9301. */
  port?: number
  /** Host to bind. Defaults to '127.0.0.1'. */
  host?: string
}

interface ClientLike {
  send(data: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
  readyState: number
  OPEN?: number
}

const OPEN_STATE = 1

/**
 * Start a local WebSocket server that the DevTools panel can connect to.
 * Returns the inspector callback. Multiple panels can connect simultaneously.
 *
 * Idempotent across hot reloads: re-uses a server stashed on globalThis to
 * avoid EADDRINUSE when modules are re-evaluated.
 */
export function createServerAdapter(options: ServerAdapterOptions = {}) {
  const port = options.port
    ?? (Number(process.env.XSTATE_DEVTOOLS_PORT) || 9301)
  const host = options.host ?? '127.0.0.1'

  // Reuse across hot reloads — Vite/Remix re-evaluate modules and would
  // otherwise hit EADDRINUSE.
  const key = `__xstate_devtools_server_${port}__`
  const existing = (globalThis as any)[key]

  let clients: Set<ClientLike>
  let close: () => void

  if (existing) {
    clients = existing.clients
    close = existing.close
  } else {
    clients = new Set<ClientLike>()
    let wss: any = null
    let closed = false

    // Lazily import ws so this module is import-safe even if ws isn't installed
    // (e.g., a build that only uses the browser entrypoint).
    void (async () => {
      try {
        const mod = await import('ws')
        const WSServer = (mod as any).WebSocketServer ?? (mod as any).Server
        if (closed) return
        wss = new WSServer({ port, host })
        wss.on('connection', (ws: ClientLike) => {
          clients.add(ws)
          ws.on('message', (raw: unknown) => {
            try {
              const text = typeof raw === 'string' ? raw : (raw as Buffer).toString('utf8')
              const msg = JSON.parse(text) as ExtensionToPageMessage
              for (const cb of dispatchHandlers) cb(msg)
            } catch {
              // ignore malformed messages
            }
          })
          ws.on('close', () => clients.delete(ws))
          ws.on('error', () => clients.delete(ws))
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

    close = () => {
      closed = true
      try { wss?.close() } catch { /* noop */ }
      clients.clear()
      delete (globalThis as any)[key]
    }

    ;(globalThis as any)[key] = { clients, close }
  }

  const dispatchHandlers = new Set<(msg: ExtensionToPageMessage) => void>()

  const transport: Transport = {
    send(message: PageToExtensionMessage) {
      const payload = JSON.stringify({ ...message, __xstateDevtools: true })
      for (const ws of clients) {
        if (ws.readyState === OPEN_STATE) {
          try { ws.send(payload) } catch { /* ignore */ }
        }
      }
    },
    subscribe(handler) {
      dispatchHandlers.add(handler)
      return () => dispatchHandlers.delete(handler)
    },
  }

  const inspector = createInspector(transport)
  return { ...inspector, close }
}
