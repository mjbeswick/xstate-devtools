// Bundles the debugger extension (and its runtime deps, e.g. the `typescript`
// compiler API used by the shared parser, and `ws`) into a self-contained
// out/extension.js so the published .vsix does not rely on node_modules.
const esbuild = require('esbuild');
const fs = require('fs');

const watch = process.argv.includes('--watch');

const options = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['vscode'],
    sourcemap: watch,
    minify: !watch,
    logLevel: 'info',
};

// Browser bundle for the debugger sidebar (events) webview.
const debuggerWebviewOptions = {
    entryPoints: ['src/webview/debuggerPanel.ts'],
    bundle: true,
    outfile: 'out/webview/debugger.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    sourcemap: watch,
    minify: !watch,
    logLevel: 'info',
};

// The debugger bundles its own copy of the statechart graph webview (from
// shared diagram-core, via the src/webview/graph.ts shim) for reveal/follow.
const graphWebviewOptions = {
    entryPoints: ['src/webview/graph.ts'],
    bundle: true,
    outfile: 'out/webview/graph.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    sourcemap: watch,
    minify: !watch,
    logLevel: 'info',
};

async function main() {
    fs.rmSync('out', { recursive: true, force: true });

    if (watch) {
        const ctx = await esbuild.context(options);
        const debuggerCtx = await esbuild.context(debuggerWebviewOptions);
        const graphCtx = await esbuild.context(graphWebviewOptions);
        await Promise.all([ctx.watch(), debuggerCtx.watch(), graphCtx.watch()]);
        console.log('esbuild: watching…');
    } else {
        await Promise.all([
            esbuild.build(options),
            esbuild.build(debuggerWebviewOptions),
            esbuild.build(graphWebviewOptions),
        ]);
        console.log('esbuild: build complete');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
