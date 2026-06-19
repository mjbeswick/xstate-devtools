// packages/adapter/src/core.test.ts
import { describe, it, expect } from 'vitest'
import { createInspector, type Transport } from './core.js'

/** A transport that records outbound messages and lets tests push inbound ones. */
function mockTransport() {
  const sent: any[] = []
  let handler: ((m: any) => void) | null = null
  const transport: Transport = {
    send: (m) => sent.push(m),
    subscribe: (h) => { handler = h; return () => { handler = null } },
  }
  return { transport, sent, push: (m: any) => handler?.(m) }
}

function fakeActor(sessionId: string, persisted: unknown, opts: { getPersisted?: boolean } = {}) {
  return {
    sessionId,
    logic: undefined,
    getSnapshot: () => ({ value: 'idle', context: {}, status: 'active' }),
    ...(opts.getPersisted === false ? {} : { getPersistedSnapshot: () => persisted }),
  } as any
}

describe('persisted snapshot request', () => {
  it('responds to XSTATE_REQUEST_PERSISTED with the persisted snapshot', () => {
    const { transport, sent, push } = mockTransport()
    const { inspect } = createInspector(transport, 'web')

    inspect({ type: '@xstate.actor', actorRef: fakeActor('s1', { value: 'running', context: { n: 1 } }) })
    push({ type: 'XSTATE_REQUEST_PERSISTED', sessionId: 'web:s1' })

    const resp = sent.find((m) => m.type === 'XSTATE_PERSISTED_SNAPSHOT')
    expect(resp).toBeDefined()
    expect(resp.sessionId).toBe('web:s1')
    expect(resp.persisted).toEqual({ value: 'running', context: { n: 1 } })
    expect(resp.error).toBeUndefined()
  })

  it('reports an error when the actor has no getPersistedSnapshot', () => {
    const { transport, sent, push } = mockTransport()
    const { inspect } = createInspector(transport, 'web')

    inspect({ type: '@xstate.actor', actorRef: fakeActor('s1', null, { getPersisted: false }) })
    push({ type: 'XSTATE_REQUEST_PERSISTED', sessionId: 'web:s1' })

    const resp = sent.find((m) => m.type === 'XSTATE_PERSISTED_SNAPSHOT')
    expect(resp.error).toMatch(/does not support/i)
    expect(resp.persisted).toBeUndefined()
  })

  it('ignores requests for actors owned by another transport source', () => {
    const { transport, sent, push } = mockTransport()
    const { inspect } = createInspector(transport, 'web')

    inspect({ type: '@xstate.actor', actorRef: fakeActor('s1', { ok: true }) })
    push({ type: 'XSTATE_REQUEST_PERSISTED', sessionId: 'srv:s1' }) // different prefix

    expect(sent.find((m) => m.type === 'XSTATE_PERSISTED_SNAPSHOT')).toBeUndefined()
  })
})

describe('restore', () => {
  it('invokes a registered restore handler with the persisted snapshot', () => {
    const { transport, push } = mockTransport()
    const { registerRestore } = createInspector(transport, 'web')

    let received: unknown
    registerRestore('s1', (persisted) => { received = persisted })
    push({ type: 'XSTATE_RESTORE', sessionId: 'web:s1', persisted: { value: 'done' } })

    expect(received).toEqual({ value: 'done' })
  })

  it('ignores restore for another transport source', () => {
    const { transport, push } = mockTransport()
    const { registerRestore } = createInspector(transport, 'web')

    let called = false
    registerRestore('s1', () => { called = true })
    push({ type: 'XSTATE_RESTORE', sessionId: 'srv:s1', persisted: {} })

    expect(called).toBe(false)
  })

  it('unregister stops the handler from firing', () => {
    const { transport, push } = mockTransport()
    const { registerRestore } = createInspector(transport, 'web')

    let count = 0
    const unregister = registerRestore('s1', () => { count++ })
    push({ type: 'XSTATE_RESTORE', sessionId: 'web:s1', persisted: {} })
    unregister()
    push({ type: 'XSTATE_RESTORE', sessionId: 'web:s1', persisted: {} })

    expect(count).toBe(1)
  })
})
