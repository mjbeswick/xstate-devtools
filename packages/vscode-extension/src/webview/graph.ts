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

const elkOptions = {
    name: 'elk',
    fit: true,
    padding: 32,
    elk: {
        algorithm: 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': 64,
        'elk.spacing.nodeNode': 44,
        'elk.spacing.edgeNode': 24,
        'elk.spacing.edgeEdge': 16,
        'elk.layered.spacing.edgeNodeBetweenLayers': 24,
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.padding': '[top=36,left=24,bottom=24,right=24]',
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
                'font-family': 'var(--vscode-font-family)',
                'color': 'var(--vscode-editor-foreground)',
                'background-color': 'var(--vscode-editorWidget-background)',
                'background-opacity': 1,
                'border-width': 1,
                'border-color': 'var(--vscode-widget-border, var(--vscode-panel-border))',
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
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'text-margin-y': 6,
                'font-weight': 'bold',
                'background-color': 'var(--vscode-editor-foreground)',
                'background-opacity': 0.04,
                'border-width': 1,
                'border-style': 'dashed',
                'border-color': 'var(--vscode-widget-border, var(--vscode-panel-border))',
                'padding': '16px',
            },
        },
        {
            // Initial-state marker: a small filled dot with an arrow into the state.
            selector: 'node[?start]',
            style: {
                'width': 12,
                'height': 12,
                'shape': 'ellipse',
                'background-color': 'var(--vscode-editor-foreground)',
                'background-opacity': 1,
                'border-width': 0,
                'label': '',
                'padding': '0px',
                'events': 'no',
            },
        },
        {
            selector: 'node[?final]',
            style: {
                'border-width': 3,
                'border-color': 'var(--vscode-editor-foreground)',
                'border-style': 'double',
            },
        },
        {
            selector: 'node.highlighted',
            style: {
                'border-width': 2,
                'border-color': 'var(--vscode-focusBorder)',
                'background-color': 'var(--vscode-list-activeSelectionBackground)',
            },
        },
        {
            selector: 'edge',
            style: {
                'label': 'data(label)',
                'text-wrap': 'wrap',
                'font-size': 10,
                'font-family': 'var(--vscode-font-family)',
                'color': 'var(--vscode-editor-foreground)',
                'text-background-color': 'var(--vscode-editor-background)',
                'text-background-opacity': 0.95,
                'text-background-padding': '3px',
                'text-background-shape': 'roundrectangle',
                'text-border-opacity': 1,
                'text-border-width': 1,
                'text-border-color': 'var(--vscode-widget-border, var(--vscode-panel-border))',
                'curve-style': 'round-taxi',
                'taxi-direction': 'auto',
                'taxi-turn': '40%',
                'taxi-radius': 8,
                'width': 1.5,
                'line-color': 'var(--vscode-charts-blue, #569cd6)',
                'target-arrow-color': 'var(--vscode-charts-blue, #569cd6)',
                'target-arrow-shape': 'triangle',
                'arrow-scale': 0.9,
            },
        },
        {
            // Start-marker edges: thin, no label, no arrowhead clutter.
            selector: 'edge[source ^= "start_"]',
            style: {
                'width': 1.5,
                'line-color': 'var(--vscode-editor-foreground)',
                'target-arrow-color': 'var(--vscode-editor-foreground)',
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
