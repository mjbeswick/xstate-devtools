// packages/vscode-extension/src/debugger/debuggerCommands.ts
//
// Right-click (view/item/context) actions for the Instances tree:
// Go to Source, Reveal in Diagram, Send Event…, and Capture / Restore Snapshot.
import * as vscode from 'vscode';
import type { SerializedStateNode } from '@xstate-devtools/protocol';
import { getActivePaths, getDisplaySnapshot } from '@xstate-devtools/panel-core';
import type { DebuggerController } from './debuggerController';
import { DebuggerTreeItem } from './debuggerTreeProvider';
import type { XStateGraphViewProvider } from '../graphView';
import type { WorkspaceScanner } from '../workspaceScanner';
import type { MachineNode } from '../parser';

/** Top-level state labels of a static machine (its root regions/states). */
function topLevelStateLabels(machine: MachineNode): string[] {
    return (machine.children ?? [])
        .filter((c) => c.type === 'state' && !c.isTypeMarker)
        .map((c) => c.label);
}

/**
 * Locate the statically-parsed machine for a running machine. Match by root id
 * first; when several share the id, prefer the file the runtime reported in
 * `sourceLocation`.
 *
 * An anonymous machine has no help from the id — XState v5 defaults its root id
 * to "(machine)", which matches nothing in the workspace (the parser labels such
 * a machine by its variable name). `sourceLocation` doesn't help either: it's
 * the createActor call site, not the createMachine definition. So fall back to a
 * structural fingerprint — the set of top-level state names, which is stable and
 * almost always unique across a workspace's machines.
 */
export function findStaticMachine(
    scanner: WorkspaceScanner,
    machineId: string,
    sourceLocation?: string,
    rootStateKeys?: string[],
): MachineNode | undefined {
    const all: MachineNode[] = [];
    for (const file of scanner.getCached()) {
        for (const machine of file.machines) { all.push(machine); }
    }
    const want = rootStateKeys && rootStateKeys.length > 0 ? new Set(rootStateKeys) : null;
    // How many of the running machine's top-level states this candidate shares —
    // a structural fingerprint used to disambiguate.
    const overlap = (m: MachineNode): number =>
        want ? topLevelStateLabels(m).reduce((n, l) => n + (want.has(l) ? 1 : 0), 0) : 0;

    const byLabel = all.filter((m) => m.label === machineId);
    let candidates: MachineNode[];
    if (byLabel.length > 0) {
        candidates = byLabel;
        // Several machines share this id (e.g. two `id: 'journey'`): keep the
        // ones whose states best match the running machine, not just the first.
        if (want && candidates.length > 1) {
            const best = Math.max(...candidates.map(overlap));
            if (best > 0) { candidates = candidates.filter((m) => overlap(m) === best); }
        }
    } else {
        // No id match — e.g. an anonymous machine whose runtime id is "(machine)".
        // Resolve purely structurally; give up if nothing shares its states.
        if (!want) { return undefined; }
        const best = Math.max(0, ...all.map(overlap));
        if (best === 0) { return undefined; }
        candidates = all.filter((m) => overlap(m) === best);
    }
    if (candidates.length <= 1) { return candidates[0]; }
    if (sourceLocation) {
        const byFile = candidates.find((m) => m.uri && sourceLocation.includes(m.uri.fsPath));
        if (byFile) { return byFile; }
    }
    return candidates[0];
}

/** Key chain from a machine's root down to the node with the given id. */
function pathToNode(node: SerializedStateNode, nodeId: string): string[] | undefined {
    if (node.id === nodeId) { return []; }
    for (const child of Object.values(node.states)) {
        const sub = pathToNode(child, nodeId);
        if (sub) { return [child.key, ...sub]; }
    }
    return undefined;
}

/** Walk a static MachineNode tree by a chain of local state labels. */
function walkStatic(machine: MachineNode, path: string[]): MachineNode | undefined {
    let cur: MachineNode | undefined = machine;
    for (const key of path) {
        cur = (cur?.children ?? []).find(
            (c) => c.type === 'state' && !c.isTypeMarker && c.label === key,
        );
        if (!cur) { return undefined; }
    }
    return cur;
}

async function reveal(uri: vscode.Uri, range: vscode.Range): Promise<void> {
    await vscode.window.showTextDocument(uri, { selection: range, preview: false });
}

/** Outgoing event types from the actor's current active configuration. */
function enabledEvents(controller: DebuggerController, sessionId: string): string[] {
    const state = controller.getStore().getState();
    const actor = state.actors.get(sessionId);
    if (!actor?.machine) { return []; }
    const snap = getDisplaySnapshot(state, sessionId) ?? actor.snapshot;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const path of getActivePaths(snap?.value as never, actor.machine.root)) {
        for (const node of path) {
            for (const t of node.on) {
                if (!seen.has(t.eventType)) { seen.add(t.eventType); out.push(t.eventType); }
            }
        }
    }
    return out;
}

