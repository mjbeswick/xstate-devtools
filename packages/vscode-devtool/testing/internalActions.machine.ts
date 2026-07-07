import { assign, setup } from 'xstate';

// Exercises action-only (internal) transitions: events that run actions
// without changing state (no `target`), alongside ordinary targeted ones.
export const counterMachine = setup({
  types: {} as {
    context: { count: number; pingCount: number; lastReset: number | null };
    events:
      | { type: 'INCREMENT'; amount?: number }
      | { type: 'DECREMENT' }
      | { type: 'PING' }
      | { type: 'RESET' }
      | { type: 'GO' };
  },
  actions: {
    doIncrement: assign({
      count: ({ context, event }) =>
        context.count + ((event as any).amount ?? 1),
    }),
    doDecrement: assign({
      count: ({ context }) => Math.max(0, context.count - 1),
    }),
    logPing: assign({
      pingCount: ({ context }) => context.pingCount + 1,
    }),
    notify: () => {},
    cleanup: assign({ count: 0, pingCount: 0 }),
    doReset: assign({ count: 0, pingCount: 0, lastReset: ({ context }) => context.count }),
  },
  guards: {
    isPositive: ({ context }) => context.count > 0,
  },
}).createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0, pingCount: 0, lastReset: null },
  states: {
    active: {
      on: {
        INCREMENT: { actions: 'doIncrement' },
        DECREMENT: { guard: 'isPositive', actions: 'doDecrement' },
        PING: { actions: ['logPing', 'notify'] },
        RESET: { actions: 'doReset' },
        GO: { target: 'done', actions: 'cleanup' },
      },
    },
    done: { type: 'final' },
  },
});
