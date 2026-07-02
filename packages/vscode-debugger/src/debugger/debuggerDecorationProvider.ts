// packages/vscode-debugger/src/debugger/debuggerDecorationProvider.ts
//
// Colors active state-node labels green in the Instances tree. VS Code has no
// API to color (or bold) a tree item's label directly, so we tag active items
// with an `xstate-active:` resourceUri and decorate that scheme here.
import * as vscode from 'vscode';

export const ACTIVE_SCHEME = 'xstate-active';

export class DebuggerActiveDecorationProvider implements vscode.FileDecorationProvider {
    // The decoration for an `xstate-active:` uri is constant — always green — so
    // there's nothing to invalidate: VS Code resolves each uri once when a tree
    // item first carries it, and the Instances tree refresh alone moves the
    // resourceUri on/off items as the active configuration changes. We deliberately
    // do NOT fire onDidChangeFileDecorations: doing so per store change (i.e. per
    // logged event) made VS Code drop and re-resolve every decoration, flashing the
    // active labels green/black.
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== ACTIVE_SCHEME) { return undefined; }
        return {
            color: new vscode.ThemeColor('charts.green'),
            propagate: false,
        };
    }
}
