// packages/extension/src/background/index.ts

import type {
  MarkedPageMessage,
  MarkedExtensionMessage,
  PageToExtensionMessage,
  ExtensionToPageMessage,
} from '../shared/types.js'
import { debugLog, infoLog, summarizeMessage } from '../shared/debug.js'

// tabId → devtools panel port
const panelPorts = new Map<number, chrome.runtime.Port>()

// tabId → content-script persistent port (see content/index.ts)
const contentPorts = new Map<number, chrome.runtime.Port>()

// tabId → buffered messages (panel may not be open yet)
const pendingMessages = new Map<number, MarkedPageMessage[]>()
const MAX_PENDING = 200

const PAGE_MESSAGE_TYPES = new Set([
  'XSTATE_ACTOR_REGISTERED',
  'XSTATE_SNAPSHOT',
  'XSTATE_EVENT',
  'XSTATE_ACTOR_STOPPED',
  'XSTATE_ADAPTER_READY',
])

function asPageMessage(data: unknown): MarkedPageMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (typeof type !== 'string' || !PAGE_MESSAGE_TYPES.has(type)) return null
  const page = data as PageToExtensionMessage
  return { ...page, __xstateDevtools: true }
}

function asDispatchMessage(data: unknown): MarkedExtensionMessage | null {
  if (!data || typeof data !== 'object') return null
  if ((data as { type?: unknown }).type !== 'XSTATE_DISPATCH') return null
  const dispatch = data as ExtensionToPageMessage
  return { ...dispatch, __xstateDevtools: true }
}

/** Forward a page message to the panel, or buffer it if the panel is not open. */
function forwardToPanel(tabId: number, normalized: MarkedPageMessage): void {
  const port = panelPorts.get(tabId)
  if (port) {
    debugLog('background', 'forwarding page message to panel', {
      tabId,
      message: summarizeMessage(normalized),
    })
    port.postMessage(normalized)
  } else {
    const buf = pendingMessages.get(tabId) ?? []
    buf.push(normalized)
    if (buf.length > MAX_PENDING) buf.shift()
    pendingMessages.set(tabId, buf)
    debugLog('background', 'buffered page message; panel not connected', {
      tabId,
      pendingCount: buf.length,
      message: summarizeMessage(normalized),
    })
  }
}

/**
 * Send XSTATE_PANEL_CONNECTED to the content script for the given tab.
 * Prefers the persistent content-script port (reliable across service-worker
 * restarts) and falls back to chrome.tabs.sendMessage for first-load cases
 * where the content script hasn't yet opened its port.
 */
