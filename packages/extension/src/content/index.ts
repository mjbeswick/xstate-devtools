// packages/extension/src/content/index.ts

import type { MarkedPageMessage, MarkedExtensionMessage } from '../shared/types.js'

// Page → service worker: forward inspection events
window.addEventListener('message', (evt: MessageEvent) => {
  if (evt.source !== window) return
  const data = evt.data as MarkedPageMessage
  if (!data?.__xstateDevtools) return
  // Only forward known inspection message types
  if (
    data.type === 'XSTATE_ACTOR_REGISTERED' ||
    data.type === 'XSTATE_SNAPSHOT' ||
    data.type === 'XSTATE_EVENT' ||
    data.type === 'XSTATE_ACTOR_STOPPED'
  ) {
    chrome.runtime.sendMessage(data)
  }
})

// Service worker → page: forward dispatch events
chrome.runtime.onMessage.addListener((message: MarkedExtensionMessage) => {
  if (!message?.__xstateDevtools) return
  if (message.type === 'XSTATE_DISPATCH') {
    window.postMessage(message, '*')
  }
})
