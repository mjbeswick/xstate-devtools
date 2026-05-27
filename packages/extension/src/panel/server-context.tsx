import { createContext, useContext } from 'react'

export interface ServerControls {
  url: string
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error'
  onUrlChange: (url: string) => void
}

export const ServerControlsContext = createContext<ServerControls | null>(null)

export function useServerControls(): ServerControls | null {
  return useContext(ServerControlsContext)
}
