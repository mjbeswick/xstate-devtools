// packages/extension/src/content/index.ts

import type {
  MarkedPageMessage,
  MarkedExtensionMessage,
  PageToExtensionMessage,
  ExtensionToPageMessage,
} from '../shared/types.js'
import { debugLog, infoLog, summarizeMessage } from '../shared/debug.js'

infoLog('content', 'content script loaded')

const PAGE_MESSAGE_TYPES = new Set([
  'XSTATE_ACTOR_REGISTERED',
  'XSTATE_SNAPSHOT',
  'XSTATE_EVENT',
  'XSTATE_ACTOR_STOPPED',
  'XSTATE_ADAPTER_READY',
])

function asPageMessage(data: unknown): PageToExtensionMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (typeof type !== 'string' || !PAGE_MESSAGE_TYPES.has(type)) return null
  return data as PageToExtensionMessage
}

function asDispatchMessage(data: unknown): ExtensionToPageMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (type !== 'XSTATE_DISPATCH' && type !== 'XSTATE_PANEL_CONNECTED') return null
  return data as ExtensionToPageMessage
}

// ── Persistent port to the background service worker ─────────────────────────
// Using a long-lived port (instead of chrome.runtime.onMessage / sendMessage)
// survives MV3 service-worker restarts.  When the worker is killed the port
// fires onDisconnect; the content script reconnects after a short delay so the
// next XSTATE_PANEL_CONNECTED message from the background is reliably received.
let bgPort: chrome.runtime.Port | null = null

function connectToBg(): void {
  // chrome.runtime.id is unset when the extension context has been invalidated
  // (extension reloaded/updated while the page was open); bail out silently.
  if (!chrome.runtime?.id) return
  try {
    bgPort = chrome.runtime.connect({ name: 'xstate-content' })
  } catch {
    // Extension context invalidated — give up silently.
    return
  }
  infoLog('content', 'connected persistent port to background')

  // Background → page: forward XSTATE_PANEL_CONNECTED and XSTATE_DISPATCH
  bgPort.onMessage.addListener((message: MarkedExtensionMessage | ExtensionToPageMessage) => {
    const dispatch = asDispatchMessage(message)
    if (!dispatch) return
    const marked: MarkedExtensionMessage = { ...dispatch, __xstateDevtools: true }
    debugLog('content', 'forwarding dispatch from background to page', summarizeMessage(marked))
    window.postMessage(marked, '*')
  })

  bgPort.onDisconnect.addListener(() => {
    bgPort = null
    infoLog('content', 'background port disconnected; scheduling reconnect')
    // Reconnect so the next PANEL_CONNECTED from the background reaches the page.
    setTimeout(connectToBg, 250)
  })
}

connectToBg()

// Page → background: forward inspection events.
// Prefer the persistent port; fall back to sendMessage while the port is
// reconnecting (e.g. during the ~250 ms window after a service-worker restart).
window.addEventListener('message', (evt: MessageEvent) => {
  if (evt.source !== window) return
  const pageMessage = asPageMessage(evt.data)
  if (!pageMessage) return
  const marked: MarkedPageMessage = { ...pageMessage, __xstateDevtools: true }
  debugLog('content', 'forwarding page message to background', summarizeMessage(marked))
  if (bgPort) {
    bgPort.postMessage(marked)
  } else {
    // Fallback: sendMessage wakes up the service worker during the reconnect gap.
    try { chrome.runtime.sendMessage(marked) } catch { /* extension context invalidated */ }
  }
})

// Background sendMessage fallback -> page.
// This path is used when the panel asks for a resync before the persistent
// content port is available for this tab.
chrome.runtime.onMessage.addListener((message: MarkedExtensionMessage | ExtensionToPageMessage) => {
  const dispatch = asDispatchMessage(message)
  if (!dispatch) return
  const marked: MarkedExtensionMessage = { ...dispatch, __xstateDevtools: true }
  debugLog('content', 'forwarding dispatch from background sendMessage fallback to page', summarizeMessage(marked))
  window.postMessage(marked, '*')
})
