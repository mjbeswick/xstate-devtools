// packages/extension/src/panel/App.tsx
import React, { useEffect } from 'react'
import { useStore } from './store.js'
import { Layout } from './components/Layout.js'
import type { PageToExtensionMessage, MarkedPageMessage } from '../shared/types.js'

export function App() {
  const handleMessage = useStore((s) => s.handleMessage)

  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId
    const port = chrome.runtime.connect({ name: `xstate-panel-${tabId}` })

    port.onMessage.addListener((message: MarkedPageMessage) => {
      if (!message?.__xstateDevtools) return
      handleMessage(message as PageToExtensionMessage)
    })

    return () => port.disconnect()
  }, [handleMessage])

  return <Layout />
}
