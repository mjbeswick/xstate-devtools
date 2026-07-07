import { defineConfig } from 'vitest/config';
import * as path from 'path';

// The shared parser imports `vscode`; alias it to the headless shim (the same
// one esbuild aliases at build time) so tests run in plain Node.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
    },
    resolve: {
        alias: {
            vscode: path.resolve(__dirname, 'src/vscode-shim.ts'),
        },
    },
});
