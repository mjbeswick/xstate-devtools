// Webview bundle for the statechart graph. Rendered with Cytoscape.js:
//   - compound nodes        → nested states
//   - cytoscape-expand-collapse → collapse/expand nested states interactively
//   - cytoscape-elk (ELK layered, ORTHOGONAL routing) + taxi edges → right-angle lines
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
    padding: 24,
    elk: {
        algorithm: 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': 48,
        'elk.spacing.nodeNode': 32,
        'elk.padding': '[top=32,left=24,bottom=24,right=24]',
    },
} as const;

const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: { nodes: payload.nodes, edges: payload.edges },
    wheelSensitivity: 0.2,
    style: [
        {
            selector: 'node',
            style: {
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'font-size': 12,
                'color': 'var(--vscode-editor-foreground)',
                'background-color': 'var(--vscode-editorWidget-background)',
                'border-width': 1.5,
                'border-color': 'var(--vscode-panel-border)',
                'shape': 'round-rectangle',
                'width': 'label',
                'padding': 10,
            },
        },
        {
            // Compound (nested) states: label sits at the top, children inside.
            selector: 'node:parent',
            style: {
                'text-valign': 'top',
                'text-margin-y': 4,
                'background-opacity': 0.12,
                'background-color': 'var(--vscode-editor-foreground)',
                'border-color': 'var(--vscode-focusBorder)',
            },
        },
        {
            selector: 'node[?initial]',
            style: { 'border-color': '#3fb950', 'border-width': 3 },
        },
        {
            selector: 'node[?final]',
            style: { 'border-color': '#f85149', 'border-width': 3, 'shape': 'round-rectangle' },
        },
        {
            selector: 'node.highlighted',
            style: { 'border-color': '#ff9900', 'border-width': 4 },
        },
        {
            selector: 'edge',
            style: {
                'label': 'data(label)',
                'font-size': 10,
                'color': 'var(--vscode-descriptionForeground)',
                'text-background-color': 'var(--vscode-editor-background)',
                'text-background-opacity': 1,
                'text-background-padding': 2,
                'curve-style': 'taxi',
                'taxi-direction': 'downward',
                'taxi-turn': '50%',
                'width': 1.5,
                'line-color': 'var(--vscode-panel-border)',
                'target-arrow-color': 'var(--vscode-panel-border)',
                'target-arrow-shape': 'triangle',
                'arrow-scale': 1,
            },
        },
    ],
    layout: elkOptions,
});

// Interactive collapse/expand of nested states.
const api = (cy as unknown as {
    expandCollapse(opts: unknown): {
        collapse(nodes: unknown): void;
    };
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
// extension and don't fire this.)
cy.on('tap', 'node', (evt: { target: { id(): string } }) => {
    vscode.postMessage({ command: 'stateClicked', id: evt.target.id() });
});

// Click a transition label → static event simulation hook.
cy.on('tap', 'edge', (evt: { target: { data(key: string): string } }) => {
    vscode.postMessage({ command: 'eventClicked', eventName: evt.target.data('label') });
});

// Highlight from cursor-sync (extension posts the sanitized state name).
window.addEventListener('message', (event: MessageEvent) => {
    const message = event.data;
    if (message && message.command === 'highlight') {
        cy.nodes().removeClass('highlighted');
        cy.nodes(`[name = "${message.stateId}"]`).addClass('highlighted');
    }
});
