import * as vscode from 'vscode';
import {
    getInvalidPropertyReplacement,
    XSTATE_DIAGNOSTIC_CODES,
} from '@xstate-devtools/diagram-core';

export class XStateCodeActionProvider implements vscode.CodeActionProvider {
    static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        return context.diagnostics.flatMap((diagnostic) => {
            if (typeof diagnostic.code !== 'string') {
                return [];
            }

            if (diagnostic.code === XSTATE_DIAGNOSTIC_CODES.condDeprecated) {
                return [this.createRenameAction(document, diagnostic, 'guard')];
            }

            if (diagnostic.code !== XSTATE_DIAGNOSTIC_CODES.invalidProperty) {
                return [];
            }

            const replacement = getInvalidPropertyReplacement(document, diagnostic.range);
            return replacement ? [this.createRenameAction(document, diagnostic, replacement)] : [];
        });
    }

    private createRenameAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        replacement: string
    ): vscode.CodeAction {
        const currentText = document.getText(diagnostic.range);
        const action = new vscode.CodeAction(
            `Rename '${currentText}' to '${replacement}'`,
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, diagnostic.range, replacement);
        action.edit = edit;

        return action;
    }
}
