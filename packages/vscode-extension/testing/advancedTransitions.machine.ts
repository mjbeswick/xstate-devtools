import { createMachine } from 'xstate';

// Exercises after (delayed), always (transient), state-level onDone,
// invoke indicator, and description tooltips.
export const checkoutFlow = createMachine({
  id: 'checkoutFlow',
  initial: 'validating',
  states: {
    validating: {
      description: 'Runs synchronous validation, then auto-advances.',
      always: [
        { guard: 'isValid', target: 'submitting' },
        { target: 'invalid' },
      ],
    },
    invalid: {
      after: { 3000: 'validating' },
    },
    submitting: {
      description: 'Posts the order to the server.',
      invoke: {
        src: 'submitOrder',
        onDone: { target: 'confirming', actions: 'storeReceipt' },
        onError: 'invalid',
      },
    },
    confirming: {
      initial: 'sending',
      onDone: 'done',
      after: { 10000: { target: 'invalid', actions: 'timeoutWarn' } },
      states: {
        sending: { on: { SENT: 'ack' } },
        ack: { type: 'final' },
      },
    },
    done: { type: 'final' },
  },
});
