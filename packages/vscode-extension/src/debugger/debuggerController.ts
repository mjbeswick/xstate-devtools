// packages/vscode-extension/src/debugger/debuggerController.ts
//
// Owns the live-debugger session in the extension host: the framework-agnostic
// inspector store (shared with the chrome panel via @xstate-devtools/panel-core),
// the WebSocket client that attaches to a running app's server adapter, the
// status-bar indicator, and the bridge that overlays each running machine's
// active state onto its open statechart diagram.
import * as vscode from 'vscode';
import { createInspectorStore, exportSession, getActivePaths, getDisplaySnapshot, importSession, type InspectorStore } from '@xstate-devtools/panel-core';
import type { StoreApi } from 'zustand/vanilla';
import type { ExtensionToPageMessage, PageToExtensionMessage, SerializedEvent, SerializedStateNode } from '@xstate-devtools/protocol';
import { DebuggerWsClient, type ConnectionStatus } from './wsClient';
import { XStateGraphViewProvider, type LiveStateValue } from '../graphView';
import { summarizeLeaves, summarizeLeafTokens } from './format';

const DEFAULT_URL = 'ws://127.0.0.1:9301';

/** A row in the debugger's actor (machine instance) tree. */
export interface ActorVM {
    sessionId: string;
    parentSessionId?: string;
    label: string;
    /** Active leaf state(s), shown inline as the instance's current state. */
    state: string;
    status: string;
    depth: number;
    hasChildren: boolean;
    selected: boolean;
}

/** Recent event-log row. */
export interface EventVM {
    sessionId: string;
    type: string;
    seq: number;
    time: number;
}

/** An event the selected actor could be sent from its current state. */
export interface TransitionVM {
    eventType: string;
    guard?: string;
    targets: string[];
}

/** The full snapshot of debugger state pushed to the webview view. */
export interface DebuggerViewModel {
    status: ConnectionStatus;
    url: string;
    replayMode: boolean;
    replayName: string | null;
    timeTravelSeq: number | null;
    canInteract: boolean;
    actors: ActorVM[];
    selected: {
        sessionId: string;
        machineId: string | null;
        status: string;
        activeLeaves: string[];
        transitions: TransitionVM[];
        persisted: { captured: boolean; error?: string };
    } | null;
    events: EventVM[];
}

/** A surface (the sidebar webview) that renders the debugger view-model. */
export interface DebuggerView {
    postModel(model: DebuggerViewModel): void;
}

const MAX_EVENT_ROWS = 200;

export class DebuggerController implements vscode.Disposable {
    private readonly store: StoreApi<InspectorStore> = createInspectorStore();
    private client: DebuggerWsClient | null = null;
    private readonly statusBar: vscode.StatusBarItem;
    private unsubscribeStore: (() => void) | null = null;
    private status: ConnectionStatus = 'idle';
    private readonly views = new Set<DebuggerView>();
    private lastModel: DebuggerViewModel | null = null;
    private readonly log: vscode.OutputChannel;

    constructor(private readonly graphView: XStateGraphViewProvider) {
        this.log = vscode.window.createOutputChannel('XState Debugger');
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
        this.statusBar.command = 'xstateDebugger.toggle';
        this.renderStatusBar();
        this.statusBar.show();

        // Re-derive the live diagram overlay and re-push the view-model whenever
        // the store changes.
        this.unsubscribeStore = this.store.subscribe(() => {
            this.syncDiagram();
            this.pushModel();
        });
        void this.setConnectedContext(false);
    }

    /** Register a webview view (debugger or events) to receive model updates. */
    addView(view: DebuggerView): void {
        this.views.add(view);
        view.postModel(this.lastModel ?? this.buildViewModel());
    }

    /** Unregister a webview view (e.g. on dispose). */
    removeView(view: DebuggerView): void {
        this.views.delete(view);
    }

    /** The most recently built view-model (for a view's ready handshake). */
    getLastModel(): DebuggerViewModel {
        return this.lastModel ?? this.buildViewModel();
    }