function sendPanelConnected(tabId: number): void {
  const csPort = contentPorts.get(tabId)
  if (csPort) {
    infoLog('background', 'sending PANEL_CONNECTED via content port', { tabId })
    csPort.postMessage({ type: 'XSTATE_PANEL_CONNECTED', __xstateDevtools: true })
  } else {
    infoLog('background', 'sending PANEL_CONNECTED via chrome.tabs.sendMessage (fallback)', { tabId })
    chrome.tabs.sendMessage(
      tabId,
      { type: 'XSTATE_PANEL_CONNECTED', __xstateDevtools: true },
      () => void chrome.runtime.lastError
    )
  }
}

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  // ── Content-script persistent port ──────────────────────────────────────
  if (port.name === 'xstate-content') {
    const tabId = port.sender?.tab?.id
    if (tabId == null) return

    contentPorts.set(tabId, port)
    infoLog('background', 'content script port connected', { tabId })

    // If the devtools panel is already open for this tab, trigger a resync
    // immediately.  This handles the case where the MV3 service worker was
    // killed while the panel was open: the content script reconnects ~250 ms
    // later and the panel's actor list needs to be repopulated.
    if (panelPorts.has(tabId)) {
      infoLog('background', 'panel already connected; sending PANEL_CONNECTED via new content port', { tabId })
      port.postMessage({ type: 'XSTATE_PANEL_CONNECTED', __xstateDevtools: true })
    }

    // Content script → panel: page inspection events arrive via this port.
    port.onMessage.addListener((message: MarkedPageMessage | PageToExtensionMessage) => {
      const normalized = asPageMessage(message)
      if (!normalized) return

      if (normalized.type === 'XSTATE_ADAPTER_READY') {
        if (panelPorts.has(tabId)) {
          infoLog('background', 'adapter ready; sending PANEL_CONNECTED for resync', { tabId })
          port.postMessage({ type: 'XSTATE_PANEL_CONNECTED', __xstateDevtools: true })
        }
        return
      }

      forwardToPanel(tabId, normalized)
    })

    port.onDisconnect.addListener(() => {
      if (contentPorts.get(tabId) === port) contentPorts.delete(tabId)
      infoLog('background', 'content script port disconnected', { tabId })
    })
    return
  }

  // ── Devtools panel port ──────────────────────────────────────────────────
  const match = port.name.match(/^xstate-panel-(\d+)$/)
  if (!match) return

  const tabId = parseInt(match[1], 10)
  panelPorts.set(tabId, port)
  infoLog('background', 'panel connected', { tabId, portName: port.name })

  // Flush buffered messages to the newly connected panel
  const pending = pendingMessages.get(tabId) ?? []
  infoLog('background', 'flushing buffered messages to panel', {
    tabId,
    pendingCount: pending.length,
  })
  pending.forEach((msg) => port.postMessage(msg))
  pendingMessages.delete(tabId)

  // Notify the page that the devtools panel is now connected so the adapter
  // can re-broadcast existing state.
  sendPanelConnected(tabId)

  // Guard against old-port onDisconnect firing after a new port is registered
  // (MV3 timing race): only remove if the disconnecting port is still current.
  port.onDisconnect.addListener(() => {
    if (panelPorts.get(tabId) === port) panelPorts.delete(tabId)
    infoLog('background', 'panel disconnected', { tabId, portName: port.name })
  })

  // Panel → content script (dispatch events)
  port.onMessage.addListener((message: MarkedExtensionMessage | ExtensionToPageMessage) => {
    const dispatch = asDispatchMessage(message)
    if (dispatch?.type === 'XSTATE_DISPATCH') {
      debugLog('background', 'forwarding dispatch from panel to tab', {
        tabId,
        message: summarizeMessage(dispatch),
      })
      const csPort = contentPorts.get(tabId)
      if (csPort) {
        csPort.postMessage(dispatch)
      } else {
        chrome.tabs.sendMessage(tabId, dispatch, () => void chrome.runtime.lastError)
      }
    }
  })
})

// Clean up when tab is closed or navigated
chrome.tabs.onRemoved.addListener((tabId) => {
  pendingMessages.delete(tabId)
  panelPorts.delete(tabId)
  contentPorts.delete(tabId)
  infoLog('background', 'tab removed; cleared panel state', { tabId })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Tab navigated — stale buffered messages are no longer valid.
    // Also tell the panel so it clears stale actors from the previous page.
    pendingMessages.delete(tabId)
    const panelPort = panelPorts.get(tabId)
    if (panelPort) {
      try { panelPort.postMessage({ type: 'XSTATE_PAGE_NAVIGATED' }) } catch { /* port closing */ }
    }
    infoLog('background', 'tab started loading; cleared pending messages', { tabId })
  }
})

// Fallback: content script → panel via chrome.runtime.sendMessage.
// Used during the ~250 ms reconnect window when the persistent port is not yet
// re-established after a service-worker restart.
chrome.runtime.onMessage.addListener(
  (message: MarkedPageMessage | PageToExtensionMessage, sender: chrome.runtime.MessageSender) => {
    const normalized = asPageMessage(message)
    if (!normalized) return
    const tabId = sender.tab?.id
    if (tabId == null) return

    if (normalized.type === 'XSTATE_ADAPTER_READY') {
      if (panelPorts.has(tabId)) {
        infoLog('background', 'adapter ready (sendMessage fallback); sending PANEL_CONNECTED for resync', { tabId })
        sendPanelConnected(tabId)
      }
      return
    }

    forwardToPanel(tabId, normalized)
  }
)
