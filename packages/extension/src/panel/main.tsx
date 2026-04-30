// packages/extension/src/panel/main.tsx
import React from 'react'
import { createRoot } from 'react-dom/client'

// App will be implemented in a later task
function PlaceholderApp() {
  return <div style={{ padding: 24, fontFamily: 'system-ui' }}>XState DevTools — loading…</div>
}

const root = createRoot(document.getElementById('root')!)
root.render(<PlaceholderApp />)
