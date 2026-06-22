// packages/protocol/src/index.ts
//
// The wire protocol shared by the adapter (which produces these messages from a
// running app), the chrome-extension panel, and the vscode-extension debugger
// (which consume them). This is the single source of truth — no package should
// redeclare these shapes.

export type StateNodeType = 'atomic' | 'compound' | 'parallel' | 'final' | 'history'

export interface SerializedTransition {
  targets: string[]   // absolute state node ids
  guard?: string      // guard name or "(inline)"
  actions: string[]   // action names
  eventType: string
}

export interface SerializedInvoke {
  id: string
  src: string
}

export type SerializedEvent = { type: string; [key: string]: unknown }

export interface SerializedStateNode {
  id: string
  key: string
  type: StateNodeType
  initial?: string
  states: Record<string, SerializedStateNode>
  on: SerializedTransition[]           // all transitions from this node
  always: SerializedTransition[]       // eventless transitions
  entry: string[]                      // action names
  exit: string[]                       // action names
  invoke: SerializedInvoke[]
}

export interface SerializedMachine {
  id: string
  root: SerializedStateNode
  sourceLocation?: string              // "file.ts:42" from Error().stack
}

export interface SerializedSnapshot {
  value: unknown                       // XState StateValue (string | object)
  context: unknown                     // sanitized context
  status: 'active' | 'done' | 'error' | 'stopped'
  error?: unknown
}

export interface ActorRecord {
  sessionId: string
  parentSessionId?: string
  machine: SerializedMachine | null    // null for non-machine actors (promise, callback)
  snapshot: SerializedSnapshot
  status: 'active' | 'done' | 'error' | 'stopped'
  registeredAt: number
  registeredAtSeq: number
}

export interface EventRecord {
  sessionId: string
  event: SerializedEvent
  snapshotAfter: SerializedSnapshot
  timestamp: number
  globalSeq: number
}

// ── Session export / import ────────────────────────────────────────────────────

export const SESSION_FORMAT_VERSION = 2

/**
 * Serializable snapshot of a captured debug session — the event log plus the
 * actors and their (display) snapshots. Re-importable into the panel as a
 * read-only replay. Note: the `*snapshot*` fields here are lossy *display*
 * snapshots, not XState persisted snapshots; `persistedSnapshots` (v2+) holds
 * any captured XState persisted snapshots, which ARE restorable.
 */
export interface SessionExportV1 {
  formatVersion: 1
  exportedAt: number
  source: 'live-capture'
  actors: ActorRecord[]
  registeredSnapshots: Array<[string, SerializedSnapshot]>
  events: EventRecord[]
}

export interface SessionExportV2 {
  formatVersion: 2
  exportedAt: number
  source: 'live-capture'
  actors: ActorRecord[]
  registeredSnapshots: Array<[string, SerializedSnapshot]>
  events: EventRecord[]
  /** XState persisted snapshots captured on demand, keyed by sessionId. */
  persistedSnapshots: Array<[string, unknown]>
}

export type SessionExport = SessionExportV1 | SessionExportV2

// ── Message protocol ──────────────────────────────────────────────────────────

// page (injected world) → content script → service worker → panel
export type PageToExtensionMessage =
  | {
      type: 'XSTATE_ACTOR_REGISTERED'
      sessionId: string
      parentSessionId?: string
      machine: SerializedMachine | null
      snapshot: SerializedSnapshot
      globalSeq: number
      timestamp: number
    }
  | {
      type: 'XSTATE_SNAPSHOT'
      sessionId: string
      snapshot: SerializedSnapshot
      timestamp: number
      globalSeq: number
    }
  | {
      type: 'XSTATE_EVENT'
      sessionId: string
      event: SerializedEvent
      snapshotAfter: SerializedSnapshot
      timestamp: number
      globalSeq: number
    }
  | {
      type: 'XSTATE_ACTOR_STOPPED'
      sessionId: string
    }
  | {
      type: 'XSTATE_PERSISTED_SNAPSHOT'
      sessionId: string
      persisted?: unknown          // XState persisted snapshot (JSON-safe), if captured
      error?: string               // set when the actor can't be persisted
      timestamp: number
    }
  | {
      type: 'XSTATE_REPLAY_DONE'
      sessionIds: string[]         // authoritative set of live actors just replayed (for reconcile)
    }

// panel → service worker → content script → injected world → adapter
export type ExtensionToPageMessage =
  | {
      type: 'XSTATE_DISPATCH'
      sessionId: string
      event: SerializedEvent
    }
  | {
      type: 'XSTATE_REQUEST_PERSISTED'
      sessionId: string
    }
  | {
      type: 'XSTATE_RESTORE'
      sessionId: string
      persisted: unknown           // XState persisted snapshot to recreate the actor from
    }

// Marker added to all postMessages so content script can filter
export type MarkedPageMessage = PageToExtensionMessage & { __xstateDevtools: true }
export type MarkedExtensionMessage = ExtensionToPageMessage & { __xstateDevtools: true }
