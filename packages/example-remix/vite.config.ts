import { defineConfig } from 'vite'
import type { ViteDevServer } from 'vite'
import { vitePlugin as remix } from '@remix-run/dev'

// Dev-only: eagerly load the server orchestrator (and thus the XState server
// adapter) when the dev server boots, so the inspector WebSocket on :9301 is
// listening immediately — no need to request a page first before the VS Code /
// Chrome debugger can attach.
function eagerInspector() {
  return {
    name: 'xstate-devtools-eager-inspector',
    apply: 'serve' as const,
    configureServer(server: ViteDevServer) {
      const load = () =>
        server.ssrLoadModule('/app/orchestrator.server.ts').catch((err: unknown) =>
          server.config.logger.warn(
            `[xstate-devtools] eager inspector load failed: ${(err as Error).message}`,
          ),
        )
      if (server.httpServer) {
        server.httpServer.once('listening', load)
      } else {
        void load()
      }
    },
  }
}

export default defineConfig({
  plugins: [remix(), eagerInspector()],
  server: { port: 5273 },
})
