// packages/extension/src/panel/store.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedMachine, SerializedSnapshot } from '../shared/types.js'
import {
  getDisplaySnapshot,
  getEventSourceStateNodeId,
  getInitialHideStoppedActors,
  getInitialLoggingPaused,
  getInitialTreeFilter,
  getSelectedEvent,
  useStore,
} from './store.js'

const mockMachine: SerializedMachine = {
  id: 'test',
  root: {
    id: 'test',
    key: 'test',
    type: 'compound',
    initial: 'idle',
    states: {
      idle: {
        id: 'test.idle',
        key: 'idle',
        type: 'atomic',
        states: {},
        on: [],
        always: [],
        entry: [],
        exit: [],
        invoke: [],
      },
      running: {
        id: 'test.running',
        key: 'running',
        type: 'atomic',
        states: {},
        on: [],
        always: [],
        entry: [],
        exit: [],
        invoke: [],
      },
    },
    on: [],
    always: [],
    entry: [],
    exit: [],
    invoke: [],
  },
}

const machineWithTransitions: SerializedMachine = {
  id: 'test',
  root: {
    id: 'test',
    key: 'test',
    type: 'compound',
    initial: 'idle',
    states: {
      idle: {
        id: 'test.idle',
        key: 'idle',
        type: 'atomic',
        states: {},
        on: [{ eventType: 'START', targets: ['test.running'], actions: [] }],
        always: [],
        entry: [],
        exit: [],
        invoke: [],
      },
      running: {
        id: 'test.running',
        key: 'running',
        type: 'atomic',
        states: {},
        on: [{ eventType: 'STOP', targets: ['test.idle'], actions: [] }],
        always: [],
        entry: [],
        exit: [],
        invoke: [],
      },
    },
    on: [],
    always: [],
    entry: [],
    exit: [],
    invoke: [],
  },
}

const snap = (value: unknown): SerializedSnapshot => ({
  value,
  context: {},
  status: 'active',
})

beforeEach(() => {
  useStore.setState({
    actors: new Map(),
    registeredSnapshots: new Map(),
    events: [],
    loggingPaused: false,
    hideStoppedActors: true,
    selectedActorId: null,
    selectedStateNodeId: null,
    timeTravelSeq: null,
    treeFilter: '',
    portConnected: false,
  })
})

describe('getInitialLoggingPaused', () => {
  it('defaults paused logging to disabled', () => {
    expect(getInitialLoggingPaused(null)).toBe(false)
    expect(getInitialLoggingPaused({ getItem: () => null })).toBe(false)
  })

  it('restores a persisted paused logging flag', () => {
    expect(
      getInitialLoggingPaused({
        getItem: (key: string) => (key === 'xstate-devtools.loggingPaused' ? '1' : null),
      }),
    ).toBe(true)
  })

  it('falls back to disabled when storage throws', () => {
    expect(
      getInitialLoggingPaused({
        getItem: () => {
          throw new Error('storage unavailable')
        },
      }),
    ).toBe(false)
  })
})

describe('getInitialTreeFilter', () => {
  it('defaults the tree filter to empty', () => {
    expect(getInitialTreeFilter(null)).toBe('')
    expect(getInitialTreeFilter({ getItem: () => null })).toBe('')
  })

  it('restores a persisted tree filter', () => {
    expect(
      getInitialTreeFilter({
        getItem: (key: string) =>
          key === 'xstate-devtools.treeFilter' ? 'machine:cart -error' : null,
      }),
    ).toBe('machine:cart -error')
  })

  it('falls back to empty when storage throws', () => {
    expect(
      getInitialTreeFilter({
        getItem: () => {
          throw new Error('storage unavailable')
        },
      }),
    ).toBe('')
  })
})

