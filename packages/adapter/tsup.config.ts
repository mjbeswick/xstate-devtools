import { defineConfig } from 'tsup'

// Dual ESM+CJS with .d.ts for each entry. The consumer's app provides ws,
// xstate, react and @xstate/react (peer deps, externalized). The private
// protocol package is bundled in (types + the one SESSION_FORMAT_VERSION const)
// so the published adapter has no @xstate-devtools/* runtime dependency.
export default defineConfig({
  entry: ['src/index.ts', 'src/server.ts', 'src/react.tsx'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['ws', 'xstate', 'react', 'react/jsx-runtime', '@xstate/react'],
  noExternal: ['@xstate-devtools/protocol'],
})
