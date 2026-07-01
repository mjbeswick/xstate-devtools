import * as vscode from 'vscode';
import {
    WorkspaceScanner,
    XStateGraphViewProvider,
    findStaticMachine,
} from '@xstate-devtools/diagram-core';
import { DebuggerController } from './debugger/debuggerController';
import { DebuggerViewProvider } from './debugger/debuggerView';
import { DebuggerTreeProvider } from './debugger/debuggerTreeProvider';
import { DebuggerContextTreeProvider, ContextTreeItem } from './debugger/debuggerContextTreeProvider';
import { DebuggerEventTreeProvider } from './debugger/debuggerEventTreeProvider';
import { registerDebuggerCommands } from './debugger/debuggerCommands';
import { DebuggerActiveDecorationProvider } from './debugger/debuggerDecorationProvider';
import { DebuggerSetupDetector } from './debugger/debuggerSetup';

export async function activate(context: vscode.ExtensionContext) {
    console.log('XState Debugger extension is now active');

    const outputChannel = vscode.window.createOutputChannel('XState Debugger');
    // The debugger resolves running actors back to their statically-parsed
    // machines (for "Reveal in Diagram" / the live overlay), so it scans the
    // workspace itself and keeps the cache fresh as files change.
    const workspaceScanner = new WorkspaceScanner(outputChannel);
    void workspaceScanner.scanWorkspace();
    // The cache updates itself on file changes (and fires onDidChange, which the
    // setup detector listens to); findStaticMachine reads getCached() on demand,
    // so the per-update callback is a no-op here.
    workspaceScanner.startWatching(() => { /* no-op */ });

    // The debugger bundles its own diagram (no outline tree, so no expansion
    // callback — nothing is collapsed by tree state).
    const graphViewProvider = new XStateGraphViewProvider(context.extensionUri);

    // ── Live debugger ──────────────────────────────────────────────────────────
    const debuggerController = new DebuggerController(graphViewProvider);
    const eventsViewRegistration = vscode.window.registerWebviewViewProvider(
        DebuggerViewProvider.eventsViewType,
        new DebuggerViewProvider(context.extensionUri, debuggerController, 'events'),
    );
    // Seed the menu/welcome context keys BEFORE the Instances tree is created.
    void vscode.commands.executeCommand('setContext', 'xstateDebugger.showStopped',
        vscode.workspace.getConfiguration('xstateDebugger').get('showStopped', true));
    void vscode.commands.executeCommand('setContext', 'xstateDebugger.setup', 'unknown');
    void vscode.commands.executeCommand('setContext', 'xstateDebugger.setupChecking', false);
    void vscode.commands.executeCommand('setContext', 'xstateDebugger.followDiagram',
        vscode.workspace.getConfiguration('xstateDebugger').get('followDiagram', false));

    const debuggerTreeProvider = new DebuggerTreeProvider(context.extensionUri, debuggerController);
    const debuggerTreeView = vscode.window.createTreeView('xstateDebuggerInstances', {
        treeDataProvider: debuggerTreeProvider,
    });
    const debuggerTreeSelectionListener = debuggerTreeView.onDidChangeSelection((e) => {
        const item = e.selection[0];
        if (item && item.kind !== 'waiting') { debuggerController.selectActor(item.sessionId); }
    });
    const debuggerFreezeIndicator = debuggerController.getStore().subscribe(() => {
        const s = debuggerController.getStore().getState();
        debuggerTreeView.message = s.timeTravelSeq !== null
            ? `⏱ Time travel — seq ${s.timeTravelSeq}`
            : s.replayMode
                ? `● Replay${s.replayName ? ` — ${s.replayName}` : ''}`
                : undefined;
    });
    const debuggerContextTreeProvider = new DebuggerContextTreeProvider(debuggerController);
    const debuggerContextTreeView = vscode.window.createTreeView('xstateDebuggerContext', {
        treeDataProvider: debuggerContextTreeProvider,
    });
    // Selecting an event reveals the actor it hit in the Instances tree.
    const debuggerRevealActorSub = debuggerController.onDidSelectEventActor((sessionId) => {
        const item = debuggerTreeProvider.getActorItem(sessionId);
        if (item) { void debuggerTreeView.reveal(item, { select: true, focus: false, expand: true }); }
    });
    const debuggerEventTreeProvider = new DebuggerEventTreeProvider(debuggerController);
    const debuggerEventTreeView = vscode.window.createTreeView('xstateDebuggerEvent', {
        treeDataProvider: debuggerEventTreeProvider,
    });
    debuggerEventTreeProvider.setView(debuggerEventTreeView);
    const setShowStopped = (value: boolean) => {
        debuggerTreeProvider.setShowStopped(value);
        void vscode.commands.executeCommand('setContext', 'xstateDebugger.showStopped', value);
    };
    const debuggerShowStoppedCommand = vscode.commands.registerCommand('xstateDebugger.showStopped', () => setShowStopped(true));
    const debuggerHideStoppedCommand = vscode.commands.registerCommand('xstateDebugger.hideStopped', () => setShowStopped(false));

    let followDiagram = vscode.workspace.getConfiguration('xstateDebugger').get('followDiagram', false);
    let lastFollowedActor: string | null = null;
    const openDiagramForActor = (sessionId: string | null): void => {
        if (!sessionId) { return; }
        const actor = debuggerController.getStore().getState().actors.get(sessionId);
        if (!actor?.machine) { return; }
        const machine = findStaticMachine(workspaceScanner, actor.machine.id, actor.machine.sourceLocation, Object.keys(actor.machine.root.states));
        if (machine) { graphViewProvider.show(machine, machine.label); }
    };
    const setFollowDiagram = (value: boolean) => {
        followDiagram = value;
        void vscode.workspace.getConfiguration('xstateDebugger').update('followDiagram', value, vscode.ConfigurationTarget.Global);
        void vscode.commands.executeCommand('setContext', 'xstateDebugger.followDiagram', value);
        if (value) {
            lastFollowedActor = debuggerController.getStore().getState().selectedActorId;
            openDiagramForActor(lastFollowedActor);
        }
    };
    const debuggerFollowDiagramCommand = vscode.commands.registerCommand('xstateDebugger.followDiagram', () => setFollowDiagram(true));
    const debuggerUnfollowDiagramCommand = vscode.commands.registerCommand('xstateDebugger.unfollowDiagram', () => setFollowDiagram(false));
    debuggerController.setStaticLabelResolver((machineId, sourceLocation, rootStateKeys) =>
        findStaticMachine(workspaceScanner, machineId, sourceLocation, rootStateKeys)?.label);
    const debuggerFollowSub = debuggerController.getStore().subscribe(() => {
        if (!followDiagram) { return; }
        const st = debuggerController.getStore().getState();
        let target = st.selectedActorId;
        if (st.timeTravelSeq !== null) {
            const ev = st.events.find((e) => e.globalSeq === st.timeTravelSeq);
            if (ev) { target = ev.sessionId; }
        }
        if (target === lastFollowedActor) { return; }
        lastFollowedActor = target;
        openDiagramForActor(target);
    });
    const debuggerItemCommands = registerDebuggerCommands(debuggerController, graphViewProvider, workspaceScanner);
    const debuggerDecorationProvider = new DebuggerActiveDecorationProvider(debuggerController);
    const debuggerDecorationRegistration = vscode.window.registerFileDecorationProvider(debuggerDecorationProvider);
    const debuggerSetupDetector = new DebuggerSetupDetector(workspaceScanner);
    const debuggerRecheckCommand = vscode.commands.registerCommand('xstateDebugger.recheckSetup', async () => {
        await vscode.commands.executeCommand('setContext', 'xstateDebugger.setupChecking', true);
        try {
            await debuggerSetupDetector.refresh();
        } finally {
            await vscode.commands.executeCommand('setContext', 'xstateDebugger.setupChecking', false);
        }
    });
    const debuggerSetupOnVisible = debuggerTreeView.onDidChangeVisibility((e) => {
        if (e.visible) { void debuggerSetupDetector.refresh(); }
    });
    const debuggerSetupOnScan = workspaceScanner.onDidChange(() => void debuggerSetupDetector.refresh());
    const debuggerPkgWatcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    debuggerPkgWatcher.onDidChange(() => void debuggerSetupDetector.refresh());
    debuggerPkgWatcher.onDidCreate(() => void debuggerSetupDetector.refresh());
    debuggerPkgWatcher.onDidDelete(() => void debuggerSetupDetector.refresh());
    const debuggerBackToLiveCommand = vscode.commands.registerCommand('xstateDebugger.backToLive', () => debuggerController.backToLive());
    const debuggerStepBackCommand = vscode.commands.registerCommand('xstateDebugger.stepBack', () => debuggerController.stepBack());
    const debuggerStepForwardCommand = vscode.commands.registerCommand('xstateDebugger.stepForward', () => debuggerController.stepForward());
    const debuggerClearEventsCommand = vscode.commands.registerCommand('xstateDebugger.clearEvents', () => debuggerController.clearEvents());
    const debuggerCopyContextCommand = vscode.commands.registerCommand(
        'xstateDebugger.copyContextValue',
        (item?: ContextTreeItem) => {
            if (!item) { return; }
            const v = item.value;
            const text = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
            void vscode.env.clipboard.writeText(text ?? String(v));
        },
    );
    const debuggerConnectCommand = vscode.commands.registerCommand('xstateDebugger.connect', () => debuggerController.connect());
    const debuggerDisconnectCommand = vscode.commands.registerCommand('xstateDebugger.disconnect', () => debuggerController.disconnect());
    const debuggerToggleCommand = vscode.commands.registerCommand('xstateDebugger.toggle', () => debuggerController.toggle());
    const debuggerExportSessionCommand = vscode.commands.registerCommand('xstateDebugger.exportSession', () => debuggerController.exportSession());
    const debuggerImportSessionCommand = vscode.commands.registerCommand('xstateDebugger.importSession', () => debuggerController.importSession());

    // "Open invoked machine" on an invoke state → open that machine's diagram,
    // falling back to a running actor whose machine id matches the invoke src.
    graphViewProvider.setOpenInvokedHandler((src) => {
        let machine = findStaticMachine(workspaceScanner, src);
        if (!machine) {
            const running = [...debuggerController.getStore().getState().actors.values()]
                .find((a) => a.machine?.id === src);
            if (running?.machine) {
                machine = findStaticMachine(
                    workspaceScanner, running.machine.id, running.machine.sourceLocation,
                    Object.keys(running.machine.root.states),
                );
            }
        }
        if (machine) { graphViewProvider.show(machine, machine.label); }
        else { void vscode.window.showWarningMessage(`No machine named "${src}" found in the workspace to open.`); }
    });
    // Resolve an invoke `src` to its static machine so the diagram can nest the
    // invoked machine inline.
    graphViewProvider.setInvokeResolver((src) => findStaticMachine(workspaceScanner, src));

    context.subscriptions.push(
        outputChannel,
        workspaceScanner,
        eventsViewRegistration,
        debuggerTreeView,
        debuggerTreeSelectionListener,
        { dispose: () => debuggerFreezeIndicator() },
        debuggerContextTreeView,
        debuggerRevealActorSub,
        debuggerEventTreeView,
        debuggerEventTreeProvider,
        debuggerShowStoppedCommand,
        debuggerHideStoppedCommand,
        debuggerFollowDiagramCommand,
        debuggerUnfollowDiagramCommand,
        { dispose: () => debuggerFollowSub() },
        ...debuggerItemCommands,
        debuggerDecorationRegistration,
        debuggerRecheckCommand,
        debuggerSetupOnVisible,
        debuggerSetupOnScan,
        debuggerPkgWatcher,
        debuggerBackToLiveCommand,
        debuggerStepBackCommand,
        debuggerStepForwardCommand,
        debuggerClearEventsCommand,
        debuggerCopyContextCommand,
        debuggerConnectCommand,
        debuggerDisconnectCommand,
        debuggerToggleCommand,
        debuggerExportSessionCommand,
        debuggerImportSessionCommand,
        debuggerController,
    );
}

export function deactivate() { /* no-op */ }
