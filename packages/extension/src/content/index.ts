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
])

function asPageMessage(data: unknown): PageToExtensionMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (typeof type !== 'string' || !PAGE_MESSAGE_TYPES.has(type)) return null
  return data as PageToExtensionMessage
}

function asDispatchMessage(data: unknown): ExtensionToPageMessage | null {
  if (!data || typeof data !== 'object') return null
  if ((data as { type?: unknown }).type !== 'XSTATE_DISPATCH') return null
  return data as ExtensionToPageMessage
}

// Page → service worker: forward inspection events
window.addEventListener('message', (evt: MessageEvent) => {
  if (evt.source !== window) return
  const pageMessage = asPageMessage(evt.data)
  if (!pageMessage) return
  const marked: MarkedPageMessage = { ...pageMessage, __xstateDevtools: true }
  debugLog('content', 'forwarding page message to background', summarizeMessage(marked))
  chrome.runtime.sendMessage(marked)
})

// Service worker → page: forward dispatch events
chrome.runtime.onMessage.addListener((message: MarkedExtensionMessage | ExtensionToPageMessage) => {
  const dispatch = asDispatchMessage(message)
  if (!dispatch) return
  const marked: MarkedExtensionMessage = { ...dispatch, __xstateDevtools: true }
  debugLog('content', 'forwarding dispatch from background to page', summarizeMessage(marked))
  window.postMessage(marked, '*')
})
