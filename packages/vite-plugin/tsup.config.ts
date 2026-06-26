import { defineConfig } from 'tsup'

// Dual ESM+CJS with .d.ts. Only `vite` (peer, externalized) and node builtins.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['vite'],
})
