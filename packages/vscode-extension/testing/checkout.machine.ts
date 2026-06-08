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
    description: 'Parallel checkout flow — payment and fulfilment regions run concurrently; the order completes once both reach their final state.',
    type: 'parallel',
    states: {
      payment: {
        description: 'Handles card authorisation. Retries are allowed up to a limit; a hard decline blocks until the customer changes card.',
        initial: 'idle',
        states: {
          idle: {
            description: 'Waiting for the customer to submit payment details.',
            on: { SUBMIT_PAYMENT: 'authorizing' },
          },
          authorizing: {
            description: 'Card charge in flight. May retry on decline if the retry guard passes.',
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
          paid: {
            description: 'Payment successfully captured.',
            type: 'final',
          },
          declined: {
            description: 'Card was hard-declined. Customer must provide a new card to continue.',
            entry: 'notifyDecline',
            on: { CHANGE_CARD: 'idle' },
          },
        },
      },
      fulfilment: {
        description: 'Collects a delivery address and shipping method before the order can be placed.',
        initial: 'collectingAddress',
        states: {
          collectingAddress: {
            description: 'Waiting for a valid address within the delivery zone.',
            on: {
              ADDRESS_VALID: { target: 'selectingMethod', guard: 'inDeliveryZone' },
            },
          },
          selectingMethod: {
            description: 'Customer is choosing a shipping method.',
            exit: 'persistShippingChoice',
            on: { METHOD_SELECTED: 'ready' },
          },
          ready: {
            description: 'Delivery details confirmed.',
            type: 'final',
          },
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
