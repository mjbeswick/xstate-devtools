import * as vscode from 'vscode';
import { XStateMachineParser, MachineNode } from '@xstate-devtools/diagram-core';
import { XSTATE_DIAGNOSTIC_SOURCE } from './diagnostics';

// A CodeLens row above every `createMachine` / `setup().createMachine` call:
//   ▶ View Diagram · 6 states · 12 transitions · ⚠ 2 problems
// Pure static — reuses the same parser the outline does, plus the diagnostics
// already published for the document.
export class XStateCodeLensProvider implements vscode.CodeLensProvider {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;

    /** Re-emit lenses (e.g. after diagnostics or the setting change). */
    refresh(): void { this._onDidChange.fire(); }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const config = vscode.workspace.getConfiguration('xstateOutline');
        if (!config.get<boolean>('codeLens', true)) { return []; }

        const machines = XStateMachineParser.parseMachines(document);
        if (machines.length === 0) { return []; }

        const problems = vscode.languages
            .getDiagnostics(document.uri)
            .filter(d => d.source === XSTATE_DIAGNOSTIC_SOURCE);

        const lenses: vscode.CodeLens[] = [];
        for (const machine of machines) {
            // Anchor the lens to the start of the machine's source range.
            const range = new vscode.Range(machine.range.start, machine.range.start);
            const counts = countNodes(machine);
            const problemCount = problems.filter(d => machine.range.contains(d.range.start)).length;

            lenses.push(new vscode.CodeLens(range, {
                title: '▶ View Diagram',
                command: 'xstateMachineOutline.openGraphViewForNode',
                arguments: [machine, document.uri],
            }));

            const stats = `${counts.states} ${plural(counts.states, 'state')} · ${counts.transitions} ${plural(counts.transitions, 'transition')}`;
            lenses.push(new vscode.CodeLens(range, { title: stats, command: '' }));

            if (problemCount > 0) {
                lenses.push(new vscode.CodeLens(range, {
                    title: `⚠ ${problemCount} ${plural(problemCount, 'problem')}`,
                    command: 'xstateMachineErrors.focus',
                }));
            }
        }
        return lenses;
    }
}

function plural(n: number, word: string): string {
    return n === 1 ? word : `${word}s`;
}

/** Count `state` and `transition` nodes anywhere beneath (and including) a machine. */
function countNodes(root: MachineNode): { states: number; transitions: number } {
    let states = 0;
    let transitions = 0;
    const walk = (node: MachineNode) => {
        if (node.type === 'state') { states++; }
        else if (node.type === 'transition') { transitions++; }
        for (const child of node.children ?? []) { walk(child); }
    };
    for (const child of root.children ?? []) { walk(child); }
    return { states, transitions };
}
