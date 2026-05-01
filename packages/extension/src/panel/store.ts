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

  // Returns the snapshot to display for an actor (live or time-travelled)
  getDisplaySnapshot: (sessionId: string) => ActorRecord['snapshot'] | null

  // Message handler — call this from the port listener
  handleMessage: (msg: PageToExtensionMessage) => void

  selectActor: (sessionId: string | null) => void
  selectStateNode: (id: string | null) => void
  timeTravel: (seq: number | null) => void
}

export const useStore = create<InspectorStore>((set, get) => ({
  actors: new Map(),
  registeredSnapshots: new Map(),
  events: [],
  selectedActorId: null,
  selectedStateNodeId: null,
  timeTravelSeq: null,

  getDisplaySnapshot(sessionId) {
    const { actors, registeredSnapshots, events, timeTravelSeq } = get()
    const actor = actors.get(sessionId)
    if (!actor) return null
    if (timeTravelSeq === null) return actor.snapshot

    // Find the latest event at or before timeTravelSeq for this actor
    for (let i = events.length - 1; i >= 0; i--) {
      const evt = events[i]
      if (evt.sessionId === sessionId && evt.globalSeq <= timeTravelSeq) {
        return evt.snapshotAfter
      }
    }
    // No events for this actor before that seq — use registration snapshot
    return registeredSnapshots.get(sessionId) ?? actor.snapshot
  },

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
          break
        }
        case 'XSTATE_ACTOR_STOPPED': {
          const actor = actors.get(msg.sessionId)
          if (actor) actors.set(msg.sessionId, { ...actor, status: 'stopped' })
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
}))
