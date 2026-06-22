// Reconnect replay semantics: live actors replay to every panel; the
// pre-connection event backlog flushes once (no stale re-flood on reconnect).
import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'
import { createMachine, createActor } from 'xstate'
import { createServerAdapter } from './server.js'

const PORT = 9349
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Connect, collect frames for `ms`, then close. */
function collect(url: string, ms: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const frames: any[] = []
    const ws = new WebSocket(url)
    ws.on('message', (raw) => { try { frames.push(JSON.parse(raw.toString('utf8'))) } catch { /* */ } })
    ws.on('open', () => setTimeout(() => { ws.close(); resolve(frames) }, ms))
    ws.on('error', reject)
  })
}

const typesOf = (frames: any[], type: string) => frames.filter((f) => f.type === type)

describe('server reconnect replay', () => {
  it('replays the live actor every connect, but the event backlog only once', async () => {
    const adapter = createServerAdapter({ port: PORT })
    const machine = createMachine({ id: 'm', initial: 'a', states: { a: { on: { GO: 'b' } }, b: {} } })
    const actor = createActor(machine, { inspect: adapter.inspect })
    actor.start()                 // registration (snapshot = state 'a')
    actor.send({ type: 'GO' })    // pre-connection event → buffered; advances to 'b'
    await wait(300)               // let the WS server come up

    const url = `ws://127.0.0.1:${PORT}`
    const first = await collect(url, 200)
    await wait(200)               // "disconnected"
    const second = await collect(url, 200)

    // Both connects replay the actor registration.
    expect(typesOf(first, 'XSTATE_ACTOR_REGISTERED').length).toBeGreaterThan(0)
    expect(typesOf(second, 'XSTATE_ACTOR_REGISTERED').length).toBeGreaterThan(0)

    // The backlog event reaches the FIRST panel only — not the reconnect.
    expect(typesOf(first, 'XSTATE_EVENT').length).toBeGreaterThan(0)
    expect(typesOf(second, 'XSTATE_EVENT').length).toBe(0)

    // The registration frame keeps its registration-time snapshot (not mutated
    // to the current 'b' — preserves the panel's time-travel floor); the
    // current state ('b') arrives as a following snapshot update.
    const reg = typesOf(second, 'XSTATE_ACTOR_REGISTERED')[0]
    expect(reg.snapshot.value).not.toBe('b')
    const snaps = typesOf(second, 'XSTATE_SNAPSHOT')
    expect(snaps.some((s) => s.snapshot.value === 'b')).toBe(true)

    actor.stop()
    adapter.close()
  }, 6000)
})
