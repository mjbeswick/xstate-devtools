// packages/vscode-debugger/src/debugger/debuggerDecorationProvider.ts
//
// Colors active state-node labels green in the Instances tree. VS Code has no
// API to color (or bold) a tree item's label directly, so we tag active items
// with an `xstate-active:` resourceUri and decorate that scheme here.
import * as vscode from 'vscode';
import type { DebuggerController } from './debuggerController';

export const ACTIVE_SCHEME = 'xstate-active';

export class DebuggerActiveDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
    private readonly _onDidChange = new vscode.EventEmitter<undefined>();
    readonly onDidChangeFileDecorations = this._onDidChange.event;

    private readonly unsubscribe: () => void;

    constructor(controller: DebuggerController) {
        // Active configuration moves as events arrive — re-evaluate decorations.
        this.unsubscribe = controller.getStore().subscribe(() => this._onDidChange.fire(undefined));
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== ACTIVE_SCHEME) { return undefined; }
        return {
            color: new vscode.ThemeColor('charts.green'),
            propagate: false,
        };
    }

    dispose(): void {
        this.unsubscribe();
        this._onDidChange.dispose();
    }
}
