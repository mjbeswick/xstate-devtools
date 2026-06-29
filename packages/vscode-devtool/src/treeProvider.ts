import * as vscode from 'vscode';
import { XStateMachineParser, MachineNode } from '@xstate-devtools/diagram-core';
import { WorkspaceScanner, FileMachines } from '@xstate-devtools/diagram-core';
import { findNodeAtPosition, normalizeTargetName, walkNodes } from '@xstate-devtools/diagram-core';
import { fuzzyMatch } from '@xstate-devtools/diagram-core';

export type ViewScope = 'file' | 'workspace';
export type ViewMode = 'grouped' | 'flat';
export type SortMode = 'original' | 'sorted' | 'type-name';

// Type ordering for the 'type-name' sort: groups children by kind, then name.
// Mirrors the reading order of a statechart (structure first, then implementations).
const SORT_TYPE_ORDER = [
    'machine', 'state', 'on', 'transition', 'target',
    'entry', 'exit', 'action', 'guard', 'invoke', 'actor', 'delay',
    'context', 'contextProperty', 'setup', 'invalid',
];

export interface SearchResultData {
    label: string;
    type: string;
    breadcrumb: string;
    uriStr: string;
    line: number;
    char: number;
    /** Matched character spans [start, end) in `label`, for highlighting. */
    ranges?: [number, number][];
    /** Match quality (higher = better); used to rank fuzzy results. */
    score?: number;
}

export class XStateMachineTreeProvider implements vscode.TreeDataProvider<XStateMachineTreeItem> {
    
    private _onDidChangeTreeData: vscode.EventEmitter<XStateMachineTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<XStateMachineTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<XStateMachineTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private treeView?: vscode.TreeView<XStateMachineTreeItem>;
    private cachedItems: XStateMachineTreeItem[] = [];
    private nodeItemCache = new Map<string, XStateMachineTreeItem>();
    private parentMap = new Map<XStateMachineTreeItem, XStateMachineTreeItem | undefined>();
    // Live set of expanded nodes, keyed by node identity. Tracked independently
    // of nodeItemCache so the graph can reflect expansion even for nodes whose
    // tree items have not been rendered yet.
    private expandedNodeKeys = new Set<string>();
    private currentScope: ViewScope = 'file';
    private viewMode: ViewMode = 'grouped';
    private isLoading: boolean = false;
    private showStateConfigs: boolean = false; // Hidden by default
    // Session-only override: set when follow-cursor lands inside a hidden state
    // config, so the tree can reveal it without mutating the user's persisted
    // preference. Never persisted; resets on reload. See revealHiddenStateConfigs.
    private tempShowStateConfigs: boolean = false;
    private groupEventHandlers: boolean = false; // Group transitions under an `on` node
    private sortChildren: SortMode = 'original'; // Sort child nodes vs. keep source order
    private workspaceScanner: WorkspaceScanner;
    private outputChannel: vscode.OutputChannel;

    constructor(
        private context: vscode.ExtensionContext,
        workspaceScanner: WorkspaceScanner,
        outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel = outputChannel;
        this.workspaceScanner = workspaceScanner;
        XStateMachineTreeItem.iconBase = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons');

        // Load saved preferences from configuration
        const config = vscode.workspace.getConfiguration('xstateOutline');
        this.currentScope = config.get('defaultScope', 'workspace');
        this.viewMode = config.get('defaultViewMode', 'flat');
        this.showStateConfigs = config.get('showStateConfigs', false);
        this.groupEventHandlers = config.get('groupEventHandlers', false);
        this.sortChildren = config.get<SortMode>('sortChildren', 'original');

        // Set initial context for menu checkmarks
        vscode.commands.executeCommand('setContext', 'xstateOutline.scopeIsWorkspace', this.currentScope === 'workspace');
        vscode.commands.executeCommand('setContext', 'xstateOutline.viewModeIsFlat', this.viewMode === 'flat');
        vscode.commands.executeCommand('setContext', 'xstateOutline.showStateConfigs', this.showStateConfigs);
        vscode.commands.executeCommand('setContext', 'xstateOutline.groupEventHandlers', this.groupEventHandlers);
        vscode.commands.executeCommand('setContext', 'xstateOutline.sortChildrenMode', this.sortChildren);
        
        // Trigger initial refresh
        this.refresh();
    }

    setTreeView(treeView: vscode.TreeView<XStateMachineTreeItem>): void {
        this.treeView = treeView;
        
        // Update tree view description based on scope
        this.updateTreeViewDescription();

        // Listen for expand/collapse to update item state
        this.treeView.onDidExpandElement(e => {
            e.element.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            this.expandedNodeKeys.add(this.itemKey(e.element.node));
            const config = vscode.workspace.getConfiguration('xstateOutline');
            if (config.get<boolean>('graphReflectsTreeExpansion', true)) {
                vscode.commands.executeCommand('xstateMachineOutline.refreshGraphOnly');
            }
        });

        this.treeView.onDidCollapseElement(e => {
            e.element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
            this.expandedNodeKeys.delete(this.itemKey(e.element.node));
            const config = vscode.workspace.getConfiguration('xstateOutline');
            if (config.get<boolean>('graphReflectsTreeExpansion', true)) {
                vscode.commands.executeCommand('xstateMachineOutline.refreshGraphOnly');
            }
        });
        
        // If starting in workspace scope, scan AND start watching so the tree
        // auto-refreshes on file changes from the start (not only after a
        // runtime scope toggle).
        if (this.currentScope === 'workspace') {
            this.enterWorkspaceScope();
        } else {
            // Trigger another refresh now that we have the tree view
            this.refresh();
        }
    }

