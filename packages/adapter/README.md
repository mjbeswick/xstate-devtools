# @xstate-devtools/adapter

Inspect [XState v5](https://stately.ai/docs/xstate) actors from a running app and
stream them to the [XState DevTools](https://github.com/mjbeswick/xstate-devtools)
panel / VS Code live debugger. Three entry points — pick the one that matches
where your actors run.

```sh
npm install @xstate-devtools/adapter
```

`xstate` is a peer dependency. `ws` is required only for the server adapter;
`react` + `@xstate/react` only for the React hooks.

## Browser — `@xstate-devtools/adapter`

```ts
import { createAdapter } from '@xstate-devtools/adapter'

export const adapter = createAdapter()
useMachine(machine, { inspect: adapter.inspect })
```

In a non-browser environment `createAdapter()` returns a no-op, so the import is
safe in SSR bundles.

## Node / SSR — `@xstate-devtools/adapter/server`

Opens a local WebSocket bridge (default `ws://127.0.0.1:9301`) the debugger
connects to. Requires `ws`.

```ts
import { createServerAdapter } from '@xstate-devtools/adapter/server'

const adapter = createServerAdapter() // { port?, host?, bufferSize? }
createActor(machine, { inspect: adapter.inspect }).start()
```

## React — `@xstate-devtools/adapter/react`

Requires `react` and `@xstate/react`.

```tsx
import { InspectorProvider, useInspectedMachine } from '@xstate-devtools/adapter/react'
```

## License

MIT
