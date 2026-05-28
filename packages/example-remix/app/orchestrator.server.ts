// Sample server-side XState actor — runs in the Remix dev process and
// is visible in the DevTools panel via the WS bridge (createServerAdapter).
import { assign, createActor, fromCallback, setup } from 'xstate'
import { inspect } from './inspector.server.js'

const tickActor = fromCallback<{ type: 'TICK' }>(({ sendBack }) => {
  const id = setInterval(() => sendBack({ type: 'TICK' }), 1000)
  return () => clearInterval(id)
})

const orchestratorMachine = setup({
  types: {
    context: {} as {
      ticks: number
      jobsProcessed: number
      failedJobs: number
      lastJobId: string | null
    },
    events: {} as
      | { type: 'TICK' }
      | { type: 'ENQUEUE'; jobId: string }
      | { type: 'PAUSE' }
      | { type: 'RESUME' }
      | { type: 'RESET' }
      | { type: 'CRASH' }
      | { type: 'RESTART' },
  },
  actors: { tickActor },
}).createMachine({
  id: 'orchestrator',
  initial: 'running',
  context: { ticks: 0, jobsProcessed: 0, failedJobs: 0, lastJobId: null },
  states: {
    running: {
      description:
        'The orchestrator is active and accepting new jobs. It periodically ticks to keep track of uptime.',
      invoke: { id: 'tick', src: 'tickActor' },
      initial: 'idle',
      states: {
        idle: {
          description:
            'Waiting for jobs to be enqueued. Ready to process the next job in the queue.',
          on: {
            ENQUEUE: {
              target: 'processing',
              actions: assign({ lastJobId: ({ event }) => event.jobId }),
            },
          },
        },
        processing: {
          description: 'A job is currently being processed. It may succeed or fail.',
          after: {
            500: [
              {
                guard: () => Math.random() > 0.2,
                target: 'idle',
                actions: assign({ jobsProcessed: ({ context }) => context.jobsProcessed + 1 }),
              },
              {
                target: 'failedJob',
                actions: assign({ failedJobs: ({ context }) => context.failedJobs + 1 }),
              },
            ],
          },
        },
        failedJob: {
          description:
            'The last job failed. Entering a brief recovery period before accepting new jobs.',
          after: {
            1000: 'idle',
          },
        },
      },
      on: {
        TICK: { actions: assign({ ticks: ({ context }) => context.ticks + 1 }) },
        PAUSE: 'paused',
        CRASH: 'crashed',
      },
    },
    paused: {
      description:
        'The orchestrator is manually paused. Job processing is halted and uptime tracking is suspended.',
      on: {
        RESUME: 'running',
        RESET: {
          target: 'running',
          actions: assign({ ticks: 0, jobsProcessed: 0, failedJobs: 0, lastJobId: null }),
        },
      },
    },
    crashed: {
      description:
        'A critical error occurred causing a crash. The orchestrator must be explicitly restarted.',
      on: {
        RESTART: {
          target: 'running',
          actions: assign({ ticks: 0, jobsProcessed: 0, failedJobs: 0, lastJobId: null }),
        },
      },
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
