// packages/chrome-extension/src/panel/session-io.ts
// Serialize the captured debug session to a portable JSON document and back.
import {
  SESSION_FORMAT_VERSION,
  type SessionExport,
  type SessionExportV1,
  type ActorRecord,
  type EventRecord,
  type SerializedSnapshot,
} from '../shared/types.js'
import type { InspectorStore } from './store.js'

type SessionState = Pick<InspectorStore, 'actors' | 'registeredSnapshots' | 'events'>

/** Build a serializable session document from the current store state. */
export function exportSession(
  state: SessionState,
  now: number,
): SessionExportV1 {
  return {
    formatVersion: SESSION_FORMAT_VERSION,
    exportedAt: now,
    source: 'live-capture',
    actors: Array.from(state.actors.values()),
    registeredSnapshots: Array.from(state.registeredSnapshots.entries()),
    events: state.events,
  }
}

/** Validate and parse an imported session document. Throws on malformed input. */
export function importSession(json: unknown): SessionExport {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Not a session file (expected a JSON object).')
  }
  const obj = json as Record<string, unknown>
  if (obj.formatVersion !== SESSION_FORMAT_VERSION) {
    throw new Error(
      `Unsupported session format version: ${String(obj.formatVersion)} ` +
      `(this panel supports v${SESSION_FORMAT_VERSION}).`,
    )
  }
  if (!Array.isArray(obj.actors) || !Array.isArray(obj.events) || !Array.isArray(obj.registeredSnapshots)) {
    throw new Error('Malformed session file: missing actors / events / registeredSnapshots.')
  }
  return {
    formatVersion: SESSION_FORMAT_VERSION,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    source: 'live-capture',
    actors: obj.actors as ActorRecord[],
    registeredSnapshots: obj.registeredSnapshots as Array<[string, SerializedSnapshot]>,
    events: obj.events as EventRecord[],
  }
}