export function registerDebuggerCommands(
    controller: DebuggerController,
    graphView: XStateGraphViewProvider,
    scanner: WorkspaceScanner,
): vscode.Disposable[] {
    const goToSource = vscode.commands.registerCommand(
        'xstateDebugger.goToSource',
        async (item?: DebuggerTreeItem) => {
            if (!item) { return; }
            const state = controller.getStore().getState();
            const actor = state.actors.get(item.sessionId);
            if (!actor?.machine) { return; }
            const machine = findStaticMachine(scanner, actor.machine.id, actor.machine.sourceLocation, Object.keys(actor.machine.root.states));
            // State node → its exact definition, via the static parse.
            if (item.kind === 'state' && item.node && machine) {
                const path = pathToNode(actor.machine.root, item.node.id);
                const target = path ? walkStatic(machine, path) : undefined;
                if (target?.uri && target.range) { await reveal(target.uri, target.range); return; }
            }
            // Actor (or state fallback) → the machine's location.
            if (machine?.uri && machine.range) { await reveal(machine.uri, machine.range); return; }
            // Last resort: the runtime's best-effort source location.
            const loc = actor.machine.sourceLocation;
            const m = loc ? /^(.*?):(\d+)(?::\d+)?$/.exec(loc) : null;
            if (m) {
                try {
                    const line = Math.max(0, parseInt(m[2], 10) - 1);
                    await reveal(vscode.Uri.file(m[1]), new vscode.Range(line, 0, line, 0));
                    return;
                } catch { /* fall through */ }
            }
            void vscode.window.showWarningMessage(
                'Could not locate source for this machine — it may be outside the workspace or created dynamically.',
            );
        },
    );

    const revealInDiagram = vscode.commands.registerCommand(
        'xstateDebugger.revealInDiagram',
        (item?: DebuggerTreeItem) => {
            if (!item) { return; }
            const actor = controller.getStore().getState().actors.get(item.sessionId);
            if (!actor?.machine) { return; }
            const machine = findStaticMachine(scanner, actor.machine.id, actor.machine.sourceLocation, Object.keys(actor.machine.root.states));
            if (!machine) {
                const name = actor.machine.id === '(machine)' ? (actor.machine.root ? 'this machine' : actor.machine.id) : `"${actor.machine.id}"`;
                void vscode.window.showWarningMessage(
                    `No diagram available — ${name} isn't in the workspace (or its states don't match a machine here).`,
                );
                return;
            }
            controller.selectActor(item.sessionId);
            const selectName = item.kind === 'state' && item.node ? item.node.key : undefined;
            graphView.show(machine, machine.label, selectName);
        },
    );

    // Open a focused diagram rooted at a compound state node (rather than the
    // whole machine). The live overlay still paints active states — show() is
    // told the owning machine label and the state-key path to this node.
    const diagramFromNode = vscode.commands.registerCommand(
        'xstateDebugger.diagramFromNode',
        (item?: DebuggerTreeItem) => {
            if (!item || item.kind !== 'state' || !item.node) { return; }
            const actor = controller.getStore().getState().actors.get(item.sessionId);
            if (!actor?.machine) { return; }
            const machine = findStaticMachine(scanner, actor.machine.id, actor.machine.sourceLocation, Object.keys(actor.machine.root.states));
            if (!machine) {
                void vscode.window.showWarningMessage(
                    `No diagram available — "${actor.machine.id}" isn't in the workspace (or its states don't match a machine here).`,
                );
                return;
            }
            const path = pathToNode(actor.machine.root, item.node.id);
            const subtree = path ? walkStatic(machine, path) : undefined;
            if (!subtree || !path) {
                void vscode.window.showWarningMessage(`Couldn't locate "${item.node.key}" in the workspace diagram.`);
                return;
            }
            controller.selectActor(item.sessionId);
            graphView.show(subtree, `${machine.label} / ${subtree.label}`, undefined, { label: machine.label, path });
        },
    );

    const sendEvent = vscode.commands.registerCommand(
        'xstateDebugger.sendEvent',
        async (item?: DebuggerTreeItem) => {
            if (!item) { return; }
            const CUSTOM = '$(edit) Custom event…';
            const events = enabledEvents(controller, item.sessionId);
            const pick = await vscode.window.showQuickPick([...events, CUSTOM], {
                placeHolder: events.length ? 'Send event to this actor' : 'No enabled events — send a custom one',
            });
            if (!pick) { return; }
            if (pick === CUSTOM) {
                const type = await vscode.window.showInputBox({ prompt: 'Event type', placeHolder: 'MY_EVENT' });
                if (!type) { return; }
                const payload = await vscode.window.showInputBox({
                    prompt: 'Payload JSON (optional)',
                    placeHolder: '{ "key": "value" }',
                });
                controller.dispatchCustom(type, payload ?? '', item.sessionId);
            } else {
                controller.dispatch({ type: pick }, item.sessionId);
            }
        },
    );

    const captureSnapshot = vscode.commands.registerCommand(
        'xstateDebugger.captureSnapshot',
        (item?: DebuggerTreeItem) => {
            if (item) { controller.capturePersisted(item.sessionId); }
        },
    );

    const restoreSnapshot = vscode.commands.registerCommand(
        'xstateDebugger.restoreSnapshot',
        (item?: DebuggerTreeItem) => {
            if (item) { void controller.restore(item.sessionId); }
        },
    );

    return [goToSource, revealInDiagram, diagramFromNode, sendEvent, captureSnapshot, restoreSnapshot];
}
