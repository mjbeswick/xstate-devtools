import * as vscode from 'vscode';
import { MachineNode } from '@xstate-devtools/diagram-core';
import { normalizeTargetName } from '@xstate-devtools/diagram-core';

/** An edge touching the focal state: `in` (←, leads into it) or `out` (→, leaves it). */
export interface TransitionRef {
    direction: 'in' | 'out';
    otherLabel: string;        // the source (in) or target (out) state
    otherUri: vscode.Uri;      // where that state is defined — the navigation target
    otherRange: vscode.Range;
    event: string;             // the transition label (event / always / after Nms / onDone)
    machineKey: string;
}

type ResolveTarget = (target: MachineNode) => { uri: vscode.Uri; range: vscode.Range } | undefined;

/** Transitions in the machine that target `focalName` (reverse index → `in`). */
function findIncoming(machineRoot: MachineNode, focalName: string, machineKey: string): TransitionRef[] {
    const out: TransitionRef[] = [];
    const visit = (node: MachineNode, state: MachineNode | null, transition: MachineNode | null) => {
        let s = state, t = transition;
        if (node.type === 'state' || node.type === 'machine') { s = node; t = null; }
        else if (node.type === 'transition') { t = node; }
        else if (node.type === 'target' && t && s && normalizeTargetName(node.label) === focalName) {
            out.push({ direction: 'in', otherLabel: s.label, otherUri: s.uri, otherRange: s.range, event: t.label, machineKey });
        }
        for (const c of node.children ?? []) { visit(c, s, t); }
    };
    visit(machineRoot, null, null);
    return out;
}

/** The focal state's own transitions and their resolved targets (→ `out`). */
function findOutgoing(focal: MachineNode, resolve: ResolveTarget, machineKey: string): TransitionRef[] {
    const out: TransitionRef[] = [];
    const visit = (node: MachineNode, transition: MachineNode | null) => {
        // Don't descend into nested states — their transitions belong to them.
        if (node.type === 'state' && node !== focal) { return; }
        let t = transition;
        if (node.type === 'transition') { t = node; }
        else if (node.type === 'target' && t) {
            const loc = resolve(node);
            if (loc) {
                out.push({
                    direction: 'out', otherLabel: normalizeTargetName(node.label) || node.label,
                    otherUri: loc.uri, otherRange: loc.range, event: t.label, machineKey,
                });
            }
        }
        for (const c of node.children ?? []) { visit(c, t); }
    };
    visit(focal, null);
    return out;
}

type TxRow = { kind: 'tx'; ref: TransitionRef };
type Hint = { kind: 'hint'; text: string };
type NavNode = TxRow | Hint;

const arrowIn = 'arrow-left';
const arrowOut = 'arrow-right';

/**
 * "Transitions" pane — a single flat list, no group headers. The icon carries
 * the meaning: ← incoming / → outgoing transitions of the selected state.
 */
export class NavigatorTreeProvider implements vscode.TreeDataProvider<NavNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<NavNode | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private focalNode: MachineNode | undefined;
    private transitions: TransitionRef[] = [];

    constructor(
        private readonly machineOf: (n: MachineNode) => MachineNode | undefined,
        private readonly resolveTarget: ResolveTarget,
        private readonly machineKeyOf: (n: MachineNode) => string,
    ) {}

    /** Point the Transitions group at a state (or clear it for any other node). */
    setFocus(node: MachineNode | undefined): void {
        if (!node || node.type !== 'state') {
            this.focalNode = undefined;
            this.transitions = [];
        } else {
            this.focalNode = node;
            const machine = this.machineOf(node);
            const key = this.machineKeyOf(node);
            const name = normalizeTargetName(node.label) || node.label;
            const incoming = machine ? findIncoming(machine, name, key) : [];
            const outgoing = findOutgoing(node, this.resolveTarget, key);
            this.transitions = [...incoming, ...outgoing];
        }
        this._onDidChangeTreeData.fire();
    }

    getChildren(el?: NavNode): NavNode[] {
        if (el) { return []; }  // flat list
        const rows: NavNode[] = this.transitions.map(ref => ({ kind: 'tx', ref }) as TxRow);
        if (rows.length === 0) {
            rows.push({ kind: 'hint', text: this.focalNode ? 'No transitions' : 'Select a state to see its transitions' });
        }
        return rows;
    }

    getTreeItem(node: NavNode): vscode.TreeItem {
        if (node.kind === 'hint') {
            const item = new vscode.TreeItem(node.text);
            item.description = '';
            return item;
        }
        const r = node.ref;
        const item = new vscode.TreeItem(r.otherLabel);
        item.iconPath = new vscode.ThemeIcon(r.direction === 'in' ? arrowIn : arrowOut);
        item.description = r.event;
        item.tooltip = r.direction === 'in'
            ? `${r.otherLabel} —${r.event}→ ${this.focalNode?.label ?? ''}`
            : `${this.focalNode?.label ?? ''} —${r.event}→ ${r.otherLabel}`;
        item.command = { command: 'xstateNavigator.openTransition', title: 'Go to state', arguments: [r] };
        return item;
    }
}
