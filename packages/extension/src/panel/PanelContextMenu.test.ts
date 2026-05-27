import { describe, expect, it } from 'vitest'
import { shouldCloseMenuOnScrollEvent } from './PanelContextMenu.js'

describe('shouldCloseMenuOnScrollEvent', () => {
  it('keeps menus open during programmatic scroll updates', () => {
    expect(shouldCloseMenuOnScrollEvent({ isTrusted: false } as Event)).toBe(false)
  })

  it('closes menus when the user scrolls', () => {
    expect(shouldCloseMenuOnScrollEvent({ isTrusted: true } as Event)).toBe(true)
  })
})
