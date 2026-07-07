// packages/panel-core/src/session-io.ts
// Serialize the captured debug session to a portable JSON document and back.
import {
  SESSION_FORMAT_VERSION,
  type SessionExportV2,
  type ActorRecord,
  type EventRecord,
  type SerializedSnapshot,
} from '@xstate-devtools/protocol'
import type { InspectorStore } from './store.js'

type SessionState = Pick<InspectorStore, 'actors' | 'registeredSnapshots' | 'persistedSnapshots' | 'events'>

const SUPPORTED_VERSIONS = [1, 2]

/** Build a serializable session document from the current store state. */
export function exportSession(
  state: SessionState,
  now: number,
): SessionExportV2 {
  // Only successfully-captured persisted snapshots are restorable — drop errors.
  const persistedSnapshots: Array<[string, unknown]> = []
  for (const [id, entry] of state.persistedSnapshots) {
    if (entry.persisted !== undefined) persistedSnapshots.push([id, entry.persisted])
  }
  return {
    formatVersion: SESSION_FORMAT_VERSION,
    exportedAt: now,
    source: 'live-capture',
    actors: Array.from(state.actors.values()),
    registeredSnapshots: Array.from(state.registeredSnapshots.entries()),
    events: state.events,
    persistedSnapshots,
  }
}

/**
 * Validate and parse an imported session document, normalizing v1 → v2.
 * Throws on malformed input.
 */
export function importSession(json: unknown): SessionExportV2 {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Not a session file (expected a JSON object).')
  }
  const obj = json as Record<string, unknown>
  if (typeof obj.formatVersion !== 'number' || !SUPPORTED_VERSIONS.includes(obj.formatVersion)) {
    throw new Error(
      `Unsupported session format version: ${String(obj.formatVersion)} ` +
      `(this panel supports v${SUPPORTED_VERSIONS.join('/')}).`,
    )
  }
  if (!Array.isArray(obj.actors) || !Array.isArray(obj.events) || !Array.isArray(obj.registeredSnapshots)) {
    throw new Error('Malformed session file: missing actors / events / registeredSnapshots.')
  }
  const persistedSnapshots = Array.isArray(obj.persistedSnapshots)
    ? (obj.persistedSnapshots as Array<[string, unknown]>)
    : []
  return {
    formatVersion: SESSION_FORMAT_VERSION,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    source: 'live-capture',
    actors: obj.actors as ActorRecord[],
    registeredSnapshots: obj.registeredSnapshots as Array<[string, SerializedSnapshot]>,
    events: obj.events as EventRecord[],
    persistedSnapshots,
  }
}
