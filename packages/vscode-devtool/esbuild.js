// Bundles the extension (and its runtime deps, e.g. the `typescript` compiler
// API used by parser.ts) into a single self-contained out/extension.js so the
// published .vsix does not rely on node_modules being present.
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
    // `vscode` is provided by the host at runtime and must stay external.
    external: ['vscode'],
    sourcemap: watch,
    minify: !watch,
    logLevel: 'info',
};

// Standalone browser bundle for the statechart graph webview (Cytoscape + elk +
// expand-collapse). Loaded from out/webview/graph.js as a local webview resource.
const webviewOptions = {
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

// Browser bundle for the XState Debugger sidebar webview. Loaded from
// out/webview/debugger.js as a local webview resource.
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

async function main() {
    // Start from a clean out/ so stale unbundled tsc output isn't shipped.
    fs.rmSync('out', { recursive: true, force: true });

    if (watch) {
        const ctx = await esbuild.context(options);
        const webviewCtx = await esbuild.context(webviewOptions);
        const debuggerCtx = await esbuild.context(debuggerWebviewOptions);
        await Promise.all([ctx.watch(), webviewCtx.watch(), debuggerCtx.watch()]);
        console.log('esbuild: watching…');
    } else {
        await Promise.all([
            esbuild.build(options),
            esbuild.build(webviewOptions),
            esbuild.build(debuggerWebviewOptions),
        ]);
        console.log('esbuild: build complete');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
