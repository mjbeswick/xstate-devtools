// Webview entry shim. The debugger bundles its own copy of the statechart graph
// webview (from shared diagram-core) so "Reveal in Diagram" / "Follow Actor"
// work without the devtool extension installed. esbuild bundles this to
// out/webview/graph.js.
import '@xstate-devtools/diagram-core/webview/graph';
