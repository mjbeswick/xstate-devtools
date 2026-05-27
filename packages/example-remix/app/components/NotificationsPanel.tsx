import { useMachine } from '@xstate/react'
import { inspect } from '../inspector.client.js'
import { notificationsMachine } from '../machines/notifications.machine.js'

export function NotificationsPanel() {
  const [state, send] = useMachine(notificationsMachine, { inspect })

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
      <h3>
        Notifications Machine - state: <code>{JSON.stringify(state.value)}</code>
      </h3>
      <p style={{ fontSize: 12, color: '#666', margin: '4px 0 10px' }}>
        permission: <strong>{state.context.permission}</strong> | unread:{' '}
        <strong>{state.context.unread}</strong> | quiet mode:{' '}
        <strong>{state.context.quietMode ? 'on' : 'off'}</strong>
      </p>

      {state.matches('off') && (
        <button onClick={() => send({ type: 'REQUEST_PERMISSION' })}>Enable notifications</button>
      )}

      {state.matches('requesting') && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => send({ type: 'GRANT' })}>Grant</button>
          <button onClick={() => send({ type: 'DENY' })}>Deny</button>
        </div>
      )}

      {state.matches('enabled') && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => send({ type: 'PUSH_MESSAGE' })}>Push message</button>
          <button onClick={() => send({ type: 'MARK_ALL_READ' })}>Mark all read</button>
          <button onClick={() => send({ type: 'TOGGLE_QUIET' })}>Toggle quiet mode</button>
        </div>
      )}

      {state.matches('disabled') && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#555' }}>Notifications are blocked.</span>
          <button onClick={() => send({ type: 'REQUEST_PERMISSION' })}>Ask again</button>
        </div>
      )}
    </div>
  )
}
