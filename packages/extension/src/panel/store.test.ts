// packages/extension/src/panel/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, getDisplaySnapshot } from './store.js'
import type { SerializedMachine, SerializedSnapshot } from '../shared/types.js'

const mockMachine: SerializedMachine = {
  id: 'test',
  root: {
    id: 'test', key: 'test', type: 'compound', initial: 'idle',
    states: {
      idle: { id: 'test.idle', key: 'idle', type: 'atomic', states: {}, on: [], always: [], entry: [], exit: [], invoke: [] },
      running: { id: 'test.running', key: 'running', type: 'atomic', states: {}, on: [], always: [], entry: [], exit: [], invoke: [] },
    },
    on: [], always: [], entry: [], exit: [], invoke: [],
  },
}

const snap = (value: unknown): SerializedSnapshot => ({
  value, context: {}, status: 'active',
})

beforeEach(() => {
  useStore.setState({
    actors: new Map(),
    registeredSnapshots: new Map(),
    events: [],
    selectedActorId: null,
    selectedStateNodeId: null,
    timeTravelSeq: null,
  })
})

describe('handleMessage', () => {
  it('registers an actor', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })
    expect(useStore.getState().actors.get('a1')?.sessionId).toBe('a1')
    expect(useStore.getState().actors.get('a1')?.status).toBe('active')
  })

  it('updates snapshot on XSTATE_EVENT', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })
    useStore.getState().handleMessage({
      type: 'XSTATE_EVENT',
      sessionId: 'a1',
      event: { type: 'START' },
      snapshotAfter: snap('running'),
      timestamp: 2000,
      globalSeq: 2,
    })
    expect(useStore.getState().actors.get('a1')?.snapshot.value).toBe('running')
    expect(useStore.getState().events).toHaveLength(1)
  })

  it('caps events at MAX_EVENTS (500)', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })
    for (let i = 0; i < 510; i++) {
      useStore.getState().handleMessage({
        type: 'XSTATE_EVENT',
        sessionId: 'a1',
        event: { type: 'TICK' },
        snapshotAfter: snap('idle'),
        timestamp: i,
        globalSeq: i + 2,
      })
    }
    expect(useStore.getState().events.length).toBe(500)
  })

  it('marks actor as stopped on XSTATE_ACTOR_STOPPED', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })
    useStore.getState().handleMessage({ type: 'XSTATE_ACTOR_STOPPED', sessionId: 'a1' })
    expect(useStore.getState().actors.get('a1')?.status).toBe('stopped')
  })
})

describe('time travel', () => {
  it('getDisplaySnapshot returns historical snapshot when time-travelling', () => {
    const { handleMessage, timeTravel } = useStore.getState()
    handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })
    handleMessage({
      type: 'XSTATE_EVENT',
      sessionId: 'a1',
      event: { type: 'START' },
      snapshotAfter: snap('running'),
      timestamp: 2000,
      globalSeq: 2,
    })
    handleMessage({
      type: 'XSTATE_EVENT',
      sessionId: 'a1',
      event: { type: 'STOP' },
      snapshotAfter: snap('idle'),
      timestamp: 3000,
      globalSeq: 3,
    })

    timeTravel(2)
    expect(getDisplaySnapshot(useStore.getState(), 'a1')?.value).toBe('running')

    timeTravel(null)
    expect(getDisplaySnapshot(useStore.getState(), 'a1')?.value).toBe('idle')
  })

  it('returns registration snapshot when no events precede the travel point', () => {
    const { handleMessage, timeTravel } = useStore.getState()
    handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })
    handleMessage({
      type: 'XSTATE_EVENT',
      sessionId: 'a1',
      event: { type: 'START' },
      snapshotAfter: snap('running'),
      timestamp: 2000,
      globalSeq: 5,
    })
    // Travel to seq 2 — between registration (1) and first event (5)
    timeTravel(2)
    expect(getDisplaySnapshot(useStore.getState(), 'a1')?.value).toBe('idle')
  })
})

describe('selection', () => {
  it('clears selectedStateNodeId when actor changes', () => {
    useStore.getState().selectStateNode('test.idle')
    useStore.getState().selectActor('a2')
    expect(useStore.getState().selectedStateNodeId).toBeNull()
  })
})
