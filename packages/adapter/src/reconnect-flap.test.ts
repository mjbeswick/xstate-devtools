// Regression: a reconnect "flap" (a second connecting status after actors are
// already showing) must NOT wipe live actors. Replicates DebuggerController's
// onStatus/onMessage against a real server + real wsClient.
import { describe, it, expect } from 'vitest'
import { createMachine, createActor } from 'xstate'
import { createServerAdapter } from './server.js'
import { createInspectorStore } from '@xstate-devtools/panel-core'
import { DebuggerWsClient } from '../../vscode-debugger/src/debugger/wsClient.js'

const PORT = 9353
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('reconnect flap does not wipe actors', () => {
  it('keeps the actor when a spurious connecting status fires after open', async () => {
    const adapter = createServerAdapter({ port: PORT })
    const machine = createMachine({ id: 'orchestrator', initial: 'running', states: { running: {} } })
    const actor = createActor(machine, { inspect: adapter.inspect })
    actor.start()
    await wait(300)

    const store = createInspectorStore()
    let status = 'idle'
    // DebuggerController.onStatus after the fix: tracks status, no store clear.
    const onStatus = (s: string) => { status = s }
    const onMessage = (msg: any) => {
      store.getState().handleMessage(msg)
      const st = store.getState()
      if (st.selectedActorId === null && st.actors.size > 0) { st.selectActor(st.actors.keys().next().value ?? null) }
    }
    const client = new DebuggerWsClient(`ws://127.0.0.1:${PORT}`, { onMessage, onStatus })

    client.connect()
    await wait(300)
    expect(store.getState().actors.size).toBeGreaterThan(0) // actor showed

    // Simulate a flap: another connecting cycle while we already have the actor.
    // With the old code this triggered exitReplay() and wiped it; now it's a no-op.
    onStatus('closed')
    onStatus('connecting')
    onStatus('open')
    await wait(50)
    expect(store.getState().actors.size).toBeGreaterThan(0) // still there — not wiped

    client.disconnect()
    actor.stop()
    adapter.close()
  }, 6000)
})
