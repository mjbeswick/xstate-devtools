// Webview entry shim. The statechart graph webview lives in the shared
// diagram-core package; importing it here for its side effects lets esbuild
// bundle it to out/webview/graph.js (the entry path the build expects).
import '@xstate-devtools/diagram-core/webview/graph';
