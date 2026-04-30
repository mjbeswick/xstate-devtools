// packages/adapter/src/sanitize.test.ts
import { describe, it, expect } from 'vitest'
import { sanitize } from './sanitize.js'

describe('sanitize', () => {
  it('passes primitives through unchanged', () => {
    expect(sanitize(42)).toBe(42)
    expect(sanitize(true)).toBe(true)
    expect(sanitize(null)).toBe(null)
    expect(sanitize('hello')).toBe('hello')
  })

  it('replaces functions with a descriptor string', () => {
    expect(sanitize(function myFn() {})).toBe('[Function: myFn]')
    expect(sanitize(() => {})).toBe('[Function: (anonymous)]')
  })

  it('truncates long strings', () => {
    const long = 'x'.repeat(600)
    const result = sanitize(long) as string
    expect(result.length).toBeLessThan(520)
    expect(result.endsWith('…')).toBe(true)
  })

  it('handles nested objects', () => {
    const result = sanitize({ a: 1, b: { c: 'hello' } })
    expect(result).toEqual({ a: 1, b: { c: 'hello' } })
  })

  it('handles Maps', () => {
    const m = new Map([['key', 'value']])
    const result = sanitize(m) as any
    expect(result.__type).toBe('Map')
    expect(result.entries).toEqual([['key', 'value']])
  })

  it('handles circular-like depth limit', () => {
    let deep: any = {}
    let curr = deep
    for (let i = 0; i < 15; i++) { curr.child = {}; curr = curr.child }
    curr.value = 'bottom'
    const result = JSON.stringify(sanitize(deep))
    expect(result).toContain('[MaxDepth]')
  })
})
