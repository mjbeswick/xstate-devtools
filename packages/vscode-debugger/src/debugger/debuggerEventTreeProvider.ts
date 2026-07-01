// packages/vscode-debugger/src/debugger/debuggerEventTreeProvider.ts
//
// Native VS Code TreeView for the selected (time-travel) event, or the latest —
// an expandable JSON tree of the event object, mirroring the Context tree. Lives
// in the Debugger sidebar so payloads read well in the tall/narrow column and
// never reflow the bottom Events panel. Follows the shared store's selection +
// time-travel; the Events panel's ←/→/Esc stepping refreshes it.
import * as vscode from 'vscode';
import type { DebuggerController } from './debuggerController';

export class EventTreeItem extends vscode.TreeItem {
    constructor(
        public readonly value: unknown,
        label: string,
        collapsible: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsible);
    }
}

function isContainer(v: unknown): v is object {
    return v !== null && typeof v === 'object';
}

function entriesOf(v: unknown): Array<[string, unknown]> {
    if (Array.isArray(v)) { return v.map((item, i) => [String(i), item]); }
    if (isContainer(v)) { return Object.entries(v as Record<string, unknown>); }
    return [];
}

function preview(v: unknown): string {
    if (v === null) { return 'null'; }
    if (v === undefined) { return 'undefined'; }
    if (Array.isArray(v)) { return `[${v.length}]`; }
    if (typeof v === 'object') { return `{${Object.keys(v as object).length}}`; }
    if (typeof v === 'string') {
        const s = JSON.stringify(v);
        return s.length > 80 ? s.slice(0, 79) + '…' : s;
    }
    if (typeof v === 'function') { return 'ƒ'; }
    return String(v);
}

export class DebuggerEventTreeProvider implements vscode.TreeDataProvider<EventTreeItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<EventTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly unsubscribe: () => void;
    private view: vscode.TreeView<EventTreeItem> | null = null;

    constructor(private readonly controller: DebuggerController) {
        this.unsubscribe = this.controller.getStore().subscribe(() => this.refresh());
    }

    /** Attach the created TreeView so the header (which event) can be shown as its description. */
    setView(view: vscode.TreeView<EventTreeItem>): void {
        this.view = view;
        this.refresh();
    }

    getTreeItem(element: EventTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: EventTreeItem): EventTreeItem[] {
        const value = element ? element.value : this.selectedEvent();
        return entriesOf(value).map(([key, val]) => this.item(key, val));
    }

    private refresh(): void {
        this._onDidChangeTreeData.fire();
        if (this.view) { this.view.description = this.headerText(); }
    }

    /** The event object shown at the root: the time-travel seq, else the latest. */
    private selectedEntry() {
        const state = this.controller.getStore().getState();
        const events = state.events;
        if (!events.length) { return undefined; }
        return state.timeTravelSeq !== null
            ? events.find((e) => e.globalSeq === state.timeTravelSeq)
            : events[events.length - 1];
    }

    private selectedEvent(): unknown {
        return this.selectedEntry()?.event;
    }

    private headerText(): string | undefined {
        const entry = this.selectedEntry();
        if (!entry) { return undefined; }
        const kind = this.controller.getStore().getState().timeTravelSeq === null ? 'latest' : 'selected';
        return `#${entry.globalSeq} · ${kind}`;
    }

    private item(key: string, value: unknown): EventTreeItem {
        const hasChildren = entriesOf(value).length > 0;
        const item = new EventTreeItem(
            value,
            key,
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );
        item.description = preview(value);
        item.tooltip = isContainer(value) ? undefined : preview(value);
        item.contextValue = 'xstateDebuggerEvent';
        return item;
    }

    dispose(): void {
        this.unsubscribe();
        this._onDidChangeTreeData.dispose();
    }
}
