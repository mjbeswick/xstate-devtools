// Webview bundle for the statechart graph. Rendered with Cytoscape.js:
//   - compound nodes        → nested states
//   - cytoscape-expand-collapse → collapse/expand nested states interactively
//   - cytoscape-elk (ELK layered, ORTHOGONAL routing) + round-taxi edges → right-angle lines
//
// Built as a standalone browser bundle by esbuild (see esbuild.js) and loaded
// from the extension's out/webview/graph.js as a local webview resource.
import cytoscape from 'cytoscape';
// These two extensions ship no type declarations; esbuild bundles them by JS
// resolution. This file is excluded from `tsc` (it targets the DOM, not Node).
import elk from 'cytoscape-elk';
import expandCollapse from 'cytoscape-expand-collapse';

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
};

interface GraphNode {
    data: {
        id: string;
        label: string;
        name: string;
        parent?: string;
        compound?: boolean;
        initial?: boolean;
        final?: boolean;
        start?: boolean;
    };
}
interface GraphEdge {
    data: { id: string; source: string; target: string; label: string };
}
interface GraphPayload {
    nodes: GraphNode[];
    edges: GraphEdge[];
    collapsedIds?: string[];
}

cytoscape.use(elk);
cytoscape.use(expandCollapse);

const vscode = acquireVsCodeApi();
const payload: GraphPayload = (window as unknown as { __GRAPH__: GraphPayload }).__GRAPH__;

// Cytoscape draws to <canvas> and does NOT understand CSS var() — it needs
// concrete colour strings. Resolve the VS Code theme variables to real values.
const rootStyle = getComputedStyle(document.documentElement);
const bodyStyle = getComputedStyle(document.body);
function themeVar(name: string, fallback: string): string {
    const v = (rootStyle.getPropertyValue(name) || bodyStyle.getPropertyValue(name)).trim();
    return v || fallback;
}
const C = {
    fg: themeVar('--vscode-editor-foreground', '#1f1f1f'),
    bg: themeVar('--vscode-editor-background', '#ffffff'),
    nodeBg: themeVar('--vscode-editorWidget-background', '#f3f3f3'),
    border: themeVar('--vscode-widget-border', themeVar('--vscode-panel-border', '#c8c8c8')),
    accent: themeVar('--vscode-charts-blue', '#3b82f6'),
    focus: themeVar('--vscode-focusBorder', '#0090f1'),
    selBg: themeVar('--vscode-list-activeSelectionBackground', '#cce5ff'),
    selFg: themeVar('--vscode-list-activeSelectionForeground', themeVar('--vscode-editor-foreground', '#1f1f1f')),
    desc: themeVar('--vscode-descriptionForeground', '#717171'),
};
const fontFamily = themeVar('--vscode-font-family', 'system-ui, sans-serif');

const elkOptions = {
    name: 'elk',
    fit: true,
    padding: 32,
    elk: {
        algorithm: 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': 72,
        'elk.spacing.nodeNode': 48,
        'elk.spacing.edgeNode': 28,
        'elk.spacing.edgeEdge': 18,
        'elk.layered.spacing.edgeNodeBetweenLayers': 28,
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.padding': '[top=40,left=28,bottom=28,right=28]',
    },
} as const;

const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: { nodes: payload.nodes, edges: payload.edges },
    minZoom: 0.2,
    maxZoom: 2.5,
    style: [
        {
            selector: 'node',
            style: {
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'text-wrap': 'wrap',
                'text-max-width': '140px',
                'font-size': 12,
                'font-family': fontFamily,
                'color': C.fg,
                'background-color': C.nodeBg,
                'border-width': 1,
                'border-color': C.border,
                'shape': 'round-rectangle',
                'width': 'label',
                'height': 'label',
                'padding': '12px',
            },
        },
        {
            // Compound (nested) states: label sits at the top, children inside.
            selector: 'node:parent',
            style: {
                'text-valign': 'top',
                'text-halign': 'center',
                'text-margin-y': 6,
                'font-weight': 'bold',
                'background-color': C.fg,
                'background-opacity': 0.04,
                'border-width': 1,
                'border-style': 'dashed',
                'border-color': C.border,
                'padding': '18px',
            },
        },
        {
            // Initial-state marker: a small filled dot with an arrow into the state.
            selector: 'node[?start]',
            style: {
                'width': 12,
                'height': 12,
                'shape': 'ellipse',
                'background-color': C.fg,
                'background-opacity': 1,
                'border-width': 0,
                'label': '',
                'padding': '0px',
                'events': 'no',
            },
        },
        {
            selector: 'node[?final]',
            style: { 'border-width': 3, 'border-color': C.fg, 'border-style': 'double' },
        },
        {
            selector: 'node.highlighted',
            style: {
                'border-width': 2,
                'border-color': C.focus,
                'background-color': C.selBg,
                'color': C.selFg,
            },
        },
        {
            selector: 'edge',
            style: {
                'label': 'data(label)',
                'text-wrap': 'wrap',
                'text-max-width': '120px',
                'text-overflow-wrap': 'anywhere',
                'font-size': 10,
                'font-family': fontFamily,
                'color': C.fg,
                'text-background-color': C.bg,
                'text-background-opacity': 0.92,
                'text-background-padding': '3px',
                'text-background-shape': 'roundrectangle',
                'text-border-opacity': 1,
                'text-border-width': 1,
                'text-border-color': C.border,
                'curve-style': 'round-taxi',
                'taxi-direction': 'auto',
                'taxi-turn': '40%',
                'taxi-radius': 8,
                'width': 1.5,
                'line-color': C.accent,
                'target-arrow-color': C.accent,
                'target-arrow-shape': 'triangle',
                'arrow-scale': 0.9,
            },
        },
        {
            // Start-marker edges: thin, straight, no label.
            selector: 'edge[source ^= "start_"]',
            style: {
                'width': 1.5,
                'line-color': C.fg,
                'target-arrow-color': C.fg,
                'curve-style': 'straight',
            },
        },
    ],
    layout: elkOptions,
});

// Interactive collapse/expand of nested states.
const api = (cy as unknown as {
    expandCollapse(opts: unknown): { collapse(nodes: unknown): void };
}).expandCollapse({
    layoutBy: elkOptions,
    fisheye: false,
    animate: false,
    undoable: false,
    cueEnabled: true,
    expandCollapseCuePosition: 'top-left',
});

// Honour the "graph reflects tree expansion" mode: collapse states the user has
// collapsed in the outline tree.
if (payload.collapsedIds && payload.collapsedIds.length > 0) {
    const toCollapse = cy.nodes().filter((n: { id(): string }) => payload.collapsedIds!.includes(n.id()));
    if (toCollapse.length > 0) {
        api.collapse(toCollapse);
    }
}

// Click a state → jump to its source. (Collapse/expand cues are handled by the
// extension and don't fire this; start markers are non-interactive.)
cy.on('tap', 'node', (evt: { target: { id(): string; data(key: string): unknown } }) => {
    if (evt.target.data('start')) { return; }
    vscode.postMessage({ command: 'stateClicked', id: evt.target.id() });
});

// Click a transition label → static event simulation hook.
cy.on('tap', 'edge', (evt: { target: { data(key: string): string } }) => {
    const label = evt.target.data('label');
    if (label) {
        vscode.postMessage({ command: 'eventClicked', eventName: label });
    }
});

// Highlight from cursor-sync (extension posts the sanitized state name).
window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data;
    if (message && message.command === 'highlight') {
        cy.nodes().removeClass('highlighted');
        cy.nodes(`[name = "${message.stateId}"]`).addClass('highlighted');
    }
});
