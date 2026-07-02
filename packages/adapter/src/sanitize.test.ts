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

  it('handles actual circular references', () => {
    const a: any = {}
    a.self = a
    expect(() => sanitize(a)).not.toThrow()
    expect(JSON.stringify(sanitize(a))).toContain('[Circular]')
  })

  it('bounds output for wide+deep cross-linked objects (no oversized string)', () => {
    // A shared node referenced from many places at every level would expand
    // multiplicatively without a global budget / shared-ref guard.
    const shared: any = {}
    for (let i = 0; i < 200; i++) shared['k' + i] = { a: 1, b: 2, c: 3 }
    const root: any = {}
    for (let i = 0; i < 200; i++) root['n' + i] = { x: shared, y: shared, z: shared }
    const out = sanitize(root)
    const json = JSON.stringify(out) // must not throw RangeError
    expect(json.length).toBeLessThan(2_000_000)
    expect(json).toContain('[Circular]')
  })

  it('handles deep linear nesting', () => {
    let deep: any = {}
    let curr = deep
    for (let i = 0; i < 15; i++) { curr.child = {}; curr = curr.child }
    curr.value = 'bottom'
    const result = JSON.stringify(sanitize(deep))
    expect(result).toContain('[MaxDepth]')
  })

  it('uses toJSON (like JSON.stringify) instead of walking the raw object', () => {
    // An XState ActorRef held in context exposes toJSON = { xstate$$type, id };
    // without honouring it we would recurse into the whole actor system and eat
    // the budget, truncating every other context key.
    const actorRefLike = {
      id: 'kid',
      _huge: (() => { const o: any = {}; for (let i = 0; i < 500; i++) o['k' + i] = { a: 1, b: 2 }; return o })(),
      toJSON: () => ({ xstate$$type: 1, id: 'kid' }),
    }
    const out = sanitize({ receiver: actorRefLike, theme: { size: 'std' }, flag: true }) as any
    expect(out.receiver).toEqual({ xstate$$type: 1, id: 'kid' })
    expect(out.theme).toEqual({ size: 'std' })
    expect(out.flag).toBe(true)
  })

  it('does not starve later top-level keys when earlier ones are huge', () => {
    // Many large top-level values whose combined node count far exceeds the
    // budget — with a single shared depth-first budget these would exhaust it and
    // the trailing simple keys would come back "[Truncated]" (the reported bug).
    const bigObj = () => {
      const o: any = {}
      for (let i = 0; i < 90; i++) o['k' + i] = { a: 1, b: 2, c: 3, d: 4, e: 5 }
      return o
    }
    const ctx: any = {}
    for (let i = 0; i < 50; i++) ctx['big' + i] = bigObj()
    ctx.isTrainingMode = true
    ctx.theme = 'dark'
    ctx.name = 'visible'

    const out = sanitize(ctx) as Record<string, unknown>
    expect(out.isTrainingMode).toBe(true)
    expect(out.theme).toBe('dark')
    expect(out.name).toBe('visible')
  })
})
