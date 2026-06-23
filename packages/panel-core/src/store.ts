// packages/panel-core/src/store.ts
//
// Framework-agnostic inspector store. The state shape and all transitions live
// here as a zustand `StateCreator`. Consumers bind it to their framework:
//   - chrome panel:  create(inspectorStoreInitializer)            // zustand/react
//   - vscode webview: createInspectorStore()                      // zustand/vanilla
// so the panel logic is shared rather than duplicated.
import { createStore, type StateCreator, type StoreApi } from 'zustand/vanilla'
import type {
  ActorRecord, EventRecord,
  PageToExtensionMessage, SerializedSnapshot, SessionExport,
} from '@xstate-devtools/protocol'

export const MAX_EVENTS = 500

/**
 * Build a minimal actor record from a bare snapshot, for an actor we never saw
 * an XSTATE_ACTOR_REGISTERED for. Adapters predating the replay-on-connect
 * feature don't re-register their already-running actors on (re)connect — they
 * only stream live XSTATE_EVENT/XSTATE_SNAPSHOT — so without this those actors
 * would never appear. machine is null (we have no definition), so the tree
 * shows the actor and its state value but no expandable state-node tree.
 */
function synthesizeActor(
  sessionId: string,
  snapshot: SerializedSnapshot,
  seq: number,
): ActorRecord {
  return {
    sessionId,
    machine: null,
    snapshot,
    status: snapshot.status,
    registeredAt: Date.now(),
    registeredAtSeq: seq,
  }
}

/** A captured XState persisted snapshot (or the reason it couldn't be captured). */
export interface PersistedEntry {
  persisted?: unknown
  error?: string
  timestamp: number
}

export interface InspectorStore {
  actors: Map<string, ActorRecord>
  /** Snapshot at registration time, never mutated — used as time-travel floor */
  registeredSnapshots: Map<string, SerializedSnapshot>
  /** On-demand XState persisted snapshots, keyed by sessionId. */
  persistedSnapshots: Map<string, PersistedEntry>
  events: EventRecord[]
  selectedActorId: string | null
  selectedStateNodeId: string | null
  timeTravelSeq: number | null   // null = live; number = frozen at that seq
  treeFilter: string

  /** When true, the store holds an imported session and ignores live messages. */
  replayMode: boolean
  /** Label for the loaded session (e.g. file name), shown in the replay banner. */
  replayName: string | null

  // Message handler — call this from the port/socket listener
  handleMessage: (msg: PageToExtensionMessage) => void

  selectActor: (sessionId: string | null) => void
  selectStateNode: (id: string | null) => void
  timeTravel: (seq: number | null) => void
  setTreeFilter: (filter: string) => void
  /** Clear the captured event log (and any time-travel point); keeps actors. */
  clearEvents: () => void

  /** Replace store contents with an imported session and enter replay mode. */
  loadSession: (data: SessionExport, name: string) => void
  /** Leave replay mode and reset to an empty live state. */
  exitReplay: () => void
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

/**
 * The store definition, as a zustand StateCreator. Bind it with `create()`
 * (react) or `createStore()` (vanilla) depending on the consumer.
 */
export const inspectorStoreInitializer: StateCreator<InspectorStore> = (set, get) => ({
  actors: new Map(),
  registeredSnapshots: new Map(),
  persistedSnapshots: new Map(),
  events: [],
  selectedActorId: null,
  selectedStateNodeId: null,
  timeTravelSeq: null,
  treeFilter: '',
  replayMode: false,
  replayName: null,

  handleMessage(msg) {
    set((state) => {
      // In replay mode the store holds a frozen imported session — drop live data.
      if (state.replayMode) return state

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
          actors.set(msg.sessionId, actor
            ? { ...actor, snapshot: msg.snapshot }
            : synthesizeActor(msg.sessionId, msg.snapshot, msg.globalSeq))
          if (!actor) { registeredSnapshots.set(msg.sessionId, msg.snapshot) }
          break
        }
        case 'XSTATE_EVENT': {
          const actor = actors.get(msg.sessionId)
          actors.set(msg.sessionId, actor
            ? { ...actor, snapshot: msg.snapshotAfter }
            : synthesizeActor(msg.sessionId, msg.snapshotAfter, msg.globalSeq))
          if (!actor) { registeredSnapshots.set(msg.sessionId, msg.snapshotAfter) }
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
        case 'XSTATE_PERSISTED_SNAPSHOT': {
          const persistedSnapshots = new Map(state.persistedSnapshots)
          persistedSnapshots.set(msg.sessionId, {
            persisted: msg.persisted,
            error: msg.error,
            timestamp: msg.timestamp,
          })
          return { actors, registeredSnapshots, events, persistedSnapshots }
        }
        case 'XSTATE_REPLAY_DONE': {
          // Reconcile to the server's authoritative live set: drop actors left
          // over from a previous session, keep the ones just replayed.
          const live = new Set(msg.sessionIds)
          for (const id of [...actors.keys()]) {
            if (!live.has(id)) { actors.delete(id); registeredSnapshots.delete(id) }
          }
          const selectedActorId = state.selectedActorId && actors.has(state.selectedActorId)
            ? state.selectedActorId
            : null
          return { actors, registeredSnapshots, events, selectedActorId }
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

  clearEvents() {
    set({ events: [], timeTravelSeq: null })
  },

  loadSession(data, name) {
    const actors = new Map(data.actors.map((a) => [a.sessionId, a]))
    const registeredSnapshots = new Map(data.registeredSnapshots)
    const persistedEntries = 'persistedSnapshots' in data ? data.persistedSnapshots : []
    const persistedSnapshots = new Map(
      persistedEntries.map(([id, persisted]) => [id, { persisted, timestamp: 0 }]),
    )
    const firstActor = data.actors[0]?.sessionId ?? null
    set({
      actors,
      registeredSnapshots,
      persistedSnapshots,
      events: data.events,
      replayMode: true,
      replayName: name,
      // Land at the end of the recording (final captured state).
      timeTravelSeq: null,
      selectedActorId: firstActor,
      selectedStateNodeId: null,
      treeFilter: '',
    })
  },

  exitReplay() {
    set({
      actors: new Map(),
      registeredSnapshots: new Map(),
      persistedSnapshots: new Map(),
      events: [],
      replayMode: false,
      replayName: null,
      timeTravelSeq: null,
      selectedActorId: null,
      selectedStateNodeId: null,
      treeFilter: '',
    })
  },
})

/** Create a standalone (vanilla) inspector store — used by the vscode webview. */
export function createInspectorStore(): StoreApi<InspectorStore> {
  return createStore<InspectorStore>(inspectorStoreInitializer)
}
