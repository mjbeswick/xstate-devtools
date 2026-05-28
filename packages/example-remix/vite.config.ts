import { vitePlugin as remix } from '@remix-run/dev'
import { xstateDevtoolsPlugin } from '@xstate-devtools/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [remix(), xstateDevtoolsPlugin()],
  server: { port: 5273 },
  define: {
    __XSTATE_DEVTOOLS_SOURCE_ROOT__: JSON.stringify(process.cwd()),
  },
})
