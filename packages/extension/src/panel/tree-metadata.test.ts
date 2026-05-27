import { describe, expect, it } from 'vitest'
import type { ActorRecord, SerializedStateNode } from '../shared/types.js'
import { getActorNodePresentation, getStateNodeTitle } from './tree-metadata.js'

function createActor(overrides: Partial<ActorRecord> = {}): ActorRecord {
  return {
    sessionId: 'session-1234567890',
    machine: null,
    snapshot: { value: null, context: {}, status: 'active' },
    status: 'active',
    registeredAt: 0,
    registeredAtSeq: 0,
    ...overrides,
  }
}

function createNode(overrides: Partial<SerializedStateNode> = {}): SerializedStateNode {
  return {
    id: 'journey.id',
    key: 'journey',
    type: 'parallel',
    states: {},
    on: [],
    always: [],
    entry: [],
    exit: [],
    invoke: [],
    ...overrides,
  }
}

describe('getActorNodePresentation', () => {
  it('describes machine actors and colors them distinctly', () => {
    const presentation = getActorNodePresentation(
      createActor({
        machine: { id: 'checkout', root: createNode({ type: 'compound' }) },
      }),
      2,
    )

    expect(presentation.label).toBe('checkout')
    expect(presentation.labelColor).toBe('#237804')
    expect(presentation.title).toContain('Machine actor "checkout" with an inspectable state tree.')
    expect(presentation.title).toContain('Contains 2 child actors.')
  })

  it('describes non-machine actors without rendering a visible badge', () => {
    const namedService = getActorNodePresentation(
      createActor({ displayName: 'analytics-loader' }),
      0,
    )
    const anonymousSession = getActorNodePresentation(createActor(), 0)

    expect(namedService.labelColor).toBe('#0958d9')
    expect(namedService.title).toContain(
      'Service actor "analytics-loader" without a machine definition.',
    )
    expect(anonymousSession.label).toBe('session-1234')
    expect(anonymousSession.labelColor).toBe('#8c8c8c')
    expect(anonymousSession.title).toContain(
      'Actor session without a display name or machine definition.',
    )
  })
})

describe('getStateNodeTitle', () => {
  it('explains the node type, activity, transitions, and invokes', () => {
    const title = getStateNodeTitle(
      createNode({
        states: {
          idle: createNode({ id: 'journey.idle', key: 'idle', type: 'atomic' }),
          checkout: createNode({ id: 'journey.checkout', key: 'checkout', type: 'compound' }),
        },
        on: [{ eventType: 'NEXT', targets: ['journey.checkout'], actions: [] }],
        always: [{ eventType: '', targets: ['journey.idle'], actions: [] }],
        invoke: [{ id: 'fetchJourney', src: 'fetchJourney' }],
      }),
      true,
    )

    expect(title).toContain('Parallel state "journey".')
    expect(title).toContain('Currently active.')
    expect(title).toContain('Contains 2 child states.')
    expect(title).toContain('Has 2 outgoing transitions.')
    expect(title).toContain('Invokes 1 service.')
  })
})
