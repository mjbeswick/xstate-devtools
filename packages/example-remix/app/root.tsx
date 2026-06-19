import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from '@remix-run/react'
import { InspectorProvider } from '@xstate-devtools/adapter/react'
// `.client` module — `adapter` is undefined during SSR; InspectorProvider falls
// back to creating its own (a no-op on the server) when none is passed.
import { adapter } from './inspector.client.js'

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <InspectorProvider adapter={adapter}>
          <Outlet />
        </InspectorProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}
