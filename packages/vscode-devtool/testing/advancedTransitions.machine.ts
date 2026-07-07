import { createMachine, fromPromise } from 'xstate';

// The invoked actor: submits the order. Defined here so the `invoke` resolves.
export const submitOrder = fromPromise(async () => {
  const response = await fetch('/api/orders', { method: 'POST' });
  return response.json();
});

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
        src: submitOrder,
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
