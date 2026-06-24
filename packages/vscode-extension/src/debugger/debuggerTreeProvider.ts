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
import { summarizeLeaves, stateValueLeaves } from './format';
import { ACTIVE_SCHEME } from './debuggerDecorationProvider';

export class DebuggerTreeItem extends vscode.TreeItem {
    constructor(
        public readonly kind: 'actor' | 'state' | 'waiting',
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
    private readonly statusSub: vscode.Disposable;
    private readonly iconBase: vscode.Uri;
    private showStopped: boolean;
    // Active state-node ids per actor, memoised per refresh (cleared on change).
    private activeCache = new Map<string, Set<string>>();
    // Bumped each time the actor set repopulates from empty. Folded into
    // tree-item ids so a re-added actor that reuses its old sessionId gets a
    // fresh identity — VS Code's tree model won't re-render a recycled id after
    // the view was emptied, so existing actors would otherwise stay hidden on
    // reconnect while newly-spawned ones appeared. This covers the explicit
    // disconnect→reconnect path, where disconnect() empties the store and the
    // reconnect repopulates it (empty→non-empty).
    private generation = 0;
    private lastActorCount = 0;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        extensionUri: vscode.Uri,
        private readonly controller: DebuggerController,
    ) {
        this.iconBase = vscode.Uri.joinPath(extensionUri, 'resources', 'icons');
        this.showStopped = vscode.workspace.getConfiguration('xstateOutline').get('debuggerShowStopped', true);
        this.unsubscribe = this.controller.getStore().subscribe(() => {
            // Generation bookkeeping runs synchronously on every store change so
            // it reliably observes the count→0 transition on disconnect (and the
            // 0→N transition on reconnect). It must NOT live inside the coalesced
            // fire below: a quick disconnect→connect collapses into one timer
            // that never sees count===0, so generation wouldn't bump, the
            // re-added actor would reuse its old tree-item id, and VS Code won't
            // re-render a recycled id — leaving actors invisible on reconnect.
            const count = this.controller.getStore().getState().actors.size;
            if (count > 0 && this.lastActorCount === 0) { this.generation++; }
            this.lastActorCount = count;
            this.activeCache.clear();
            this.scheduleRefresh();
        });
        this.statusSub = this.controller.onDidChangeStatus(() => this.scheduleRefresh());
    }

    // Coalesce only the fire() via setTimeout(0). On (re)connect the store fills
    // in a rapid flurry — status→open, then one XSTATE_ACTOR_REGISTERED per
    // replayed actor, then XSTATE_REPLAY_DONE. Firing per message let the
    // waiting-row → actor-rows transition flicker; one deferred fire lands on
    // the final state and renders the actors directly.
    private scheduleRefresh(): void {
        if (this.refreshTimer) { return; }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this._onDidChangeTreeData.fire();
        }, 0);
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
            // Connected but no actors yet: keep one in-tree placeholder so the
            // view never goes empty. An empty tree drops VS Code into its
            // viewsWelcome/empty state, which then sticks — a later refresh that
            // returns actor rows fails to tear it down, so reconnect shows
            // nothing. The native tree, by contrast, reliably swaps this row for
            // the actor rows once they arrive.
            if (roots.length === 0 && this.controller.isConnected()) {
                return [this.waitingItem()];
            }
            return roots.filter((i): i is DebuggerTreeItem => !!i);
        }
        if (element.kind === 'actor') {
            const items: DebuggerTreeItem[] = [];
            const machine = state.actors.get(element.sessionId)?.machine;
            if (machine) {
                for (const node of Object.values(machine.root.states)) {
                    items.push(this.stateItem(element.sessionId, node, machine.root.initial));
                }
            }
            // Invoked actors are nested under the state that invokes them (see
            // stateItem's children). Anything left — spawned actors, or an
            // invoke whose src doesn't match a machine id — stays a direct
            // child so it's never hidden.
            const invoked = machine ? this.allInvokeSrcs(machine.root) : new Set<string>();
            for (const [sessionId, a] of state.actors) {
                if (a.parentSessionId === element.sessionId && this.includeActor(a.status)
                    && !(a.machine && invoked.has(a.machine.id))) {
                    items.push(this.actorItem(sessionId));
                }
            }
            return items;
        }
        // state node → its child states, then any invoked actors it spawned.
        const parent = element.node;
        if (!parent) { return []; }
        const items = Object.values(parent.states).map((node) => this.stateItem(element.sessionId, node, parent.initial));
        for (const sessionId of this.invokedActorsOf(element.sessionId, parent)) {
            items.push(this.actorItem(sessionId));
        }
        return items;
    }

    /** All invoke `src` names anywhere in a machine's state tree. */
    private allInvokeSrcs(root: SerializedStateNode): Set<string> {
        const out = new Set<string>();
        const walk = (n: SerializedStateNode) => {
            for (const i of n.invoke) { out.add(i.src); }
            for (const c of Object.values(n.states)) { walk(c); }
        };
        walk(root);
        return out;
    }

    /** Live child actors invoked by `node` — matched src→machine.id, the same
     *  contract the diagram's "open invoked machine" uses. */
    private invokedActorsOf(ownerSessionId: string, node: SerializedStateNode): string[] {
        if (node.invoke.length === 0) { return []; }
        const srcs = new Set(node.invoke.map((i) => i.src));
        const state = this.controller.getStore().getState();
        const out: string[] = [];
        for (const [sessionId, a] of state.actors) {
            if (a.parentSessionId === ownerSessionId && a.machine && srcs.has(a.machine.id) && this.includeActor(a.status)) {
                out.push(sessionId);
            }
        }
        return out;
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

    private waitingItem(): DebuggerTreeItem {
        const item = new DebuggerTreeItem('waiting', '');
        item.id = 'waiting';
        item.label = 'Waiting for actors…';
        // No inline description — it truncated to noise in the narrow panel.
        // The guidance lives in the tooltip instead.
        item.tooltip =
            'Connected. Interact with or reload your app to see its XState actors.\n' +
            'If your adapter starts lazily (e.g. inside a route loader), load a page so it initialises.';
        item.iconPath = new vscode.ThemeIcon('loading~spin');
        return item;
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
            // No machine definition (actor synthesized from a bare snapshot):
            // derive leaf states straight from the snapshot value.
            : (snap ? stateValueLeaves(snap.value) : []);
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
        // Expandable if it has child states, or a live invoked actor nested
        // under it (invoked actors only exist while the state is active).
        const hasChildren = Object.keys(node.states).length > 0 || this.invokedActorsOf(sessionId, node).length > 0;
        item.collapsibleState = hasChildren
            ? (active ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
            : vscode.TreeItemCollapsibleState.None;
        return item;
    }

    dispose(): void {
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
        this.unsubscribe();
        this.statusSub.dispose();
        this._onDidChangeTreeData.dispose();
    }
}
