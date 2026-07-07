// Bundle the MCP server into a single self-contained dist/index.js, with the
// `vscode` import aliased to a headless shim (the shared diagram-core parser
// needs Position/Range/Uri at runtime). Everything else (the SDK, zod,
// fast-glob, the TypeScript compiler) is bundled too, so `npx` works with no
// install step.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const options = {
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/index.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    banner: { js: '#!/usr/bin/env node' },
    alias: { vscode: path.resolve(__dirname, 'src/vscode-shim.ts') },
    sourcemap: watch,
    minify: !watch,
    logLevel: 'info',
};

async function main() {
    fs.rmSync('dist', { recursive: true, force: true });
    if (watch) {
        const ctx = await esbuild.context(options);
        await ctx.watch();
        console.log('esbuild: watching…');
    } else {
        await esbuild.build(options);
        fs.chmodSync('dist/index.js', 0o755);
        console.log('esbuild: build complete');
    }
}

main().catch((err) => { console.error(err); process.exit(1); });
