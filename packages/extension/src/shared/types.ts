// packages/extension/src/shared/types.ts

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
  /**
   * Synthetic message emitted by the background service worker when the
   * inspected tab starts a new navigation.  The panel should clear its actor
   * store so stale actors from the previous page are not shown.
   */
  | { type: 'XSTATE_PAGE_NAVIGATED' }
  /**
   * Sent by the adapter when it initializes to request a resync if the panel is connected.
   */
  | { type: 'XSTATE_ADAPTER_READY' }

// panel → service worker → content script → injected world → adapter
export type ExtensionToPageMessage =
  | {
      type: 'XSTATE_DISPATCH'
      sessionId: string
      event: SerializedEvent
    }
  /**
   * Sent by the background when a devtools panel connects (or reconnects).
   * The adapter responds by re-broadcasting XSTATE_ACTOR_REGISTERED for every
   * currently-active actor so the panel never shows a blank list if the MV3
   * service worker was killed between page load and panel open.
   */
  | { type: 'XSTATE_PANEL_CONNECTED' }

// Marker added to all postMessages so content script can filter
export type MarkedPageMessage = PageToExtensionMessage & { __xstateDevtools: true }
export type MarkedExtensionMessage = ExtensionToPageMessage & { __xstateDevtools: true }
