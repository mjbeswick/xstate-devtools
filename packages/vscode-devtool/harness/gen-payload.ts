// Harness payload generator. Reuses the REAL parser to turn a fixture file into
// MachineNode[], then runs a faithful copy of GraphView.buildElements (with
// reflectExpansion=false, so no TreeProvider is needed) to emit the __GRAPH__
// payload the webview consumes. Output is JSON on stdout.
//
// Bundled to harness/out/gen-payload.js with `vscode` aliased to vscode-shim.js.
import * as fs from 'fs';
import * as ts from 'typescript';
import * as vscode from 'vscode';
import { XStateMachineParser, MachineNode } from '../src/parser';

// Keep stdout clean for the JSON payload — the parser logs progress via console.log.
console.log = (...a: unknown[]) => process.stderr.write(a.join(' ') + '\n');

const file = process.argv[2];
const machineIndex = Number(process.argv[3] ?? '0');
const text = fs.readFileSync(file, 'utf8');

// Build a TextDocument good enough for the parser: getText / fileName / uri /
// positionAt. positionAt maps an absolute offset → {line, character} using a
// scanned line-start table.
const lineStarts: number[] = [0];
for (let i = 0; i < text.length; i++) { if (text[i] === '\n') { lineStarts.push(i + 1); } }
function positionAt(offset: number): vscode.Position {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) { lo = mid; } else { hi = mid - 1; } }
    return new vscode.Position(lo, offset - lineStarts[lo]);
}
const doc = {
    getText: () => text,
    fileName: file,
    uri: vscode.Uri.file(file),
    positionAt,
} as unknown as vscode.TextDocument;

const machines = XStateMachineParser.parseMachines(doc);
if (!machines.length) { process.stderr.write('No machines found\n'); process.exit(1); }
const machine = machines[machineIndex];

// ── Faithful copy of GraphView.buildElements (reflectExpansion = false) ────────
interface NodeData {
    id: string; label: string; name: string;
    parent?: string; compound?: boolean; initial?: boolean; final?: boolean;
    parallel?: boolean; history?: 'shallow' | 'deep'; ghost?: boolean; start?: boolean;
    entryActions?: string[]; exitActions?: string[]; internalTransitions?: string[];
    invokes?: string[]; description?: string;
}
const nodes: { data: NodeData }[] = [];
const edges: { data: { id: string; source: string; target: string; label: string } }[] = [];
const nameToId = new Map<string, string>();
const idByNode = new Map<MachineNode, string>();
let counter = 0;
const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

const collect = (n: MachineNode, parentId: string | undefined, isRoot: boolean) => {
    const id = `n${counter++}`;
    idByNode.set(n, id);
    const name = sanitize(n.label);
    nameToId.set(name, id);
    const childStates = (n.children ?? []).filter(c => c.type === 'state' && !(c as any).isTypeMarker);
    const entryActions = (n.children ?? []).filter(c => c.type === 'entry').map(c => c.label);
    const exitActions = (n.children ?? []).filter(c => c.type === 'exit').map(c => c.label);
    const internalTransitions = (n.children ?? [])
        .filter(c => c.type === 'transition'
            && !(c.children ?? []).some(cc => cc.type === 'target')
            && (c.children ?? []).some(cc => cc.type === 'action'))
        .map(c => {
            const guard = c.children?.find(cc => cc.type === 'guard');
            const acts = (c.children ?? []).filter(cc => cc.type === 'action').map(cc => cc.label);
            return `${c.label}${guard ? ` [${guard.label}]` : ''} / ${acts.join(', ')}`;
        });
    const invokes = (n.children ?? []).filter(c => c.type === 'invoke').map(c => c.label);
    nodes.push({ data: {
        id, label: n.label, name, parent: parentId,
        compound: childStates.length > 0,
        initial: !!n.isInitial, final: !!n.isFinal, parallel: !!(n as any).isParallel,
        history: (n as any).historyType, entryActions, exitActions, internalTransitions,
        invokes, description: (n as any).description,
    } });
    for (const c of childStates) { collect(c, id, false); }
};

