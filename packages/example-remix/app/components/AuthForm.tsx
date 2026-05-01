import React, { useState } from 'react'
import { useMachine } from '@xstate/react'
import { authMachine } from '../machines/auth.machine.js'
import { inspect } from '../inspector.client.js'

export function AuthForm() {
  const [state, send] = useMachine(authMachine, { inspect })
  const [email, setEmail] = useState('user@example.com')
  const [password, setPassword] = useState('secret')

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8, maxWidth: 360 }}>
      <h3>Auth Machine — state: <code>{JSON.stringify(state.value)}</code></h3>

      {(state.matches('idle') || state.matches('failed')) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {state.matches('failed') && (
            <div style={{ color: 'red', fontSize: 13 }}>Error: {state.context.error}</div>
          )}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={{ padding: 6 }} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" style={{ padding: 6 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => send({ type: 'SUBMIT', email, password })}>Login</button>
            {state.matches('failed') && (
              <button onClick={() => send({ type: 'RETRY' })}>Retry</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>Use password "wrong" to trigger the error state.</div>
        </div>
      )}
      {state.matches('authenticating') && <p style={{ marginTop: 8 }}>Logging in…</p>}
      {state.matches('authenticated') && (
        <div style={{ marginTop: 8 }}>
          <p style={{ color: 'green' }}>✓ Logged in as {state.context.email}</p>
          <button onClick={() => send({ type: 'LOGOUT' })}>Logout</button>
        </div>
      )}
    </div>
  )
}
