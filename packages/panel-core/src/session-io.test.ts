// packages/panel-core/src/session-io.test.ts
import { describe, it, expect } from 'vitest'
import { exportSession, importSession } from './session-io.js'
import type { ActorRecord, EventRecord, SerializedSnapshot } from '@xstate-devtools/protocol'

const snap = (value: unknown): SerializedSnapshot => ({ value, context: {}, status: 'active' })

const actor: ActorRecord = {
  sessionId: 'a1', machine: null, snapshot: snap('running'),
  status: 'active', registeredAt: 0, registeredAtSeq: 1,
}
const event: EventRecord = {
  sessionId: 'a1', event: { type: 'START' }, snapshotAfter: snap('running'),
  timestamp: 2000, globalSeq: 2,
}

const state = {
  actors: new Map([['a1', actor]]),
  registeredSnapshots: new Map([['a1', snap('idle')]]),
  persistedSnapshots: new Map([
    ['a1', { persisted: { value: 'running', context: { n: 1 } }, timestamp: 5 }],
    ['a2', { error: 'not persistable', timestamp: 6 }],
  ]),
  events: [event],
}

describe('session-io', () => {
  it('round-trips through JSON without loss', () => {
    const doc = exportSession(state, 12345)
    const reparsed = importSession(JSON.parse(JSON.stringify(doc)))
    expect(reparsed.formatVersion).toBe(2)
    expect(reparsed.exportedAt).toBe(12345)
    expect(reparsed.actors).toEqual([actor])
    expect(reparsed.registeredSnapshots).toEqual([['a1', snap('idle')]])
    expect(reparsed.events).toEqual([event])
  })

  it('exports only successfully-captured persisted snapshots', () => {
    const doc = exportSession(state, 0)
    // a1 captured, a2 was an error → dropped
    expect(doc.persistedSnapshots).toEqual([['a1', { value: 'running', context: { n: 1 } }]])
  })

  it('imports a v1 session, normalizing to v2 with empty persisted snapshots', () => {
    const v1 = {
      formatVersion: 1, exportedAt: 1, source: 'live-capture',
      actors: [actor], registeredSnapshots: [['a1', snap('idle')]], events: [event],
    }
    const reparsed = importSession(v1)
    expect(reparsed.formatVersion).toBe(2)
    expect(reparsed.persistedSnapshots).toEqual([])
  })

  it('rejects a non-object', () => {
    expect(() => importSession(null)).toThrow(/session file/i)
    expect(() => importSession(42)).toThrow(/session file/i)
  })

  it('rejects an unsupported format version', () => {
    expect(() => importSession({ formatVersion: 99, actors: [], events: [], registeredSnapshots: [] }))
      .toThrow(/version/i)
  })

  it('rejects missing arrays', () => {
    expect(() => importSession({ formatVersion: 1, actors: [], events: [] }))
      .toThrow(/malformed/i)
  })
})
