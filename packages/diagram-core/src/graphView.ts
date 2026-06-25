import * as vscode from 'vscode';
import { MachineNode } from './parser';
import { toMermaid } from './export/mermaid';
import { XStateTreeEditor } from './treeEditor';
import { GraphPayload, buildGraphPayload, machineKey, childStatesOf } from './buildGraph';
import { renderTestPathsMarkdown } from './analysis';

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
    // Roots of the invoked machines nested inline into this diagram, so the live
    // overlay can paint a *child actor's* active states onto the nested subtree.
    invokedMachines?: MachineNode[];
    // Set when this panel is a sub-diagram rooted at a child node (not a whole
    // machine). The live overlay then looks up the owning machine's config by
    // `label` and descends `path` (the state-key chain to this node) before
    // painting, so active states still show. See applyLiveConfigs.
    liveOverlay?: { label: string; path: string[] };
}

/** XState StateValue shape from a live snapshot. */
export type LiveStateValue = string | { [key: string]: LiveStateValue };


/**
 * Walk a live StateValue against the static MachineNode tree, collecting every
 * active node (the node itself plus the active descendant chain). Compound
 * values are a single active child; parallel values activate several regions.
 * Matching is by local label, mirroring XState's state keys.
 */
function collectActiveNodes(
    value: LiveStateValue,
    node: MachineNode,
    acc: Set<MachineNode>,
): void {
    acc.add(node);
    const children = childStatesOf(node);
    if (typeof value === 'string') {
        const child = children.find(c => c.label === value);
        if (child) { acc.add(child); }
        return;
    }
    for (const [key, sub] of Object.entries(value)) {
        const child = children.find(c => c.label === key);
        if (child) { collectActiveNodes(sub, child, acc); }
    }
}

/** Descend a StateValue by a chain of state keys; undefined if the path isn't
 *  active (so a sub-diagram outside the active configuration gets no overlay). */
