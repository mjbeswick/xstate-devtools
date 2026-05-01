import React from 'react'
import { useMachine } from '@xstate/react'
import { cartMachine } from '../machines/cart.machine.js'
import { inspect } from '../inspector.client.js'

const ITEMS = [
  { id: '1', name: 'Widget A', price: 9.99, qty: 1 },
  { id: '2', name: 'Widget B', price: 14.99, qty: 1 },
  { id: '3', name: 'Widget C', price: 4.99, qty: 1 },
]

export function ShoppingCart() {
  const [state, send] = useMachine(cartMachine, { inspect })
  const checkoutState = (state.value as any).checkout as string

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
      <h3>Cart Machine — checkout: <code>{checkoutState}</code></h3>

      <div style={{ marginBottom: 12 }}>
        <strong>Add items:</strong>
        {ITEMS.map((item) => (
          <button key={item.id} onClick={() => send({ type: 'ADD_ITEM', item })} style={{ margin: '0 4px' }}>
            + {item.name}
          </button>
        ))}
      </div>

      {state.context.items.length > 0 && (
        <ul style={{ marginBottom: 12 }}>
          {state.context.items.map((item) => (
            <li key={item.id}>
              {item.name} ×{item.qty} — ${(item.price * item.qty).toFixed(2)}
              <button onClick={() => send({ type: 'REMOVE_ITEM', id: item.id })} style={{ marginLeft: 8 }}>×</button>
            </li>
          ))}
        </ul>
      )}

      {checkoutState === 'idle' && (
        <button onClick={() => send({ type: 'START_CHECKOUT' })}>Checkout</button>
      )}
      {checkoutState === 'details' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => send({ type: 'APPLY_PROMO', code: 'SAVE10' })}>Apply promo SAVE10</button>
          <button onClick={() => send({ type: 'SELECT_PAYMENT', method: 'card' })}>Pay with card</button>
          <button onClick={() => send({ type: 'SUBMIT_ORDER' })}>Submit order</button>
        </div>
      )}
      {checkoutState === 'processing' && <p>Processing…</p>}
      {checkoutState === 'confirmed' && (
        <div>
          <p style={{ color: 'green' }}>Order confirmed!</p>
          <button onClick={() => send({ type: 'RESET' })}>Reset</button>
        </div>
      )}
    </div>
  )
}
