// packages/chrome-extension/src/panel/App.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from './store.js'
import { Layout } from './components/Layout.js'
import { DispatchContext } from './port-context.js'
import { exportSession, importSession } from './session-io.js'
import type {
  PageToExtensionMessage, ExtensionToPageMessage, MarkedPageMessage,
} from '../shared/types.js'

const SERVER_URL_KEY = 'xstate-devtools.serverUrl'
const DEFAULT_SERVER_URL = 'ws://localhost:9301'

export function App() {
  const handleMessage = useStore((s) => s.handleMessage)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const panelSeqRef = useRef(0)

  /**
   * Rewrite each incoming message's globalSeq to a panel-monotonic value.
   * Browser and server adapters each have their own per-process seq, so naive
   * merging would produce overlapping values. This rebases everything onto
   * one timeline at the point of ingest.
   */
  const ingest = useCallback((message: PageToExtensionMessage) => {
    panelSeqRef.current += 1
    const seq = panelSeqRef.current
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

  // Browser transport — content-script port
  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId
    const p = chrome.runtime.connect({ name: `xstate-panel-${tabId}` })
    portRef.current = p

    p.onMessage.addListener((message: MarkedPageMessage) => {
      if (!message?.__xstateDevtools) return
      ingest(message as PageToExtensionMessage)
    })

    return () => {
      p.disconnect()
      portRef.current = null
    }
  }, [ingest])

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
      try {
        ws = new WebSocket(serverUrl)
      } catch {
        setServerStatus('error')
        return
      }
      wsRef.current = ws

      ws.onopen = () => setServerStatus('open')
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as MarkedPageMessage
          if (!data?.__xstateDevtools) return
          ingest(data as PageToExtensionMessage)
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        setServerStatus('closed')
        if (cancelled) return
        reconnectTimer = window.setTimeout(connect, 2000)
      }
      ws.onerror = () => {
        setServerStatus('error')
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
    portRef.current?.postMessage({ ...message, __xstateDevtools: true })
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
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
        enabled={serverEnabled}
        url={serverUrl}
        status={serverStatus}
        onToggle={onToggleServer}
        onUrlChange={onSetServerUrl}
      />
      <SessionControls />
      <Layout />
    </DispatchContext.Provider>
  )
}

function SessionControls() {
  const replayMode = useStore((s) => s.replayMode)
  const replayName = useStore((s) => s.replayName)
  const eventCount = useStore((s) => s.events.length)
  const loadSession = useStore((s) => s.loadSession)
  const exitReplay = useStore((s) => s.exitReplay)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const onExport = () => {
    setError(null)
    const state = useStore.getState()
    const doc = exportSession(state, Date.now())
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date(doc.exportedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href = url
    a.download = `xstate-session-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onPickFile = () => fileRef.current?.click()

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const data = importSession(JSON.parse(text))
      loadSession(data, file.name)
    } catch (err) {
      setError((err as Error).message || 'Failed to import session.')
    }
  }

  const btnStyle: React.CSSProperties = {
    fontSize: 11, padding: '1px 8px', cursor: 'pointer',
    background: '#fff', border: '1px solid #d9d9d9', borderRadius: 4, color: '#444',
  }

  return (
    <div style={{
      borderBottom: '1px solid #eee', background: '#fafafa',
      padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 8,
      fontSize: 11, flexShrink: 0,
    }}>
      {replayMode ? (
        <>
          <span style={{ color: '#722ed1', fontWeight: 600 }}>● Replay</span>
          <code style={{ fontSize: 11 }}>{replayName}</code>
          <span style={{ color: '#999' }}>· {eventCount} events</span>
          <button onClick={exitReplay} style={{ ...btnStyle, marginLeft: 'auto' }}>Exit replay</button>
        </>
      ) : (
        <>
          <span style={{ color: '#666' }}>Session</span>
          <button onClick={onExport} disabled={eventCount === 0} style={{
            ...btnStyle, cursor: eventCount === 0 ? 'default' : 'pointer',
            opacity: eventCount === 0 ? 0.5 : 1,
          }}>Export</button>
          <button onClick={onPickFile} style={btnStyle}>Import</button>
          {error && <span style={{ color: '#cf1322' }}>{error}</span>}
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={onFileChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}

function ServerStatusBar({
  enabled, url, status, onToggle, onUrlChange,
}: {
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
