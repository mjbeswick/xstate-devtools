import { describe, expect, it } from 'vitest'
import { getInitialPanelCollapseState } from './Layout.js'

describe('getInitialPanelCollapseState', () => {
  it('defaults all collapse flags to expanded', () => {
    expect(getInitialPanelCollapseState(null)).toEqual({
      leftCollapsed: false,
      rightCollapsed: false,
      selectedEventCollapsed: false,
      bottomCollapsed: false,
    })
    expect(getInitialPanelCollapseState({ getItem: () => null })).toEqual({
      leftCollapsed: false,
      rightCollapsed: false,
      selectedEventCollapsed: false,
      bottomCollapsed: false,
    })
  })

  it('restores persisted collapse flags', () => {
    expect(
      getInitialPanelCollapseState({
        getItem: (key: string) => {
          switch (key) {
            case 'xstate-devtools.panel.leftCollapsed':
            case 'xstate-devtools.panel.selectedEventCollapsed':
              return '1'
            case 'xstate-devtools.panel.rightCollapsed':
            case 'xstate-devtools.panel.bottomCollapsed':
              return '0'
            default:
              return null
          }
        },
      }),
    ).toEqual({
      leftCollapsed: true,
      rightCollapsed: false,
      selectedEventCollapsed: true,
      bottomCollapsed: false,
    })
  })

  it('falls back to defaults when storage throws', () => {
    expect(
      getInitialPanelCollapseState({
        getItem: () => {
          throw new Error('storage unavailable')
        },
      }),
    ).toEqual({
      leftCollapsed: false,
      rightCollapsed: false,
      selectedEventCollapsed: false,
      bottomCollapsed: false,
    })
  })
})