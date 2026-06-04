import * as vscode from 'vscode';
import { XStateMachineParser, MachineNode } from './parser';
import { WorkspaceScanner, FileMachines } from './workspaceScanner';

export type ViewScope = 'file' | 'workspace';
export type ViewMode = 'grouped' | 'flat';

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
    private currentScope: ViewScope = 'file';
    private viewMode: ViewMode = 'grouped';
    private isLoading: boolean = false;
    private showStateConfigs: boolean = false; // Hidden by default
    private workspaceScanner: WorkspaceScanner;
    private outputChannel: vscode.OutputChannel;

    constructor(private context: vscode.ExtensionContext) {
        this.outputChannel = vscode.window.createOutputChannel('XState Outline');
        this.workspaceScanner = new WorkspaceScanner(this.outputChannel);
        
        // Load saved preferences from configuration
        const config = vscode.workspace.getConfiguration('xstateOutline');
        this.currentScope = config.get('defaultScope', 'workspace');
        this.viewMode = config.get('defaultViewMode', 'flat');
        this.showStateConfigs = config.get('showStateConfigs', false);
        
        // Set initial context for menu checkmarks
        vscode.commands.executeCommand('setContext', 'xstateOutline.scopeIsWorkspace', this.currentScope === 'workspace');
        vscode.commands.executeCommand('setContext', 'xstateOutline.viewModeIsFlat', this.viewMode === 'flat');
        vscode.commands.executeCommand('setContext', 'xstateOutline.showStateConfigs', this.showStateConfigs);
        
        // Trigger initial refresh
        this.refresh();
    }

    setTreeView(treeView: vscode.TreeView<XStateMachineTreeItem>): void {
        this.treeView = treeView;
        
        // Update tree view description based on scope
        this.updateTreeViewDescription();
        
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
        const name = this.normalizeTargetName(targetNode.label);
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

    /** Strip XState target sigils (`#id`, leading `.`) and return the leaf state name. */
    private normalizeTargetName(raw: string): string {
        const segments = raw.replace(/^#/, '').split('.').filter(Boolean);
        return segments.length ? segments[segments.length - 1] : '';
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
            if (node.children) {
                this.preBuildItemCache(node.children, item);
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

    /** Collapse a single expanded item in place (re-renders just that node). */
    collapseItem(item: XStateMachineTreeItem): void {
        if (item.collapsibleState === vscode.TreeItemCollapsibleState.None) { return; }
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        this._onDidChangeTreeData.fire(item);
    }

    getTreeItem(element: XStateMachineTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: XStateMachineTreeItem): Promise<XStateMachineTreeItem[]> {
        if (!element) {
            // Root level
            if (this.isLoading) {
                // Show loading message
                if (this.treeView) {
                    this.treeView.message = 'Scanning workspace...';
                }
                return [];
            }

            if (this.currentScope === 'file') {
                // File scope - show machines from current file
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    if (this.treeView) {
                        this.treeView.message = 'Open a JS/TS file to see XState machines';
                    }
                    return [];
                }

                const machines = XStateMachineParser.parseMachines(editor.document);
                if (machines.length === 0) {
                    if (this.treeView) {
                        this.treeView.message = 'No XState machines found in this file';
                    }
                    return [];
                }

                const items = machines
                    .filter((m: MachineNode) => this.showStateConfigs || !m.isStateConfig)
                    .filter((m: MachineNode) => this.nodeMatchesFilter(m))
                    .map((m: MachineNode) => {
                        const item = this.getOrCreateItem(m, undefined);
                        if (m.children) { this.preBuildItemCache(m.children, item); }
                        return item;
                    });
                
                if (items.length === 0 && !this.showStateConfigs) {
                    if (this.treeView) {
                        this.treeView.message = 'All machines are state configs (toggle filter to show)';
                    }
                    return [];
                }

                if (this.treeView) {
                    this.treeView.message = this.filterText ? `Filter: "${this.filterText}"` : undefined;
                }
                return items;
            } else {
                // Workspace scope
                const fileMachines = this.workspaceScanner.getCached();
                
                if (fileMachines.length === 0) {
                    if (this.treeView) {
                        this.treeView.message = 'No XState machines found in workspace';
                    }
                    return [];
                }

                // Clear message when we have items
                if (this.treeView) {
                    this.treeView.message = this.filterText ? `Filter: "${this.filterText}"` : undefined;
                }

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
                return this.filterNodes(element.node.children)
                    .map(c => this.getOrCreateItem(c, element));
            }
            return [];
        }
    }

    private createLoadingItem(): XStateMachineTreeItem {
        return new XStateMachineTreeItem({
            type: 'machine',
            label: 'Scanning workspace...',
            range: new vscode.Range(0, 0, 0, 0),
            uri: vscode.Uri.file('')
        });
    }

    private createEmptyItem(message: string): XStateMachineTreeItem {
        return new XStateMachineTreeItem({
            type: 'machine',
            label: message,
            range: new vscode.Range(0, 0, 0, 0),
            uri: vscode.Uri.file('')
        });
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
            for (const fm of filteredFileMachines) {
                for (const m of fm.machines) {
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
                    if (m.children) { this.preBuildItemCache(m.children, item); }
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
                        if (m.children) { this.preBuildItemCache(m.children, item); }
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
            this.tooltip = this.buildTooltip();
            this.description = this.getDescription();
            this.iconPath = this.getIcon();
            
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
        // No descriptions needed - indicators are in the label now
        return undefined;
    }

    private buildTooltip(): string | vscode.MarkdownString {
        const node = this.node;
        if (node.description) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${node.label}**\n\n`);
            md.appendText(node.description);
            return md;
        }
        return `${node.type}: ${node.label}`;
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.node.type) {
            case 'machine':
                return new vscode.ThemeIcon('package', new vscode.ThemeColor('symbolIcon.classForeground'));
            case 'state':
                if (this.node.isInitial) {
                    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
                }
                if (this.node.isFinal) {
                    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.red'));
                }
                return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('symbolIcon.fieldForeground'));
            case 'transition':
                // Use different icons for event handlers vs regular transitions
                if (this.node.label === 'onDone' || this.node.label === 'onError') {
                    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('symbolIcon.eventForeground'));
                }
                return new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor('symbolIcon.eventForeground'));
            case 'action':
                return new vscode.ThemeIcon('rocket', new vscode.ThemeColor('symbolIcon.methodForeground'));
            case 'entry':
                return new vscode.ThemeIcon('debug-step-into', new vscode.ThemeColor('symbolIcon.methodForeground'));
            case 'exit':
                return new vscode.ThemeIcon('debug-step-out', new vscode.ThemeColor('symbolIcon.colorForeground'));
            case 'guard':
                return new vscode.ThemeIcon('shield', new vscode.ThemeColor('symbolIcon.booleanForeground'));
            case 'target':
                return new vscode.ThemeIcon('target', new vscode.ThemeColor('terminal.ansiBrightMagenta'));
            case 'invoke':
                return new vscode.ThemeIcon('circuit-board', new vscode.ThemeColor('symbolIcon.eventForeground'));
            case 'context':
                return new vscode.ThemeIcon('symbol-variable', new vscode.ThemeColor('symbolIcon.variableForeground'));
            default:
                return new vscode.ThemeIcon('symbol-misc');
        }
    }
}
