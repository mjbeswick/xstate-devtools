# XState DevTools

Chrome DevTools extension for inspecting XState v5 machines at runtime — both browser-side and Node.js-side actors — with time travel and event dispatch.

## The problem

Debugging XState machines with `console.log` or the Network tab is painful. You see raw JSON snapshots and event payloads with no sense of the machine's shape, and you can't tell which states are currently active, which transitions are possible, or how you got here.

Standard DevTools know nothing about state machine topology. When an actor lives on the server, you have zero visibility into it from the browser at all.

XState DevTools solves this by embedding a purpose-built panel directly in Chrome DevTools that understands XState's actor model:

- Visualises the full machine tree with active states highlighted
- Shows every event as it happens and lets you rewind to any point in time
- Bridges server-side Node actors over WebSocket so they appear alongside browser actors in the same panel
- Links each state definition back to the exact line in your editor

![XState DevTools panel](docs/screenshot.png)

## What you get

- **Actor list** with parent → child hierarchy
- **Machine tree** with active-state highlighting, inline state descriptions, and source-link to your editor
- **Active-state breadcrumb** under the title (selected node only)
- **Side panel** with stacked accordion sections: Transitions, Send event, Context (interactive JSON viewer), Status, Actor info
- **Event log** with filter, click-to-time-travel, and live "back to live"
- **Server-side bridge** — a single `createServerAdapter()` call exposes Node actors to the panel via WebSocket
- **Vite plugin** — injects source locations at build time so the panel links directly to machine and state definitions
- **Resizable, collapsible** three-column + drawer layout (Chrome DevTools style)

For a more detailed breakdown of these features, read the [Extension Features & Usage Guide](docs/EXTENSION_FEATURES.md).

## Packages

- **`@xstate-devtools/adapter`**: Exposes the `createAdapter()` function to bridge browser-side XState actors to the extension.
- **`@xstate-devtools/adapter/server`**: Exposes the `createServerAdapter()` function to bridge Node.js actors via WebSocket.
- **`@xstate-devtools/vite-plugin`**: Exposes the `xstateDevtoolsPlugin()` which enables click-to-source file navigation from the devtools pane.
- **`extension`**: The architecture running the Chrome MV3 DevTools panel itself.

For an exhaustive explanation of the exported functions and configuration options, please refer to the [API Reference](docs/API_REFERENCE.md).

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

The panel auto-connects to the server adapter at `ws://localhost:9301` on startup. To use a custom endpoint, click the **Edit** button next to the server status indicator in the panel header, or set the `XSTATE_DEVTOOLS_PORT` env var.

`ws` must be installed by the consumer (peer dep, optional). The browser entrypoint doesn't import it.

### Vite plugin — source links & state descriptions

Add `xstateDevtoolsPlugin()` to your Vite config to enable **click-to-source** navigation from the panel directly to your machine and state definitions in VS Code:

```ts
// vite.config.ts
import { xstateDevtoolsPlugin } from '@xstate-devtools/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [xstateDevtoolsPlugin()],
})
```

The plugin runs a source transform at build time that injects `__xstateDevtoolsSource` into every `createMachine({…})` config and into every state definition object in your `states: {}` blocks. Without the plugin, the panel falls back to stack-based detection (which finds the component calling `useMachine`, not the machine definition file).

#### State descriptions

XState v5 supports an optional `description` string on any state node config. When present, the devtools panel renders it inline after the state name in the machine tree:

```ts
createMachine({
  states: {
    idle: {
      description: 'Waiting for the user to submit their credentials.',
      on: { SUBMIT: 'loading' },
    },
    loading: {
      description: 'Login request in-flight.',
    },
  },
})
```

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

## Time travel

- Click any row in the event log → state tree freezes to the post-event snapshot at that point in time
- "Back to live" in the time-travel banner resumes following live state
- Bounded ring buffer (500 events) — `timeTravelSeq` clamps to the oldest retained event when older entries evict

## Limitations

- Bounded event history (500 events) — older events are evicted; time travel clamps to the oldest retained event
- Server adapter requires `ws` to be installed by the consumer (not bundled)
- Source links use `vscode://file/…` — works in VS Code; other editors need a custom URL handler
- The Vite plugin uses static source transforms; dynamically constructed machines won't have source locations injected

## Scripts

```bash
npm test              # run all package tests
npm run build --workspace=packages/extension
npm run dev --workspace=packages/example-remix
```

## License

MIT

