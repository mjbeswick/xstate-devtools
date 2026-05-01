// packages/extension/src/panel/port-context.ts
import { createContext, useContext } from 'react'

export const PortContext = createContext<chrome.runtime.Port | null>(null)

export function usePort(): chrome.runtime.Port | null {
  return useContext(PortContext)
}
