// Sample server-side XState actor — runs in the Remix dev process and
// is visible in the DevTools panel via the WS bridge (createServerAdapter).
import { setup, assign, createActor, fromCallback } from 'xstate'
import { inspect } from './inspector.server.js'

const tickActor = fromCallback<{ type: 'TICK' }>(({ sendBack }) => {
  const id = setInterval(() => sendBack({ type: 'TICK' }), 1000)
  return () => clearInterval(id)
})

const orchestratorMachine = setup({
  types: {
    context: {} as { ticks: number; jobsProcessed: number; lastJobId: string | null },
    events: {} as
      | { type: 'TICK' }
      | { type: 'ENQUEUE'; jobId: string }
      | { type: 'PAUSE' }
      | { type: 'RESUME' }
      | { type: 'RESET' },
  },
  actors: { tickActor },
}).createMachine({
  id: 'orchestrator',
  initial: 'running',
  context: { ticks: 0, jobsProcessed: 0, lastJobId: null },
  states: {
    running: {
      invoke: { id: 'tick', src: 'tickActor' },
      on: {
        TICK: { actions: assign({ ticks: ({ context }) => context.ticks + 1 }) },
        ENQUEUE: {
          target: 'processing',
          actions: assign({ lastJobId: ({ event }) => event.jobId }),
        },
        PAUSE: 'paused',
      },
    },
    processing: {
      after: {
        500: {
          target: 'running',
          actions: assign({ jobsProcessed: ({ context }) => context.jobsProcessed + 1 }),
        },
      },
    },
    paused: {
      on: { RESUME: 'running', RESET: { target: 'running', actions: assign({ ticks: 0, jobsProcessed: 0, lastJobId: null }) } },
    },
  },
})

const KEY = '__xstate_devtools_orchestrator__'
type Cached = { actor: ReturnType<typeof createActor<typeof orchestratorMachine>> }
const cached = (globalThis as Record<string, unknown>)[KEY] as Cached | undefined

if (!cached) {
  const actor = createActor(orchestratorMachine, { inspect })
  actor.start()
  ;(globalThis as Record<string, unknown>)[KEY] = { actor } satisfies Cached
}

export const orchestrator = ((globalThis as Record<string, unknown>)[KEY] as Cached).actor
