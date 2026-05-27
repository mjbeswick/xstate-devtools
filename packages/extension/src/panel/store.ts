// packages/extension/src/panel/store.ts
import { create } from 'zustand'
import type {
  ActorRecord,
  EventRecord,
  PageToExtensionMessage,
  SerializedSnapshot,
} from '../shared/types.js'
import { getActiveNodeIds, getActivePaths } from './active-nodes.js'

const MAX_EVENTS = 5000
const LOGGING_PAUSED_KEY = 'xstate-devtools.loggingPaused'
const TREE_FILTER_KEY = 'xstate-devtools.treeFilter'
const HIDE_STOPPED_ACTORS_KEY = 'xstate-devtools.hideStoppedActors'

export function getInitialLoggingPaused(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): boolean {
  try {
    return storage?.getItem(LOGGING_PAUSED_KEY) === '1'
  } catch {
    return false
  }
}

export function getInitialTreeFilter(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): string {
  try {
    return storage?.getItem(TREE_FILTER_KEY) ?? ''
  } catch {
    return ''
  }
}

export function getInitialHideStoppedActors(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): boolean {
  try {
    const stored = storage?.getItem(HIDE_STOPPED_ACTORS_KEY)
    return stored === null || stored === undefined ? true : stored === '1'
  } catch {
    return true
  }
}

export interface InspectorStore {
  actors: Map<string, ActorRecord>
  /** Snapshot at registration time, never mutated — used as time-travel floor */
  registeredSnapshots: Map<string, SerializedSnapshot>
  events: EventRecord[]
  loggingPaused: boolean
  hideStoppedActors: boolean
  selectedActorId: string | null
  selectedStateNodeId: string | null
  timeTravelSeq: number | null // null = live; number = frozen at that seq
  treeFilter: string
  portConnected: boolean

  // Message handler — call this from the port listener
  handleMessage: (msg: PageToExtensionMessage) => void

  selectActor: (sessionId: string | null) => void
  selectStateNode: (id: string | null) => void
  timeTravel: (seq: number | null) => void
  clearEvents: () => void
  setLoggingPaused: (paused: boolean) => void
  setHideStoppedActors: (hidden: boolean) => void
  setTreeFilter: (filter: string) => void
  setPortConnected: (connected: boolean) => void
  resetPanel: () => void
}

function getResetPanelState() {
  return {
    actors: new Map<string, ActorRecord>(),
    registeredSnapshots: new Map<string, SerializedSnapshot>(),
    events: [] as EventRecord[],
    selectedActorId: null,
    selectedStateNodeId: null,
    timeTravelSeq: null,
    hideStoppedActors: true,
  }
}

/** Pure function — use as a Zustand selector: useStore(s => getDisplaySnapshot(s, id)) */
export function getDisplaySnapshot(
  state: Pick<InspectorStore, 'actors' | 'events' | 'timeTravelSeq' | 'registeredSnapshots'>,
  sessionId: string,
): ActorRecord['snapshot'] | null {
  const actor = state.actors.get(sessionId)
  if (!actor) return null
  if (state.timeTravelSeq === null) return actor.snapshot

  for (let i = state.events.length - 1; i >= 0; i--) {
    const evt = state.events[i]
    if (evt.sessionId === sessionId && evt.globalSeq <= state.timeTravelSeq) {
      return evt.snapshotAfter
    }
  }
  return state.registeredSnapshots.get(sessionId) ?? actor.snapshot
}

export function getSelectedEvent(
  state: Pick<InspectorStore, 'events' | 'timeTravelSeq' | 'selectedActorId'>,
): EventRecord | null {
  if (state.timeTravelSeq === null || state.selectedActorId === null) {
    return null
  }

  for (let i = state.events.length - 1; i >= 0; i--) {
    const eventRecord = state.events[i]
    if (
      eventRecord.globalSeq === state.timeTravelSeq &&
      eventRecord.sessionId === state.selectedActorId
    ) {
      return eventRecord
    }
  }

  return null
}

function getSnapshotBeforeEvent(
  state: Pick<InspectorStore, 'events' | 'registeredSnapshots'>,
  eventRecord: EventRecord,
): SerializedSnapshot | null {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const candidate = state.events[i]
    if (
      candidate.sessionId === eventRecord.sessionId &&
      candidate.globalSeq < eventRecord.globalSeq
    ) {
      return candidate.snapshotAfter
    }
  }

  return state.registeredSnapshots.get(eventRecord.sessionId) ?? null
}

export function getEventSourceStateNodeId(
  state: Pick<InspectorStore, 'actors' | 'events' | 'registeredSnapshots'>,
  eventRecord: EventRecord,
): string | null {
  const actor = state.actors.get(eventRecord.sessionId)
  if (!actor?.machine) {
    return null
  }

  const previousSnapshot = getSnapshotBeforeEvent(state, eventRecord)
  if (!previousSnapshot) {
    return null
  }

  const sourcePaths = getActivePaths(previousSnapshot.value as any, actor.machine.root)
  if (sourcePaths.length === 0) {
    return null
  }

  const targetActiveIds = getActiveNodeIds(eventRecord.snapshotAfter.value as any, actor.machine.root)

  let fallbackNodeId: string | null = null

  for (const path of sourcePaths) {
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i]
      const matchingTransitions = node.on.filter((transition) => transition.eventType === eventRecord.event.type)
      if (matchingTransitions.length === 0) {
        continue
      }

      fallbackNodeId ??= node.id

      const hasMatchingTarget = matchingTransitions.some(
        (transition) =>
          transition.targets.length > 0 &&
          transition.targets.some((target) => targetActiveIds.has(target)),
      )

      if (hasMatchingTarget) {
        return node.id
      }
    }
  }

  return fallbackNodeId
}

