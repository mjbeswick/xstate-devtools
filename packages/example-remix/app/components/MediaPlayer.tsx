import React from 'react'
import { useMachine } from '@xstate/react'
import { playerMachine } from '../machines/player.machine.js'

interface Props {
  inspect?: (event: any) => void
}

export function MediaPlayer({ inspect }: Props) {
  const [state, send] = useMachine(playerMachine, { inspect })

  return (
    <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
      <h3>Player Machine — state: <code>{JSON.stringify(state.value)}</code></h3>
      <p style={{ fontSize: 12, color: '#666', margin: '4px 0 8px' }}>
        Position: {state.context.position}s / {state.context.duration}s | Vol: {state.context.volume}%
      </p>

      {(state.value === 'buffering' || (state.context.bufferProgress > 0 && state.context.bufferProgress < 100)) && (
        <div style={{ height: 4, background: '#eee', borderRadius: 2, margin: '8px 0' }}>
          <div style={{
            height: '100%',
            width: `${state.context.bufferProgress}%`,
            background: '#1890ff',
            borderRadius: 2,
            transition: 'width 0.1s',
          }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button onClick={() => send({ type: 'LOAD', src: 'example.mp4', duration: 120 })}>Load</button>
        <button onClick={() => send({ type: 'PLAY' })}>Play</button>
        <button onClick={() => send({ type: 'PAUSE' })}>Pause</button>
        <button onClick={() => send({ type: 'SEEK', position: 30 })}>Seek 30s</button>
        <button onClick={() => send({ type: 'VOLUME', level: 50 })}>Vol 50%</button>
        <button onClick={() => send({ type: 'STOP' })}>Stop</button>
      </div>
    </div>
  )
}
