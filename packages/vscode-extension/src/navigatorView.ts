import * as vscode from 'vscode';
import { MachineNode } from './parser';
import { normalizeTargetName } from './utils';
import { TrailService, TrailEntry } from './trailView';

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

type Group = { kind: 'group'; id: 'transitions' | 'trail' };
type TxRow = { kind: 'tx'; ref: TransitionRef };
type TrailRow = { kind: 'trail'; entry: TrailEntry };
type Hint = { kind: 'hint'; text: string };
type NavNode = Group | TxRow | TrailRow | Hint;

const arrowIn = 'arrow-small-left';
const arrowOut = 'arrow-small-right';

/**
 * Combined "Transitions" pane. Two groups, one arrow language (← in/back,
 * → out/forward): the **Transitions** of the selected state, and the **Trail**
 * of states walked while navigating.
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
        private readonly trail: TrailService,
    ) {
        this.trail.onDidChange(() => this._onDidChangeTreeData.fire());
    }

    getFocalNode(): MachineNode | undefined { return this.focalNode; }

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
        if (!el) {
            return [{ kind: 'group', id: 'transitions' }, { kind: 'group', id: 'trail' }];
        }
        if (el.kind === 'group' && el.id === 'transitions') {
            if (!this.focalNode) { return [{ kind: 'hint', text: 'Select a state to see its transitions' }]; }
            if (this.transitions.length === 0) { return [{ kind: 'hint', text: 'No transitions' }]; }
            return this.transitions.map(ref => ({ kind: 'tx', ref }) as TxRow);
        }
        if (el.kind === 'group' && el.id === 'trail') {
            const entries = this.trail.getEntries();
            if (entries.length === 0) { return [{ kind: 'hint', text: 'Navigate a transition to start a trail' }]; }
            return entries.map(entry => ({ kind: 'trail', entry }) as TrailRow);
        }
        return [];
    }

    getTreeItem(node: NavNode): vscode.TreeItem {
        if (node.kind === 'group') {
            const item = new vscode.TreeItem(
                node.id === 'transitions' ? 'Transitions' : 'Trail',
                vscode.TreeItemCollapsibleState.Expanded,
            );
            item.contextValue = `group-${node.id}`;
            if (node.id === 'transitions' && this.focalNode) { item.description = this.focalNode.label; }
            return item;
        }
        if (node.kind === 'hint') {
            const item = new vscode.TreeItem(node.text);
            item.description = '';
            return item;
        }
        if (node.kind === 'tx') {
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
        // trail row
        const entries = this.trail.getEntries();
        const index = entries.indexOf(node.entry);
        const isCurrent = index === this.trail.getCurrent();
        const e = node.entry;
        const arrow = e.direction === 'backward' ? arrowIn : e.direction === 'forward' ? arrowOut : 'circle-small-filled';
        const item = new vscode.TreeItem(e.label);
        item.iconPath = isCurrent
            ? new vscode.ThemeIcon(arrow, new vscode.ThemeColor('charts.blue'))
            : new vscode.ThemeIcon(arrow);
        item.description = isCurrent ? [e.via, 'current'].filter(Boolean).join(' · ') : e.via;
        item.tooltip = `${e.label}${e.via ? ` (via ${e.via})` : ''}${isCurrent ? ' — current' : ''}`;
        item.command = { command: 'xstateMachineTrail.open', title: 'Go to state', arguments: [e, index] };
        return item;
    }
}