function descend(value: LiveStateValue, path: string[]): LiveStateValue | undefined {
    let v: LiveStateValue = value;
    for (const key of path) {
        if (typeof v !== 'object' || v === null) { return undefined; }
        const next = v[key];
        if (next === undefined) { return undefined; }
        v = next;
    }
    return v;
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
    // Invoked when the user picks "Open invoked machine" on an invoke state, so
    // the host can resolve the invoke src to a machine and open its diagram.
    private openInvoked?: (src: string) => void;
    // Resolves an invoke `src` to its static machine definition, so invoked
    // machines can be nested inline into the diagram. Returns undefined when no
    // matching workspace machine is found (then the invoke stays a leaf row).
    private resolveInvoke?: (src: string) => MachineNode | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        // Optional: report whether a node is currently expanded in an outline
        // tree, so the diagram can collapse nodes the user has collapsed there.
        // The debugger has no outline tree and passes nothing (nothing collapses).
        private readonly reflectsExpansion?: (node: MachineNode) => boolean
    ) {}

    /** Register a callback that selects the given node in the tree outline. */
    public setRevealInTreeHandler(fn: (node: MachineNode) => void) {
        this.revealInTree = fn;
    }

    /** Register a callback that opens the diagram for an invoked machine. */
    public setOpenInvokedHandler(fn: (src: string) => void) {
        this.openInvoked = fn;
    }

    /** Register a resolver from an invoke `src` to its static machine, used to
     *  nest invoked machines inline into the diagram. */
    public setInvokeResolver(fn: (src: string) => MachineNode | undefined) {
        this.resolveInvoke = fn;
    }


    public show(machineNode: MachineNode, title: string, selectName?: string, liveOverlay?: { label: string; path: string[] }) {
        const key = machineKey(machineNode);
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

        const entry: PanelEntry = { panel, machine: machineNode, nodeById: new Map(), title, direction: this.autoDirection(machineNode), selectName, liveOverlay };
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
                case 'openInvoked': this.openInvoked?.(String(message.src)); return;
                case 'editNode':      void this.runNodeEdit(message.id, entry, n => XStateTreeEditor.editNode(n)); return;
                case 'addChildState': void this.runNodeEdit(message.id, entry, n => XStateTreeEditor.addChildState(n)); return;
                case 'addTransition': void this.runNodeEdit(message.id, entry, n => XStateTreeEditor.addTransition(n)); return;
                case 'addReference':  void this.runNodeEdit(message.id, entry, n => XStateTreeEditor.addReference(n)); return;
                case 'setDescription':void this.runNodeEdit(message.id, entry, n => XStateTreeEditor.setDescription(n)); return;
                case 'deleteNode':    void this.runNodeEdit(message.id, entry, n => XStateTreeEditor.deleteNode(n)); return;
                case 'goToSourceEvent': void this.runTransitionEdit(message.src, message.eventName, entry, async n => {
                    if (n.uri && n.range) { await vscode.window.showTextDocument(n.uri, { selection: n.range, preview: false }); }
                }); return;
                case 'editTransition':       void this.runTransitionEdit(message.src, message.eventName, entry, n => XStateTreeEditor.editNode(n)); return;
                case 'addTransitionReference':void this.runTransitionEdit(message.src, message.eventName, entry, n => XStateTreeEditor.addReference(n)); return;
                case 'deleteTransition':     void this.runTransitionEdit(message.src, message.eventName, entry, n => XStateTreeEditor.deleteNode(n)); return;
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

    /**
     * Overlay a running machine's active state configuration onto any open
     * diagram for that machine. `value` is the XState StateValue from the live
     * snapshot (a string for an atomic leaf, or nested objects for compound /
     * parallel configs). We resolve it against the static MachineNode tree by
     * local label — robust against the diagram's opaque `n#` ids and the
     * name-collision pitfall of a flat name map — then push the matching diagram
     * node ids to the webview, which paints them (see `paintLive` in graph.ts).
     */
    public applyLiveConfigs(configs: Map<string, LiveStateValue>): { matched: number; painted: number } {
        let matched = 0;
        let painted = 0;
        for (const entry of this.panels.values()) {
            const active = new Set<MachineNode>();
            let matchedHere = false;
            // The diagram's own machine, plus any invoked machines nested inline:
            // a child actor's config lights up the nested subtree. Union the
            // active nodes across all of them so a later push (e.g. the child
            // actor) doesn't overwrite the parent's overlay.
            for (const m of [entry.machine, ...(entry.invokedMachines ?? [])]) {
                // A sub-diagram's root node isn't a machine, so its config is
                // reached by descending the owning machine's StateValue.
                const value = entry.liveOverlay && m === entry.machine
                    ? (() => {
                        const root = configs.get(entry.liveOverlay.label);
                        return root === undefined ? undefined : descend(root, entry.liveOverlay.path);
                    })()
                    : configs.get(m.label);
                if (value === undefined) { continue; }
                matchedHere = true;
                matched++;
                collectActiveNodes(value, m, active);
            }
            if (!matchedHere) { continue; }
            const ids: string[] = [];
            for (const [id, node] of entry.nodeById) {
                if (active.has(node)) { ids.push(id); }
            }
            painted += ids.length;
            entry.panel.webview.postMessage({ command: 'liveStates', ids });
        }
        return { matched, painted };
    }

    /** Labels of every open diagram panel — for diagnosing overlay mismatches. */
    public getOpenMachineLabels(): string[] {
        return [...this.panels.values()].map((e) => e.machine.label);
    }

    /** Remove any live overlay from all open diagrams (e.g. on disconnect). */
    public clearLiveConfig(): void {
        for (const entry of this.panels.values()) {
            entry.panel.webview.postMessage({ command: 'liveClear' });
        }
    }

    /** True if a diagram is open for the machine with the given root id/label. */
    public hasPanelForMachineId(machineId: string): boolean {
        for (const entry of this.panels.values()) {
            if (entry.machine.label === machineId) { return true; }
        }
        return false;
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
            const newKey = machineKey(updated);
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

    // Resolve a diagram edge (source state id + rendered event label) back to
    // its transition MachineNode. `eventName` is the rendered Harel label
    // (EVENT [guard] / actions); the transition node's own label is just the
    // event, so match on that prefix.
    private resolveTransitionNode(srcId: string | undefined, eventName: string | undefined, entry: PanelEntry): MachineNode | undefined {
        if (!srcId || !eventName) { return undefined; }
        const state = entry.nodeById.get(srcId);
        if (!state) { return undefined; }
        const event = eventName.split(/\s*[[/]/)[0].trim();
        const transitions = (state.children ?? []).filter(c => c.type === 'transition');
        return transitions.find(t => t.label === eventName)
            ?? transitions.find(t => t.label === event)
            ?? transitions.find(t => (t.label ?? '').trim() === event);
    }

    // Event label clicked → select the matching transition node in the tree.
    private selectEventInTree(srcId: string | undefined, eventName: string, entry: PanelEntry) {
        const match = this.resolveTransitionNode(srcId, eventName, entry);
        if (match) { this.revealInTree?.(match); }
    }

    // Run an edit action against the MachineNode behind a diagram node id.
    private async runNodeEdit(id: string, entry: PanelEntry, edit: (node: MachineNode) => Promise<void>) {
        const node = entry.nodeById.get(id);
        if (node) { await edit(node); }
    }

    // Run an edit action against the transition behind a diagram edge.
    private async runTransitionEdit(srcId: string | undefined, eventName: string | undefined, entry: PanelEntry, edit: (node: MachineNode) => Promise<void>) {
        const node = this.resolveTransitionNode(srcId, eventName, entry);
        if (node) { await edit(node); }
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
        const payload = buildGraphPayload(machine, { resolveInvoke: this.resolveInvoke });
        const mermaid = toMermaid(payload);
        const content = `# ${title}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`;
        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    /**
     * Open a Markdown report of the shortest path to every state (a coverage
     * map), plus copy-paste test skeletons — handy for seeding `@xstate/test`
     * style suites or just documenting how the machine is driven.
     */
    public async generateTestPaths(machine: MachineNode) {
        const content = renderTestPathsMarkdown(machine, this.resolveInvoke);
        const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    private updatePanel(key: string) {
        const entry = this.panels.get(key);
        if (!entry) { return; }
        entry.nodeById.clear();
        const config = vscode.workspace.getConfiguration('xstateOutline');
        const reflectExpansion = config.get<boolean>('graphReflectsTreeExpansion', true);
        const invokedMachines: MachineNode[] = [];
        const payload = buildGraphPayload(entry.machine, {
            reflectExpansion,
            isExpanded: this.reflectsExpansion,
            resolveInvoke: this.resolveInvoke,
            nodeById: entry.nodeById,
            invokedRoots: invokedMachines,
        });
        entry.invokedMachines = invokedMachines;
        if (entry.rendered) {
            // Incremental update — preserve the webview's pan/zoom/selection.
            entry.panel.webview.postMessage({ command: 'setModel', payload, direction: entry.direction });
        } else {
            entry.panel.webview.html = this.getHtmlForWebview(entry.panel.webview, payload, entry.direction, entry.selectName);
            entry.rendered = true;
        }
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


function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return text;
}