const isSubDiagram = machine.type === 'state';
let rootParentId: string | undefined;
if (!isSubDiagram) {
    rootParentId = `n${counter++}`;
    nodes.push({ data: { id: rootParentId, label: machine.label, name: sanitize(machine.label), parent: undefined, compound: true, parallel: !!(machine as any).isParallel } });
}
const rootStates = isSubDiagram ? [machine] : (machine.children ?? []).filter(c => c.type === 'state' && !(c as any).isTypeMarker);
for (const r of rootStates) { collect(r, rootParentId, isSubDiagram); }

const edgeMap = new Map<string, { source: string; target: string; labels: string[] }>();
const ghostByName = new Map<string, string>();
const addEdges = (n: MachineNode) => {
    if (n.type === 'state') {
        const sourceId = idByNode.get(n);
        if (sourceId) {
            const directT = (n.children ?? []).filter(c => c.type === 'transition');
            const invokeT = (n.children ?? [])
                .filter(c => c.type === 'invoke')
                .flatMap(inv => (inv.children ?? []).filter(c => c.type === 'transition'));
            const emitEdge = (targetRaw: string, eventLabel: string, guardLabel?: string, actionLabels: string[] = []) => {
                const targetName = sanitize(targetRaw.replace(/^#/, '').split('.').pop() ?? '');
                let targetId = nameToId.get(targetName);
                if (!targetId) {
                    if (!isSubDiagram) { return; }
                    const display = targetRaw.replace(/^#/, '');
                    targetId = ghostByName.get(targetName);
                    if (!targetId) {
                        targetId = `n${counter++}`;
                        ghostByName.set(targetName, targetId);
                        nodes.push({ data: { id: targetId, label: display, name: sanitize(display), parent: undefined, ghost: true } });
                    }
                }
                const key = `${sourceId} ${targetId}`;
                let entry = edgeMap.get(key);
                if (!entry) { entry = { source: sourceId, target: targetId, labels: [] }; edgeMap.set(key, entry); }
                let label = eventLabel ?? '';
                if (guardLabel) { label += ` [${guardLabel}]`; }
                if (actionLabels.length) { label += ` / ${actionLabels.join(', ')}`; }
                label = label.trim();
                if (label && !entry.labels.includes(label)) { entry.labels.push(label); }
            };
            for (const t of [...directT, ...invokeT]) {
                const branches = (t.children ?? []).filter(c => c.type === 'transition');
                if (branches.length > 0) {
                    for (const b of branches) {
                        if (!b.label || b.label === '?') { continue; }
                        const g = b.children?.find(c => c.type === 'guard');
                        const acts = (b.children ?? []).filter(c => c.type === 'action').map(a => a.label);
                        emitEdge(b.label, t.label ?? '', g?.label, acts);
                    }
                    continue;
                }
                const target = t.children?.find(c => c.type === 'target');
                if (!target) { continue; }
                const guard = t.children?.find(c => c.type === 'guard');
                const actions = (t.children ?? []).filter(c => c.type === 'action').map(a => a.label);
                emitEdge(target.label, t.label ?? '', guard?.label, actions);
            }
        }
    }
    for (const c of (n.children ?? [])) { addEdges(c); }
};
addEdges(machine);
for (const entry of edgeMap.values()) {
    edges.push({ data: { id: `e${counter++}`, source: entry.source, target: entry.target, label: entry.labels.join('\n') } });
}
const starts: { data: NodeData }[] = [];
for (const node of nodes) {
    if (!node.data.initial) { continue; }
    const startId = `start_${counter++}`;
    starts.push({ data: { id: startId, label: '', name: startId, parent: node.data.parent, start: true } });
    edges.push({ data: { id: `e${counter++}`, source: startId, target: node.data.id, label: '' } });
}
nodes.push(...starts);

process.stdout.write(JSON.stringify({ nodes, edges, collapsedIds: [] }));
void ts;