    /** Select an actor (drives the inspector + which diagram is emphasised). */
    selectActor(sessionId: string | null): void {
        this.store.getState().selectActor(sessionId);
    }

    /** Freeze the display at a captured event seq (null = back to live). */
    timeTravel(seq: number | null): void {
        this.store.getState().timeTravel(seq);
    }

    /** Send an event to the selected running actor. */
    dispatch(event: SerializedEvent): void {
        const sessionId = this.store.getState().selectedActorId;
        if (!sessionId) { return; }
        this.send({ type: 'XSTATE_DISPATCH', sessionId, event });
    }

    /** Send a custom event with a JSON payload; reports a parse error to the UI. */
    dispatchCustom(type: string, payloadJson: string): void {
        let payload: Record<string, unknown> = {};
        if (payloadJson.trim()) {
            try {
                const parsed = JSON.parse(payloadJson);
                if (parsed && typeof parsed === 'object') { payload = parsed as Record<string, unknown>; }
            } catch {
                void vscode.window.showErrorMessage('XState debugger: event payload is not valid JSON.');
                return;
            }
        }
        if (!type.trim()) { return; }
        this.dispatch({ type: type.trim(), ...payload });
    }

    /** Ask the running app for the selected actor's persisted snapshot. */
    capturePersisted(): void {
        const sessionId = this.store.getState().selectedActorId;
        if (!sessionId) { return; }
        this.send({ type: 'XSTATE_REQUEST_PERSISTED', sessionId });
    }

    /** Recreate the selected actor from its captured persisted snapshot. */
    async restore(): Promise<void> {
        const state = this.store.getState();
        const sessionId = state.selectedActorId;
        if (!sessionId) { return; }
        const entry = state.persistedSnapshots.get(sessionId);
        if (!entry || entry.persisted === undefined) {
            void vscode.window.showWarningMessage('XState debugger: capture a persisted snapshot before restoring.');
            return;
        }
        const ok = await vscode.window.showWarningMessage(
            'Restore this actor to the captured snapshot? Side effects already run are not undone. ' +
            '(Requires the actor to be wired with useRestorableInspectedMachine.)',
            { modal: true },
            'Restore',
        );
        if (ok !== 'Restore') { return; }
        this.send({ type: 'XSTATE_RESTORE', sessionId, persisted: entry.persisted });
    }

