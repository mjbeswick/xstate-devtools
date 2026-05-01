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
    return { inspect: () => {}, dispose: () => {} }
  }

  const transport: Transport = {
    send(message: PageToExtensionMessage) {
      window.__XSTATE_DEVTOOLS__?.send({ ...message, __xstateDevtools: true })
    },
    subscribe(handler) {
      const onMessage = (evt: MessageEvent) => {
        if (evt.source !== window) return
        const data = evt.data
        if (!data?.__xstateDevtools) return
        handler(data as ExtensionToPageMessage)
      }
      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    },
  }

  return createInspector(transport, 'web')
}
