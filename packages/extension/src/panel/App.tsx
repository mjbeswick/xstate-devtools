// packages/extension/src/panel/App.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from './store.js'
import { Layout } from './components/Layout.js'
import { DispatchContext } from './port-context.js'
import type {
  PageToExtensionMessage, ExtensionToPageMessage, MarkedPageMessage,
} from '../shared/types.js'
import { debugLog, infoLog, summarizeMessage, warnLog } from '../shared/debug.js'

const SERVER_URL_KEY = 'xstate-devtools.serverUrl'
const DEFAULT_SERVER_URL = 'ws://localhost:9301'

const PAGE_MESSAGE_TYPES = new Set([
  'XSTATE_ACTOR_REGISTERED',
  'XSTATE_SNAPSHOT',
  'XSTATE_EVENT',
  'XSTATE_ACTOR_STOPPED',
  'XSTATE_PAGE_NAVIGATED',
  'XSTATE_ADAPTER_READY',
])

function asPageMessage(data: unknown): PageToExtensionMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (typeof type !== 'string' || !PAGE_MESSAGE_TYPES.has(type)) return null
  return data as PageToExtensionMessage
}

export function App() {
  const handleMessage = useStore((s) => s.handleMessage)
  const setPortConnectedInStore = useStore((s) => s.setPortConnected)
  const portRef = useRef<chrome.runtime.Port | null>(null)

  // Mount log — helps confirm the panel React app has initialised
  useEffect(() => {
    console.log('[xstate-devtools:panel] panel mounted, tabId =', chrome.devtools.inspectedWindow.tabId)
  }, [])
  const wsRef = useRef<WebSocket | null>(null)
  const panelSeqRef = useRef(0)

  // Incrementing this causes the browser-transport effect to re-run and
  // reconnect the background port.  Used to auto-recover after the MV3 service
  // worker is killed and the port drops.
  const [reconnectKey, setReconnectKey] = useState(0)
  const reconnectTimerRef = useRef<number | null>(null)

  /**
   * Rewrite each incoming message's globalSeq to a panel-monotonic value.
   * Browser and server adapters each have their own per-process seq, so naive
   * merging would produce overlapping values. This rebases everything onto
   * one timeline at the point of ingest.
   */
  const ingest = useCallback((message: PageToExtensionMessage) => {
    if (message.type === 'XSTATE_PAGE_NAVIGATED') {
      console.log('[xstate-devtools:panel] page navigated — clearing actor store')
      handleMessage(message)
      return
    }
    panelSeqRef.current += 1
    const seq = panelSeqRef.current
    debugLog('panel', 'ingesting message', {
      original: summarizeMessage(message),
      rebasedGlobalSeq: seq,
    })
    if (
      message.type === 'XSTATE_ACTOR_REGISTERED'
      || message.type === 'XSTATE_SNAPSHOT'
      || message.type === 'XSTATE_EVENT'
    ) {
      handleMessage({ ...message, globalSeq: seq })
    } else {
      handleMessage(message)
    }
  }, [handleMessage])

  const [serverUrl, setServerUrl] = useState<string>(() => {
    try { return localStorage.getItem(SERVER_URL_KEY) ?? DEFAULT_SERVER_URL }
    catch { return DEFAULT_SERVER_URL }
  })
  const [serverEnabled, setServerEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(SERVER_URL_KEY + '.enabled') === '1' }
    catch { return false }
  })
  const [serverStatus, setServerStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle')
  const [portConnected, setPortConnected] = useState(false)
  const [browserMsgCount, setBrowserMsgCount] = useState(0)

  // Log connection state changes to console so they are visible without enabling verbose DevTools logging
  useEffect(() => {
    console.log('[xstate-devtools:panel] portConnected changed →', portConnected)
  }, [portConnected])

  useEffect(() => {
    console.log('[xstate-devtools:panel] serverStatus changed →', serverStatus)
  }, [serverStatus])

  // Browser transport — content-script port
  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId
    infoLog('panel', 'connecting to background port', { tabId, reconnectKey })
    const p = chrome.runtime.connect({ name: `xstate-panel-${tabId}` })
    portRef.current = p
    setPortConnected(true)
    setPortConnectedInStore(true)
    infoLog('panel', 'connected to background port', { tabId, portName: p.name })

    p.onMessage.addListener((message: MarkedPageMessage | PageToExtensionMessage) => {
      const normalized = asPageMessage(message)
      if (!normalized) return
      debugLog('panel', 'received message from browser transport', summarizeMessage(normalized))
      setBrowserMsgCount((n) => {
        if (n === 0) infoLog('panel', 'first message received from browser transport', summarizeMessage(normalized))
        return n + 1
      })
      ingest(normalized)
    })

    p.onDisconnect.addListener(() => {
      setPortConnected(false)
      setPortConnectedInStore(false)
      infoLog('panel', 'background port disconnected; scheduling reconnect', { tabId, portName: p.name })
      // Auto-reconnect: the MV3 service worker can be killed at any time.
      // Reconnecting re-triggers the resync flow so the panel stays populated.
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        setReconnectKey((k) => k + 1)
      }, 1000)
    })

    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      infoLog('panel', 'disconnecting background port', { tabId, portName: p.name })
      p.disconnect()
      portRef.current = null
      setPortConnected(false)
      setPortConnectedInStore(false)
    }
  }, [ingest, setPortConnectedInStore, reconnectKey])

  // Server transport — WebSocket to user-supplied endpoint
  useEffect(() => {
    if (!serverEnabled) {
      wsRef.current?.close()
      wsRef.current = null
      setServerStatus('idle')
      return
    }

    let ws: WebSocket
    let reconnectTimer: number | null = null
    let cancelled = false

    function connect() {
      if (cancelled) return
      setServerStatus('connecting')
      infoLog('panel', 'connecting to server transport', { serverUrl })
      try {
        ws = new WebSocket(serverUrl)
      } catch (error) {
        setServerStatus('error')
        warnLog('panel', 'failed to create WebSocket', { serverUrl, error })
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        setServerStatus('open')
        infoLog('panel', 'server transport open', { serverUrl })
        // Ask the server adapter to resync its actors, same as the browser transport does
        try { ws.send(JSON.stringify({ type: 'XSTATE_PANEL_CONNECTED' })) } catch { /* ignore */ }
      }
      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as MarkedPageMessage | PageToExtensionMessage
          const normalized = asPageMessage(parsed)
          if (!normalized) return
          debugLog('panel', 'received message from server transport', summarizeMessage(normalized))
          ingest(normalized)
        } catch (error) {
          warnLog('panel', 'failed to parse server transport message', {
            serverUrl,
            error,
            raw: typeof evt.data === 'string' ? evt.data : String(evt.data),
          })
        }
      }
      ws.onclose = () => {
        setServerStatus('closed')
        infoLog('panel', 'server transport closed; scheduling reconnect', { serverUrl })
        if (cancelled) return
        reconnectTimer = window.setTimeout(connect, 2000)
      }
      ws.onerror = () => {
        setServerStatus('error')
        warnLog('panel', 'server transport error', { serverUrl, readyState: ws.readyState })
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      wsRef.current = null
    }
  }, [serverEnabled, serverUrl, ingest])

  const dispatch = useCallback((message: ExtensionToPageMessage) => {
    // Broadcast to all transports — receivers ignore unknown sessionIds.
    debugLog('panel', 'dispatching event to transports', summarizeMessage(message))
    portRef.current?.postMessage({ ...message, __xstateDevtools: true })
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    } else {
      debugLog('panel', 'server transport unavailable for dispatch', {
        readyState: ws?.readyState ?? null,
      })
    }
  }, [])

  const onToggleServer = (enabled: boolean) => {
    setServerEnabled(enabled)
    try { localStorage.setItem(SERVER_URL_KEY + '.enabled', enabled ? '1' : '0') } catch { /* noop */ }
  }
  const onSetServerUrl = (url: string) => {
    setServerUrl(url)
    try { localStorage.setItem(SERVER_URL_KEY, url) } catch { /* noop */ }
  }

  return (
    <DispatchContext.Provider value={dispatch}>
      <ServerStatusBar
        portConnected={portConnected}
        browserMsgCount={browserMsgCount}
        enabled={serverEnabled}
        url={serverUrl}
        status={serverStatus}
        onToggle={onToggleServer}
        onUrlChange={onSetServerUrl}
      />
      <Layout />
    </DispatchContext.Provider>
  )
}

