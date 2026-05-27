import { createContext, useContext } from 'react'

export interface PanelCollapseControls {
  leftCollapsed: boolean
  rightCollapsed: boolean
  selectedEventCollapsed: boolean
  bottomCollapsed: boolean
  toggleLeft: () => void
  toggleRight: () => void
  toggleSelectedEvent: () => void
  toggleBottom: () => void
}

const noop = () => {}
export const PanelCollapseContext = createContext<PanelCollapseControls>({
  leftCollapsed: false,
  rightCollapsed: false,
  selectedEventCollapsed: false,
  bottomCollapsed: false,
  toggleLeft: noop,
  toggleRight: noop,
  toggleSelectedEvent: noop,
  toggleBottom: noop,
})

export function usePanelCollapse(): PanelCollapseControls {
  return useContext(PanelCollapseContext)
}
