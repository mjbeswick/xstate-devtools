import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { useFetcher, useLoaderData } from '@remix-run/react'
import { AuthForm } from '../components/AuthForm.js'
import { ShoppingCart } from '../components/ShoppingCart.js'
import { MediaPlayer } from '../components/MediaPlayer.js'

export async function loader(_args: LoaderFunctionArgs) {
  const { orchestrator } = await import('../orchestrator.server.js')
  const snapshot = orchestrator.getSnapshot()
  return json({
    state: typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value),
    ticks: snapshot.context.ticks,
    jobsProcessed: snapshot.context.jobsProcessed,
    lastJobId: snapshot.context.lastJobId,
  })
}

export async function action() {
  const { orchestrator } = await import('../orchestrator.server.js')
  orchestrator.send({ type: 'ENQUEUE', jobId: `job-${Date.now()}` })
  return json({ ok: true })
}

export default function Index() {
  const data = useLoaderData<typeof loader>()
  const fetcher = useFetcher<typeof action>()

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>XState DevTools — Example App</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Open Chrome DevTools → <strong>XState</strong> panel to inspect these machines.
        Enable "Server adapter" in the panel header to see the server-side orchestrator below.
      </p>

      <div style={{
        border: '1px solid #d6e4ff', background: '#f0f5ff',
        padding: 12, borderRadius: 8, marginBottom: 24, maxWidth: 600,
      }}>
        <strong>Server-side orchestrator</strong> (running in Node)
        <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
          state: <code>{data.state}</code> · ticks: <strong>{data.ticks}</strong> · jobs: <strong>{data.jobsProcessed}</strong>
          {data.lastJobId && <> · last: <code>{data.lastJobId}</code></>}
        </div>
        <fetcher.Form method="post" style={{ marginTop: 8 }}>
          <button type="submit">Enqueue job</button>
        </fetcher.Form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600 }}>
        <AuthForm />
        <ShoppingCart />
        <MediaPlayer />
      </div>
    </div>
  )
}
