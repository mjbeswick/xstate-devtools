// packages/adapter/src/serialize.test.ts
import { describe, it, expect } from 'vitest'
import { createMachine, setup } from 'xstate'
import { serializeMachine } from './serialize.js'

describe('serializeMachine', () => {
  it('serializes a simple compound machine', () => {
    const machine = createMachine({
      id: 'test',
      initial: 'idle',
      states: {
        idle: { on: { START: 'running' } },
        running: { on: { STOP: 'idle' } },
      },
    })
    const result = serializeMachine(machine)
    expect(result.id).toBe('test')
    expect(result.root.type).toBe('compound')
    expect(result.root.initial).toBe('idle')
    expect(Object.keys(result.root.states)).toEqual(['idle', 'running'])
    expect(result.root.states.idle.on).toHaveLength(1)
    expect(result.root.states.idle.on[0].eventType).toBe('START')
    expect(result.root.states.idle.on[0].targets).toEqual(['test.running'])
  })

  it('serializes parallel states', () => {
    const machine = createMachine({
      id: 'parallel',
      type: 'parallel',
      states: {
        a: { initial: 'on', states: { on: {}, off: {} } },
        b: { initial: 'on', states: { on: {}, off: {} } },
      },
    })
    const result = serializeMachine(machine)
    expect(result.root.type).toBe('parallel')
    expect(Object.keys(result.root.states)).toEqual(['a', 'b'])
  })

  it('serializes named guards and actions from setup()', () => {
    const machine = setup({
      guards: { isReady: () => true },
      actions: { doSomething: () => {} },
    }).createMachine({
      id: 'guarded',
      initial: 'idle',
      states: {
        idle: {
          on: {
            GO: {
              target: 'active',
              guard: 'isReady',
              actions: 'doSomething',
            },
          },
        },
        active: {},
      },
    })
    const result = serializeMachine(machine)
    const transition = result.root.states.idle.on[0]
    expect(transition.guard).toBe('isReady')
    expect(transition.actions).toEqual(['doSomething'])
  })

  it('includes sourceLocation when provided', () => {
    const machine = createMachine({ id: 'm', initial: 'a', states: { a: {} } })
    const result = serializeMachine(machine, 'src/auth.ts:42')
    expect(result.sourceLocation).toBe('src/auth.ts:42')
  })
})