describe('getInitialHideStoppedActors', () => {
  it('defaults hide-stopped actors to enabled', () => {
    expect(getInitialHideStoppedActors(null)).toBe(true)
    expect(getInitialHideStoppedActors({ getItem: () => null })).toBe(true)
  })

  it('restores a persisted hide-stopped flag', () => {
    expect(
      getInitialHideStoppedActors({
        getItem: (key: string) => (key === 'xstate-devtools.hideStoppedActors' ? '0' : null),
      }),
    ).toBe(false)
  })

  it('falls back to enabled when storage throws', () => {
    expect(
      getInitialHideStoppedActors({
        getItem: () => {
          throw new Error('storage unavailable')
        },
      }),
    ).toBe(true)
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
    expect(useStore.getState().selectedActorId).toBe('a1')
  })

  it('returns the selected event for the current time-travel entry', () => {
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
      event: { type: 'START', input: { step: 1 } },
      snapshotAfter: snap('running'),
      timestamp: 2000,
      globalSeq: 2,
    })
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a2',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 3,
      timestamp: 3000,
    })
    useStore.getState().handleMessage({
      type: 'XSTATE_EVENT',
      sessionId: 'a2',
      event: { type: 'START', input: { step: 2 } },
      snapshotAfter: snap('running'),
      timestamp: 4000,
      globalSeq: 4,
    })

    useStore.getState().selectActor('a1')
    useStore.getState().timeTravel(2)

    expect(getSelectedEvent(useStore.getState())?.event).toEqual({
      type: 'START',
      input: { step: 1 },
    })

    useStore.getState().selectActor('a2')
    expect(getSelectedEvent(useStore.getState())).toBeNull()
  })

  it('finds the source state node for a clicked event using adjacent snapshots', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: machineWithTransitions,
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
    useStore.getState().handleMessage({
      type: 'XSTATE_EVENT',
      sessionId: 'a1',
      event: { type: 'STOP' },
      snapshotAfter: snap('idle'),
      timestamp: 3000,
      globalSeq: 3,
    })

    const [startEvent, stopEvent] = useStore.getState().events

    expect(getEventSourceStateNodeId(useStore.getState(), startEvent)).toBe('test.idle')
    expect(getEventSourceStateNodeId(useStore.getState(), stopEvent)).toBe('test.running')
  })

  it('keeps the current selection when another actor registers', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })

    useStore.getState().selectActor('a1')

    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a2',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 2,
      timestamp: 2000,
    })

    expect(useStore.getState().selectedActorId).toBe('a1')
  })

  it('stores actor displayName when provided', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      displayName: 'service',
      machine: null,
      snapshot: snap(null),
      globalSeq: 1,
      timestamp: 1000,
    })

    expect(useStore.getState().actors.get('a1')?.displayName).toBe('service')
  })

  it('preserves parentSessionId across duplicate registrations when reconnect payload omits it', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'parent',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })

    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'child',
      parentSessionId: 'parent',
      displayName: 'checkHealth',
      machine: null,
      snapshot: snap(null),
      globalSeq: 2,
      timestamp: 1001,
    })

    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'child',
      machine: null,
      snapshot: snap(null),
      globalSeq: 3,
      timestamp: 1002,
    })

    expect(useStore.getState().actors.get('child')?.parentSessionId).toBe('parent')
    expect(useStore.getState().actors.get('child')?.displayName).toBe('checkHealth')
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

  it('does not append events while logging is paused', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })

    useStore.getState().setLoggingPaused(true)

    useStore.getState().handleMessage({
      type: 'XSTATE_EVENT',
      sessionId: 'a1',
      event: { type: 'START' },
      snapshotAfter: snap('running'),
      timestamp: 2000,
      globalSeq: 2,
    })

    expect(useStore.getState().actors.get('a1')?.snapshot.value).toBe('running')
    expect(useStore.getState().events).toHaveLength(0)
  })

  it('persists paused logging changes', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })

    useStore.getState().setLoggingPaused(true)
    expect(setItem).toHaveBeenCalledWith('xstate-devtools.loggingPaused', '1')

    useStore.getState().setLoggingPaused(false)
    expect(setItem).toHaveBeenCalledWith('xstate-devtools.loggingPaused', '0')

    vi.unstubAllGlobals()
  })

  it('persists tree filter changes', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })

    useStore.getState().setTreeFilter('machine:checkout -error')

    expect(setItem).toHaveBeenCalledWith('xstate-devtools.treeFilter', 'machine:checkout -error')
    expect(useStore.getState().treeFilter).toBe('machine:checkout -error')

    vi.unstubAllGlobals()
  })

  it('persists hide-stopped actor changes', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })

    useStore.getState().setHideStoppedActors(false)
    expect(setItem).toHaveBeenCalledWith('xstate-devtools.hideStoppedActors', '0')

    useStore.getState().setHideStoppedActors(true)
    expect(setItem).toHaveBeenCalledWith('xstate-devtools.hideStoppedActors', '1')

    vi.unstubAllGlobals()
  })

  it('caps events at MAX_EVENTS (5000)', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a1',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })
    for (let i = 0; i < 5010; i++) {
      useStore.getState().handleMessage({
        type: 'XSTATE_EVENT',
        sessionId: 'a1',
        event: { type: 'TICK' },
        snapshotAfter: snap('idle'),
        timestamp: i,
        globalSeq: i + 2,
      })
    }
    expect(useStore.getState().events.length).toBe(5000)
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

  it('clears actor state on XSTATE_PAGE_NAVIGATED', () => {
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
    timeTravel(2)

    handleMessage({ type: 'XSTATE_PAGE_NAVIGATED' })

    expect(useStore.getState().actors.size).toBe(0)
    expect(useStore.getState().events).toHaveLength(0)
    expect(useStore.getState().selectedActorId).toBeNull()
    expect(useStore.getState().timeTravelSeq).toBeNull()
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
  it('selects the root state node when selecting a machine actor', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'a2',
      machine: mockMachine,
      snapshot: snap('idle'),
      globalSeq: 1,
      timestamp: 1000,
    })

    useStore.getState().selectStateNode('test.idle')
    useStore.getState().selectActor('a2')

    expect(useStore.getState().selectedStateNodeId).toBe('test')
  })

  it('clears selectedStateNodeId when selecting a non-machine actor', () => {
    useStore.getState().handleMessage({
      type: 'XSTATE_ACTOR_REGISTERED',
      sessionId: 'svc',
      displayName: 'service',
      machine: null,
      snapshot: snap(null),
      globalSeq: 1,
      timestamp: 1000,
    })

    useStore.getState().selectStateNode('test.idle')
    useStore.getState().selectActor('svc')

    expect(useStore.getState().selectedStateNodeId).toBeNull()
  })
})
