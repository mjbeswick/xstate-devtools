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

/** Locate the statically-parsed machine whose root id matches a running machine. */
function findStaticMachine(scanner: WorkspaceScanner, machineId: string): MachineNode | undefined {
    for (const file of scanner.getCached()) {
        for (const machine of file.machines) {
            if (machine.label === machineId) { return machine; }
        }
    }
    return undefined;
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
            const machine = findStaticMachine(scanner, actor.machine.id);
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
            const machine = findStaticMachine(scanner, actor.machine.id);
            if (!machine) {
                void vscode.window.showWarningMessage(
                    `No diagram available — machine "${actor.machine.id}" isn't in the workspace.`,
                );
                return;
            }
            controller.selectActor(item.sessionId);
            const selectName = item.kind === 'state' && item.node ? item.node.key : undefined;
            graphView.show(machine, machine.label, selectName);
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

    return [goToSource, revealInDiagram, sendEvent, captureSnapshot, restoreSnapshot];
}
