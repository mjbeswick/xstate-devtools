// packages/extension/src/injected/index.ts

import type { MarkedExtensionMessage } from '../shared/types.js'

// Set the hook before any page scripts run (run_at: document_start)
window.__XSTATE_DEVTOOLS__ = {
  send: (message: unknown) => {
    // Forward inspection events to the content script (isolated world)
    window.postMessage(message, '*')
  },
}

// Type declaration for the global hook
declare global {
  interface Window {
    __XSTATE_DEVTOOLS__?: {
      send: (message: unknown) => void
    }
  }
}
