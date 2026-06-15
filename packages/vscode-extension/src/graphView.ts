import * as vscode from 'vscode';
import { MachineNode } from './parser';
import { XStateMachineTreeProvider } from './treeProvider';
import { toMermaid } from './export/mermaid';
import { SimModel, SimState, SimTransition, indexModel, shortestPaths } from './machineModel';

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
                case 'exportMermaid': void this.exportMermaid(entry.machine, title); return;
                case 'goToSource': void this.goToSource(message.id, entry); return;
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

    // Open a diagram node's source location in the editor (context-menu action).
    private async goToSource(id: string, entry: PanelEntry) {
        const node = entry.nodeById.get(id);
        if (node?.uri && node.range) {
            await vscode.window.showTextDocument(node.uri, { selection: node.range, preview: false });
        }
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

    /**
     * Build the Mermaid `stateDiagram-v2` text for a machine (or compound state)
     * and open it in a new Markdown document — previewable, copyable, savable.
     * Drives the full tree (no collapse), so the export is complete regardless of
     * the diagram's current expansion state.
     */
    public async exportMermaid(machine: MachineNode, title: string) {
        const payload = this.buildElements(machine, false, new Map());
        const mermaid = toMermaid(payload);
        const content = `# ${title}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`;
        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    // Build the simulator model for a machine (used by the test-path report).
    private buildSimForMachine(machine: MachineNode): { model: SimModel } {
        const payload = this.buildElements(machine, false, new Map());
        return { model: payload.sim! };
    }

    /**
     * Open a Markdown report of the shortest path to every state (a coverage
     * map), plus copy-paste test skeletons — handy for seeding `@xstate/test`
     * style suites or just documenting how the machine is driven.
     */
    public async generateTestPaths(machine: MachineNode) {
        const { model } = this.buildSimForMachine(machine);
        const idx = indexModel(model);
        const paths = shortestPaths(idx);

        const states = model.states.filter(s => s.id !== model.rootId);
        const reachable = states.filter(s => paths.get(s.id) !== null);
        const unreachable = states.filter(s => paths.get(s.id) === null);
        const eventsOf = (s: SimState) => (paths.get(s.id) ?? []).map(t => t.event);

        const lines: string[] = [];
        lines.push(`# Test paths — ${machine.label}`, '');
        lines.push(`Shortest event sequence to reach each state, from the structural`,
            `interpreter (guards assumed takeable). ${reachable.length}/${states.length} states reachable.`, '');

        lines.push('## Reachable states', '');
        for (const s of reachable) {
            const ev = eventsOf(s);
            lines.push(`- **${s.label}** — ${ev.length ? ev.map(e => `\`${e}\``).join(' → ') : '_initial_'}`);
        }
        if (unreachable.length) {
            lines.push('', '## Unreachable states', '');
            for (const s of unreachable) { lines.push(`- ${s.label}`); }
        }

        lines.push('', '## Test skeletons', '', '```ts',
            `import { createActor } from 'xstate';`,
            `// import { machine } from './your-machine';`, '');
        for (const s of reachable) {
            const ev = eventsOf(s);
            lines.push(`test('reaches "${s.label}"', () => {`,
                `  const actor = createActor(machine).start();`);
            for (const e of ev) { lines.push(`  actor.send({ type: '${e}' });`); }
            lines.push(`  // expect(actor.getSnapshot().matches('${s.label}')).toBe(true);`, `});`, '');
        }
        lines.push('```', '');

        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') });
        await vscode.window.showTextDocument(doc, { preview: false });
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
        // Each state's parent state node — for XState-style relative target
        // resolution (a bare target is a sibling, not a same-named state elsewhere).
        const parentNodeOf = new Map<MachineNode, MachineNode | undefined>();
        const collapsedIds: string[] = [];
        // Parallel structural model for the simulator (same ids as the diagram).
        const simStates: SimState[] = [];
        const simTransitions: SimTransition[] = [];
        let simCounter = 0;
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

            // Mirror the state into the simulator model (same id as the diagram).
            const simType: SimState['type'] = n.isFinal ? 'final'
                : n.isParallel ? 'parallel'
                : childStates.length > 0 ? 'compound'
                : 'atomic';
            simStates.push({
                id, label: n.label, parent: parentId, type: simType,
                initial: !!n.isInitial, historyType: n.historyType,
            });

            // A compound state renders as a single collapsed block unless it is
            // currently expanded in the tree. Using the live expansion set (not
            // the cached tree item) means this is correct even for nodes whose
            // tree items have never been rendered. Root states are never
            // collapsed — a diagram rooted at a state must always show it open.
            if (reflectExpansion && !isRoot && childStates.length > 0 && !this.treeProvider.isNodeExpanded(n)) {
                collapsedIds.push(id);
            }

            for (const c of childStates) { parentNodeOf.set(c, n); collect(c, id, false); }
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
            simStates.push({
                id: rootParentId, label: machine.label, parent: undefined,
                type: machine.isParallel ? 'parallel' : 'compound',
            });
        }

        const rootStates = isSubDiagram
            ? [machine]
            : (machine.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker);
        for (const r of rootStates) {
            parentNodeOf.set(r, isSubDiagram ? undefined : machine);
            collect(r, rootParentId, isSubDiagram);
        }

        // Resolve a transition's target string to a diagram node id, the way
        // XState scopes it: a bare `target` is a sibling (child of the source's
        // parent); a dotted path descends from there; a leading `.` is relative
        // to the source itself; `#id` is global. Only when relative resolution
        // fails do we fall back to the flat last-segment name map — which is what
        // used to mis-resolve a sibling to a same-named state elsewhere.
        const childStateNodes = (scope: MachineNode | undefined): MachineNode[] =>
            scope ? (scope.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker) : rootStates;
        const globalByLeaf = (raw: string): string | undefined =>
            nameToId.get(sanitize(raw.replace(/^#/, '').split('.').pop() ?? ''));
        const resolveTargetId = (source: MachineNode, raw: string): string | undefined => {
            if (!raw) { return undefined; }
            if (raw.startsWith('#')) { return globalByLeaf(raw); }
            let scope = raw.startsWith('.') ? source : parentNodeOf.get(source);
            const segs = (raw.startsWith('.') ? raw.slice(1) : raw).split('.').filter(Boolean);
            let node: MachineNode | undefined;
            for (const seg of segs) {
                node = childStateNodes(scope).find(k => k.label === seg);
                if (!node) { return globalByLeaf(raw); }
                scope = node;
            }
            return node ? idByNode.get(node) : globalByLeaf(raw);
        };
        // The simulator's root: the machine box, or the focused state itself.
        const simRootId = rootParentId ?? idByNode.get(machine) ?? '';

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
                        // Resolve relative to the source state (XState scoping), so a
                        // sibling target isn't confused with a same-named state elsewhere.
                        const realTarget = resolveTargetId(n, targetRaw);
                        let targetId = realTarget;
                        if (!targetId) {
                            if (!isSubDiagram) { return; }
                            const display = targetRaw.replace(/^#/, '');
                            const ghostName = sanitize(display.split('.').pop() ?? '');
                            targetId = ghostByName.get(ghostName);
                            if (!targetId) {
                                targetId = `n${counter++}`;
                                ghostByName.set(ghostName, targetId);
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
                        // Simulator transition — only when the target is a real
                        // diagram state (skip ghost/out-of-diagram stubs).
                        if (realTarget) {
                            simTransitions.push({
                                id: `st${simCounter++}`, source: sourceId, event: eventLabel ?? '',
                                guard: guardLabel, target: realTarget, actions: actionLabels,
                            });
                        }
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
                        const guard   = t.children?.find(c => c.type === 'guard');
                        const actions = (t.children ?? []).filter(c => c.type === 'action').map(a => a.label);
                        if (!target) {
                            // Internal transition (event, no target): no state change,
                            // but still a fireable event in the simulator.
                            if (t.label) {
                                simTransitions.push({
                                    id: `st${simCounter++}`, source: sourceId,
                                    event: t.label, guard: guard?.label, actions,
                                });
                            }
                            continue;
                        }
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

        const sim: SimModel = { rootId: simRootId, states: simStates, transitions: simTransitions };
        return { nodes, edges, collapsedIds, sim };
    }

    private getHtmlForWebview(webview: vscode.Webview, payload: GraphPayload, direction: 'DOWN' | 'RIGHT', selectName?: string): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'graph.js')
        );
        const nonce = getNonce();
        const json = JSON.stringify(payload);
        const showInternal = vscode.workspace.getConfiguration('xstateOutline').get<boolean>('showInternalTransitions', true);

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
        #toolbar button#btn-simulate.active { background: var(--vscode-charts-green, #388a34); color: #fff; }
        #toolbar button#btn-internal.active { background: var(--vscode-toolbar-activeBackground, rgba(127,127,127,0.25)); }
        /* ── Simulator panel ───────────────────────────────────────────── */
        #sim-panel {
            position: absolute;
            top: 12px;
            right: 12px;
            z-index: 10;
            width: 260px;
            max-height: calc(100% - 90px);
            display: flex;
            flex-direction: column;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3));
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.16);
            font-family: var(--vscode-font-family, system-ui, sans-serif);
            font-size: 12px;
            user-select: none;
        }
        #sim-panel[hidden] { display: none; }
        #sim-head { display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3)); }
        #sim-title { font-weight: 600; }
        .sim-spacer { flex: 1; }
        #sim-head button { background: none; border: none; color: var(--vscode-icon-foreground, var(--vscode-editor-foreground)); cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
        #sim-head button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.1)); }
        #sim-status { padding: 6px 8px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3)); word-break: break-word; }
        .sim-section-title { padding: 6px 8px 2px; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
        #sim-events { display: flex; flex-direction: column; gap: 2px; padding: 2px 6px 6px; overflow-y: auto; }
        .sim-event {
            display: flex; align-items: baseline; gap: 6px;
            text-align: left; width: 100%;
            background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.12));
            color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
            border: none; border-radius: 4px; cursor: pointer;
            padding: 5px 8px; font-size: 12px; font-family: inherit;
        }
        .sim-event:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,0.22)); }
        .sim-ev { font-weight: 600; }
        .sim-to { color: var(--vscode-descriptionForeground); font-size: 11px; }
        .sim-internal { font-style: italic; }
        .sim-empty { padding: 4px 8px; color: var(--vscode-descriptionForeground); font-style: italic; }
        #sim-trace { list-style: decimal inside; margin: 0; padding: 2px 8px 8px; overflow-y: auto; max-height: 30%; }
        #sim-trace li { padding: 2px 0; display: flex; gap: 6px; justify-content: space-between; }
        #sim-trace li.sim-current { color: var(--vscode-charts-green, #388a34); }
        #sim-trace li.sim-clickable { cursor: pointer; border-radius: 3px; }
        #sim-trace li.sim-clickable:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.12)); }
        .sim-link { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; text-decoration-style: dotted; }
        .sim-link:hover { color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground)); }
        /* ── Right-click context menu ──────────────────────────────────── */
        #ctx-menu {
            position: absolute; z-index: 20; min-width: 184px;
            background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
            color: var(--vscode-menu-foreground, var(--vscode-editor-foreground));
            border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(127,127,127,0.3)));
            border-radius: 5px; padding: 4px; box-shadow: 0 2px 12px rgba(0,0,0,0.32);
            font-family: var(--vscode-font-family, system-ui, sans-serif); font-size: 13px; user-select: none;
        }
        #ctx-menu[hidden] { display: none; }
        #ctx-menu .ctx-item { padding: 4px 10px; border-radius: 3px; cursor: pointer; white-space: nowrap; }
        #ctx-menu .ctx-item:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-menu-selectionForeground, inherit); }
        #ctx-menu .ctx-sep { height: 1px; margin: 4px 2px; background: var(--vscode-menu-separatorBackground, rgba(127,127,127,0.3)); }
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
        <button id="btn-internal" title="Show internal (action-only) transitions">/ƒ</button>
        <div class="tb-sep"></div>
        <button id="btn-export-svg" title="Export as SVG">SVG</button>
        <button id="btn-export-png" title="Export as PNG">PNG</button>
        <button id="btn-export-mermaid" title="Export as Mermaid">MMD</button>
        <div class="tb-sep"></div>
        <button id="btn-simulate" title="Simulate (walk the machine interactively)">▷ Sim</button>
    </div>
    <div id="sim-panel" hidden>
        <div id="sim-head">
            <span id="sim-title">Simulator</span>
            <span class="sim-spacer"></span>
            <button id="sim-back" title="Step back">↶</button>
            <button id="sim-reset" title="Reset to initial state">⟲</button>
            <button id="sim-close" title="Exit simulator">✕</button>
        </div>
        <div id="sim-status"></div>
        <div class="sim-section-title">Events</div>
        <div id="sim-events"></div>
        <div class="sim-section-title">Trace</div>
        <ol id="sim-trace"></ol>
    </div>
    <div id="ctx-menu" hidden></div>
    <script nonce="${nonce}">window.__GRAPH__ = ${json}; window.__DIRECTION__ = ${JSON.stringify(direction)}; window.__SELECT__ = ${JSON.stringify(selectName ? selectName.replace(/[^a-zA-Z0-9_]/g, '_') : '')}; window.__SHOWINTERNAL__ = ${JSON.stringify(showInternal)};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

export interface GraphNode {
    data: {
        id: string; label: string; name: string;
        parent?: string; compound?: boolean;
        initial?: boolean; final?: boolean; start?: boolean; parallel?: boolean;
        history?: 'shallow' | 'deep'; ghost?: boolean;
        entryActions?: string[]; exitActions?: string[]; internalTransitions?: string[];
        invokes?: string[]; description?: string;
    };
}
export interface GraphEdge {
    data: { id: string; source: string; target: string; label: string };
}
export interface GraphPayload {
    nodes: GraphNode[];
    edges: GraphEdge[];
    collapsedIds?: string[];
    /** Structural model for the interactive simulator. */
    sim?: SimModel;
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return text;
}
