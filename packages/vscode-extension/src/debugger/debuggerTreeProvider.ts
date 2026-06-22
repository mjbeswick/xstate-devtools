// packages/vscode-extension/src/debugger/debuggerTreeProvider.ts
//
// Native VS Code TreeView for the live debugger's machine instances — like the
// xstate outline tree, but driven by the running app. Roots are running actors
// (nested parent → child); each actor expands into its live state-node tree with
// the active configuration highlighted. Selecting an item drives the Inspector
// webview and the diagram overlay (both key off the controller's selectedActorId).
import * as vscode from 'vscode';
import type { SerializedStateNode } from '@xstate-devtools/protocol';
import { getActiveNodeIds, getActivePaths, getDisplaySnapshot } from '@xstate-devtools/panel-core';
import type { DebuggerController } from './debuggerController';
import { summarizeLeaves } from './format';
import { ACTIVE_SCHEME } from './debuggerDecorationProvider';

export class DebuggerTreeItem extends vscode.TreeItem {
    constructor(
        public readonly kind: 'actor' | 'state',
        public readonly sessionId: string,
        public readonly node?: SerializedStateNode,
    ) {
        super('', vscode.TreeItemCollapsibleState.None);
    }
}

// The same Harel-shape SVG mapping the outline tree uses (XStateMachineTreeItem
// .stateIconFile): history → parallel → initial → final → default.
function stateIconFile(node: SerializedStateNode, isInitial: boolean): string {
    if (node.type === 'history') { return 'state-history.svg'; }
    if (node.type === 'parallel') { return 'state-parallel.svg'; }
    if (isInitial) { return 'state-initial.svg'; }
    if (node.type === 'final') { return 'state-final.svg'; }
    return 'state.svg';
}

