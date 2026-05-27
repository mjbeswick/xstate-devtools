// packages/extension/src/panel/App.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { debugLog, infoLog, summarizeMessage, warnLog } from '../shared/debug.js'
import type {
  ExtensionToPageMessage,
  MarkedPageMessage,
  PageToExtensionMessage,
} from '../shared/types.js'
import { Layout } from './components/Layout.js'
import { DispatchContext } from './port-context.js'
import { ServerControlsContext } from './server-context.js'
import { setBackgroundPort } from './open-source.js'
import { useStore } from './store.js'

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

const BROWSER_RECONNECT_WARN_ATTEMPTS = 5
const BROWSER_RECONNECT_WARN_ELAPSED_MS = 10_000

export interface BrowserReconnectFailureState {
  startedAt: number
  attempts: number
  warned: boolean
}

export function registerBrowserReconnectFailure(
  previous: BrowserReconnectFailureState | null,
  now: number,
): { next: BrowserReconnectFailureState; shouldWarn: boolean; elapsedMs: number } {
  const next: BrowserReconnectFailureState = previous
    ? { ...previous, attempts: previous.attempts + 1 }
    : { startedAt: now, attempts: 1, warned: false }

  const elapsedMs = Math.max(0, now - next.startedAt)
  const thresholdReached =
    next.attempts >= BROWSER_RECONNECT_WARN_ATTEMPTS ||
    elapsedMs >= BROWSER_RECONNECT_WARN_ELAPSED_MS
  const shouldWarn = !next.warned && thresholdReached

  if (shouldWarn) next.warned = true

  return { next, shouldWarn, elapsedMs }
}

function asPageMessage(data: unknown): PageToExtensionMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (typeof type !== 'string' || !PAGE_MESSAGE_TYPES.has(type)) return null
  return data as PageToExtensionMessage
}

export function shouldResetBrowserStateOnFirstMessage(
  message: PageToExtensionMessage,
  actorCount: number,
  awaitingFirstMessage: boolean,
): boolean {
  return awaitingFirstMessage && actorCount > 0 && message.type !== 'XSTATE_PAGE_NAVIGATED'
}

export function shouldResetPanelAfterNavigation(
  message: PageToExtensionMessage,
  pendingNavigationReset: boolean,
): boolean {
  return (
    pendingNavigationReset &&
    message.type !== 'XSTATE_PAGE_NAVIGATED' &&
    message.type !== 'XSTATE_ADAPTER_READY'
  )
}

export function getBrowserTransportStatus(
  portConnected: boolean,
  browserMsgCount: number,
  serverStatus: 'idle' | 'connecting' | 'open' | 'closed' | 'error',
): 'disconnected' | 'waiting' | 'connected' {
  const browserConnected = portConnected && browserMsgCount > 0
  const serverConnected = serverStatus === 'open'

  if (browserConnected || serverConnected) return 'connected'

  if (!portConnected && !serverConnected) return 'disconnected'
  if (serverStatus === 'closed' || serverStatus === 'error') {
    return 'disconnected'
  }

  return 'waiting'
}

