import { useState } from 'react'
import { useMachine } from '@xstate/react'
import { authMachine } from '../machines/auth.machine.js'
import { inspect } from '../inspector.client.js'

export function AuthForm() {
  const [state, send] = useMachine(authMachine, { inspect })
  const [email, setEmail] = useState('user@example.com')
  const [password, setPassword] = useState('secret')
  const [mfaCode, setMfaCode] = useState('123456')

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8, maxWidth: 420 }}>
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
          <div style={{ fontSize: 11, color: '#888' }}>Use password "wrong" to trigger the error state. MFA code: 123456</div>
        </div>
      )}

      {state.matches({ authenticating: 'submittingCredentials' }) && (
        <p style={{ marginTop: 8 }}>Logging in…</p>
      )}

      {state.matches({ authenticating: 'awaitingMfa' }) && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.context.error && (
            <div style={{ color: 'red', fontSize: 13 }}>Error: {state.context.error}</div>
          )}
          <label style={{ fontSize: 13 }}>Enter MFA code:</label>
          <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456" style={{ padding: 6 }} />
          <button onClick={() => send({ type: 'MFA_SUBMIT', code: mfaCode })}>Verify</button>
        </div>
      )}

      {state.matches({ authenticating: 'verifyingMfa' }) && (
        <p style={{ marginTop: 8 }}>Verifying MFA…</p>
      )}

      {state.matches('authenticated') && (
        <div style={{ marginTop: 8 }}>
          <p style={{ color: 'green', margin: '0 0 8px' }}>✓ Logged in as {state.context.email}</p>

          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <NavButton active={state.matches({ authenticated: { active: 'home' } })} onClick={() => send({ type: 'VIEW_HOME' })}>Home</NavButton>
            <NavButton active={state.matches({ authenticated: { active: 'profile' } })} onClick={() => send({ type: 'VIEW_PROFILE' })}>Profile</NavButton>
            <NavButton active={state.matches({ authenticated: { active: 'settings' } })} onClick={() => send({ type: 'VIEW_SETTINGS' })}>Settings</NavButton>
          </div>

          {state.matches({ authenticated: { active: 'settings' } }) && (
            <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <NavButton active={state.matches({ authenticated: { active: { settings: 'general' } } })} onClick={() => send({ type: 'TAB_GENERAL' })}>General</NavButton>
                <NavButton active={state.matches({ authenticated: { active: { settings: 'security' } } })} onClick={() => send({ type: 'TAB_SECURITY' })}>Security</NavButton>
                <NavButton active={state.matches({ authenticated: { active: { settings: 'billing' } } })} onClick={() => send({ type: 'TAB_BILLING' })}>Billing</NavButton>
              </div>

              {state.matches({ authenticated: { active: { settings: 'security' } } }) && (
                <div style={{ paddingLeft: 8, fontSize: 13 }}>
                  <div style={{ marginBottom: 4 }}>
                    Two-factor: <strong>{state.matches({ authenticated: { active: { settings: { security: 'twoFactor' } } } }) ? 'Enabled' : 'Disabled'}</strong>
                  </div>
                  <button onClick={() => send({ type: 'TOGGLE_2FA' })}>Toggle 2FA</button>
                </div>
              )}
            </div>
          )}

          <button onClick={() => send({ type: 'LOGOUT' })}>Logout</button>
        </div>
      )}
    </div>
  )
}

function NavButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? '#1890ff' : '#f5f5f5',
        color: active ? '#fff' : '#333',
        border: '1px solid #ddd',
        borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