    /** Write the current captured session to a JSON file. */
    async exportSession(): Promise<void> {
        const doc = exportSession(this.store.getState(), Date.now());
        const uri = await vscode.window.showSaveDialog({
            filters: { 'XState session': ['json'] },
            saveLabel: 'Export XState session',
        });
        if (!uri) { return; }
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(doc, null, 2), 'utf8'));
        void vscode.window.showInformationMessage(`Exported XState session to ${uri.fsPath}`);
    }

    /** Load a session JSON file into the store as a read-only replay. */
    async importSession(): Promise<void> {
        const picks = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'XState session': ['json'] },
            openLabel: 'Import XState session',
        });
        const uri = picks?.[0];
        if (!uri) { return; }
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const data = importSession(JSON.parse(Buffer.from(bytes).toString('utf8')));
            const name = uri.path.split('/').pop() ?? 'session';
            this.store.getState().loadSession(data, name);
        } catch (e) {
            void vscode.window.showErrorMessage(`Could not import session: ${(e as Error).message}`);
        }
    }

    /** Leave replay mode and return to an empty live session. */
    exitReplay(): void {
        this.store.getState().exitReplay();
        this.graphView.clearLiveConfig();
    }

    /** Current connection URL (from config, falling back to the default). */
    private url(): string {
        const configured = vscode.workspace
            .getConfiguration('xstateOutline')
            .get<string>('debuggerUrl');
        return configured && configured.trim() ? configured.trim() : DEFAULT_URL;
    }

    connect(): void {
        this.log.appendLine(`[${stamp()}] connect → ${this.url()}`);
        if (!this.client) {
            this.client = new DebuggerWsClient(this.url(), {
                onMessage: (msg) => this.onMessage(msg),
                onStatus: (status) => this.onStatus(status),
            });
        }
        this.client.connect(this.url());
    }

    disconnect(): void {
        this.client?.disconnect();
        // Drop the diagram overlay and reset the captured session.
        this.graphView.clearLiveConfig();
        this.store.getState().exitReplay();
    }

    toggle(): void {
        if (this.status === 'idle' || this.status === 'closed' || this.status === 'error') {
            this.connect();
        } else {
            this.disconnect();
        }
    }

    /** Send a command (dispatch / request-persisted / restore) to the running app. */
    send(msg: ExtensionToPageMessage): boolean {
        return this.client?.send(msg) ?? false;
    }

    /** The shared inspector store — UI surfaces subscribe to this. */
    getStore(): StoreApi<InspectorStore> {
        return this.store;
    }

    private onMessage(msg: PageToExtensionMessage): void {
        this.log.appendLine(`[${stamp()}] ← ${msg.type}${'sessionId' in msg ? ` (${msg.sessionId})` : ''}`);
        const state = this.store.getState();
        state.handleMessage(msg);
        // Auto-select the first actor so the inspector isn't empty on connect.
        const next = this.store.getState();
        if (next.selectedActorId === null && next.actors.size > 0) {
            next.selectActor(next.actors.keys().next().value ?? null);
        }
    }

    private onStatus(status: ConnectionStatus): void {
        this.log.appendLine(`[${stamp()}] status → ${status}`);
        this.status = status;
        this.renderStatusBar();
        void this.setConnectedContext(status === 'open');
        if (status !== 'open') { this.graphView.clearLiveConfig(); }
        this.pushModel();
    }

    /** Build and push the current view-model to the attached webview view. */
    private pushModel(): void {
        const model = this.buildViewModel();
        this.lastModel = model;
        for (const view of this.views) { view.postModel(model); }
    }

    private buildViewModel(): DebuggerViewModel {
        const state = this.store.getState();

        // Order actors depth-first — each parent immediately followed by its
        // descendants — so the list renders as a real machine-instance tree.
        // An actor whose parent is unknown (e.g. stopped) is treated as a root.
        const childrenOf = new Map<string | undefined, string[]>();
        for (const [sessionId, a] of state.actors) {
            const parent = a.parentSessionId && state.actors.has(a.parentSessionId) ? a.parentSessionId : undefined;
            const arr = childrenOf.get(parent) ?? [];
            arr.push(sessionId);
            childrenOf.set(parent, arr);
        }
        const summarize = (sessionId: string): string => {
            const a = state.actors.get(sessionId);
            if (!a?.machine) { return ''; }
            const snap = getDisplaySnapshot(state, sessionId) ?? a.snapshot;
            const leaves = getActivePaths(snap?.value as LiveStateValue, a.machine.root)
                .map((p) => p[p.length - 1]?.key)
                .filter((k): k is string => !!k);
            return summarizeLeaves(leaves);
        };
        const actors: ActorVM[] = [];
        const walk = (sessionId: string, depth: number): void => {
            const a = state.actors.get(sessionId)!;
            actors.push({
                sessionId,
                parentSessionId: a.parentSessionId,
                label: a.machine?.id ?? sessionId.slice(0, 8),
                state: summarize(sessionId),
                status: a.status,
                depth,
                hasChildren: (childrenOf.get(sessionId)?.length ?? 0) > 0,
                selected: state.selectedActorId === sessionId,
            });
            for (const child of childrenOf.get(sessionId) ?? []) { walk(child, depth + 1); }
        };
        for (const root of childrenOf.get(undefined) ?? []) { walk(root, 0); }

        const liveSelectable = this.status === 'open' && state.timeTravelSeq === null && !state.replayMode;

        let selected: DebuggerViewModel['selected'] = null;
        const selId = state.selectedActorId;
        if (selId) {
            const actor = state.actors.get(selId);
            const snapshot = getDisplaySnapshot(state, selId) ?? actor?.snapshot ?? null;
            if (actor && snapshot) {
                const activeLeaves: string[] = [];
                const transitions: TransitionVM[] = [];
                if (actor.machine) {
                    const seenNodes = new Set<SerializedStateNode>();
                    const seenEvents = new Set<string>();
                    for (const path of getActivePaths(snapshot.value as LiveStateValue, actor.machine.root)) {
                        const leaf = path[path.length - 1];
                        if (leaf) { activeLeaves.push(leaf.key); }
                        // Outgoing events from every node on the active path (a child
                        // and its ancestors can both handle an event).
                        for (const node of path) {
                            if (seenNodes.has(node)) { continue; }
                            seenNodes.add(node);
                            for (const t of node.on) {
                                const key = `${t.eventType}::${t.guard ?? ''}`;
                                if (seenEvents.has(key)) { continue; }
                                seenEvents.add(key);
                                transitions.push({ eventType: t.eventType, guard: t.guard, targets: t.targets });
                            }
                        }
                    }
                }
                const persistedEntry = state.persistedSnapshots.get(selId);
                selected = {
                    sessionId: selId,
                    machineId: actor.machine?.id ?? null,
                    status: snapshot.status,
                    activeLeaves: summarizeLeafTokens(activeLeaves),
                    transitions,
                    persisted: {
                        captured: persistedEntry?.persisted !== undefined,
                        error: persistedEntry?.error,
                    },
                };
            }
        }

        const events: EventVM[] = state.events
            .slice(-MAX_EVENT_ROWS)
            .map((e) => ({ sessionId: e.sessionId, type: e.event.type, seq: e.globalSeq, time: e.timestamp }));

        return {
            status: this.status,
            url: this.url(),
            replayMode: state.replayMode,
            replayName: state.replayName,
            timeTravelSeq: state.timeTravelSeq,
            canInteract: liveSelectable,
            actors,
            selected,
            events,
        };
    }

    // Overlay every running machine's active state onto its open diagram. The
    // graph provider only touches panels whose machine id matches, so actors
    // without an open diagram are silently skipped.
    private syncDiagram(): void {
        const state = this.store.getState();
        for (const [sessionId, actor] of state.actors) {
            const machineId = actor.machine?.id;
            // Respect time-travel: show the snapshot at the frozen seq, not live.
            const snapshot = getDisplaySnapshot(state, sessionId) ?? actor.snapshot;
            const value = snapshot?.value;
            if (!machineId || value === undefined || value === null) { continue; }
            this.graphView.setLiveConfig(machineId, value as LiveStateValue);
        }
    }

    private renderStatusBar(): void {
        const map: Record<ConnectionStatus, { icon: string; text: string; tooltip: string }> = {
            idle:       { icon: 'debug-disconnect', text: 'XState: off',        tooltip: 'XState debugger — click to connect' },
            connecting: { icon: 'sync~spin',        text: 'XState: connecting', tooltip: `Connecting to ${this.url()}…` },
            open:       { icon: 'debug-alt',        text: 'XState: live',       tooltip: `Live — connected to ${this.url()} (click to disconnect)` },
            closed:     { icon: 'debug-disconnect', text: 'XState: off',        tooltip: 'XState debugger disconnected — click to reconnect' },
            error:      { icon: 'warning',          text: 'XState: error',      tooltip: `Could not reach ${this.url()} — click to retry` },
        };
        const s = map[this.status];
        this.statusBar.text = `$(${s.icon}) ${s.text}`;
        this.statusBar.tooltip = s.tooltip;
    }

    private async setConnectedContext(connected: boolean): Promise<void> {
        await vscode.commands.executeCommand('setContext', 'xstateDebugger.connected', connected);
    }

    /** Reveal the diagnostics output channel. */
    showLog(): void {
        this.log.show(true);
    }

    /** Append a diagnostic line (used by the webview view to trace its lifecycle). */
    logLine(message: string): void {
        this.log.appendLine(`[${stamp()}] ${message}`);
    }

    dispose(): void {
        this.unsubscribeStore?.();
        this.client?.dispose();
        this.statusBar.dispose();
        this.log.dispose();
    }
}

function stamp(): string {
    const d = new Date();
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
