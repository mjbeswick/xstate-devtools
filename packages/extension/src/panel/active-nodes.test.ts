// packages/extension/src/panel/active-nodes.test.ts
import { describe, it, expect } from 'vitest'
import { getActiveNodeIds } from './active-nodes.js'
import type { SerializedStateNode } from '../shared/types.js'

const atomicNode = (id: string): SerializedStateNode => ({
  id, key: id.split('.').pop()!, type: 'atomic',
  states: {}, on: [], always: [], entry: [], exit: [], invoke: [],
})

describe('getActiveNodeIds', () => {
  it('returns active ids for a compound state', () => {
    const node: SerializedStateNode = {
      id: 'root', key: 'root', type: 'compound', initial: 'idle',
      states: { idle: atomicNode('root.idle'), running: atomicNode('root.running') },
      on: [], always: [], entry: [], exit: [], invoke: [],
    }
    const ids = getActiveNodeIds('idle', node)
    expect(ids.has('root')).toBe(true)
    expect(ids.has('root.idle')).toBe(true)
    expect(ids.has('root.running')).toBe(false)
  })

  it('handles parallel states', () => {
    const node: SerializedStateNode = {
      id: 'root', key: 'root', type: 'parallel', initial: undefined,
      states: {
        a: { ...atomicNode('root.a'), type: 'compound', initial: 'on',
          states: { on: atomicNode('root.a.on'), off: atomicNode('root.a.off') } },
        b: { ...atomicNode('root.b'), type: 'compound', initial: 'on',
          states: { on: atomicNode('root.b.on'), off: atomicNode('root.b.off') } },
      },
      on: [], always: [], entry: [], exit: [], invoke: [],
    }
    const ids = getActiveNodeIds({ a: 'on', b: 'off' }, node)
    expect(ids.has('root.a')).toBe(true)
    expect(ids.has('root.a.on')).toBe(true)
    expect(ids.has('root.b.off')).toBe(true)
    expect(ids.has('root.a.off')).toBe(false)
  })

  it('returns empty set for null value', () => {
    const node: SerializedStateNode = {
      id: 'root', key: 'root', type: 'compound', initial: 'idle',
      states: { idle: atomicNode('root.idle') },
      on: [], always: [], entry: [], exit: [], invoke: [],
    }
    expect(getActiveNodeIds(null, node).size).toBe(0)
  })

  it('treats history nodes as atomic (no recursion)', () => {
    const node: SerializedStateNode = {
      id: 'root', key: 'root', type: 'compound', initial: 'active',
      states: {
        active: atomicNode('root.active'),
        hist: { ...atomicNode('root.hist'), type: 'history' },
      },
      on: [], always: [], entry: [], exit: [], invoke: [],
    }
    // History resolves to its parent's compound value — value at this level is the sibling key
    const ids = getActiveNodeIds('active', node)
    expect(ids.has('root.active')).toBe(true)
    expect(ids.has('root.hist')).toBe(false)
  })

  it('handles nested compound states', () => {
    const node: SerializedStateNode = {
      id: 'root', key: 'root', type: 'compound', initial: 'a',
      states: {
        a: {
          id: 'root.a', key: 'a', type: 'compound', initial: 'x',
          states: {
            x: atomicNode('root.a.x'),
            y: atomicNode('root.a.y'),
          },
          on: [], always: [], entry: [], exit: [], invoke: [],
        },
      },
      on: [], always: [], entry: [], exit: [], invoke: [],
    }
    const ids = getActiveNodeIds({ a: 'x' }, node)
    expect(ids.has('root')).toBe(true)
    expect(ids.has('root.a')).toBe(true)
    expect(ids.has('root.a.x')).toBe(true)
    expect(ids.has('root.a.y')).toBe(false)
  })
})
