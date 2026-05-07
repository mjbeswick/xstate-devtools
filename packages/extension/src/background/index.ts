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

// tabId → buffered messages (panel may not be open yet)
const pendingMessages = new Map<number, MarkedPageMessage[]>()
const MAX_PENDING = 200

const PAGE_MESSAGE_TYPES = new Set([
  'XSTATE_ACTOR_REGISTERED',
  'XSTATE_SNAPSHOT',
  'XSTATE_EVENT',
  'XSTATE_ACTOR_STOPPED',
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

// Panel connects with name "xstate-panel-{tabId}"
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
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

  port.onDisconnect.addListener(() => {
    panelPorts.delete(tabId)
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
      chrome.tabs.sendMessage(tabId, dispatch, () => void chrome.runtime.lastError)
    }
  })
})

// Clean up when tab is closed or navigated
chrome.tabs.onRemoved.addListener((tabId) => {
  pendingMessages.delete(tabId)
  panelPorts.delete(tabId)
  infoLog('background', 'tab removed; cleared panel state', { tabId })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Tab navigated — stale buffered messages are no longer valid
    pendingMessages.delete(tabId)
    infoLog('background', 'tab started loading; cleared pending messages', { tabId })
  }
})

// Content script → panel (inspection events)
chrome.runtime.onMessage.addListener(
  (message: MarkedPageMessage | PageToExtensionMessage, sender: chrome.runtime.MessageSender) => {
    const normalized = asPageMessage(message)
    if (!normalized) return
    const tabId = sender.tab?.id
    if (tabId == null) return

    const port = panelPorts.get(tabId)
    if (port) {
      debugLog('background', 'forwarding page message to panel', {
        tabId,
        message: summarizeMessage(normalized),
      })
      port.postMessage(normalized)
    } else {
      // Buffer for when panel opens
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
)
