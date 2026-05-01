// packages/extension/src/panel/port-context.ts
import { createContext, useContext } from 'react'
import type { ExtensionToPageMessage } from '../shared/types.js'

export type DispatchFn = (message: ExtensionToPageMessage) => void

/** Broadcasts a panel-originated message to all active transports. */
export const DispatchContext = createContext<DispatchFn>(() => {})

export function useDispatch(): DispatchFn {
  return useContext(DispatchContext)
}
