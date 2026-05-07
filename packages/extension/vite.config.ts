// packages/extension/vite.config.ts

import { resolve } from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: 'dist',
    // Keep previous hashed assets so already-injected content script loaders
    // from an older extension build can still resolve their dynamic imports.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, 'src/panel/index.html'),
      },
    },
  },
})
