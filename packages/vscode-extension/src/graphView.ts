import * as vscode from 'vscode';
import { MachineNode } from './parser';
import { XStateMachineTreeProvider } from './treeProvider';

interface PanelEntry {
    panel: vscode.WebviewPanel;
    machine: MachineNode;
    nodeById: Map<string, MachineNode>;
    title: string;
    direction: 'DOWN' | 'RIGHT';
    // State (by label) to select once the diagram first renders — set when the
    // panel is opened from a specific tree/editor node.
    selectName?: string;
    // Whether the webview HTML has been built yet. Once it has, model updates
    // are pushed incrementally via `setModel` so the user's pan/zoom survives.
    rendered?: boolean;
}

export class XStateGraphViewProvider {
    public static readonly viewType = 'xstateGraphView';

    // One panel per machine — keyed by stable machine identity (file path + line + label).
    private panels = new Map<string, PanelEntry>();
    // The key of the panel the user most recently focused, used for highlight/simulate.
    private activeKey: string | undefined;
    // Invoked when a diagram node is clicked, so the host can select the
    // matching item in the tree outline (set from activate()).
    private revealInTree?: (node: MachineNode) => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly treeProvider: XStateMachineTreeProvider
    ) {}

    /** Register a callback that selects the given node in the tree outline. */
    public setRevealInTreeHandler(fn: (node: MachineNode) => void) {
        this.revealInTree = fn;
    }

    private machineKey(machine: MachineNode): string {
        const path = machine.uri?.fsPath ?? '';
        const line = machine.range?.start.line ?? 0;
        return `${path}::${line}::${machine.label}`;
    }

    public show(machineNode: MachineNode, title: string, selectName?: string) {
        const key = this.machineKey(machineNode);
        const existing = this.panels.get(key);
        if (existing) {
            existing.panel.reveal();
            this.activeKey = key;
            // Already rendered — select the requested node via a live message.
            if (selectName) { this.highlightState(selectName); }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            XStateGraphViewProvider.viewType,
            `XState Graph: ${title}`,
            { viewColumn: vscode.ViewColumn.Active },
            {
                enableScripts: true,
                localResourceRoots: [this.extensionUri],
                // Keep the webview alive when hidden so switching editor tabs
                // doesn't destroy the user's pan/zoom and re-run ELK layout.
                retainContextWhenHidden: true,
            }
        );

        const entry: PanelEntry = { panel, machine: machineNode, nodeById: new Map(), title, direction: this.autoDirection(machineNode), selectName };
        this.panels.set(key, entry);
        this.activeKey = key;

        panel.onDidDispose(() => {
            // Find by panel identity, not the original key — the key can change
            // when the document is edited and the machine is re-derived.
            for (const [k, e] of this.panels) {
                if (e.panel === panel) {
                    this.panels.delete(k);
                    if (this.activeKey === k) { this.activeKey = [...this.panels.keys()].at(-1); }
                    break;
                }
            }
        });

        panel.onDidChangeViewState(e => {
            if (e.webviewPanel.active) { this.activeKey = key; }
        });

        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'stateClicked': this.selectInTree(message.id, entry); return;
                case 'eventClicked': this.selectEventInTree(message.src, message.eventName, entry); return;
                case 'setDirection': entry.direction = message.direction === 'RIGHT' ? 'RIGHT' : 'DOWN'; return;
                case 'exportSvg':   this.saveExport(message.data, 'svg', title); return;
                case 'exportPng':   this.saveExport(message.data, 'png', title); return;
            }
        });

        this.updatePanel(key);
    }

    // Pick a starting layout direction from the machine's shape. Small,
    // mostly-linear machines (e.g. a traffic light) read naturally left-to-right
    // as a flow; parallel, large, or wide machines read better top-down — their
    // regions sit side by side and a wide machine laid horizontally gets
    // unwieldy. This is only the initial default; the toolbar toggle (persisted
    // per panel in entry.direction) always wins after that.
    private autoDirection(machine: MachineNode): 'DOWN' | 'RIGHT' {
        let hasParallel = false, stateCount = 0, maxSiblings = 0;
        const visit = (n: MachineNode) => {
            if (n.isParallel) { hasParallel = true; }
            const childStates = (n.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker);
            maxSiblings = Math.max(maxSiblings, childStates.length);
            for (const c of childStates) { stateCount++; visit(c); }
        };
        visit(machine);
        if (hasParallel || stateCount > 24 || maxSiblings > 6) { return 'DOWN'; }
        return 'RIGHT';
    }

    public highlightState(stateName: string) {
        const entry = this.activeKey ? this.panels.get(this.activeKey) : undefined;
        entry?.panel.webview.postMessage({
            command: 'highlight',
            stateId: stateName.replace(/[^a-zA-Z0-9_]/g, '_'),
        });
    }

    public refresh() {
        for (const key of this.panels.keys()) { this.updatePanel(key); }
    }

    /** True if any open diagram is rooted in the given document. */
    public hasPanelForDocument(uri: vscode.Uri): boolean {
        for (const entry of this.panels.values()) {
            if (entry.machine.uri?.fsPath === uri.fsPath) { return true; }
        }
        return false;
    }

    /**
     * Re-derive any open diagram rooted in `uri` from a freshly parsed machine
     * list and push the update (incrementally, preserving the viewport). Called
     * when the source document changes. Matching is by label, then nearest start
     * line, since edits shift line numbers out from under the original key.
     */
    public updateForDocument(uri: vscode.Uri, machines: MachineNode[]) {
        for (const [oldKey, entry] of [...this.panels.entries()]) {
            if (entry.machine.uri?.fsPath !== uri.fsPath) { continue; }
            const updated = this.matchMachine(entry.machine, machines);
            if (!updated) { continue; }
            entry.machine = updated;
            // The key embeds the line number, which edits shift — re-key so
            // re-opening the same machine still finds this panel.
            const newKey = this.machineKey(updated);
            if (newKey !== oldKey) {
                this.panels.delete(oldKey);
                this.panels.set(newKey, entry);
                if (this.activeKey === oldKey) { this.activeKey = newKey; }
            }
            this.updatePanel(newKey);
        }
    }

    // Find the parsed node corresponding to a previously-rendered one. Sub-diagrams
    // are rooted at a nested state, so search the whole tree, not just top level.
    private matchMachine(prev: MachineNode, machines: MachineNode[]): MachineNode | undefined {
        const candidates: MachineNode[] = [];
        const visit = (n: MachineNode) => {
            if (n.label === prev.label && n.type === prev.type) { candidates.push(n); }
            for (const c of n.children ?? []) { visit(c); }
        };
        for (const m of machines) { visit(m); }
        if (candidates.length <= 1) { return candidates[0]; }
        // Disambiguate same-named nodes by proximity to the original line.
        const prevLine = prev.range?.start.line ?? 0;
        return candidates.reduce((best, c) =>
            Math.abs((c.range?.start.line ?? 0) - prevLine) < Math.abs((best.range?.start.line ?? 0) - prevLine) ? c : best
        );
    }

    // Event label clicked → select the matching transition node in the tree.
    // `eventName` is the rendered Harel label (EVENT [guard] / actions); the
    // transition node's own label is just the event, so match on that prefix.
    private selectEventInTree(srcId: string | undefined, eventName: string, entry: PanelEntry) {
        if (!srcId || !eventName) { return; }
        const state = entry.nodeById.get(srcId);
        if (!state) { return; }
        const event = eventName.split(/\s*[[/]/)[0].trim();
        const transitions = (state.children ?? []).filter(c => c.type === 'transition');
        const match = transitions.find(t => t.label === eventName)
            ?? transitions.find(t => t.label === event)
            ?? transitions.find(t => (t.label ?? '').trim() === event);
        if (match) { this.revealInTree?.(match); }
    }

    // Diagram node clicked → select the matching item in the tree outline.
    // (Does NOT open source code; the tree's own navigation handles that.)
    private selectInTree(id: string, entry: PanelEntry) {
        const node = entry.nodeById.get(id);
        if (node) { this.revealInTree?.(node); }
    }

    private async saveExport(data: string, format: 'svg' | 'png', machineTitle: string) {
        const safeTitle = machineTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${safeTitle}.${format}`),
            filters: format === 'svg' ? { 'SVG Image': ['svg'] } : { 'PNG Image': ['png'] },
        });
        if (!saveUri) { return; }
        const bytes = format === 'svg'
            ? Buffer.from(data, 'utf8')
            : Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64');
        await vscode.workspace.fs.writeFile(saveUri, bytes);
        vscode.window.showInformationMessage(`Graph exported: ${saveUri.fsPath}`);
    }

    private updatePanel(key: string) {
        const entry = this.panels.get(key);
        if (!entry) { return; }
        entry.nodeById.clear();
        const config = vscode.workspace.getConfiguration('xstateOutline');
        const reflectExpansion = config.get<boolean>('graphReflectsTreeExpansion', true);
        const payload = this.buildElements(entry.machine, reflectExpansion, entry.nodeById);
        if (entry.rendered) {
            // Incremental update — preserve the webview's pan/zoom/selection.
            entry.panel.webview.postMessage({ command: 'setModel', payload, direction: entry.direction });
        } else {
            entry.panel.webview.html = this.getHtmlForWebview(entry.panel.webview, payload, entry.direction, entry.selectName);
            entry.rendered = true;
        }
    }

    private buildElements(
        machine: MachineNode,
        reflectExpansion: boolean,
        nodeById: Map<string, MachineNode>
    ): GraphPayload {
        const nodes: GraphNode[] = [];
        const nameToId = new Map<string, string>();
        const idByNode = new Map<MachineNode, string>();
        const collapsedIds: string[] = [];
        let counter = 0;

        const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

        const collect = (n: MachineNode, parentId: string | undefined, isRoot: boolean) => {
            const id = `n${counter++}`;
            idByNode.set(n, id);
            nodeById.set(id, n);
            const name = sanitize(n.label);
            nameToId.set(name, id);

            // Exclude the synthetic `type: …` marker — the graph shows
            // parallel-ness via the state's own styling, not a child node.
            const childStates = (n.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker);
            const entryActions = (n.children ?? []).filter(c => c.type === 'entry').map(c => c.label);
            const exitActions  = (n.children ?? []).filter(c => c.type === 'exit').map(c => c.label);
            // Internal (action-only) transitions: an event that runs actions
            // without a target. There's no state change, so it's not an edge —
            // it belongs inside the state box like entry/exit, shown as
            // `EVENT [guard] / actions` (Harel internal-transition convention).
            const internalTransitions = (n.children ?? [])
                .filter(c => c.type === 'transition'
                    && !(c.children ?? []).some(cc => cc.type === 'target')
                    && (c.children ?? []).some(cc => cc.type === 'action'))
                .map(c => {
                    const guard = c.children?.find(cc => cc.type === 'guard');
                    const acts = (c.children ?? []).filter(cc => cc.type === 'action').map(cc => cc.label);
                    return `${c.label}${guard ? ` [${guard.label}]` : ''} / ${acts.join(', ')}`;
                });
            // Invoked services on this state (shown as `invoke <src>` rows).
            const invokes = (n.children ?? []).filter(c => c.type === 'invoke').map(c => c.label);
            nodes.push({
                data: {
                    id, label: n.label, name,
                    parent: parentId,
                    compound: childStates.length > 0,
                    initial: !!n.isInitial,
                    final: !!n.isFinal,
                    parallel: !!n.isParallel,
                    history: n.historyType,
                    entryActions,
                    exitActions,
                    internalTransitions,
                    invokes,
                    description: n.description,
                },
            });

            // A compound state renders as a single collapsed block unless it is
            // currently expanded in the tree. Using the live expansion set (not
            // the cached tree item) means this is correct even for nodes whose
            // tree items have never been rendered. Root states are never
            // collapsed — a diagram rooted at a state must always show it open.
            if (reflectExpansion && !isRoot && childStates.length > 0 && !this.treeProvider.isNodeExpanded(n)) {
                collapsedIds.push(id);
            }

            for (const c of childStates) { collect(c, id, false); }
        };

        // When the diagram is rooted at a single state (a sub-diagram), that
        // state is always shown expanded. When rooted at a machine, its
        // top-level states respect their own tree expansion state.
        const isSubDiagram = machine.type === 'state';

        // Frame an actual machine in a labelled root box (Harel convention).
        // This also lets a parallel machine root carry its parallel styling,
        // which would otherwise be lost (the machine node isn't a state).
        let rootParentId: string | undefined;
        if (!isSubDiagram) {
            rootParentId = `n${counter++}`;
            nodeById.set(rootParentId, machine);
            nodes.push({
                data: {
                    id: rootParentId, label: machine.label, name: sanitize(machine.label),
                    parent: undefined, compound: true, parallel: !!machine.isParallel,
                },
            });
        }

        const rootStates = isSubDiagram
            ? [machine]
            : (machine.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker);
        for (const r of rootStates) { collect(r, rootParentId, isSubDiagram); }

        // Edges: merge transitions between the same source→target pair so multiple
        // events on one arrow don't stack into an unreadable blob.
        const edgeMap = new Map<string, { source: string; target: string; labels: string[] }>();
        // In a focused sub-diagram, transitions can target a state outside the
        // shown subtree. Rather than dropping them, point them at a faded ghost
        // "exit" stub labelled with the external target.
        const ghostByName = new Map<string, string>();
        const addEdges = (n: MachineNode) => {
            if (n.type === 'state') {
                const sourceId = idByNode.get(n);
                if (sourceId) {
                    // A state's outgoing transitions: its direct `on:` handlers
                    // plus the onDone/onError defined on its invoke(s) — those
                    // also move the state when the invoked actor settles.
                    const directT = (n.children ?? []).filter(c => c.type === 'transition');
                    const invokeT = (n.children ?? [])
                        .filter(c => c.type === 'invoke')
                        .flatMap(inv => (inv.children ?? []).filter(c => c.type === 'transition'));

                    // Emit one merged edge for source→target, building the Harel
                    // label `EVENT [guard] / action1, action2`.
                    const emitEdge = (targetRaw: string, eventLabel: string, guardLabel?: string, actionLabels: string[] = []) => {
                        const targetName = sanitize(targetRaw.replace(/^#/, '').split('.').pop() ?? '');
                        let targetId = nameToId.get(targetName);
                        if (!targetId) {
                            if (!isSubDiagram) { return; }
                            const display = targetRaw.replace(/^#/, '');
                            targetId = ghostByName.get(targetName);
                            if (!targetId) {
                                targetId = `n${counter++}`;
                                ghostByName.set(targetName, targetId);
                                nodes.push({ data: { id: targetId, label: display, name: sanitize(display), parent: undefined, ghost: true } });
                            }
                        }
                        const key = `${sourceId} ${targetId}`;
                        let entry = edgeMap.get(key);
                        if (!entry) { entry = { source: sourceId, target: targetId, labels: [] }; edgeMap.set(key, entry); }
                        let label = eventLabel ?? '';
                        if (guardLabel) { label += ` [${guardLabel}]`; }
                        if (actionLabels.length) { label += ` / ${actionLabels.join(', ')}`; }
                        label = label.trim();
                        if (label && !entry.labels.includes(label)) { entry.labels.push(label); }
                    };

                    for (const t of [...directT, ...invokeT]) {
                        // Conditional transition (array of branches): each branch is
                        // a `transition` whose label is its own target. Emit an edge
                        // per branch so guarded multi-target transitions all show.
                        const branches = (t.children ?? []).filter(c => c.type === 'transition');
                        if (branches.length > 0) {
                            for (const b of branches) {
                                if (!b.label || b.label === '?') { continue; }  // action-only branch, no target
                                const g = b.children?.find(c => c.type === 'guard');
                                const acts = (b.children ?? []).filter(c => c.type === 'action').map(a => a.label);
                                emitEdge(b.label, t.label ?? '', g?.label, acts);
                            }
                            continue;
                        }
                        const target = t.children?.find(c => c.type === 'target');
                        if (!target) { continue; }
                        const guard   = t.children?.find(c => c.type === 'guard');
                        const actions = (t.children ?? []).filter(c => c.type === 'action').map(a => a.label);
                        emitEdge(target.label, t.label ?? '', guard?.label, actions);
                    }
                }
            }
            for (const c of (n.children ?? [])) { addEdges(c); }
        };
        addEdges(machine);

        const edges: GraphEdge[] = [];
        for (const entry of edgeMap.values()) {
            edges.push({ data: { id: `e${counter++}`, source: entry.source, target: entry.target, label: entry.labels.join('\n') } });
        }

        // Filled start-node for each region's initial state (Harel convention).
        const starts: GraphNode[] = [];
        for (const node of nodes) {
            if (!node.data.initial) { continue; }
            const startId = `start_${counter++}`;
            starts.push({ data: { id: startId, label: '', name: startId, parent: node.data.parent, start: true } });
            edges.push({ data: { id: `e${counter++}`, source: startId, target: node.data.id, label: '' } });
        }
        nodes.push(...starts);

        return { nodes, edges, collapsedIds };
    }

    private getHtmlForWebview(webview: vscode.Webview, payload: GraphPayload, direction: 'DOWN' | 'RIGHT', selectName?: string): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'graph.js')
        );
        const nonce = getNonce();
        const json = JSON.stringify(payload);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>XState Graph</title>
    <style>
        html, body { padding: 0; margin: 0; height: 100%; width: 100%; overflow: hidden; }
        body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        #cy { position: absolute; inset: 0; }
        /* Smooth transitions for hover interactivity */
        path { transition: stroke-opacity 0.12s ease, stroke-width 0.12s ease; }
        [data-event] { transition: opacity 0.12s ease; }
        rect { transition: stroke-opacity 0.12s ease, stroke-width 0.12s ease, fill 0.12s ease; }
        #toolbar {
            position: absolute;
            bottom: 12px;
            right: 12px;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 1px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3));
            border-radius: 6px;
            padding: 3px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.16);
            user-select: none;
        }
        #toolbar button {
            background: none;
            border: none;
            color: var(--vscode-icon-foreground, var(--vscode-editor-foreground));
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-family: var(--vscode-font-family, system-ui, sans-serif);
            line-height: 1.4;
            white-space: nowrap;
        }
        #toolbar button#btn-zoom-reset { min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
        #toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.1)); }
        #toolbar button:active { background: var(--vscode-toolbar-activeBackground, rgba(127,127,127,0.2)); }
        .tb-sep { width: 1px; height: 14px; background: var(--vscode-widget-border, rgba(127,127,127,0.3)); margin: 0 2px; }
    </style>
</head>
<body>
    <div id="cy"></div>
    <div id="toolbar">
        <button id="btn-zoom-out" title="Zoom out">−</button>
        <button id="btn-zoom-reset" title="Reset to actual size (100%)">100%</button>
        <button id="btn-zoom-in"  title="Zoom in">+</button>
        <button id="btn-fit"      title="Fit to screen">⊡</button>
        <button id="btn-direction" title="Toggle layout direction (top-down / left-right)">↧</button>
        <div class="tb-sep"></div>
        <button id="btn-expand-all"   title="Expand all states">⊞</button>
        <button id="btn-collapse-all" title="Collapse all states">⊟</button>
        <div class="tb-sep"></div>
        <button id="btn-export-svg" title="Export as SVG">SVG</button>
        <button id="btn-export-png" title="Export as PNG">PNG</button>
    </div>
    <script nonce="${nonce}">window.__GRAPH__ = ${json}; window.__DIRECTION__ = ${JSON.stringify(direction)}; window.__SELECT__ = ${JSON.stringify(selectName ? selectName.replace(/[^a-zA-Z0-9_]/g, '_') : '')};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

interface GraphNode {
    data: {
        id: string; label: string; name: string;
        parent?: string; compound?: boolean;
        initial?: boolean; final?: boolean; start?: boolean; parallel?: boolean;
        history?: 'shallow' | 'deep'; ghost?: boolean;
        entryActions?: string[]; exitActions?: string[]; internalTransitions?: string[];
        invokes?: string[]; description?: string;
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

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return text;
}
