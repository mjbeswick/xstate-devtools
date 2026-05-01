# XState DevTools

Chrome DevTools extension for inspecting XState v5 machines at runtime — both browser-side and Node.js-side actors — with time travel and event dispatch.

## What you get

- **Actor list** with parent → child hierarchy
- **Machine tree** with active-state highlighting and source-link to your editor
- **Active-state breadcrumb** under the title (selected node only)
- **Side panel** with stacked accordion sections: Transitions, Send event, Context (interactive JSON viewer), Status, Actor info
- **Event log** with filter, click-to-time-travel, and live "back to live"
- **Server-side bridge** — a single `createServerAdapter()` call exposes Node actors to the panel via WebSocket
- **Resizable, collapsible** three-column + drawer layout (Chrome DevTools style)

## Repo layout

```
packages/
├── adapter/                 # createAdapter() (browser) + createServerAdapter() (Node)
├── extension/               # Chrome MV3 extension — service worker, content scripts, panel
└── example-remix/           # demo app: 3 client machines + 1 server orchestrator
```

## Quick start

```bash
npm install
npm run build --workspace=packages/extension
```

Load the extension:
1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → `packages/extension/dist`

Run the example:
```bash
npm run dev --workspace=packages/example-remix
# open http://localhost:5273
```

Open Chrome DevTools → **XState** panel.

## Wiring it into your app

### Browser-side actors

```ts
// inspector.client.ts (Remix .client.ts is excluded from SSR)
import { createAdapter } from '@xstate-devtools/adapter'
export const { inspect } = createAdapter()
```

```tsx
import { useMachine } from '@xstate/react'
import { inspect } from './inspector.client.js'

const [state, send] = useMachine(myMachine, { inspect })
```

### Server-side actors (Node)

```ts
// inspector.server.ts
import { createServerAdapter } from '@xstate-devtools/adapter/server'

const adapter = (globalThis as any).__inspect__
  ?? ((globalThis as any).__inspect__ = createServerAdapter())
export const { inspect } = adapter
```

```ts
import { createActor } from 'xstate'
import { inspect } from './inspector.server.js'

const actor = createActor(myMachine, { inspect })
actor.start()
```

In the panel header, toggle **Server adapter** on. Default endpoint: `ws://localhost:9301`. Override with the `XSTATE_DEVTOOLS_PORT` env var.

`ws` must be installed by the consumer (peer dep, optional). The browser entrypoint doesn't import it.

## Architecture

```
                 ┌─ window.postMessage ─→ content script ─→ service worker ─┐
 browser actor ──┤                                                          ├→ panel
                 └────────── via injected world:MAIN bridge ────────────────┘

  Node actor ────────── createServerAdapter (WebSocket :9301) ───────────────→ panel
```

- Panel maintains a single zustand store; both transports feed `handleMessage`.
- Inspector tags every `sessionId` with `web:` or `srv:` prefix on outbound, strips it on inbound dispatch — so collisions across processes are impossible.
- Panel rewrites `globalSeq` to a monotonic counter on ingest, so time travel works across both transports.
- Server adapter buffers up to 200 messages until the first panel connects, so actors registered at boot are still visible to a panel that connects late.
- Server adapter and its WS server are cached on `globalThis` to survive Vite/Remix HMR re-evaluation.

## Wire protocol

Defined in `packages/extension/src/shared/types.ts`. Same protocol on both transports:

- `XSTATE_ACTOR_REGISTERED` — new actor with serialized machine + initial snapshot
- `XSTATE_SNAPSHOT` — snapshot tick (no event)
- `XSTATE_EVENT` — event dispatched + resulting snapshot
- `XSTATE_ACTOR_STOPPED` — actor terminated
- `XSTATE_DISPATCH` — panel → adapter, send an event to a specific actor

## Time travel

- Click any row in the event log → state tree freezes to the post-event snapshot at that point in time
- "Back to live" in the time-travel banner resumes following live state
- Bounded ring buffer (500 events) — `timeTravelSeq` clamps to the oldest retained event when older entries evict

## Limitations

- Bounded event history (500 events) — older events are evicted; time travel clamps to the oldest retained event
- Server adapter requires `ws` to be installed by the consumer (not bundled)
- Machine source-link uses `vscode://file/...` — works in VS Code; other editors need a custom URL handler

## Scripts

```bash
npm test              # run all package tests
npm run build --workspace=packages/extension
npm run dev --workspace=packages/example-remix
```

## License

MIT
