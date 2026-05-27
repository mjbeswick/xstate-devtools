import { describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'
import { createInspector, type Transport } from './core.js'

describe('createInspector', () => {
  it('sanitizes outbound inspection events before sending them to the transport', () => {
    const sent: unknown[] = []
    const transport: Transport = {
      send(message) {
        sent.push(message)
      },
      subscribe() {
        return () => {}
      },
    }

    const inspector = createInspector(transport, 'srv')
    const snapshot = { value: 'idle', context: {}, status: 'active' }
    const actorRef = {
      sessionId: 'actor-1',
      getSnapshot: vi.fn(() => snapshot),
    }

    const event: Record<string, unknown> = { type: 'route.changed' }
    event.self = event
    event.handler = function routeHandler() {}

    inspector.inspect({
      type: '@xstate.event',
      actorRef,
      event,
    })

    const message = sent.find(
      (candidate): candidate is { type: string; event: Record<string, unknown> } =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'type' in candidate &&
        (candidate as { type?: string }).type === 'XSTATE_EVENT',
    )

    expect(message).toBeDefined()
    expect(message?.event.type).toBe('route.changed')
    expect(message?.event.handler).toBe('[Function: routeHandler]')
    expect(message?.event.self).not.toBe(event)
  })

  it('sets a selected state node as active for machine actors', () => {
    let handler: ((message: Parameters<Transport['subscribe']>[0]) => void) | undefined
    const transport: Transport = {
      send() {},
      subscribe(callback) {
        handler = callback
        return () => {}
      },
    }

    const inspector = createInspector(transport, 'srv')
    const actor = createActor(
      createMachine({
        id: 'traffic',
        initial: 'green',
        states: {
          green: {},
          yellow: {},
          red: {},
        },
      }),
    )

    actor.start()
    inspector.inspect({ type: '@xstate.actor', actorRef: actor })

    handler?.({
      type: 'XSTATE_SET_ACTIVE_STATE',
      sessionId: `srv:${actor.sessionId}`,
      stateNodeId: 'traffic.red',
    })

    expect(actor.getSnapshot().value).toBe('red')
  })
})