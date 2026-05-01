import { setup, assign } from 'xstate'

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
        return { items: context.items.map((i) => i.id === event.item.id ? { ...i, qty: i.qty + 1 } : i) }
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
      initial: 'browsing',
      states: {
        browsing: {
          on: {
            ADD_ITEM: { actions: 'addItem' },
            REMOVE_ITEM: { actions: 'removeItem' },
          },
        },
      },
    },
    checkout: {
      initial: 'idle',
      states: {
        idle: {
          on: { START_CHECKOUT: { target: 'details', guard: 'hasItems' } },
        },
        details: {
          initial: 'reviewing',
          on: {
            APPLY_PROMO: { actions: 'applyPromo' },
            SUBMIT_ORDER: { target: 'processing', guard: 'hasPaymentMethod' },
          },
          states: {
            reviewing: {
              on: { OPEN_PAYMENT: 'choosingPayment' },
            },
            choosingPayment: {
              initial: 'card',
              states: {
                card: {
                  on: {
                    PICK_PAYPAL: 'paypal',
                    CONFIRM_PAYMENT: { target: '#cart.checkout.details.reviewing', actions: 'setCard' },
                  },
                },
                paypal: {
                  on: {
                    PICK_CARD: 'card',
                    CONFIRM_PAYMENT: { target: '#cart.checkout.details.reviewing', actions: 'setPaypal' },
                  },
                },
              },
            },
          },
        },
        processing: {
          initial: 'charging',
          states: {
            charging: {
              after: { 800: 'confirming' },
            },
            confirming: {
              after: { 700: '#cart.checkout.confirmed' },
            },
          },
        },
        confirmed: {
          on: { RESET: { target: 'idle', actions: 'resetCart' } },
        },
      },
    },
  },
})
