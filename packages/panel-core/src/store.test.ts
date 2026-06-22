import { describe, it, expect } from 'vitest'
import { createInspectorStore } from './store.js'
import type { PageToExtensionMessage, SerializedSnapshot } from '@xstate-devtools/protocol'

const snap = (value: string): SerializedSnapshot => ({ value, context: {}, status: 'active' })
const register = (sessionId: string): PageToExtensionMessage => ({
  type: 'XSTATE_ACTOR_REGISTERED', sessionId, machine: null, snapshot: snap('idle'),
  globalSeq: 1, timestamp: 0,
})

describe('XSTATE_REPLAY_DONE reconcile', () => {
  it('prunes actors absent from the live set, keeps the replayed ones', () => {
    const store = createInspectorStore()
    const h = store.getState().handleMessage
    // Stale actor from a previous session + a freshly replayed one.
    h(register('srv:x:0'))
    h(register('srv:x:5'))
    store.getState().selectActor('srv:x:0')
    expect(store.getState().actors.size).toBe(2)

    // Reconnect replay says only srv:x:5 is live.
    h({ type: 'XSTATE_REPLAY_DONE', sessionIds: ['srv:x:5'] })

    const s = store.getState()
    expect([...s.actors.keys()]).toEqual(['srv:x:5'])      // ghost pruned, live kept
    expect(s.registeredSnapshots.has('srv:x:0')).toBe(false)
    expect(s.selectedActorId).toBe(null)                    // selection cleared when its actor went
  })

  it('keeps the selection when the selected actor survives reconcile', () => {
    const store = createInspectorStore()
    const h = store.getState().handleMessage
    h(register('srv:x:5'))
    store.getState().selectActor('srv:x:5')
    h({ type: 'XSTATE_REPLAY_DONE', sessionIds: ['srv:x:5'] })
    expect(store.getState().selectedActorId).toBe('srv:x:5')
  })
})
