import { describe, expect, it } from 'vitest'
import { getInitialServerEnabled } from './App.js'

describe('getInitialServerEnabled', () => {
  it('defaults the server adapter to enabled', () => {
    expect(getInitialServerEnabled(null)).toBe(true)
    expect(getInitialServerEnabled({ getItem: () => null })).toBe(true)
  })

  it('restores an explicitly enabled server adapter', () => {
    expect(
      getInitialServerEnabled({
        getItem: (key: string) => (key === 'xstate-devtools.serverUrl.enabled' ? '1' : null),
      }),
    ).toBe(true)
  })

  it('treats other stored values as disabled', () => {
    expect(getInitialServerEnabled({ getItem: () => '0' })).toBe(false)
  })

  it('falls back to enabled when storage throws', () => {
    expect(
      getInitialServerEnabled({
        getItem: () => {
          throw new Error('storage unavailable')
        },
      }),
    ).toBe(true)
  })
})