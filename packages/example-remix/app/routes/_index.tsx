import React from 'react'
import { AuthForm } from '../components/AuthForm.js'
import { ShoppingCart } from '../components/ShoppingCart.js'
import { MediaPlayer } from '../components/MediaPlayer.js'
import { inspect } from '../inspector.client.js'

export default function Index() {
  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>XState DevTools — Example App</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Open Chrome DevTools → <strong>XState</strong> panel to inspect these machines.
        Click events in the log to time-travel.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
        <AuthForm inspect={inspect} />
        <ShoppingCart inspect={inspect} />
        <MediaPlayer inspect={inspect} />
      </div>
    </div>
  )
}
