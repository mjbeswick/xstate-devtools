import { useMachine } from '@xstate/react'
import { inspect } from '../inspector.client.js'
import { searchMachine } from '../machines/search.machine.js'

export function SearchPanel() {
  const [state, send] = useMachine(searchMachine, { inspect })

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
      <h3>
        Search Machine - state: <code>{JSON.stringify(state.value)}</code>
      </h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          value={state.context.query}
          onChange={(event) => send({ type: 'INPUT', value: event.target.value })}
          placeholder="Search term (try: actor, or fail)"
          style={{ padding: 6, flex: 1 }}
        />
        <button onClick={() => send({ type: 'SEARCH' })}>Search</button>
        <button onClick={() => send({ type: 'CLEAR' })}>Clear</button>
      </div>

      {state.matches('loading') && <p style={{ margin: 0 }}>Searching...</p>}

      {state.matches('failed') && (
        <p style={{ margin: 0, color: 'red' }}>Error: {state.context.error}</p>
      )}

      {state.context.results.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {state.context.results.map((result) => (
            <li key={result}>{result}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