export class DebuggerTreeProvider implements vscode.TreeDataProvider<DebuggerTreeItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DebuggerTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly unsubscribe: () => void;
    private readonly iconBase: vscode.Uri;
    private showStopped: boolean;
    // Active state-node ids per actor, memoised per refresh (cleared on change).
    private activeCache = new Map<string, Set<string>>();
    // Bumped each time the actor set repopulates from empty. Folded into
    // tree-item ids so a re-added actor that reuses its old sessionId gets a
    // fresh identity — VS Code's tree model won't re-render a recycled id after
    // the view was emptied, so existing actors would otherwise stay hidden on
    // reconnect while newly-spawned ones appeared. The controller empties the
    // store at the start of every connection attempt (onStatus 'connecting'),
    // so this empty→non-empty transition fires reliably on every reconnect.
    private generation = 0;
    private lastActorCount = 0;

    constructor(
        extensionUri: vscode.Uri,
        private readonly controller: DebuggerController,
    ) {
        this.iconBase = vscode.Uri.joinPath(extensionUri, 'resources', 'icons');
        this.showStopped = vscode.workspace.getConfiguration('xstateOutline').get('debuggerShowStopped', true);
        this.unsubscribe = this.controller.getStore().subscribe(() => {
            const count = this.controller.getStore().getState().actors.size;
            if (count > 0 && this.lastActorCount === 0) { this.generation++; }
            this.lastActorCount = count;
            this.activeCache.clear();
            this._onDidChangeTreeData.fire();
        });
    }

    getShowStopped(): boolean {
        return this.showStopped;
    }

    setShowStopped(value: boolean): void {
        this.showStopped = value;
        void vscode.workspace.getConfiguration('xstateOutline').update('debuggerShowStopped', value, true);
        this._onDidChangeTreeData.fire();
    }

    private includeActor(status: string): boolean {
        return this.showStopped || status !== 'stopped';
    }

    getTreeItem(element: DebuggerTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DebuggerTreeItem): DebuggerTreeItem[] {
        const state = this.controller.getStore().getState();
        if (!element) {
            // Root actors — those whose parent isn't another actor in the store.
            const roots: DebuggerTreeItem[] = [];
            for (const [sessionId, a] of state.actors) {
                const parent = a.parentSessionId;
                if ((!parent || !state.actors.has(parent)) && this.includeActor(a.status)) {
                    roots.push(this.actorItem(sessionId));
                }
            }
            return roots.filter((i): i is DebuggerTreeItem => !!i);
        }
        if (element.kind === 'actor') {
            const items: DebuggerTreeItem[] = [];
            // Child actors first, then the machine's top-level states.
            for (const [sessionId, a] of state.actors) {
                if (a.parentSessionId === element.sessionId && this.includeActor(a.status)) {
                    items.push(this.actorItem(sessionId));
                }
            }
            const machine = state.actors.get(element.sessionId)?.machine;
            if (machine) {
                for (const node of Object.values(machine.root.states)) {
                    items.push(this.stateItem(element.sessionId, node, machine.root.initial));
                }
            }
            return items;
        }
        // state node → its child states
        const parent = element.node;
        if (!parent) { return []; }
        return Object.values(parent.states).map((node) => this.stateItem(element.sessionId, node, parent.initial));
    }

    /** Active node ids for an actor's current (display) snapshot, memoised. */
    private activeIds(sessionId: string): Set<string> {
        const cached = this.activeCache.get(sessionId);
        if (cached) { return cached; }
        const state = this.controller.getStore().getState();
        const actor = state.actors.get(sessionId);
        const snap = actor ? (getDisplaySnapshot(state, sessionId) ?? actor.snapshot) : null;
        const ids = actor?.machine && snap
            ? getActiveNodeIds(snap.value as never, actor.machine.root)
            : new Set<string>();
        this.activeCache.set(sessionId, ids);
        return ids;
    }

    private actorItem(sessionId: string): DebuggerTreeItem {
        const state = this.controller.getStore().getState();
        const actor = state.actors.get(sessionId)!;
        const item = new DebuggerTreeItem('actor', sessionId);
        item.id = `actor:${this.generation}:${sessionId}`;
        item.label = actor.machine?.id ?? sessionId.slice(0, 8);
        const snap = getDisplaySnapshot(state, sessionId) ?? actor.snapshot;
        const leaves = actor.machine && snap
            ? getActivePaths(snap.value as never, actor.machine.root)
                .map((p) => p[p.length - 1]?.key)
                .filter((k): k is string => !!k)
            : [];
        const stopped = actor.status === 'stopped';
        item.description = (stopped ? '(stopped) ' : '') + summarizeLeaves(leaves);
        item.contextValue = 'xstateDebuggerActor';
        // Match the outline's machine icon (package); tint by run status.
        item.iconPath = new vscode.ThemeIcon(
            'package',
            new vscode.ThemeColor(stopped ? 'disabledForeground' : 'charts.green'),
        );
        const hasChildren = !!actor.machine || [...state.actors.values()].some((a) => a.parentSessionId === sessionId);
        item.collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        item.tooltip = `${item.label} · ${actor.status}\n${sessionId}`;
        return item;
    }

    private stateItem(sessionId: string, node: SerializedStateNode, parentInitial?: string): DebuggerTreeItem {
        const active = this.activeIds(sessionId).has(node.id);
        const item = new DebuggerTreeItem('state', sessionId, node);
        item.id = `state:${this.generation}:${sessionId}:${node.id}`;
        item.label = node.key;
        item.contextValue = 'xstateDebuggerState';
        // Active states are shown by colouring the label green (via the
        // FileDecorationProvider keyed on this scheme), not a dot/text suffix.
        if (active) {
            item.resourceUri = vscode.Uri.parse(`${ACTIVE_SCHEME}:/${sessionId}/${encodeURIComponent(node.id)}`);
        }
        // Same bundled Harel-shape SVGs as the outline tree (can't be tinted, so
        // active is shown via the description above).
        const file = stateIconFile(node, node.key === parentInitial);
        item.iconPath = {
            light: vscode.Uri.joinPath(this.iconBase, 'light', file),
            dark: vscode.Uri.joinPath(this.iconBase, 'dark', file),
        };
        const hasChildren = Object.keys(node.states).length > 0;
        item.collapsibleState = hasChildren
            ? (active ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
            : vscode.TreeItemCollapsibleState.None;
        return item;
    }

    dispose(): void {
        this.unsubscribe();
        this._onDidChangeTreeData.dispose();
    }
}
