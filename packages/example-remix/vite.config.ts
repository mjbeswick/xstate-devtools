import { vitePlugin as remix } from '@remix-run/dev'
import { xstateDevtoolsPlugin } from '@xstate-devtools/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    remix(),
    xstateDevtoolsPlugin(),
    {
      name: 'chrome-devtools-well-known',
      configureServer(server) {
        server.middlewares.use(
          '/.well-known/appspecific/com.chrome.devtools.json',
          (_req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ workspace: { root: process.cwd(), uuid: 'example-remix' } }))
          },
        )
      },
    },
  ],
  server: { port: 5273 },
})
