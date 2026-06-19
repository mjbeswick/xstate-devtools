// packages/vscode-extension/src/debugger/wsClient.ts
//
// WebSocket client that attaches the VS Code extension host to a running app's
// server adapter (createServerAdapter, default ws://127.0.0.1:9301). The wire
// format is defined in @xstate-devtools/protocol:
//   - server → client: JSON `{ ...PageToExtensionMessage, __xstateDevtools: true }`
//   - client → server: JSON `ExtensionToPageMessage`
// Mirrors the chrome panel's ServerStatusBar behaviour, including 2s auto-reconnect.
import WebSocket from 'ws'
import type { ExtensionToPageMessage, PageToExtensionMessage } from '@xstate-devtools/protocol'

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

const RECONNECT_DELAY_MS = 2000

export interface WsClientCallbacks {
  onMessage: (msg: PageToExtensionMessage) => void
  onStatus: (status: ConnectionStatus) => void
}

export class DebuggerWsClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = false
  private status: ConnectionStatus = 'idle'

  constructor(
    private url: string,
    private readonly callbacks: WsClientCallbacks,
  ) {}

  getStatus(): ConnectionStatus {
    return this.status
  }

  getUrl(): string {
    return this.url
  }

  /** Begin connecting and keep retrying on drop until disconnect() is called. */
  connect(url?: string): void {
    if (url) this.url = url
    this.shouldReconnect = true
    this.open()
  }

  /** Stop reconnecting and tear down the socket. */
  disconnect(): void {
    this.shouldReconnect = false
    this.clearReconnect()
    this.teardownSocket()
    this.setStatus('idle')
  }

  /** Send a command (dispatch / request-persisted / restore) to the running app. */
  send(msg: ExtensionToPageMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg))
        return true
      } catch {
        return false
      }
    }
    return false
  }

  dispose(): void {
    this.disconnect()
  }

  private open(): void {
    this.teardownSocket()
    this.setStatus('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch {
      this.setStatus('error')
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.on('open', () => {
      if (this.ws !== ws) return
      this.setStatus('open')
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      if (this.ws !== ws) return
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8')
        const parsed = JSON.parse(text) as PageToExtensionMessage & { __xstateDevtools?: boolean }
        delete parsed.__xstateDevtools
        this.callbacks.onMessage(parsed)
      } catch {
        // ignore malformed frames
      }
    })

    ws.on('close', () => {
      if (this.ws !== ws) return
      this.ws = null
      this.setStatus('closed')
      this.scheduleReconnect()
    })

    ws.on('error', () => {
      if (this.ws !== ws) return
      this.setStatus('error')
      // a 'close' event follows, which schedules the reconnect
    })
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect) this.open()
    }, RECONNECT_DELAY_MS)
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private teardownSocket(): void {
    if (this.ws) {
      const ws = this.ws
      this.ws = null
      try {
        ws.removeAllListeners()
        ws.close()
      } catch {
        /* noop */
      }
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.callbacks.onStatus(status)
  }
}
