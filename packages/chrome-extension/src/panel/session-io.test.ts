// packages/chrome-extension/src/panel/session-io.test.ts
import { describe, it, expect } from 'vitest'
import { exportSession, importSession } from './session-io.js'
import type { ActorRecord, EventRecord, SerializedSnapshot } from '../shared/types.js'

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
  events: [event],
}

describe('session-io', () => {
  it('round-trips through JSON without loss', () => {
    const doc = exportSession(state, 12345)
    const reparsed = importSession(JSON.parse(JSON.stringify(doc)))
    expect(reparsed.exportedAt).toBe(12345)
    expect(reparsed.actors).toEqual([actor])
    expect(reparsed.registeredSnapshots).toEqual([['a1', snap('idle')]])
    expect(reparsed.events).toEqual([event])
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
