import { describe, expect, it } from 'vitest'
import { getNodePaddingLeft } from './JsonView.js'

describe('getNodePaddingLeft', () => {
  it('does not compound indentation for nested nodes', () => {
    expect(getNodePaddingLeft(0)).toBe(0)
    expect(getNodePaddingLeft(1)).toBe(14)
    expect(getNodePaddingLeft(2)).toBe(14)
    expect(getNodePaddingLeft(3)).toBe(14)
  })
})
