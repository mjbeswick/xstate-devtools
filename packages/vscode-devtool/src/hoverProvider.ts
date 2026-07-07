import * as vscode from 'vscode';
import { WorkspaceScanner } from '@xstate-devtools/diagram-core';
import { findNodeAtPosition, normalizeTargetName, walkNodes } from '@xstate-devtools/diagram-core';
import { ImplementationFinder } from './implementationFinder';

export class XStateHoverProvider implements vscode.HoverProvider {
    constructor(private workspaceScanner: WorkspaceScanner) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        this.workspaceScanner.updateDocument(document);
        const fileMachines = this.workspaceScanner.getFile(document.uri);
        if (!fileMachines) { return undefined; }

        const match = findNodeAtPosition(fileMachines.machines, position);
        if (!match) { return undefined; }

        const { node, parents } = match;
        const machine = parents[0]?.type === 'machine' ? parents[0] : (node.type === 'machine' ? node : undefined);

        // Target hover
        if (node.type === 'target') {
            const targetName = normalizeTargetName(node.label);
            if (!targetName) return undefined;
            
            const contents = new vscode.MarkdownString();
            contents.appendMarkdown(`**Target State**: \`${node.label}\`\n\n`);
            
            // Try to find the state to show its description/meta/tags if any
            // We'll just look in the same machine for now
            if (machine) {
                let foundState = false;
                walkNodes(machine, n => {
                    if (!foundState && n.type === 'state' && n.label === targetName) {
                        foundState = true;
                        // Build context
                        const info = [];
                        if (n.isInitial) info.push('Initial state');
                        if (n.isFinal) info.push('Final state');
                        
                        if (info.length > 0) {
                            contents.appendMarkdown(`*${info.join(', ')}*\n\n`);
                        }
                    }
                });
            }
            
            return new vscode.Hover(contents, node.range);
        }

        // State hover
        if (node.type === 'state') {
            const contents = new vscode.MarkdownString();
            contents.appendMarkdown(`**State**: \`${node.label}\`\n\n`);
            if (node.isInitial) contents.appendMarkdown(`*Initial state*\n\n`);
            if (node.isFinal) contents.appendMarkdown(`*Final state*\n\n`);
            return new vscode.Hover(contents, node.range);
        }

        // Action / Guard / Actor hover
        if (['action', 'guard', 'actor', 'delay', 'entry', 'exit', 'invoke'].includes(node.type)) {
            let labelName = node.label;
            let kind: string = node.type;
            const match2 = labelName.match(/^(entry|exit|action|guard|invoke):\s*(.+)$/);
            if (match2) { 
                kind = match2[1];
                labelName = match2[2].trim(); 
            }

            const contents = new vscode.MarkdownString();
            contents.appendMarkdown(`**${kind.charAt(0).toUpperCase() + kind.slice(1)}**: \`${labelName}\`\n\n`);

            // Try to resolve implementation
            try {
                const impl = await ImplementationFinder.findImplementation(labelName, document);
                if (impl) {
                    const wsPath = vscode.workspace.asRelativePath(impl.document.uri);
                    contents.appendMarkdown(`*Resolved in [${wsPath}](${impl.document.uri.toString()}#L${impl.range.start.line + 1})*\n\n`);
                    
                    // Add a small snippet of the implementation
                    const code = impl.document.getText(impl.range);
                    if (code.length < 500) {
                        contents.appendCodeblock(code, 'typescript');
                    } else {
                        contents.appendCodeblock(code.substring(0, 500) + '...', 'typescript');
                    }
                } else {
                    contents.appendMarkdown(`*Implementation not found*\n\n`);
                }
            } catch {}

            return new vscode.Hover(contents, node.range);
        }

        return undefined;
    }
}
