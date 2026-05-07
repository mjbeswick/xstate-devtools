// Browser entrypoint — uses window.postMessage via the extension's injected bridge.
import type { ExtensionToPageMessage, PageToExtensionMessage } from '../../extension/src/shared/types.js'
import { createInspector, type Transport } from './core.js'

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
    console.info('[xstate-devtools:web:adapter] createAdapter called without window; returning no-op adapter')
    return { inspect: () => {}, dispose: () => {} }
  }

  console.info('[xstate-devtools:web:adapter] creating browser adapter', {
    hookInstalled: Boolean(window.__XSTATE_DEVTOOLS__),
  })

  let warnedMissingHook = false

  const transport: Transport = {
    send(message: PageToExtensionMessage) {
      const payload = { ...message, __xstateDevtools: true as const }
      console.debug('[xstate-devtools:web:adapter] sending message via page hook', {
        type: message.type,
        sessionId: 'sessionId' in message ? message.sessionId : undefined,
      })
      if (window.__XSTATE_DEVTOOLS__) {
        window.__XSTATE_DEVTOOLS__.send(payload)
        return
      }

      if (!warnedMissingHook) {
        warnedMissingHook = true
        console.warn('[xstate-devtools:web:adapter] page hook missing; using direct window.postMessage fallback')
      }
      // Fallback keeps inspection working if MAIN-world injection is unavailable.
      window.postMessage(payload, '*')
    },
    subscribe(handler) {
      console.info('[xstate-devtools:web:adapter] subscribing to window messages')
      const onMessage = (evt: MessageEvent) => {
        if (evt.source !== window) return
        const data = evt.data
        if (!data?.__xstateDevtools) return
        console.debug('[xstate-devtools:web:adapter] received message from window bridge', {
          type: (data as ExtensionToPageMessage).type,
          sessionId: 'sessionId' in (data as ExtensionToPageMessage)
            ? (data as ExtensionToPageMessage & { sessionId?: string }).sessionId
            : undefined,
        })
        handler(data as ExtensionToPageMessage)
      }
      window.addEventListener('message', onMessage)
      return () => {
        console.info('[xstate-devtools:web:adapter] unsubscribing from window messages')
        window.removeEventListener('message', onMessage)
      }
    },
  }

  return createInspector(transport, 'web')
}
