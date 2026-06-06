import { createMachine } from 'xstate';

/**
 * Parallel checkout machine — exercises the diagram's parallel-state rendering
 * (dashed accent border + "∥ parallel" marker, tinted concurrent regions),
 * guarded transitions, entry/exit actions inside state boxes, and final states.
 *
 * The two regions (`payment` and `fulfilment`) run concurrently; the machine is
 * only done once both reach their final state.
 */
export const checkoutMachine = createMachine(
  {
    id: 'checkout',
    type: 'parallel',
    states: {
      payment: {
        initial: 'idle',
        states: {
          idle: {
            on: { SUBMIT_PAYMENT: 'authorizing' },
          },
          authorizing: {
            entry: 'chargeCard',
            exit: 'clearPaymentToken',
            on: {
              PAYMENT_APPROVED: 'paid',
              PAYMENT_DECLINED: [
                { target: 'authorizing', guard: 'canRetry', reenter: true },
                { target: 'declined' },
              ],
            },
          },
          paid: { type: 'final' },
          declined: {
            entry: 'notifyDecline',
            on: { CHANGE_CARD: 'idle' },
          },
        },
      },
      fulfilment: {
        initial: 'collectingAddress',
        states: {
          collectingAddress: {
            on: {
              ADDRESS_VALID: { target: 'selectingMethod', guard: 'inDeliveryZone' },
            },
          },
          selectingMethod: {
            exit: 'persistShippingChoice',
            on: { METHOD_SELECTED: 'ready' },
          },
          ready: { type: 'final' },
        },
      },
    },
    onDone: { actions: 'completeOrder' },
  },
  {
    actions: {
      chargeCard: () => {},
      clearPaymentToken: () => {},
      notifyDecline: () => {},
      persistShippingChoice: () => {},
      completeOrder: () => {},
    },
    guards: {
      canRetry: () => true,
      inDeliveryZone: () => true,
    },
  },
);