    getScope(): ViewScope {
        return this.currentScope;
    }

    getViewMode(): ViewMode {
        return this.viewMode;
    }

    getShowStateConfigs(): boolean {
        return this.showStateConfigs;
    }

    /** Whether state configs should appear in the tree right now — the persisted
     *  preference OR the session-only follow-cursor override. */
    private get effectiveShowStateConfigs(): boolean {
        return this.showStateConfigs || this.tempShowStateConfigs;
    }

    /** True if `position` falls inside a state-config definition that's currently
     *  hidden from the tree (so follow-cursor can choose to surface it). */
    positionInHiddenStateConfig(position: vscode.Position): boolean {
        if (this.effectiveShowStateConfigs) { return false; }
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return false; }
        const uriStr = editor.document.uri.toString();
        const machines = this.currentScope === 'file'
            ? XStateMachineParser.parseMachines(editor.document)
            : (this.workspaceScanner.getCached().find(f => f.uri.toString() === uriStr)?.machines ?? []);
        return machines.some(m => m.isStateConfig && m.uri.toString() === uriStr && m.range.contains(position));
    }

    /** Surface hidden state configs for this session and rebuild the tree, so a
     *  follow-cursor reveal into one can succeed. No-op if already shown. */
    async revealHiddenStateConfigs(): Promise<void> {
        if (this.effectiveShowStateConfigs) { return; }
        this.tempShowStateConfigs = true;
        // Keep the title-bar toggle coherent: configs are now visible, so offer
        // "Hide" (which clears the override via setStateConfigs).
        vscode.commands.executeCommand('setContext', 'xstateOutline.showStateConfigs', true);
        this.refresh();
        // Repopulate the item cache eagerly so the caller can findItemAtPosition
        // immediately, rather than waiting for VS Code's lazy render.
        await this.getChildren();
    }

    handleDocumentChange(document: vscode.TextDocument): void {
        if (!this.isSupportedDocument(document)) {
            return;
        }

        if (this.currentScope === 'workspace') {
            this.workspaceScanner.updateDocument(document);
        }

        this.refresh();
    }

    // ── Search ────────────────────────────────────────────────────────────────

    /**
     * Search by label text and/or node type. A type filter alone (empty `text`)
     * lists every node of those types, so a filter can be applied before — or
     * without — typing. An empty query with no type filter returns nothing.
     */
    /** The machines to search/count, mirroring exactly what the tree renders:
     *  the active document (live-parsed) in file scope, the scanner cache in
     *  workspace scope, with state configs gated on `effectiveShowStateConfigs`
     *  (so a follow-cursor reveal is searchable too). Keeping search and the
     *  tree on one source stops them diverging — a node shown is a node found. */
    private scopedMachines(): { machines: MachineNode[]; breadcrumb: string }[] {
        const keep = (ms: MachineNode[]) =>
            this.effectiveShowStateConfigs ? ms : ms.filter(m => !m.isStateConfig);
        if (this.currentScope === 'file') {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return []; }
            return [{
                machines: keep(XStateMachineParser.parseMachines(editor.document)),
                breadcrumb: vscode.workspace.asRelativePath(editor.document.uri),
            }];
        }
        return this.workspaceScanner.getCached().map(fm => ({
            machines: keep(fm.machines),
            breadcrumb: fm.relativePath,
        }));
    }

    search(text: string, types: readonly string[] = [], fuzzy = false): SearchResultData[] {
        const filter = text.trim().toLowerCase();
        const typeSet = new Set(types);
        if (!filter && typeSet.size === 0) { return []; }
        const results: SearchResultData[] = [];
        for (const { machines, breadcrumb } of this.scopedMachines()) {
            for (const machine of machines) {
                this.collectSearchMatches(machine, filter, typeSet, fuzzy, breadcrumb, results);
            }
        }
        // Fuzzy results are ranked by match quality, so the best matches lead.
        if (fuzzy && filter) { results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)); }
        return results;
    }

    /** Distinct node types present in the current scope, with counts — drives
     *  the search view's type-filter chips so they can be picked pre-search. */
    typeCounts(): { type: string; count: number }[] {
        const counts = new Map<string, number>();
        const tally = (node: MachineNode) => {
            counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
            node.children?.forEach(tally);
        };
        for (const { machines } of this.scopedMachines()) {
            machines.forEach(tally);
        }
        return [...counts].map(([type, count]) => ({ type, count }));
    }

    private collectSearchMatches(
        node: MachineNode,
        filter: string,
        typeSet: Set<string>,
        fuzzy: boolean,
        breadcrumb: string,
        results: SearchResultData[]
    ): void {
        if (typeSet.size === 0 || typeSet.has(node.type)) {
            const base = {
                label: node.label,
                type: node.type,
                breadcrumb,
                uriStr: node.uri.toString(),
                line: node.range.start.line,
                char: node.range.start.character,
            };
            if (!filter) {
                results.push(base); // type-only (browse): no text to match/highlight
            } else if (fuzzy) {
                const m = fuzzyMatch(filter, node.label);
                if (m) { results.push({ ...base, ranges: m.ranges, score: m.score }); }
            } else {
                const idx = node.label.toLowerCase().indexOf(filter);
                if (idx !== -1) { results.push({ ...base, ranges: [[idx, idx + filter.length]] }); }
            }
        }
        if (node.children) {
            const childBreadcrumb = `${breadcrumb} › ${node.label}`;
            for (const child of node.children) {
                this.collectSearchMatches(child, filter, typeSet, fuzzy, childBreadcrumb, results);
            }
        }
    }

    // ── Target navigation ──────────────────────────────────────────────────────

    /**
     * Resolve a transition `target` node to the location of the state it points to.
     * Returns the defining state's uri/range, or undefined if it can't be resolved.
     */
    /** The machine root whose source range contains the given node, if any. */
    findMachineContaining(node: MachineNode): MachineNode | undefined {
        return this.getAllMachineNodes().find(m =>
            m.uri.toString() === node.uri.toString() && m.range.contains(node.range));
    }

    /** The deepest state/machine whose range contains `node` (its enclosing state). */
    findEnclosingState(node: MachineNode): MachineNode | undefined {
        const machine = this.findMachineContaining(node);
        if (!machine) { return undefined; }
        let best: MachineNode | undefined;
        walkNodes(machine, n => {
            if ((n.type === 'state' || n.type === 'machine') && n !== node
                && n.uri.toString() === node.uri.toString() && n.range.contains(node.range)
                && (!best || best.range.contains(n.range))) {
                best = n;  // prefer the smallest (deepest) containing state
            }
        });
        return best;
    }

    /** The transition whose range contains `node` (the event it travels on). */
    findEnclosingTransition(node: MachineNode): MachineNode | undefined {
        const machine = this.findMachineContaining(node);
        if (!machine) { return undefined; }
        let best: MachineNode | undefined;
        walkNodes(machine, n => {
            if (n.type === 'transition' && n.uri.toString() === node.uri.toString()
                && n.range.contains(node.range) && (!best || best.range.contains(n.range))) {
                best = n;
            }
        });
        return best;
    }

    /** Stable identity of the machine containing a node (scopes transition refs). */
    machineKeyOf(node: MachineNode): string {
        const m = this.findMachineContaining(node);
        return m ? `${m.uri.fsPath}::${m.range.start.line}::${m.label}` : '';
    }

    resolveTargetLocation(targetNode: MachineNode): { uri: vscode.Uri; range: vscode.Range } | undefined {
        const name = normalizeTargetName(targetNode.label);
        if (!name) { return undefined; }

        const roots = this.getAllMachineNodes();

        // Prefer the machine in the same file that contains the transition.
        const containing = roots.find(m =>
            m.uri.toString() === targetNode.uri.toString() &&
            m.range.contains(targetNode.range));
        const searchOrder = containing
            ? [containing, ...roots.filter(r => r !== containing)]
            : roots;

        for (const root of searchOrder) {
            const match = this.findStateByName(root, name);
            if (match) { return { uri: match.uri, range: match.range }; }
        }
        return undefined;
    }



    /**
     * Resolve a bare state name (e.g. a transition `target` string under the
     * editor cursor) to the location of the state that defines it. Searches the
     * machine in `document` that contains `position` first, then the rest of the
     * document, then other known files. Returns undefined if no such state
     * exists. Used as the state-target fallback for Go to Implementation /
     * Definition, which otherwise only resolve actions/guards/services.
     */
    resolveStateLocationByName(
        name: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): { uri: vscode.Uri; range: vscode.Range } | undefined {
        const normalized = normalizeTargetName(name);
        if (!normalized) { return undefined; }
        const docMachines = XStateMachineParser.parseMachines(document);
        const containing = docMachines.find(m => m.range.contains(position));
        const others = this.workspaceScanner.getCached()
            .flatMap(fm => fm.machines)
            .filter(m => m.uri.toString() !== document.uri.toString());
        const searchOrder = [
            ...(containing ? [containing] : []),
            ...docMachines.filter(m => m !== containing),
            ...others,
        ];
        for (const root of searchOrder) {
            const match = this.findStateByName(root, normalized);
            if (match) { return { uri: match.uri, range: match.range }; }
        }
        return undefined;
    }

    /** Depth-first search for a `state` node with the given name, ignoring non-state branches. */
    private findStateByName(node: MachineNode, name: string): MachineNode | undefined {
        if (node.type === 'state' && node.label === name) { return node; }
        if (node.children) {
            for (const child of node.children) {
                if (child.type !== 'machine' && child.type !== 'state') { continue; }
                const found = this.findStateByName(child, name);
                if (found) { return found; }
            }
        }
        return undefined;
    }

    private getAllMachineNodes(): MachineNode[] {
        if (this.currentScope === 'workspace') {
            return this.workspaceScanner.getCached().flatMap(fm => fm.machines);
        }
        const editor = vscode.window.activeTextEditor;
        return editor ? XStateMachineParser.parseMachines(editor.document) : [];
    }

    // ── Tree filter (used by title-bar filter button) ─────────────────────────

    private filterText: string = '';

    setFilter(text: string): void {
        this.filterText = text.trim();
        vscode.commands.executeCommand('setContext', 'xstateOutline.hasFilter', this.filterText.length > 0);
        this.refresh();
        if (this.filterText) {
            // After tree refreshes and getChildren() populates the cache, reveal all direct matches
            setTimeout(() => this.revealFilterMatches(), 150);
        }
    }

    private revealFilterMatches(): void {
        if (!this.treeView || !this.filterText) { return; }
        const filter = this.filterText.toLowerCase();
        for (const item of this.nodeItemCache.values()) {
            if (item.node.label.toLowerCase().includes(filter)) {
                this.treeView.reveal(item, { select: false, focus: false, expand: true });
            }
        }
    }

    clearFilter(): void {
        this.filterText = '';
        vscode.commands.executeCommand('setContext', 'xstateOutline.hasFilter', false);
        this.refresh();
    }

    getFilterText(): string {
        return this.filterText;
    }

    private nodeMatchesFilter(node: MachineNode): boolean {
        if (!this.filterText) { return true; }
        const filter = this.filterText.toLowerCase();
        if (node.label.toLowerCase().includes(filter)) { return true; }
        if (node.children) {
            return node.children.some(c => this.nodeMatchesFilter(c));
        }
        return false;
    }

    private filterNodes(nodes: MachineNode[]): MachineNode[] {
        if (!this.filterText) { return nodes; }
        return nodes.filter(n => this.nodeMatchesFilter(n));
    }

    setScope(scope: 'file' | 'workspace'): void {
        this.currentScope = scope;
        const config = vscode.workspace.getConfiguration('xstateOutline');
        config.update('defaultScope', scope, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.scopeIsWorkspace', scope === 'workspace');
        this.updateTreeViewDescription();
        
        // If switching to workspace scope, trigger scan
        if (scope === 'workspace') {
            this.scanWorkspaceAndRefresh();
        } else {
            this.refresh();
        }
    }

    setViewMode(mode: 'grouped' | 'flat'): void {
        this.viewMode = mode;
        const config = vscode.workspace.getConfiguration('xstateOutline');
        config.update('defaultViewMode', mode, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.viewModeIsFlat', mode === 'flat');
        this.updateTreeViewDescription();
        this.refresh();
    }

    setStateConfigs(show: boolean): void {
        this.showStateConfigs = show;
        // An explicit hide must win over a prior follow-cursor auto-reveal.
        this.tempShowStateConfigs = false;
        const config = vscode.workspace.getConfiguration('xstateOutline');
        config.update('showStateConfigs', show, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.showStateConfigs', show);
        this.updateTreeViewDescription();
        this.refresh();
    }

    setGroupEventHandlers(group: boolean): void {
        this.groupEventHandlers = group;
        const config = vscode.workspace.getConfiguration('xstateOutline');
        config.update('groupEventHandlers', group, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.groupEventHandlers', group);
        this.refresh();
    }

    setSortChildren(mode: SortMode): void {
        this.sortChildren = mode;
        const config = vscode.workspace.getConfiguration('xstateOutline');
        config.update('sortChildren', mode, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.sortChildrenMode', mode);
        this.refresh();
    }

    /**
     * Transform a node's raw children for display: optionally group event-handler
     * transitions under a synthetic `on` node, then optionally sort alphabetically.
     * Pure with respect to the parser's `MachineNode` tree — the underlying data
     * (used by search, graph, and target resolution) is left untouched.
     */
    private displayChildren(node: MachineNode): MachineNode[] {
        let children = node.children ?? [];

        // Only group the `on: {}` handlers of states/machines — not the onDone/onError
        // transitions that live under an invoke, nor the transitions inside an `on` node.
        if (this.groupEventHandlers && (node.type === 'state' || node.type === 'machine')) {
            children = this.groupTransitions(children);
        }

        if (this.sortChildren === 'sorted') {
            children = [...children].sort((a, b) => a.label.localeCompare(b.label));
        } else if (this.sortChildren === 'type-name') {
            children = [...children].sort((a, b) =>
                (SORT_TYPE_ORDER.indexOf(a.type) - SORT_TYPE_ORDER.indexOf(b.type))
                || a.label.localeCompare(b.label));
        }

        return children;
    }

    /** Replace the run of `transition` children with a single `on` node containing them. */
    private groupTransitions(children: MachineNode[]): MachineNode[] {
        const transitions = children.filter(c => c.type === 'transition');
        if (transitions.length === 0) { return children; }

        const onNode: MachineNode = {
            type: 'on',
            label: 'on',
            range: new vscode.Range(
                transitions[0].range.start,
                transitions[transitions.length - 1].range.end
            ),
            uri: transitions[0].uri,
            children: transitions,
        };

        const result: MachineNode[] = [];
        let inserted = false;
        for (const c of children) {
            if (c.type === 'transition') {
                if (!inserted) { result.push(onNode); inserted = true; }
            } else {
                result.push(c);
            }
        }
        return result;
    }

    toggleViewMode(): void {
        this.viewMode = this.viewMode === 'grouped' ? 'flat' : 'grouped';
        
        // Persist to configuration
        const config = vscode.workspace.getConfiguration('xstateOutline');
        config.update('defaultViewMode', this.viewMode, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.viewModeIsFlat', this.viewMode === 'flat');
        
        this.updateTreeViewDescription();
        this.refresh();
    }

    toggleStateConfigs(): void {
        this.showStateConfigs = !this.showStateConfigs;
        
        // Persist to configuration
        const config = vscode.workspace.getConfiguration('xstateOutline');
        config.update('showStateConfigs', this.showStateConfigs, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.showStateConfigs', this.showStateConfigs);
        
        this.updateTreeViewDescription();
        this.refresh();
    }

    async toggleScope(): Promise<void> {
        this.currentScope = this.currentScope === 'file' ? 'workspace' : 'file';
        
        // Persist to configuration
        const config = vscode.workspace.getConfiguration('xstateOutline');
        await config.update('defaultScope', this.currentScope, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.scopeIsWorkspace', this.currentScope === 'workspace');
        
        // Update UI
        this.updateTreeViewDescription();

        if (this.currentScope === 'workspace') {
            await this.enterWorkspaceScope();
        } else {
            // File mode - stop watching; the tree live-parses the active doc.
            this.workspaceScanner.stopWatching();
            this.refresh();
        }
    }

    /** Start watching the workspace and ensure it's scanned. Shared by initial
     *  activation (`setTreeView`) and the runtime scope toggle, so the file
     *  watcher runs from startup — not only after a manual file→workspace
     *  toggle — and external edits/new files auto-refresh the tree. */
    private async enterWorkspaceScope(): Promise<void> {
        this.workspaceScanner.startWatching(() => this.refresh());

        if (this.workspaceScanner.getCached().length === 0) {
            this.isLoading = true;
            this.refresh();
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: "Scanning workspace for XState machines..."
            }, async () => {
                await this.workspaceScanner.scanWorkspace();
            });
            this.isLoading = false;
        }
        this.refresh();
    }

    private updateTreeViewDescription(): void {
        if (!this.treeView) return;
        const filterSuffix = this.filterText ? `Filter: "${this.filterText}"` : '';
        this.treeView.description = filterSuffix || '';
    }

    private async scanWorkspaceAndRefresh(): Promise<void> {
        this.isLoading = true;
        this.refresh();
        
        try {
            await this.workspaceScanner.scanWorkspace();
        } finally {
            this.isLoading = false;
            this.refresh();
        }
    }

    public getTreeItemForNode(node: MachineNode): XStateMachineTreeItem | undefined {
        return this.nodeItemCache.get(this.itemKey(node));
    }

    /**
     * Whether the given node is currently expanded in the tree. Backed by a
     * live key set, so it is accurate even for nodes whose tree items have not
     * been rendered (i.e. their parent is collapsed) — those report false.
     */
    public isNodeExpanded(node: MachineNode): boolean {
        return this.expandedNodeKeys.has(this.itemKey(node));
    }

    private itemKey(node: MachineNode): string {
        return `${node.uri.toString()}:${node.type}:${node.range.start.line}:${node.range.start.character}`;
    }

    private getOrCreateItem(
        node: MachineNode,
        parent: XStateMachineTreeItem | undefined,
        machines?: XStateMachineTreeItem[],
        fileUri?: vscode.Uri
    ): XStateMachineTreeItem {
        const key = this.itemKey(node);
        let item = this.nodeItemCache.get(key);
        if (!item) {
            item = new XStateMachineTreeItem(node, machines, fileUri);
            this.nodeItemCache.set(key, item);
        }
        this.parentMap.set(item, parent);

        // When a filter is active, expand any node that has matching descendants
        if (this.filterText && item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
            const hasMatchingChild = node.children?.some(c => this.nodeMatchesFilter(c))
                || machines?.some(m => this.nodeMatchesFilter(m.node));
            if (hasMatchingChild) {
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            }
        }

        return item;
    }

    private preBuildItemCache(nodes: MachineNode[], parent: XStateMachineTreeItem | undefined): void {
        for (const node of nodes) {
            const item = this.getOrCreateItem(node, parent);
            const children = this.displayChildren(node);
            if (children.length > 0) {
                this.preBuildItemCache(children, item);
            }
        }
    }

    getParent(element: XStateMachineTreeItem): vscode.ProviderResult<XStateMachineTreeItem> {
        return this.parentMap.get(element);
    }

    refresh(): void {
        this.nodeItemCache.clear();
        this.parentMap.clear();
        this._onDidChangeTreeData.fire();
        this.updateTreeViewDescription();
    }

    /** User-facing manual refresh (the title-bar button). In workspace scope
     *  this re-scans the workspace from disk — a real recovery after bulk or
     *  external changes the watcher may have missed — not just a re-render of
     *  the cache. File scope already live-parses on every render, so a plain
     *  refresh suffices there. */
    rescan(): void {
        if (this.currentScope === 'workspace') {
            void this.scanWorkspaceAndRefresh();
        } else {
            this.refresh();
        }
    }

    private isSupportedDocument(document: vscode.TextDocument): boolean {
        return ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'].includes(document.languageId);
    }

    /** Collapse a single expanded item in place (re-renders just that node). */
    collapseItem(item: XStateMachineTreeItem): void {
        if (item.collapsibleState === vscode.TreeItemCollapsibleState.None) { return; }
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        this._onDidChangeTreeData.fire(item);
    }

    getTreeItem(element: XStateMachineTreeItem): vscode.TreeItem {
        return element;
    }

    // Drives the contributed `viewsWelcome` content (buttons) via a context key.
    // Empty: '' (have items / loading). Otherwise one of the reason strings below.
    private setEmptyReason(reason: '' | 'noEditor' | 'noMachinesInFile' | 'stateConfigsHidden' | 'noMachinesInWorkspace'): void {
        if (this.treeView) {
            // Welcome content carries the explanatory text + buttons for empty
            // cases; keep `message` only for the live filter indicator.
            this.treeView.message = reason === '' && this.filterText ? `Filter: "${this.filterText}"` : undefined;
        }
        vscode.commands.executeCommand('setContext', 'xstateOutline.emptyReason', reason);
    }

    async getChildren(element?: XStateMachineTreeItem): Promise<XStateMachineTreeItem[]> {
        if (!element) {
            // Root level
            if (this.isLoading) {
                // Show loading message
                if (this.treeView) {
                    this.treeView.message = 'Scanning workspace...';
                }
                vscode.commands.executeCommand('setContext', 'xstateOutline.emptyReason', '');
                return [];
            }

            if (this.currentScope === 'file') {
                // File scope - show machines from current file
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    this.setEmptyReason('noEditor');
                    return [];
                }

                // Always re-parse to get latest changes
                const machines = XStateMachineParser.parseMachines(editor.document);
                if (machines.length === 0) {
                    this.setEmptyReason('noMachinesInFile');
                    return [];
                }

                const items = machines
                    .filter((m: MachineNode) => this.effectiveShowStateConfigs || !m.isStateConfig)
                    .filter((m: MachineNode) => this.nodeMatchesFilter(m))
                    .map((m: MachineNode) => {
                        const item = this.getOrCreateItem(m, undefined);
                        this.preBuildItemCache(this.displayChildren(m), item);
                        return item;
                    });

                if (items.length === 0 && !this.effectiveShowStateConfigs) {
                    this.setEmptyReason('stateConfigsHidden');
                    return [];
                }

                this.setEmptyReason('');
                return items;
            } else {
                // Workspace scope
                const fileMachines = this.workspaceScanner.getCached();

                if (fileMachines.length === 0) {
                    this.setEmptyReason('noMachinesInWorkspace');
                    return [];
                }

                this.setEmptyReason('');
                return this.formatRootItems(fileMachines);
            }
        } else if (element.type === 'file') {
            // File node - return filtered machines
            const machines = element.machines || [];
            return this.filterText
                ? machines.filter(m => this.nodeMatchesFilter(m.node))
                : machines;
        } else if (element.type === 'loading') {
            // Loading item has no children
            return [];
        } else {
            // Return children of the current node, filtered if needed
            if (element.node.children) {
                return this.filterNodes(this.displayChildren(element.node))
                    .map(c => this.getOrCreateItem(c, element));
            }
            return [];
        }
    }

    private formatRootItems(fileMachines: FileMachines[]): XStateMachineTreeItem[] {
        // Filter out state configs and apply text filter
        const filteredFileMachines = fileMachines.map(fm => ({
            ...fm,
            machines: (this.effectiveShowStateConfigs ? fm.machines : fm.machines.filter(m => !m.isStateConfig))
                .filter(m => this.nodeMatchesFilter(m))
        })).filter(fm => fm.machines.length > 0);

        if (this.viewMode === 'flat') {
            const allMachines: XStateMachineTreeItem[] = [];
            const seenKeys = new Set<string>();
            for (const fm of filteredFileMachines) {
                for (const m of fm.machines) {
                    const key = this.itemKey(m);
                    // Skip duplicates (same uri, type, range)
                    if (seenKeys.has(key)) {
                        continue;
                    }
                    seenKeys.add(key);
                    
                    const item = this.getOrCreateItem(m, undefined);
                    if (m.description) {
                        const md = new vscode.MarkdownString();
                        md.appendMarkdown(`**${m.label}**\n\n`);
                        md.appendText(`${m.description}\n\n`);
                        md.appendMarkdown(`_${fm.relativePath}_`);
                        item.tooltip = md;
                    } else {
                        item.tooltip = `${m.label}\n${fm.relativePath}`;
                    }
                    this.preBuildItemCache(this.displayChildren(m), item);
                    allMachines.push(item);
                }
            }
            allMachines.sort((a, b) => a.node.label.localeCompare(b.node.label));
            this.cachedItems = allMachines;
            return allMachines;
        } else {
            const fileItems: XStateMachineTreeItem[] = filteredFileMachines.map(fm => {
                const machineItems = fm.machines
                    .map(m => {
                        const item = this.getOrCreateItem(m, undefined);
                        this.preBuildItemCache(this.displayChildren(m), item);
                        return item;
                    })
                    .sort((a, b) => a.node.label.localeCompare(b.node.label));

                const fileNode: MachineNode = {
                    type: 'machine',
                    label: fm.relativePath,
                    range: new vscode.Range(0, 0, 0, 0),
                    uri: fm.uri
                };
                const fileItem = this.getOrCreateItem(fileNode, undefined, machineItems, fm.uri);
                for (const mi of machineItems) { this.parentMap.set(mi, fileItem); }
                return fileItem;
            });

            fileItems.sort((a, b) => a.node.label.localeCompare(b.node.label));
            this.cachedItems = fileItems;
            return fileItems;
        }
    }

    /** Expand an item if it has descendants matching the filter but doesn't directly match itself. */

    /**
     * Find the tree item that contains the given position
     */
    findItemAtPosition(position: vscode.Position): XStateMachineTreeItem | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return undefined;
        }

        const uriStr = editor.document.uri.toString();
        let best: XStateMachineTreeItem | undefined;

        for (const item of this.nodeItemCache.values()) {
            if (!item.uri || !item.range) { continue; }
            if (item.uri.toString() !== uriStr) { continue; }
            if (!item.range.contains(position)) { continue; }

            // Prefer the most specific (smallest / deepest) containing range
            if (!best || !best.range ||
                (item.range.start.isAfterOrEqual(best.range.start) &&
                 item.range.end.isBeforeOrEqual(best.range.end))) {
                best = item;
            }
        }

        return best;
    }
}

export class XStateMachineTreeItem extends vscode.TreeItem {

    public readonly type: 'machine' | 'file' | 'loading';
    public readonly machines?: XStateMachineTreeItem[];
    // Base folder for the bundled custom Harel-shape state icons (resources/icons).
    // Set once during activation; when present, state nodes use these SVGs.
    public static iconBase?: vscode.Uri;

    constructor(
        public readonly node: MachineNode,
        machines?: XStateMachineTreeItem[],
        fileUri?: vscode.Uri
    ) {
        super(
            node.label,
            machines && machines.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : node.children && node.children.length > 0 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.None
        );

        // Determine if this is a file node, loading node, or machine node
        if (node.label === 'Loading...') {
            this.type = 'loading';
        } else if (machines) {
            this.type = 'file';
        } else {
            this.type = 'machine';
        }
        this.machines = machines;

        if (this.type === 'loading') {
            // Loading node
            this.tooltip = 'Scanning workspace for XState machines...';
            this.iconPath = new vscode.ThemeIcon('loading~spin');
            this.contextValue = 'loading';
            this.command = undefined;
        } else if (this.type === 'file') {
            // File node
            this.tooltip = `${node.label} (${machines?.length || 0} machines)`;
            this.description = `${machines?.length || 0} machine${machines?.length === 1 ? '' : 's'}`;
            this.iconPath = new vscode.ThemeIcon('file-code');
            this.contextValue = 'file';
            
            // No command for file nodes - they just expand
            this.command = undefined;
            this.resourceUri = fileUri;
        } else {
            // Machine/state/action node
            
            // Check if there are diagnostics for this node's range
            const diagnostics = vscode.languages.getDiagnostics(node.uri);
            const nodeDiagnostics = diagnostics.filter(d => d.range.intersection(node.range));
            
            let hasError = false;
            let hasWarning = false;
            
            if (nodeDiagnostics.length > 0) {
                hasError = nodeDiagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Error);
                hasWarning = nodeDiagnostics.some(d => d.severity === vscode.DiagnosticSeverity.Warning);
            }

            this.tooltip = this.buildTooltip(nodeDiagnostics);
            this.description = this.getDescription();
            // State nodes use the bundled custom Harel-shape icons (per-theme
            // grey variants); everything else (and any node with a diagnostic,
            // so the error/warning tint still shows) falls back to themed codicons.
            const base = XStateMachineTreeItem.iconBase;
            const stateIcon = base && !hasError && !hasWarning
                ? (this.stateIconFile() ?? this.guardIconFile())
                : undefined;
            this.iconPath = stateIcon && base
                ? {
                    light: vscode.Uri.joinPath(base, 'light', stateIcon),
                    dark: vscode.Uri.joinPath(base, 'dark', stateIcon),
                }
                : this.getIcon(hasError, hasWarning);
            
            // Store range and uri for navigation
            this.range = node.range;
            this.uri = node.uri;

            // All nodes navigate to their source position on click.
            // "Go to Implementation" is available via context menu / inline button
            // for action/guard/entry/exit/invoke nodes.
            this.command = {
                command: 'xstateMachineOutline.navigateToNode',
                title: 'Go to source',
                arguments: [this]
            };

            this.contextValue = node.type;
        }
    }

    range?: vscode.Range;
    uri?: vscode.Uri;

    private getDescription(): string | undefined {
        // Dimmed text markers carry state-kind meaning on a non-color channel,
        // so initial/final/parallel/history stay legible without relying on icon
        // color (which fails colorblind users and at-a-glance scanning).
        const node = this.node;
        if (node.isTypeMarker) { return undefined; }
        const markers: string[] = [];
        if (node.historyType) { markers.push(`${node.historyType} history`); }
        if (node.isParallel) { markers.push('parallel'); }
        if (node.isInitial) { markers.push('initial'); }
        if (node.isFinal) { markers.push('final'); }
        // Anonymous action/guard: `inline` as a dimmed qualifier, mirroring the
        // way parallel/initial/final read on state nodes.
        if (node.isInline) { markers.push('inline'); }
        // Guard combinator group: the and/or/not word as a dimmed qualifier (the
        // badge icon carries it too, like parallel's icon + marker).
        if (node.guardCombinator) { markers.push(node.guardCombinator); }
        return markers.length > 0 ? markers.join(' · ') : undefined;
    }

    private buildTooltip(diagnostics?: vscode.Diagnostic[]): string | vscode.MarkdownString {
        const node = this.node;
        if (node.type === 'invalid') {
            return `Invalid XState property: ${node.label.replace(/^invalid:\s*/, '')}`;
        }
        if (node.type === 'on') {
            const count = node.children?.length ?? 0;
            return `Event handlers (${count} ${count === 1 ? 'event' : 'events'})`;
        }
        if (node.description) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${node.label}**\n\n`);
            md.appendText(node.description);
            return md;
        }
        // Human-readable type name; drop the label when it just repeats the type
        // (e.g. "context: context", "setup: setup"). Append state-kind markers.
        const typeName = XStateMachineTreeItem.TYPE_NAMES[node.type] ?? node.type;
        const markers = this.getDescription();
        const base = node.label === node.type || node.label === typeName
            ? typeName
            : `${typeName}: ${node.label}`;
        return markers ? `${base} · ${markers}` : base;
    }

    private static readonly TYPE_NAMES: Record<string, string> = {
        machine: 'Machine', state: 'State', transition: 'Transition', target: 'Target',
        action: 'Action', guard: 'Guard', entry: 'Entry action', exit: 'Exit action',
        invoke: 'Invoke', context: 'Context', contextProperty: 'Context property',
        actor: 'Actor', delay: 'Delay', setup: 'Setup', on: 'Events'
    };

    // Custom Harel-shape icon file for a state node, or undefined for non-states
    // and synthetic `type:` markers (which keep their codicon). Priority mirrors
    // getIcon: history → parallel → initial → final → plain.
    private stateIconFile(): string | undefined {
        const n = this.node;
        if (n.type !== 'state' || n.isTypeMarker) { return undefined; }
        if (n.historyType) { return 'state-history.svg'; }
        if (n.isParallel)  { return 'state-parallel.svg'; }
        if (n.isInitial)   { return 'state-initial.svg'; }
        if (n.isFinal)     { return 'state-final.svg'; }
        return 'state.svg';
    }

    // Bundled square-badge icons for `and`/`or`/`not` guard combinator groups
    // (resources/icons); leaf guards keep the themed `shield` codicon.
    private guardIconFile(): string | undefined {
        const c = this.node.guardCombinator;
        return c ? `guard-${c}.svg` : undefined;
    }

    private getIcon(hasError = false, hasWarning = false): vscode.ThemeIcon {
        let iconName = '';
        let iconColor: vscode.ThemeColor | undefined;

        switch (this.node.type) {
            case 'machine':
                iconName = 'package';
                iconColor = new vscode.ThemeColor('charts.blue');
                break;
            case 'state':
                if (this.node.historyType) {
                    iconName = 'history';
                    iconColor = new vscode.ThemeColor('charts.purple');
                } else if (this.node.isParallel) {
                    // Hollow blue circle marks an orthogonal (parallel) state —
                    // no redundant child marker needed.
                    iconName = 'circle-outline';
                    iconColor = new vscode.ThemeColor('charts.blue');
                } else if (this.node.isInitial) {
                    iconName = 'circle-filled';
                    iconColor = new vscode.ThemeColor('charts.green');
                } else if (this.node.isFinal) {
                    // Shape-distinct from initial (a plain filled circle) so the two
                    // are tellable apart by shape, not colour — final uses the
                    // neutral foreground (a red ring reads as an error).
                    iconName = 'pass-filled';
                    iconColor = new vscode.ThemeColor('foreground');
                } else {
                    iconName = 'circle-filled';
                    iconColor = new vscode.ThemeColor('symbolIcon.fieldForeground');
                }
                break;
            case 'on':
                iconName = 'inbox';
                iconColor = new vscode.ThemeColor('charts.orange');
                break;
            case 'transition':
                if (this.node.label === 'onDone' || this.node.label === 'onError') {
                    iconName = 'circle-filled';
                    iconColor = new vscode.ThemeColor('charts.orange');
                } else if (this.node.label === 'always') {
                    // Eventless transition — fires automatically, not on an event.
                    iconName = 'zap';
                    iconColor = new vscode.ThemeColor('charts.orange');
                } else if (this.node.label.startsWith('after ')) {
                    // Delayed (after) transition — fires automatically after a timeout.
                    iconName = 'clock';
                    iconColor = new vscode.ThemeColor('charts.orange');
                } else {
                    iconName = 'symbol-event';
                    iconColor = new vscode.ThemeColor('charts.orange');
                }
                break;
            case 'action':
                iconName = 'rocket';
                iconColor = new vscode.ThemeColor('symbolIcon.methodForeground');
                break;
            case 'entry':
                iconName = 'debug-step-into';
                iconColor = new vscode.ThemeColor('symbolIcon.methodForeground');
                break;
            case 'exit':
                iconName = 'debug-step-out';
                iconColor = new vscode.ThemeColor('symbolIcon.methodForeground');
                break;
            case 'guard':
                iconName = 'shield';
                iconColor = new vscode.ThemeColor('terminal.ansiCyan');
                break;
            case 'target':
                iconName = 'target';
                iconColor = new vscode.ThemeColor('terminal.ansiBrightMagenta');
                break;
            case 'invoke':
                iconName = 'circuit-board';
                iconColor = new vscode.ThemeColor('charts.yellow');
                break;
            case 'context':
                iconName = 'symbol-variable';
                iconColor = new vscode.ThemeColor('symbolIcon.variableForeground');
                break;
            case 'contextProperty':
                iconName = 'symbol-property';
                iconColor = new vscode.ThemeColor('symbolIcon.propertyForeground');
                break;
            case 'actor':
                iconName = 'account';
                iconColor = new vscode.ThemeColor('charts.yellow');
                break;
            case 'delay':
                iconName = 'history';
                iconColor = new vscode.ThemeColor('terminal.ansiYellow');
                break;
            case 'setup':
                iconName = 'settings-gear';
                iconColor = new vscode.ThemeColor('terminal.ansiBlue');
                break;
            case 'invalid':
                iconName = 'error';
                iconColor = new vscode.ThemeColor('terminal.ansiRed');
                break;
            default:
                iconName = 'symbol-misc';
                break;
        }

        if (hasError) {
            iconColor = new vscode.ThemeColor('testing.iconFailed');
        } else if (hasWarning) {
            iconColor = new vscode.ThemeColor('testing.iconQueued'); // Queued maps to orange/yellow warning color in default themes
        }

        return new vscode.ThemeIcon(iconName, iconColor);
    }
}
