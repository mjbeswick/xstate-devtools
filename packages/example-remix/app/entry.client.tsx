import { RemixBrowser } from '@remix-run/react'
import { startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'

// StrictMode is intentionally omitted here: it causes React to double-mount
// components in development, which makes XState actors register twice and
// appear duplicated in the devtools panel.
startTransition(() => {
  hydrateRoot(document, <RemixBrowser />)
})
