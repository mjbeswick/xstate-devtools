// packages/vscode-extension/src/debugger/debuggerController.ts
//
// Owns the live-debugger session in the extension host: the framework-agnostic
// inspector store (shared with the chrome panel via @xstate-devtools/panel-core),
// the WebSocket client that attaches to a running app's server adapter, the
// status-bar indicator, and the bridge that overlays each running machine's
// active state onto its open statechart diagram.
import * as vscode from 'vscode';
import { createInspectorStore, type InspectorStore } from '@xstate-devtools/panel-core';
import type { StoreApi } from 'zustand/vanilla';
import type { ExtensionToPageMessage, PageToExtensionMessage } from '@xstate-devtools/protocol';
import { DebuggerWsClient, type ConnectionStatus } from './wsClient';
import { XStateGraphViewProvider, type LiveStateValue } from '../graphView';

const DEFAULT_URL = 'ws://127.0.0.1:9301';

export class DebuggerController implements vscode.Disposable {
    private readonly store: StoreApi<InspectorStore> = createInspectorStore();
    private client: DebuggerWsClient | null = null;
    private readonly statusBar: vscode.StatusBarItem;
    private unsubscribeStore: (() => void) | null = null;
    private status: ConnectionStatus = 'idle';

    constructor(private readonly graphView: XStateGraphViewProvider) {
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
        this.statusBar.command = 'xstateDebugger.toggle';
        this.renderStatusBar();
        this.statusBar.show();

        // Re-derive the live diagram overlay whenever the store changes.
        this.unsubscribeStore = this.store.subscribe(() => this.syncDiagram());
        void this.setConnectedContext(false);
    }

    /** Current connection URL (from config, falling back to the default). */
    private url(): string {
        const configured = vscode.workspace
            .getConfiguration('xstateOutline')
            .get<string>('debuggerUrl');
        return configured && configured.trim() ? configured.trim() : DEFAULT_URL;
    }

    connect(): void {
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
        this.store.getState().handleMessage(msg);
    }

    private onStatus(status: ConnectionStatus): void {
        this.status = status;
        this.renderStatusBar();
        void this.setConnectedContext(status === 'open');
        if (status !== 'open') { this.graphView.clearLiveConfig(); }
    }

    // Overlay every running machine's active state onto its open diagram. The
    // graph provider only touches panels whose machine id matches, so actors
    // without an open diagram are silently skipped.
    private syncDiagram(): void {
        const { actors } = this.store.getState();
        for (const actor of actors.values()) {
            const machineId = actor.machine?.id;
            const value = actor.snapshot?.value;
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

    dispose(): void {
        this.unsubscribeStore?.();
        this.client?.dispose();
        this.statusBar.dispose();
    }
}
