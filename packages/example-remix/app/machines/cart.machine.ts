import { assign, setup } from 'xstate'

type Item = { id: string; name: string; price: number; qty: number }

export const cartMachine = setup({
  types: {
    context: {} as {
      items: Item[]
      promoCode: string | null
      paymentMethod: string | null
    },
    events: {} as
      | { type: 'ADD_ITEM'; item: Item }
      | { type: 'REMOVE_ITEM'; id: string }
      | { type: 'START_CHECKOUT' }
      | { type: 'APPLY_PROMO'; code: string }
      | { type: 'OPEN_PAYMENT' }
      | { type: 'PICK_CARD' }
      | { type: 'PICK_PAYPAL' }
      | { type: 'CONFIRM_PAYMENT' }
      | { type: 'SUBMIT_ORDER' }
      | { type: 'RESET' },
  },
  guards: {
    hasItems: ({ context }) => context.items.length > 0,
    hasPaymentMethod: ({ context }) => context.paymentMethod !== null,
  },
  actions: {
    addItem: assign(({ context, event }) => {
      if (event.type !== 'ADD_ITEM') return {}
      const existing = context.items.find((i) => i.id === event.item.id)
      if (existing) {
        return {
          items: context.items.map((i) => (i.id === event.item.id ? { ...i, qty: i.qty + 1 } : i)),
        }
      }
      return { items: [...context.items, event.item] }
    }),
    removeItem: assign(({ context, event }) => {
      if (event.type !== 'REMOVE_ITEM') return {}
      return { items: context.items.filter((i) => i.id !== event.id) }
    }),
    applyPromo: assign(({ event }) => {
      if (event.type !== 'APPLY_PROMO') return {}
      return { promoCode: event.code }
    }),
    setCard: assign({ paymentMethod: 'card' }),
    setPaypal: assign({ paymentMethod: 'paypal' }),
    resetCart: assign({ items: [], promoCode: null, paymentMethod: null }),
  },
}).createMachine({
  id: 'cart',
  type: 'parallel',
  context: { items: [], promoCode: null, paymentMethod: null },
  states: {
    inventory: {
      description: 'Manages the list of items the user has added to their cart.',
      initial: 'browsing',
      states: {
        browsing: {
          description: 'User can add or remove items freely.',
          on: {
            ADD_ITEM: { actions: 'addItem' },
            REMOVE_ITEM: { actions: 'removeItem' },
          },
        },
      },
    },
    checkout: {
      description: 'Parallel region handling the full checkout flow from cart review to order confirmation.',
      initial: 'idle',
      states: {
        idle: {
          description: 'Checkout has not started yet.',
          on: { START_CHECKOUT: { target: 'details', guard: 'hasItems' } },
        },
        details: {
          description: 'User is reviewing cart contents and selecting a payment method.',
          initial: 'reviewing',
          on: {
            APPLY_PROMO: { actions: 'applyPromo' },
            SUBMIT_ORDER: { target: 'processing', guard: 'hasPaymentMethod' },
          },
          states: {
            reviewing: {
              description: 'Showing the cart summary; user can open payment picker.',
              on: { OPEN_PAYMENT: 'choosingPayment' },
            },
            choosingPayment: {
              description: 'User is picking a payment method.',
              initial: 'card',
              states: {
                card: {
                  description: 'Credit card payment selected.',
                  on: {
                    PICK_PAYPAL: 'paypal',
                    CONFIRM_PAYMENT: {
                      target: '#cart.checkout.details.reviewing',
                      actions: 'setCard',
                    },
                  },
                },
                paypal: {
                  description: 'PayPal payment selected.',
                  on: {
                    PICK_CARD: 'card',
                    CONFIRM_PAYMENT: {
                      target: '#cart.checkout.details.reviewing',
                      actions: 'setPaypal',
                    },
                  },
                },
              },
            },
          },
        },
        processing: {
          description: 'Order is being submitted — charging the payment method then confirming.',
          initial: 'charging',
          states: {
            charging: {
              description: 'Charging the selected payment method.',
              after: { 800: 'confirming' },
            },
            confirming: {
              description: 'Payment accepted — finalising the order.',
              after: { 700: '#cart.checkout.confirmed' },
            },
          },
        },
        confirmed: {
          description: 'Order placed successfully. User can reset to start a new cart.',
          on: { RESET: { target: 'idle', actions: 'resetCart' } },
        },
      },
    },
  },
})