export function App() {
  const handleMessage = useStore((s) => s.handleMessage)
  const resetPanel = useStore((s) => s.resetPanel)
  const setPortConnectedInStore = useStore((s) => s.setPortConnected)
  const portRef = useRef<chrome.runtime.Port | null>(null)

  // Mount log — helps confirm the panel React app has initialised
  useEffect(() => {
    console.log(
      '[xstate-devtools:panel] panel mounted, tabId =',
      chrome.devtools.inspectedWindow.tabId,
    )
  }, [])
  const wsRef = useRef<WebSocket | null>(null)
  const panelSeqRef = useRef(0)

  // Incrementing this causes the browser-transport effect to re-run and
  // reconnect the background port.  Used to auto-recover after the MV3 service
  // worker is killed and the port drops.
  const [reconnectKey, setReconnectKey] = useState(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const awaitingBrowserFirstMessageRef = useRef(true)
  const pendingNavigationResetRef = useRef(false)
  const intentionalDisconnectPortRef = useRef<chrome.runtime.Port | null>(null)
  const browserReconnectFailureRef = useRef<BrowserReconnectFailureState | null>(null)

  const resetPanelState = useCallback(
    (reason: 'page-navigated' | 'browser-resync') => {
      panelSeqRef.current = 0
      setBrowserMsgCount(0)
      resetPanel()
      infoLog('panel', 'reset panel state', { reason })
    },
    [resetPanel],
  )

  /**
   * Rewrite each incoming message's globalSeq to a panel-monotonic value.
   * Browser and server adapters each have their own per-process seq, so naive
   * merging would produce overlapping values. This rebases everything onto
   * one timeline at the point of ingest.
   */
  const ingest = useCallback(
    (message: PageToExtensionMessage) => {
      if (message.type === 'XSTATE_PAGE_NAVIGATED') {
        console.log('[xstate-devtools:panel] page navigated — preserving state until resync')
        pendingNavigationResetRef.current = true
        const currentPort = portRef.current
        if (currentPort) {
          intentionalDisconnectPortRef.current = currentPort
          setReconnectKey((key) => key + 1)
        }
        return
      }
      if (shouldResetPanelAfterNavigation(message, pendingNavigationResetRef.current)) {
        resetPanelState('page-navigated')
        pendingNavigationResetRef.current = false
      }
      panelSeqRef.current += 1
      const seq = panelSeqRef.current
      debugLog('panel', 'ingesting message', {
        original: summarizeMessage(message),
        rebasedGlobalSeq: seq,
      })
      if (
        message.type === 'XSTATE_ACTOR_REGISTERED' ||
        message.type === 'XSTATE_SNAPSHOT' ||
        message.type === 'XSTATE_EVENT'
      ) {
        handleMessage({ ...message, globalSeq: seq })
      } else {
        handleMessage(message)
      }
    },
    [handleMessage, resetPanelState],
  )

  const [serverUrl, setServerUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(SERVER_URL_KEY) ?? DEFAULT_SERVER_URL
    } catch {
      return DEFAULT_SERVER_URL
    }
  })
  const [serverStatus, setServerStatus] = useState<
    'idle' | 'connecting' | 'open' | 'closed' | 'error'
  >('connecting')
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
    awaitingBrowserFirstMessageRef.current = true
    pendingNavigationResetRef.current = false
    infoLog('panel', 'connecting to background port', { tabId, reconnectKey })
    const p = chrome.runtime.connect({ name: `xstate-panel-${tabId}` })
    setBackgroundPort(p)
    portRef.current = p
    setPortConnected(true)
    setPortConnectedInStore(true)
    infoLog('panel', 'connected to background port', { tabId, portName: p.name })
    if (browserReconnectFailureRef.current) {
      const { attempts, startedAt } = browserReconnectFailureRef.current
      infoLog('panel', 'background port reconnected after failures', {
        tabId,
        attempts,
        elapsedMs: Math.max(0, Date.now() - startedAt),
      })
      browserReconnectFailureRef.current = null
    }

    p.onMessage.addListener((message: MarkedPageMessage | PageToExtensionMessage) => {
      const normalized = asPageMessage(message)
      if (!normalized) return
      if (
        shouldResetBrowserStateOnFirstMessage(
          normalized,
          useStore.getState().actors.size,
          awaitingBrowserFirstMessageRef.current,
        )
      ) {
        resetPanelState('browser-resync')
      }
      awaitingBrowserFirstMessageRef.current = false
      debugLog('panel', 'received message from browser transport', summarizeMessage(normalized))
      setBrowserMsgCount((n) => {
        if (n === 0)
          infoLog(
            'panel',
            'first message received from browser transport',
            summarizeMessage(normalized),
          )
        return n + 1
      })
      ingest(normalized)
      awaitingBrowserFirstMessageRef.current = normalized.type === 'XSTATE_PAGE_NAVIGATED'
    })

    p.onDisconnect.addListener(() => {
      if (intentionalDisconnectPortRef.current === p) {
        intentionalDisconnectPortRef.current = null
        infoLog('panel', 'background port disconnected for intentional reconnect', {
          tabId,
          portName: p.name,
        })
        return
      }
      setPortConnected(false)
      setPortConnectedInStore(false)
      const { next, shouldWarn, elapsedMs } = registerBrowserReconnectFailure(
        browserReconnectFailureRef.current,
        Date.now(),
      )
      browserReconnectFailureRef.current = next
      if (shouldWarn) {
        warnLog('panel', 'background port reconnect still failing', {
          tabId,
          attempts: next.attempts,
          elapsedMs,
          portName: p.name,
        })
      }
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
      awaitingBrowserFirstMessageRef.current = true
      pendingNavigationResetRef.current = false
      browserReconnectFailureRef.current = null
      infoLog('panel', 'disconnecting background port', { tabId, portName: p.name })
      intentionalDisconnectPortRef.current = p
      p.disconnect()
      portRef.current = null
      setPortConnected(false)
      setPortConnectedInStore(false)
    }
  }, [ingest, setPortConnectedInStore, reconnectKey, resetPanelState])

  // Server transport — WebSocket to user-supplied endpoint (always enabled)
  useEffect(() => {
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
        try {
          ws.send(JSON.stringify({ type: 'XSTATE_PANEL_CONNECTED' }))
        } catch {
          /* ignore */
        }
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
  }, [serverUrl, ingest])

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

  const onSetServerUrl = (url: string) => {
    setServerUrl(url)
    try {
      localStorage.setItem(SERVER_URL_KEY, url)
    } catch {
      /* noop */
    }
  }

  return (
    <DispatchContext.Provider value={dispatch}>
      <ServerControlsContext.Provider
        value={{
          url: serverUrl,
          status: serverStatus,
          onUrlChange: onSetServerUrl,
        }}
      >
        <Layout />
      </ServerControlsContext.Provider>
    </DispatchContext.Provider>
  )
}