export const useStore = create<InspectorStore>((set, _get) => ({
  actors: new Map(),
  registeredSnapshots: new Map(),
  events: [],
  loggingPaused: getInitialLoggingPaused(typeof localStorage === 'undefined' ? null : localStorage),
  hideStoppedActors: getInitialHideStoppedActors(typeof localStorage === 'undefined' ? null : localStorage),
  selectedActorId: null,
  selectedStateNodeId: null,
  timeTravelSeq: null,
  treeFilter: getInitialTreeFilter(typeof localStorage === 'undefined' ? null : localStorage),
  portConnected: false,

  handleMessage(msg) {
    set((state) => {
      const actors = new Map(state.actors)
      const registeredSnapshots = new Map(state.registeredSnapshots)
      const events = [...state.events]

      switch (msg.type) {
        case 'XSTATE_ACTOR_REGISTERED': {
          const existingActor = actors.get(msg.sessionId)
          actors.set(msg.sessionId, {
            sessionId: msg.sessionId,
            parentSessionId: msg.parentSessionId ?? existingActor?.parentSessionId,
            displayName: msg.displayName ?? existingActor?.displayName,
            machine: msg.machine,
            snapshot: msg.snapshot,
            status: 'active',
            registeredAt: existingActor?.registeredAt ?? Date.now(),
            registeredAtSeq: msg.globalSeq,
          })
          registeredSnapshots.set(msg.sessionId, msg.snapshot)
          return {
            actors,
            registeredSnapshots,
            events,
            selectedActorId: state.selectedActorId ?? msg.sessionId,
          }
        }
        case 'XSTATE_SNAPSHOT': {
          const actor = actors.get(msg.sessionId)
          if (actor) {
            actors.set(msg.sessionId, { ...actor, snapshot: msg.snapshot })
          }
          break
        }
        case 'XSTATE_EVENT': {
          const actor = actors.get(msg.sessionId)
          if (actor) {
            actors.set(msg.sessionId, { ...actor, snapshot: msg.snapshotAfter })
          }
          if (!state.loggingPaused) {
            events.push({
              sessionId: msg.sessionId,
              event: msg.event,
              snapshotAfter: msg.snapshotAfter,
              timestamp: msg.timestamp,
              globalSeq: msg.globalSeq,
            })
            if (events.length > MAX_EVENTS) events.shift()
          }

          // Clamp time travel if oldest event was evicted
          const timeTravelSeq = state.timeTravelSeq
          const newTimeTravelSeq =
            timeTravelSeq !== null && events.length > 0 && timeTravelSeq < events[0].globalSeq
              ? events[0].globalSeq
              : timeTravelSeq

          return { actors, registeredSnapshots, events, timeTravelSeq: newTimeTravelSeq }
        }
        case 'XSTATE_ACTOR_STOPPED': {
          const actor = actors.get(msg.sessionId)
          if (actor) actors.set(msg.sessionId, { ...actor, status: 'stopped' })
          registeredSnapshots.delete(msg.sessionId)
          break
        }
        case 'XSTATE_PAGE_NAVIGATED': {
          // Page reloaded — wipe all state so fresh registrations start clean
          return getResetPanelState()
        }
      }

      return { actors, registeredSnapshots, events }
    })
  },

  selectActor(sessionId) {
    const actor = sessionId ? _get().actors.get(sessionId) : null
    const selectedStateNodeId = actor?.machine?.root.id ?? null
    set({ selectedActorId: sessionId, selectedStateNodeId })
  },

  selectStateNode(id) {
    set({ selectedStateNodeId: id })
  },

  timeTravel(seq) {
    set({ timeTravelSeq: seq })
  },

  clearEvents() {
    set({ events: [], timeTravelSeq: null })
  },

  setLoggingPaused(paused) {
    try {
      localStorage.setItem(LOGGING_PAUSED_KEY, paused ? '1' : '0')
    } catch {
      // Ignore storage failures so the panel continues to work in restricted environments.
    }
    set({ loggingPaused: paused })
  },

  setHideStoppedActors(hidden) {
    try {
      localStorage.setItem(HIDE_STOPPED_ACTORS_KEY, hidden ? '1' : '0')
    } catch {
      // Ignore storage failures so the panel continues to work in restricted environments.
    }
    set({ hideStoppedActors: hidden })
  },

  setTreeFilter(filter) {
    try {
      localStorage.setItem(TREE_FILTER_KEY, filter)
    } catch {
      // Ignore storage failures so the panel continues to work in restricted environments.
    }
    set({ treeFilter: filter })
  },

  setPortConnected(connected) {
    set({ portConnected: connected })
  },

  resetPanel() {
    set(getResetPanelState())
  },
}))
