// packages/extension/src/panel/store.ts
import { create } from 'zustand'
import type {
  ActorRecord, EventRecord, SerializedStateNode,
  PageToExtensionMessage, SerializedSnapshot,
} from '../shared/types.js'

const MAX_EVENTS = 500

export interface InspectorStore {
  actors: Map<string, ActorRecord>
  /** Snapshot at registration time, never mutated — used as time-travel floor */
  registeredSnapshots: Map<string, SerializedSnapshot>
  events: EventRecord[]
  selectedActorId: string | null
  selectedStateNodeId: string | null
  timeTravelSeq: number | null   // null = live; number = frozen at that seq
  treeFilter: string
  portConnected: boolean

  // Message handler — call this from the port listener
  handleMessage: (msg: PageToExtensionMessage) => void

  selectActor: (sessionId: string | null) => void
  selectStateNode: (id: string | null) => void
  timeTravel: (seq: number | null) => void
  setTreeFilter: (filter: string) => void
  setPortConnected: (connected: boolean) => void
}

/** Pure function — use as a Zustand selector: useStore(s => getDisplaySnapshot(s, id)) */
export function getDisplaySnapshot(
  state: Pick<InspectorStore, 'actors' | 'events' | 'timeTravelSeq' | 'registeredSnapshots'>,
  sessionId: string
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

export const useStore = create<InspectorStore>((set, get) => ({
  actors: new Map(),
  registeredSnapshots: new Map(),
  events: [],
  selectedActorId: null,
  selectedStateNodeId: null,
  timeTravelSeq: null,
  treeFilter: '',
  portConnected: false,

  handleMessage(msg) {
    set((state) => {
      const actors = new Map(state.actors)
      const registeredSnapshots = new Map(state.registeredSnapshots)
      const events = [...state.events]

      switch (msg.type) {
        case 'XSTATE_ACTOR_REGISTERED': {
          actors.set(msg.sessionId, {
            sessionId: msg.sessionId,
            parentSessionId: msg.parentSessionId,
            machine: msg.machine,
            snapshot: msg.snapshot,
            status: 'active',
            registeredAt: Date.now(),
            registeredAtSeq: msg.globalSeq,
          })
          registeredSnapshots.set(msg.sessionId, msg.snapshot)
          break
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
          events.push({
            sessionId: msg.sessionId,
            event: msg.event,
            snapshotAfter: msg.snapshotAfter,
            timestamp: msg.timestamp,
            globalSeq: msg.globalSeq,
          })
          if (events.length > MAX_EVENTS) events.shift()

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
      }

      return { actors, registeredSnapshots, events }
    })
  },

  selectActor(sessionId) {
    set({ selectedActorId: sessionId, selectedStateNodeId: null })
  },

  selectStateNode(id) {
    set({ selectedStateNodeId: id })
  },

  timeTravel(seq) {
    set({ timeTravelSeq: seq })
  },

  setTreeFilter(filter) {
    set({ treeFilter: filter })
  },

  setPortConnected(connected) {
    set({ portConnected: connected })
  },
}))
