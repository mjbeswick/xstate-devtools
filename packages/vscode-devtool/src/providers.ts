import * as vscode from 'vscode';
import { WorkspaceScanner } from './workspaceScanner';
import { MachineNode } from './parser';
import { findNodeAtPosition, normalizeTargetName, walkNodes } from './utils';

export class XStateReferenceProvider implements vscode.ReferenceProvider {
    constructor(private workspaceScanner: WorkspaceScanner) {}

    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken
    ): Promise<vscode.Location[]> {
        this.workspaceScanner.updateDocument(document);
        const fileMachines = this.workspaceScanner.getFile(document.uri);
        if (!fileMachines) { return []; }

        const match = findNodeAtPosition(fileMachines.machines, position);
        if (!match) { return []; }

        const { node, parents } = match;
        const machine = parents[0]?.type === 'machine' ? parents[0] : (node.type === 'machine' ? node : undefined);
        
        const references: vscode.Location[] = [];

        // For states and targets
        if (node.type === 'state' || node.type === 'target') {
            const nameToFind = node.type === 'state' ? node.label : normalizeTargetName(node.label);
            if (!nameToFind) { return []; }

            // Find all targets in the workspace (or just same machine) that point to this name
            // For now, let's search all machines in workspace just in case (e.g. reused IDs)
            const allMachines = this.workspaceScanner.getCached().flatMap(fm => fm.machines);
            for (const m of allMachines) {
                walkNodes(m, n => {
                    if (n.type === 'target' && normalizeTargetName(n.label) === nameToFind) {
                        references.push(new vscode.Location(n.uri, n.range));
                    }
                    if (n.type === 'state' && n.label === nameToFind) {
                        references.push(new vscode.Location(n.uri, n.range));
                    }
                });
            }
            return references;
        }

        // For setup items (actions, guards, actors, delays) and usages (entry, exit, invoke)
        if (['action', 'guard', 'actor', 'delay', 'entry', 'exit', 'invoke'].includes(node.type)) {
            // Find references inside the same machine
            if (machine) {
                let targetName = node.label;
                const match2 = targetName.match(/^(?:entry|exit|action|guard|invoke):\s*(.+)$/);
                if (match2) { targetName = match2[1].trim(); }

                walkNodes(machine, n => {
                    if (['action', 'guard', 'actor', 'delay', 'entry', 'exit', 'invoke'].includes(n.type)) {
                        let labelName = n.label;
                        const match = labelName.match(/^(?:entry|exit|action|guard|invoke):\s*(.+)$/);
                        if (match) { labelName = match[1].trim(); }
                        
                        if (labelName === targetName) {
                            references.push(new vscode.Location(n.uri, n.range));
                        }
                    }
                });
            }
            return references;
        }

        return [];
    }
}

export class XStateRenameProvider implements vscode.RenameProvider {
    constructor(private workspaceScanner: WorkspaceScanner) {}

    async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken
    ): Promise<vscode.WorkspaceEdit | undefined> {
        this.workspaceScanner.updateDocument(document);
        const fileMachines = this.workspaceScanner.getFile(document.uri);
        if (!fileMachines) { return undefined; }

        const match = findNodeAtPosition(fileMachines.machines, position);
        if (!match) { return undefined; }

        const { node, parents } = match;
        const machine = parents[0]?.type === 'machine' ? parents[0] : (node.type === 'machine' ? node : undefined);

        // Start with the standard TS rename edits
        let edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
            'vscode.executeDocumentRenameProvider',
            document.uri,
            position,
            newName
        );

        if (!edit) {
            edit = new vscode.WorkspaceEdit();
        }

        if (node.type === 'state' || node.type === 'target') {
            const nameToFind = node.type === 'state' ? node.label : normalizeTargetName(node.label);
            if (!nameToFind) { return edit; }

            const allMachines = this.workspaceScanner.getCached().flatMap(fm => fm.machines);
            const promises: Promise<void>[] = [];
            for (const m of allMachines) {
                walkNodes(m, n => {
                    if (n.type === 'target') {
                        if (normalizeTargetName(n.label) === nameToFind) {
                            promises.push((async () => {
                                try {
                                    const doc = await vscode.workspace.openTextDocument(n.uri);
                                    const oldText = doc.getText(n.range);
                                    const newText = oldText.replace(nameToFind, newName);
                                    edit!.replace(n.uri, n.range, newText);
                                } catch {}
                            })());
                        }
                    }
                });
            }
            await Promise.all(promises);
            return edit;
        }

        if (['action', 'guard', 'actor', 'delay', 'entry', 'exit', 'invoke'].includes(node.type)) {
            if (!machine) return edit;
            
            let targetName = node.label;
            const match2 = targetName.match(/^(?:entry|exit|action|guard|invoke):\s*(.+)$/);
            if (match2) { targetName = match2[1].trim(); }

            const promises: Promise<void>[] = [];
            walkNodes(machine, n => {
                if (['action', 'guard', 'actor', 'delay', 'entry', 'exit', 'invoke'].includes(n.type)) {
                    let labelName = n.label;
                    const match = labelName.match(/^(?:entry|exit|action|guard|invoke):\s*(.+)$/);
                    if (match) { labelName = match[1].trim(); }

                    if (labelName === targetName) {
                        promises.push((async () => {
                            try {
                                const doc = await vscode.workspace.openTextDocument(n.uri);
                                const oldText = doc.getText(n.range);
                                if (oldText.includes(targetName)) {
                                    const newText = oldText.replace(targetName, newName);
                                    edit!.replace(n.uri, n.range, newText);
                                }
                            } catch {}
                        })());
                    }
                }
            });
            await Promise.all(promises);
            return edit;
        }

        return edit;
    }
}
