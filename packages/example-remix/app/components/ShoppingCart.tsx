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

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
      <h3>Cart Machine — checkout: <code>{JSON.stringify(state.value.checkout)}</code></h3>

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

      {state.context.paymentMethod && (
        <p style={{ fontSize: 13, color: '#666' }}>Payment: <strong>{state.context.paymentMethod}</strong></p>
      )}
      {state.context.promoCode && (
        <p style={{ fontSize: 13, color: '#666' }}>Promo: <strong>{state.context.promoCode}</strong></p>
      )}

      {state.matches({ checkout: 'idle' }) && (
        <button onClick={() => send({ type: 'START_CHECKOUT' })}>Checkout</button>
      )}

      {state.matches({ checkout: { details: 'reviewing' } }) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={() => send({ type: 'APPLY_PROMO', code: 'SAVE10' })}>Apply promo SAVE10</button>
          <button onClick={() => send({ type: 'OPEN_PAYMENT' })}>Choose payment method</button>
          <button onClick={() => send({ type: 'SUBMIT_ORDER' })}>Submit order</button>
        </div>
      )}

      {state.matches({ checkout: { details: 'choosingPayment' } }) && (
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Pick a method:</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              onClick={() => send({ type: 'PICK_CARD' })}
              style={{ background: state.matches({ checkout: { details: { choosingPayment: 'card' } } }) ? '#1890ff' : '#f5f5f5', color: state.matches({ checkout: { details: { choosingPayment: 'card' } } }) ? '#fff' : '#333' }}
            >Card</button>
            <button
              onClick={() => send({ type: 'PICK_PAYPAL' })}
              style={{ background: state.matches({ checkout: { details: { choosingPayment: 'paypal' } } }) ? '#1890ff' : '#f5f5f5', color: state.matches({ checkout: { details: { choosingPayment: 'paypal' } } }) ? '#fff' : '#333' }}
            >PayPal</button>
          </div>
          <button onClick={() => send({ type: 'CONFIRM_PAYMENT' })}>Confirm</button>
        </div>
      )}

      {state.matches({ checkout: { processing: 'charging' } }) && <p>Charging…</p>}
      {state.matches({ checkout: { processing: 'confirming' } }) && <p>Confirming order…</p>}

      {state.matches({ checkout: 'confirmed' }) && (
        <div>
          <p style={{ color: 'green' }}>Order confirmed!</p>
          <button onClick={() => send({ type: 'RESET' })}>Reset</button>
        </div>
      )}
    </div>
  )
}
