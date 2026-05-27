// Browser entrypoint — uses window.postMessage via the extension's injected bridge.
import type {
  ExtensionToPageMessage,
  PageToExtensionMessage,
} from '../../extension/src/shared/types.js'
import { createInspector, type Transport } from './core.js'
import { debugLog, infoLog, warnLog } from './logging.js'

declare global {
  interface Window {
    __XSTATE_DEVTOOLS__?: {
      send: (message: unknown) => void
    }
  }
}

export function createAdapter() {
  if (typeof window === 'undefined') {
    // Non-browser env (SSR/SSG/server) — return a no-op so importing this module is safe.
    infoLog('web:adapter', 'createAdapter called without window; returning no-op adapter')
    return { inspect: () => {}, dispose: () => {} }
  }

  infoLog('web:adapter', 'creating browser adapter', {
    hookInstalled: Boolean(window.__XSTATE_DEVTOOLS__),
  })

  let warnedMissingHook = false

  const transport: Transport = {
    send(message: PageToExtensionMessage) {
      const payload = { ...message, __xstateDevtools: true as const }
      debugLog('web:adapter', 'sending message via page hook', {
        type: message.type,
        sessionId: 'sessionId' in message ? message.sessionId : undefined,
      })
      if (window.__XSTATE_DEVTOOLS__) {
        window.__XSTATE_DEVTOOLS__.send(payload)
        return
      }

      if (!warnedMissingHook) {
        warnedMissingHook = true
        warnLog('web:adapter', 'page hook missing; using direct window.postMessage fallback')
      }
      // Fallback keeps inspection working if MAIN-world injection is unavailable.
      window.postMessage(payload, '*')
    },
    subscribe(handler) {
      infoLog('web:adapter', 'subscribing to window messages')
      const onMessage = (evt: MessageEvent) => {
        if (evt.source !== window) return
        const data = evt.data
        if (!data?.__xstateDevtools) return
        debugLog('web:adapter', 'received message from window bridge', {
          type: (data as ExtensionToPageMessage).type,
          sessionId:
            'sessionId' in (data as ExtensionToPageMessage)
              ? (data as ExtensionToPageMessage & { sessionId?: string }).sessionId
              : undefined,
        })
        handler(data as ExtensionToPageMessage)
      }
      window.addEventListener('message', onMessage)
      return () => {
        infoLog('web:adapter', 'unsubscribing from window messages')
        window.removeEventListener('message', onMessage)
      }
    },
  }

  return createInspector(transport, 'web')
}
