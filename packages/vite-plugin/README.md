# @xstate-devtools/vite-plugin

A [Vite](https://vite.dev) plugin that injects `__xstateDevtoolsSource` source
locations into `createMachine({ ... })` calls and state definition objects at
build time, so the [XState DevTools](https://github.com/mjbeswick/xstate-devtools)
panel / VS Code debugger can jump straight to the machine and state definitions
in your editor. It also exposes the inspector WebSocket URL to the page.

```sh
npm install -D @xstate-devtools/vite-plugin
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { xstateDevtoolsPlugin } from '@xstate-devtools/vite-plugin'

export default defineConfig({
  plugins: [xstateDevtoolsPlugin()],
})
```

`vite` is a peer dependency. The plugin only transforms your own source —
files under `node_modules` are skipped.

## License

MIT
