# API Reference

Detailed documentation of the functions available in the `xstate-devtools` packages.

## `@xstate-devtools/adapter`

This package provides adapters for syncing XState machines with the XState DevTools panel.

### `createAdapter(options?: InspectorOptions)`
Creates an inspection adapter for **browser** environments. It sets up a communication bridge to the Chrome DevTools extension via `window.postMessage`.

**Options:**
- `options` (optional): Currently accepts configuration to alter inspector behavior (e.g. debugging constraints).

**Returns:**
An object containing:
- `inspect`: The `Observer` callback to pass to XState's `useMachine` or `createActor` (e.g. `{ inspect }`).
- `dispose`: A function to tear down the adapter and remove message listeners.

**Usage:**
```ts
import { createAdapter } from '@xstate-devtools/adapter';

export const { inspect, dispose } = createAdapter();
```

---

## `@xstate-devtools/adapter/server`

Server-side equivalent for Node.js environments. Since the server runs outside the browser, it exposes actors to DevTools using a local WebSocket server.

### `createServerAdapter(options?: ServerAdapterOptions)`
Creates an inspection adapter for **Node.js** processes via WebSockets. The Chrome DevTools panel will connect directly to this WebSocket port in the background.

**Options:**
- `port` (number, default `9301` or `process.env.XSTATE_DEVTOOLS_PORT`): Port to listen on.
- `host` (string, default `'127.0.0.1'`): Host to bind the WebSocket server to.
- `bufferSize` (number, default `200`): Maximum number of messages to hold in memory while waiting for the DevTools panel to connect.

**Returns:**
An object containing:
- `inspect`: The `Observer` callback to pass to XState actors running on the server.

**Usage:**
```ts
import { createServerAdapter } from '@xstate-devtools/adapter/server';

const { inspect } = createServerAdapter({
  port: 9301,
  bufferSize: 300 
});
```

*(Note: Ensure you cache the return value in development so you don't rebuild WebSocket servers on each Hot-Module Reload).*

---

## `@xstate-devtools/vite-plugin`

A Vite plugin to improve debugging context.

### `xstateDevtoolsPlugin()`
This function returns a Vite plugin configuration. It acts as an AST/string-replacement transform that runs at build time to inject `__xstateDevtoolsSource` onto every `createMachine({…})` config and specific states in `.ts`/`.tsx` files. 

**Returns:**
A Vite Plugin object.

**Usage:**
```ts
// vite.config.ts
import { xstateDevtoolsPlugin } from '@xstate-devtools/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [xstateDevtoolsPlugin()],
});
```
