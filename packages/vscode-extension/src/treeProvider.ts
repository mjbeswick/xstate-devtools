import * as vscode from 'vscode';
import { XStateMachineParser, MachineNode } from './parser';
import { WorkspaceScanner, FileMachines } from './workspaceScanner';
import { findNodeAtPosition, normalizeTargetName, walkNodes } from './utils';

export type ViewScope = 'file' | 'workspace';
export type ViewMode = 'grouped' | 'flat';
export type SortMode = 'original' | 'sorted';

export interface SearchResultData {
    label: string;
    type: string;
    breadcrumb: string;
    uriStr: string;
    line: number;
    char: number;
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
        vscode.commands.executeCommand('setContext', 'xstateOutline.sortChildrenIsSorted', this.sortChildren === 'sorted');
        
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
        
        // If starting in workspace scope, trigger initial scan
        if (this.currentScope === 'workspace') {
            this.scanWorkspaceAndRefresh();
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

    search(text: string): SearchResultData[] {
        const filter = text.trim().toLowerCase();
        if (!filter) { return []; }
        const results: SearchResultData[] = [];
        for (const fm of this.workspaceScanner.getCached()) {
            const machines = this.showStateConfigs
                ? fm.machines
                : fm.machines.filter(m => !m.isStateConfig);
            for (const machine of machines) {
                this.collectSearchMatches(machine, filter, fm.relativePath, results);
            }
        }
        return results;
    }

    private collectSearchMatches(
        node: MachineNode,
        filter: string,
        breadcrumb: string,
        results: SearchResultData[]
    ): void {
        if (node.label.toLowerCase().includes(filter)) {
            results.push({
                label: node.label,
                type: node.type,
                breadcrumb,
                uriStr: node.uri.toString(),
                line: node.range.start.line,
                char: node.range.start.character,
            });
        }
        if (node.children) {
            const childBreadcrumb = `${breadcrumb} › ${node.label}`;
            for (const child of node.children) {
                this.collectSearchMatches(child, filter, childBreadcrumb, results);
            }
        }
    }

    // ── Target navigation ──────────────────────────────────────────────────────

    /**
     * Resolve a transition `target` node to the location of the state it points to.
     * Returns the defining state's uri/range, or undefined if it can't be resolved.
     */
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
        vscode.commands.executeCommand('setContext', 'xstateOutline.sortChildrenIsSorted', mode === 'sorted');
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
        
        // If switching to workspace mode, start scanning
        if (this.currentScope === 'workspace') {
            this.workspaceScanner.startWatching(() => this.refresh());
            
            // Scan if not already cached
            const cached = this.workspaceScanner.getCached();
            if (cached.length === 0) {
                // Show loading state
                this.isLoading = true;
                this.refresh();

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Window,
                    title: "Scanning workspace for XState machines..."
                }, async () => {
                    await this.workspaceScanner.scanWorkspace();
                });

                this.isLoading = false;
                this.refresh();
            } else {
                this.refresh();
            }
        } else {
            // File mode - stop watching
            this.workspaceScanner.stopWatching();
            this.refresh();
        }
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
                    .filter((m: MachineNode) => this.showStateConfigs || !m.isStateConfig)
                    .filter((m: MachineNode) => this.nodeMatchesFilter(m))
                    .map((m: MachineNode) => {
                        const item = this.getOrCreateItem(m, undefined);
                        this.preBuildItemCache(this.displayChildren(m), item);
                        return item;
                    });

                if (items.length === 0 && !this.showStateConfigs) {
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
            machines: (this.showStateConfigs ? fm.machines : fm.machines.filter(m => !m.isStateConfig))
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
            // State nodes use the bundled custom Harel-shape icons; everything
            // else (and any node with a diagnostic, so the error/warning tint
            // still shows) falls back to themed codicons.
            const stateIcon = XStateMachineTreeItem.iconBase && !hasError && !hasWarning
                ? this.stateIconFile()
                : undefined;
            this.iconPath = stateIcon
                ? vscode.Uri.joinPath(XStateMachineTreeItem.iconBase!, stateIcon)
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
                    // are tellable apart without relying on green-vs-red color.
                    iconName = 'pass-filled';
                    iconColor = new vscode.ThemeColor('charts.red');
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
                iconName = 'play-circle';
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
