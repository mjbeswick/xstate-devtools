// packages/extension/src/panel/App.tsx
import React, { useEffect, useState } from 'react'
import { useStore } from './store.js'
import { Layout } from './components/Layout.js'
import { PortContext } from './port-context.js'
import type { PageToExtensionMessage, MarkedPageMessage } from '../shared/types.js'

export function App() {
  const handleMessage = useStore((s) => s.handleMessage)
  const [port, setPort] = useState<chrome.runtime.Port | null>(null)

  useEffect(() => {
    const tabId = chrome.devtools.inspectedWindow.tabId
    const p = chrome.runtime.connect({ name: `xstate-panel-${tabId}` })
    setPort(p)

    p.onMessage.addListener((message: MarkedPageMessage) => {
      if (!message?.__xstateDevtools) return
      handleMessage(message as PageToExtensionMessage)
    })

    return () => {
      p.disconnect()
      setPort(null)
    }
  }, [handleMessage])

  return (
    <PortContext.Provider value={port}>
      <Layout />
    </PortContext.Provider>
  )
}
