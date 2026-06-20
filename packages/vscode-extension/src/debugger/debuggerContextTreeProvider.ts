// packages/vscode-extension/src/debugger/debuggerContextTreeProvider.ts
//
// Native VS Code TreeView for the selected actor's context — an expandable JSON
// tree (objects/arrays expand, primitives are leaves with their value shown).
// Reads the controller's shared store and follows the current selection +
// time-travel, like the Instances tree.
import * as vscode from 'vscode';
import { getDisplaySnapshot } from '@xstate-devtools/panel-core';
import type { DebuggerController } from './debuggerController';

export class ContextTreeItem extends vscode.TreeItem {
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

export class DebuggerContextTreeProvider implements vscode.TreeDataProvider<ContextTreeItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<ContextTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private readonly unsubscribe: () => void;

    constructor(private readonly controller: DebuggerController) {
        this.unsubscribe = this.controller.getStore().subscribe(() => this._onDidChangeTreeData.fire());
    }

    getTreeItem(element: ContextTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ContextTreeItem): ContextTreeItem[] {
        const value = element ? element.value : this.selectedContext();
        return entriesOf(value).map(([key, val]) => this.item(key, val));
    }

    private selectedContext(): unknown {
        const state = this.controller.getStore().getState();
        const selId = state.selectedActorId;
        if (!selId) { return undefined; }
        const actor = state.actors.get(selId);
        const snap = actor ? (getDisplaySnapshot(state, selId) ?? actor.snapshot) : null;
        return snap?.context;
    }

    private item(key: string, value: unknown): ContextTreeItem {
        const hasChildren = entriesOf(value).length > 0;
        const item = new ContextTreeItem(
            value,
            key,
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );
        item.description = preview(value);
        item.tooltip = isContainer(value) ? undefined : preview(value);
        item.contextValue = 'xstateDebuggerContext';
        return item;
    }

    dispose(): void {
        this.unsubscribe();
        this._onDidChangeTreeData.dispose();
    }
}