function ServerStatusBar({
  portConnected, browserMsgCount, enabled, url, status, onToggle, onUrlChange,
}: {
  portConnected: boolean
  browserMsgCount: number
  enabled: boolean
  url: string
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error'
  onToggle: (v: boolean) => void
  onUrlChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(url)

  const dot =
    status === 'open' ? '#52c41a'
    : status === 'connecting' ? '#faad14'
    : status === 'error' ? '#ff4d4f'
    : '#d9d9d9'

  return (
    <div style={{
      borderBottom: '1px solid #eee', background: '#fafafa',
      padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 11, flexShrink: 0,
    }}>
      {/* Browser transport indicator */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={portConnected ? `Browser transport connected (${browserMsgCount} messages received)` : 'Browser transport disconnected'}>
        <span style={{
          display: 'inline-block', width: 8, height: 8,
          borderRadius: '50%', background: portConnected ? '#52c41a' : '#ff4d4f',
          flexShrink: 0,
        }} />
        <span style={{ color: portConnected ? '#389e0d' : '#cf1322' }}>
          {portConnected ? `Connected${browserMsgCount > 0 ? ` · ${browserMsgCount} msg` : ''}` : 'Disconnected'}
        </span>
      </span>
      <span style={{ color: '#ddd' }}>|</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ margin: 0 }}
        />
        Server adapter
      </label>
      {enabled && (
        <>
          <span style={{
            display: 'inline-block', width: 8, height: 8,
            borderRadius: '50%', background: dot,
          }} title={status} />
          {editing ? (
            <>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onUrlChange(draft); setEditing(false) }
                  if (e.key === 'Escape') { setDraft(url); setEditing(false) }
                }}
                autoFocus
                style={{
                  fontFamily: 'monospace', fontSize: 11, padding: '1px 6px',
                  border: '1px solid #d9d9d9', borderRadius: 4, width: 240,
                }}
              />
              <button onClick={() => { onUrlChange(draft); setEditing(false) }} style={{ fontSize: 11 }}>Save</button>
              <button onClick={() => { setDraft(url); setEditing(false) }} style={{ fontSize: 11 }}>Cancel</button>
            </>
          ) : (
            <>
              <code style={{ fontSize: 11 }}>{url}</code>
              <button onClick={() => { setDraft(url); setEditing(true) }} style={{ fontSize: 11 }}>Edit</button>
            </>
          )}
          <span style={{ color: '#999', marginLeft: 'auto' }}>
            status: {status}
          </span>
        </>
      )}
    </div>
  )
}
