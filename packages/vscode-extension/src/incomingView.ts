import * as vscode from 'vscode';
import { MachineNode } from './parser';
import { normalizeTargetName } from './utils';

/** A transition that targets the focal state. */
export interface IncomingRef {
    sourceLabel: string;   // the state that owns the transition
    event: string;         // the transition label (event / always / after Nms / onDone)
    uri: vscode.Uri;
    range: vscode.Range;   // the transition's range, to navigate to
    targetLabel: string;   // the focal state name (for the trail's backward record)
}

/**
 * Reverse index: every transition in `machineRoot` whose target resolves (by
 * name) to `focalName`. Name-based matching is approximate for same-named states
 * in different regions, but covers the common sibling/child/absolute cases.
 */
export function findIncomingTransitions(machineRoot: MachineNode, focalName: string): IncomingRef[] {
    const out: IncomingRef[] = [];
    const visit = (node: MachineNode, state: MachineNode | null, transition: MachineNode | null) => {
        let s = state, t = transition;
        if (node.type === 'state' || node.type === 'machine') { s = node; t = null; }
        else if (node.type === 'transition') { t = node; }
        else if (node.type === 'target' && t && s && normalizeTargetName(node.label) === focalName) {
            out.push({ sourceLabel: s.label, event: t.label, uri: t.uri, range: t.range, targetLabel: focalName });
        }
        for (const c of node.children ?? []) { visit(c, s, t); }
    };
    visit(machineRoot, null, null);
    return out;
}

/** TreeView listing the transitions that lead into the currently-focused state. */
export class IncomingTreeProvider implements vscode.TreeDataProvider<IncomingRef> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private refs: IncomingRef[] = [];
    private focalLabel = '';

    constructor(private readonly machineOf: (node: MachineNode) => MachineNode | undefined) {}

    /** Point the view at a state (or clear it for any other / no node). */
    setFocus(node: MachineNode | undefined): void {
        if (!node || node.type !== 'state') {
            this.refs = [];
            this.focalLabel = '';
        } else {
            const machine = this.machineOf(node);
            const name = normalizeTargetName(node.label) || node.label;
            this.focalLabel = node.label;
            this.refs = machine ? findIncomingTransitions(machine, name) : [];
        }
        vscode.commands.executeCommand('setContext', 'xstateIncoming.hasFocus', !!this.focalLabel);
        this._onDidChangeTreeData.fire();
    }

    getFocalLabel(): string { return this.focalLabel; }

    getTreeItem(ref: IncomingRef): vscode.TreeItem {
        const item = new vscode.TreeItem(ref.sourceLabel);
        item.description = `via ${ref.event}`;
        item.iconPath = new vscode.ThemeIcon('arrow-small-right');
        item.tooltip = `${ref.sourceLabel} —${ref.event}→ ${this.focalLabel}`;
        item.command = {
            command: 'xstateMachineIncoming.open',
            title: 'Go to transition',
            arguments: [ref],
        };
        return item;
    }

    getChildren(): IncomingRef[] {
        return this.refs;
    }
}
