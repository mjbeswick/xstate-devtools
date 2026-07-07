import { assign, setup } from 'xstate';

/**
 * Parallel checkout machine — exercises the diagram's parallel-state rendering
 * (dashed accent border + "∥ parallel" marker, tinted concurrent regions),
 * guarded transitions, entry/exit actions inside state boxes, and final states.
 *
 * The two regions (`payment` and `fulfilment`) run concurrently; the machine is
 * only done once both reach their final state.
 */
export const checkoutMachine = setup({
  types: {} as {
    context: {
      retryCount: number;
      cardToken: string | null;
      address: string | null;
      shippingMethod: string | null;
      orderRef: string | null;
    };
    events:
      | { type: 'SUBMIT_PAYMENT'; cardToken: string }
      | { type: 'PAYMENT_APPROVED'; orderRef: string }
      | { type: 'PAYMENT_DECLINED' }
      | { type: 'CHANGE_CARD' }
      | { type: 'ADDRESS_VALID'; address: string }
      | { type: 'METHOD_SELECTED'; method: string };
  },
  actions: {
    chargeCard: assign({
      cardToken: ({ event }) => (event as any).cardToken ?? null,
    }),
    clearPaymentToken: assign({ cardToken: null }),
    incrementRetry: assign({ retryCount: ({ context }) => context.retryCount + 1 }),
    notifyDecline: () => {},
    persistShippingChoice: assign({
      shippingMethod: ({ event }) => (event as any).method ?? null,
    }),
    saveAddress: assign({
      address: ({ event }) => (event as any).address ?? null,
    }),
    completeOrder: assign({
      orderRef: ({ event }) => (event as any).output?.orderRef ?? null,
    }),
  },
  guards: {
    canRetry: ({ context }) => context.retryCount < 3,
    inDeliveryZone: ({ event }) => {
      const address = (event as any).address ?? '';
      return address.length > 0;
    },
  },
}).createMachine({
  id: 'checkout',
  description: 'Parallel checkout flow — payment and fulfilment regions run concurrently; the order completes once both reach their final state.',
  type: 'parallel',
  context: {
    retryCount: 0,
    cardToken: null,
    address: null,
    shippingMethod: null,
    orderRef: null,
  },
  states: {
    payment: {
      description: 'Handles card authorisation. Retries are allowed up to a limit; a hard decline blocks until the customer changes card.',
      initial: 'idle',
      states: {
        idle: {
          description: 'Waiting for the customer to submit payment details.',
          on: { SUBMIT_PAYMENT: { target: 'authorizing', actions: 'chargeCard' } },
        },
        authorizing: {
          description: 'Card charge in flight. May retry on decline if the retry guard passes.',
          exit: 'clearPaymentToken',
          on: {
            PAYMENT_APPROVED: {
              target: 'paid',
              actions: assign({ orderRef: ({ event }) => event.orderRef }),
            },
            PAYMENT_DECLINED: [
              { target: 'authorizing', guard: 'canRetry', actions: 'incrementRetry', reenter: true },
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
          on: { CHANGE_CARD: { target: 'idle', actions: assign({ retryCount: 0, cardToken: null }) } },
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
            ADDRESS_VALID: {
              target: 'selectingMethod',
              guard: 'inDeliveryZone',
              actions: 'saveAddress',
            },
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
});
