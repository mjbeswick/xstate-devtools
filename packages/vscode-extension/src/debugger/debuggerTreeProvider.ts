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

export class DebuggerTreeItem extends vscode.TreeItem {
    constructor(
        public readonly kind: 'actor' | 'state',
        public readonly sessionId: string,
        public readonly node?: SerializedStateNode,
    ) {
        super('', vscode.TreeItemCollapsibleState.None);
    }
}

const GREEN = new vscode.ThemeColor('charts.green');

function stateIconName(type: SerializedStateNode['type']): string {
    switch (type) {
        case 'compound': return 'symbol-namespace';
        case 'parallel': return 'split-horizontal';
        case 'final': return 'pass-filled';
        case 'history': return 'history';
        default: return 'circle-outline';
    }
}

export class DebuggerTreeProvider implements vscode.TreeDataProvider<DebuggerTreeItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<DebuggerTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly unsubscribe: () => void;
    // Active state-node ids per actor, memoised per refresh (cleared on change).
    private activeCache = new Map<string, Set<string>>();

    constructor(private readonly controller: DebuggerController) {
        this.unsubscribe = this.controller.getStore().subscribe(() => {
            this.activeCache.clear();
            this._onDidChangeTreeData.fire();
        });
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
                if (!parent || !state.actors.has(parent)) { roots.push(this.actorItem(sessionId)); }
            }
            return roots.filter((i): i is DebuggerTreeItem => !!i);
        }
        if (element.kind === 'actor') {
            const items: DebuggerTreeItem[] = [];
            // Child actors first, then the machine's top-level states.
            for (const [sessionId, a] of state.actors) {
                if (a.parentSessionId === element.sessionId) {
                    const child = this.actorItem(sessionId);
                    if (child) { items.push(child); }
                }
            }
            const machine = state.actors.get(element.sessionId)?.machine;
            if (machine) {
                for (const node of Object.values(machine.root.states)) {
                    items.push(this.stateItem(element.sessionId, node));
                }
            }
            return items;
        }
        // state node → its child states
        const children = element.node ? Object.values(element.node.states) : [];
        return children.map((node) => this.stateItem(element.sessionId, node));
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
        item.id = `actor:${sessionId}`;
        item.label = actor.machine?.id ?? sessionId.slice(0, 8);
        const snap = getDisplaySnapshot(state, sessionId) ?? actor.snapshot;
        const leaves = actor.machine && snap
            ? getActivePaths(snap.value as never, actor.machine.root)
                .map((p) => p[p.length - 1]?.key)
                .filter((k): k is string => !!k)
            : [];
        const stopped = actor.status === 'stopped';
        item.description = (stopped ? '(stopped) ' : '') + leaves.join(', ');
        item.contextValue = 'xstateDebuggerActor';
        item.iconPath = new vscode.ThemeIcon(stopped ? 'circle-slash' : 'circle-filled', stopped ? undefined : GREEN);
        const hasChildren = !!actor.machine || [...state.actors.values()].some((a) => a.parentSessionId === sessionId);
        item.collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        item.tooltip = `${item.label} · ${actor.status}\n${sessionId}`;
        return item;
    }

    private stateItem(sessionId: string, node: SerializedStateNode): DebuggerTreeItem {
        const active = this.activeIds(sessionId).has(node.id);
        const item = new DebuggerTreeItem('state', sessionId, node);
        item.id = `state:${sessionId}:${node.id}`;
        item.label = node.key;
        item.description = active ? '● active' : undefined;
        item.contextValue = 'xstateDebuggerState';
        item.iconPath = new vscode.ThemeIcon(stateIconName(node.type), active ? GREEN : undefined);
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
