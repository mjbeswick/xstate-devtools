// packages/extension/src/background/index.ts

import type { MarkedPageMessage, MarkedExtensionMessage } from '../shared/types.js'

// tabId → devtools panel port
const panelPorts = new Map<number, chrome.runtime.Port>()

// tabId → buffered messages (panel may not be open yet)
const pendingMessages = new Map<number, MarkedPageMessage[]>()
const MAX_PENDING = 200

// Panel connects with name "xstate-panel-{tabId}"
chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
  const match = port.name.match(/^xstate-panel-(\d+)$/)
  if (!match) return

  const tabId = parseInt(match[1], 10)
  panelPorts.set(tabId, port)

  // Flush buffered messages to the newly connected panel
  const pending = pendingMessages.get(tabId) ?? []
  pending.forEach((msg) => port.postMessage(msg))
  pendingMessages.delete(tabId)

  port.onDisconnect.addListener(() => {
    panelPorts.delete(tabId)
  })

  // Panel → content script (dispatch events)
  port.onMessage.addListener((message: MarkedExtensionMessage) => {
    if (!message?.__xstateDevtools) return
    if (message.type === 'XSTATE_DISPATCH') {
      chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError)
    }
  })
})

// Clean up when tab is closed or navigated
chrome.tabs.onRemoved.addListener((tabId) => {
  pendingMessages.delete(tabId)
  panelPorts.delete(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    // Tab navigated — stale buffered messages are no longer valid
    pendingMessages.delete(tabId)
  }
})

// Content script → panel (inspection events)
chrome.runtime.onMessage.addListener(
  (message: MarkedPageMessage, sender: chrome.runtime.MessageSender) => {
    if (!message?.__xstateDevtools) return
    const tabId = sender.tab?.id
    if (tabId == null) return

    const port = panelPorts.get(tabId)
    if (port) {
      port.postMessage(message)
    } else {
      // Buffer for when panel opens
      const buf = pendingMessages.get(tabId) ?? []
      buf.push(message)
      if (buf.length > MAX_PENDING) buf.shift()
      pendingMessages.set(tabId, buf)
    }
  }
)
