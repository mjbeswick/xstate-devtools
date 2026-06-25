import { defineConfig } from 'vitest/config';
import * as path from 'path';

// The extension's pure modules (parser) import `vscode`, which only exists in
// the VS Code runtime. Alias it to a minimal stub so they run under vitest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/vscode-stub.ts'),
    },
  },
});
