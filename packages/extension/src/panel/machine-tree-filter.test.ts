import { describe, expect, it } from 'vitest'
import type { SerializedStateNode } from '../shared/types.js'
import {
  buildMachineTreeMatchSet,
  getMachineTreeHighlightTerm,
  parseMachineTreeFilter,
} from './machine-tree-filter.js'

const createNode = (
  id: string,
  key: string,
  states: Record<string, SerializedStateNode> = {},
): SerializedStateNode => ({
  id,
  key,
  type: 'compound',
  states,
  on: [],
  always: [],
  entry: [],
  exit: [],
  invoke: [],
})

const machineRoot = createNode('checkout', 'checkout', {
  idle: createNode('checkout.idle', 'idle'),
  loading: createNode('checkout.loading', 'loading'),
  error: createNode('checkout.error', 'error'),
})

describe('parseMachineTreeFilter', () => {
  it('parses scoped and negated tokens', () => {
    expect(parseMachineTreeFilter('machine:checkout state:idle -error')).toEqual([
      { negated: false, scope: 'machine', value: 'checkout' },
      { negated: false, scope: 'state', value: 'idle' },
      { negated: true, scope: 'any', value: 'error' },
    ])
  })
})

describe('buildMachineTreeMatchSet', () => {
  it('matches state names by default', () => {
    expect(new Set(buildMachineTreeMatchSet(machineRoot, 'checkoutMachine', 'idle'))).toEqual(
      new Set([
      'checkout',
      'checkout.idle',
      ]),
    )
  })

  it('matches the full tree when filtering by machine only', () => {
    expect(
      new Set(buildMachineTreeMatchSet(machineRoot, 'checkoutMachine', 'machine:checkout')),
    ).toEqual(
      new Set(['checkout.idle', 'checkout.loading', 'checkout.error', 'checkout']),
    )
  })

  it('supports combined machine and state filters', () => {
    expect(
      new Set(
        buildMachineTreeMatchSet(machineRoot, 'checkoutMachine', 'machine:checkout state:loading'),
      ),
    ).toEqual(new Set(['checkout', 'checkout.loading']))
  })

  it('supports negated filters', () => {
    expect(new Set(buildMachineTreeMatchSet(machineRoot, 'checkoutMachine', '-error'))).toEqual(
      new Set(['checkout.idle', 'checkout.loading', 'checkout']),
    )
  })

  it('excludes the whole tree when the machine is negated', () => {
    expect(buildMachineTreeMatchSet(machineRoot, 'checkoutMachine', '-machine:checkout').size).toBe(0)
  })
})

describe('getMachineTreeHighlightTerm', () => {
  it('returns the first positive state-capable token', () => {
    expect(getMachineTreeHighlightTerm('machine:checkout state:idle -error')).toBe('idle')
    expect(getMachineTreeHighlightTerm('machine:checkout')).toBe('')
  })
})