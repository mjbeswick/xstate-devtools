import { createContext, useContext } from 'react'

export interface PanelCollapseControls {
  leftCollapsed: boolean
  rightCollapsed: boolean
  bottomCollapsed: boolean
  toggleLeft: () => void
  toggleRight: () => void
  toggleBottom: () => void
}

const noop = () => {}
export const PanelCollapseContext = createContext<PanelCollapseControls>({
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: false,
  toggleLeft: noop,
  toggleRight: noop,
  toggleBottom: noop,
})

export function usePanelCollapse(): PanelCollapseControls {
  return useContext(PanelCollapseContext)
}
