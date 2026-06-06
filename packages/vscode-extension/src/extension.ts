import * as vscode from 'vscode';
import { XStateMachineTreeProvider } from './treeProvider';
import { ImplementationFinder } from './implementationFinder';
import { FilterWebviewViewProvider } from './filterView';
import { XStateCompletionProvider } from './completionProvider';
import { XStateTreeEditor } from './treeEditor';
import { XStateCodeActionProvider } from './codeActions';
import { isSupportedXStateDocument, validateXStateDocument } from './diagnostics';
import { WorkspaceScanner } from './workspaceScanner';
import { XStateReferenceProvider, XStateRenameProvider } from './providers';
import { XStateHoverProvider } from './hoverProvider';
import { XStateGraphViewProvider } from './graphView';

let selectionTimeout: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('XState Machine Outline extension is now active');

    // Read persisted preferences and set contexts BEFORE creating the tree provider,
    // so the when-clause conditions are resolved before the first menu render.
    const config = vscode.workspace.getConfiguration('xstateOutline');
    const initialScope = config.get<string>('defaultScope', 'workspace');
    const initialViewMode = config.get<string>('defaultViewMode', 'flat');
    const initialShowStateConfigs = config.get<boolean>('showStateConfigs', false);
    const initialGroupEventHandlers = config.get<boolean>('groupEventHandlers', false);
    const initialSortChildren = config.get<string>('sortChildren', 'original');
    let followCursor = config.get<boolean>('followCursor', true);

    let graphReflectsTreeExpansion = config.get<boolean>('graphReflectsTreeExpansion', true);
    vscode.commands.executeCommand('setContext', 'xstateOutline.graphReflectsTreeExpansion', graphReflectsTreeExpansion);

    await Promise.all([
        vscode.commands.executeCommand('setContext', 'xstateOutline.scopeIsWorkspace', initialScope === 'workspace'),
        vscode.commands.executeCommand('setContext', 'xstateOutline.viewModeIsFlat', initialViewMode === 'flat'),
        vscode.commands.executeCommand('setContext', 'xstateOutline.showStateConfigs', initialShowStateConfigs),
        vscode.commands.executeCommand('setContext', 'xstateOutline.groupEventHandlers', initialGroupEventHandlers),
        vscode.commands.executeCommand('setContext', 'xstateOutline.sortChildrenIsSorted', initialSortChildren === 'sorted'),
        vscode.commands.executeCommand('setContext', 'xstateOutline.followCursor', followCursor),
        vscode.commands.executeCommand('setContext', 'xstateOutline.graphReflectsTreeExpansion', graphReflectsTreeExpansion),
    ]);

    const outputChannel = vscode.window.createOutputChannel('XState Outline');
    const workspaceScanner = new WorkspaceScanner(outputChannel);

    const treeProvider = new XStateMachineTreeProvider(context, workspaceScanner, outputChannel);
    
    const treeView = vscode.window.createTreeView('xstateMachineOutline', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });
    treeProvider.setTreeView(treeView);

    // Track which items are currently expanded so a click on an already-selected,
    // expanded node can collapse it (see navigateToNode).
    const expandedItems = new WeakSet<object>();
    const expandListener = treeView.onDidExpandElement(e => expandedItems.add(e.element));
    const collapseListener = treeView.onDidCollapseElement(e => expandedItems.delete(e.element));

    // ── Search WebviewView ────────────────────────────────────────────────────

    const filterViewProvider = new FilterWebviewViewProvider(context.extensionUri);
    const filterViewRegistration = vscode.window.registerWebviewViewProvider(
        FilterWebviewViewProvider.viewId,
        filterViewProvider
    );
    filterViewProvider.onDidSearch(text => {
        filterViewProvider.showResults(treeProvider.search(text));
    });

    filterViewProvider.onDidSelectItem(async ({ uriStr, line, char }) => {
        const uri = vscode.Uri.parse(uriStr);
        const pos = new vscode.Position(line, char);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
            selection: new vscode.Selection(pos, pos),
            preserveFocus: false
        });
        // Reveal in the outline tree after the editor activates
        setTimeout(() => {
            const item = treeProvider.findItemAtPosition(pos);
            if (item) {
                treeView.reveal(item, { select: true, focus: false, expand: true });
            }
        }, 400);
    });

    // ── Commands ─────────────────────────────────────────────────────────────

    const refreshCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.refresh',
        () => treeProvider.refresh()
    );

    const setScopeFileCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setScopeFile',
        () => treeProvider.setScope('file')
    );

    const setScopeWorkspaceCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setScopeWorkspace',
        () => treeProvider.setScope('workspace')
    );

    const setViewGroupedCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setViewGrouped',
        () => treeProvider.setViewMode('grouped')
    );

    const setViewFlatCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setViewFlat',
        () => treeProvider.setViewMode('flat')
    );

    const setStateConfigsShowCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setStateConfigsShow',
        () => treeProvider.setStateConfigs(true)
    );

    const setStateConfigsHideCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setStateConfigsHide',
        () => treeProvider.setStateConfigs(false)
    );

    const setGroupHandlersOnCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setGroupHandlersOn',
        () => treeProvider.setGroupEventHandlers(true)
    );

    const setGroupHandlersOffCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setGroupHandlersOff',
        () => treeProvider.setGroupEventHandlers(false)
    );

    const setSortChildrenSortedCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setSortChildrenSorted',
        () => treeProvider.setSortChildren('sorted')
    );

    const setSortChildrenOriginalCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setSortChildrenOriginal',
        () => treeProvider.setSortChildren('original')
    );

    const toggleFollowCursorCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.toggleFollowCursor',
        () => {
            followCursor = !followCursor;
            const cfg = vscode.workspace.getConfiguration('xstateOutline');
            cfg.update('followCursor', followCursor, vscode.ConfigurationTarget.Global);
            vscode.commands.executeCommand('setContext', 'xstateOutline.followCursor', followCursor);
        }
    );

    // ── Filter commands ───────────────────────────────────────────────────────

    const filterCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.filter',
        async () => {
            await vscode.commands.executeCommand(`${FilterWebviewViewProvider.viewId}.focus`);
            filterViewProvider.focusInput();
        }
    );

    const clearFilterCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.clearFilter',
        () => {
            treeProvider.clearFilter();
            filterViewProvider.clearInput();
        }
    );

    const editNodeCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.editNode',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.editNode(treeItem);
            treeProvider.refresh();
        }
    );

    const addChildStateCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.addChildState',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.addChildState(treeItem);
            treeProvider.refresh();
        }
    );

    const addTransitionCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.addTransition',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.addTransition(treeItem);
            treeProvider.refresh();
        }
    );

    const addReferenceCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.addReference',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.addReference(treeItem);
            treeProvider.refresh();
        }
    );

    const deleteNodeCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.deleteNode',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.deleteNode(treeItem);
            treeProvider.refresh();
        }
    );

    // ── Active-state noop commands (provide ✓ prefix via title) ──────────────

    const setScopeFileActiveCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setScopeFileActive', () => { /* already active */ }
    );
    const setScopeWorkspaceActiveCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setScopeWorkspaceActive', () => { /* already active */ }
    );
    const setViewGroupedActiveCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setViewGroupedActive', () => { /* already active */ }
    );
    const setViewFlatActiveCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setViewFlatActive', () => { /* already active */ }
    );
    const setStateConfigsShowActiveCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setStateConfigsShowActive', () => { /* already active */ }
    );
    const setStateConfigsHideActiveCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setStateConfigsHideActive', () => { /* already active */ }
    );
    const toggleFollowCursorActiveCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.toggleFollowCursorActive', () => {
            followCursor = !followCursor;
            const cfg = vscode.workspace.getConfiguration('xstateOutline');
            cfg.update('followCursor', followCursor, vscode.ConfigurationTarget.Global);
            vscode.commands.executeCommand('setContext', 'xstateOutline.followCursor', followCursor);
        }
    );

    const toggleGraphSyncExpansionCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.toggleGraphSyncExpansion',
        () => {
            graphReflectsTreeExpansion = !graphReflectsTreeExpansion;
            const cfg = vscode.workspace.getConfiguration('xstateOutline');
            cfg.update('graphReflectsTreeExpansion', graphReflectsTreeExpansion, vscode.ConfigurationTarget.Global);
            vscode.commands.executeCommand('setContext', 'xstateOutline.graphReflectsTreeExpansion', graphReflectsTreeExpansion);
            
            // Re-render graph if active
            graphViewProvider.refresh();
        }
    );

    const toggleGraphSyncExpansionActiveCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.toggleGraphSyncExpansionActive', () => {
            vscode.commands.executeCommand('xstateMachineOutline.toggleGraphSyncExpansion');
        }
    );

    const refreshGraphOnlyCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.refreshGraphOnly',
        () => {
            graphViewProvider.refresh();
        }
    );

    // Register "Go to Implementation" command
    const goToImplementationCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.goToImplementation',
        async (treeItem) => {
            if (!treeItem) { return; }

            if (treeItem.type === 'file' && treeItem.resourceUri) {
                const document = await vscode.workspace.openTextDocument(treeItem.resourceUri);
                await vscode.window.showTextDocument(document, { preserveFocus: false, preview: false });
                return;
            }

            if (!treeItem.node) { return; }

            if (treeItem.node.type === 'target') {
                const loc = treeProvider.resolveTargetLocation(treeItem.node);
                if (loc) {
                    await vscode.window.showTextDocument(loc.uri, {
                        selection: loc.range,
                        preserveFocus: false,
                        preview: false
                    });
                    return;
                }
            }

            // 1. Try VS Code's LSP definition provider at the source position.
            //    Works best with XState v5 typed setup() — the TS server resolves
            //    string action references directly.
            if (treeItem.uri && treeItem.range) {
                try {
                    const defs = await vscode.commands.executeCommand<vscode.Location[]>(
                        'vscode.executeDefinitionProvider',
                        treeItem.uri,
                        treeItem.range.start
                    );
                    if (defs && defs.length > 0) {
                        await vscode.window.showTextDocument(defs[0].uri, {
                            selection: defs[0].range,
                            preserveFocus: false
                        });
                        return;
                    }
                } catch { /* fall through */ }
            }

            // 2. Fall back to AST-based search (same file → imports → workspace symbols)
            const functionName = ImplementationFinder.extractFunctionName(treeItem.node.label);
            if (!functionName) {
                if (treeItem.uri && treeItem.range) {
                    await vscode.window.showTextDocument(treeItem.uri, {
                        selection: treeItem.range,
                        preserveFocus: false,
                        preview: false
                    });
                }
                return;
            }

            let document: vscode.TextDocument | undefined;
            if (treeItem.uri) {
                try { document = await vscode.workspace.openTextDocument(treeItem.uri); } catch { }
            }
            if (!document) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) { return; }
                document = editor.document;
            }

            const result = await ImplementationFinder.findImplementation(functionName, document);
            if (result) {
                await vscode.window.showTextDocument(result.document.uri, {
                    selection: result.range,
                    preserveFocus: false
                });
            } else {
                if (treeItem.uri && treeItem.range) {
                    await vscode.window.showTextDocument(treeItem.uri, {
                        selection: treeItem.range,
                        preserveFocus: false,
                        preview: false
                    });
                }
            }
        }
    );

    // ── Navigate to source position (reuses existing tab) ────────────────────
    let lastClickedItem: unknown = undefined;
    let lastClickTime = 0;
    const DOUBLE_CLICK_MS = 500;

    const navigateToNodeCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.navigateToNode',
        async (treeItem) => {
            if (!treeItem?.uri || !treeItem?.range) { return; }

            const now = Date.now();
            const isDoubleClick = treeItem === lastClickedItem && (now - lastClickTime) < DOUBLE_CLICK_MS;
            const wasAlreadySelected = treeItem === lastClickedItem;
            lastClickedItem = treeItem;
            lastClickTime = now;

            if (isDoubleClick) {
                const implementable = ['action', 'guard', 'entry', 'exit', 'invoke'];
                if (implementable.includes(treeItem.node?.type)) {
                    await vscode.commands.executeCommand('xstateMachineOutline.goToImplementation', treeItem);
                    return;
                }
                // Double-clicking a transition target jumps to the state it points to
                if (treeItem.node?.type === 'target') {
                    const loc = treeProvider.resolveTargetLocation(treeItem.node);
                    if (loc) {
                        await vscode.window.showTextDocument(loc.uri, {
                            selection: loc.range,
                            preserveFocus: false,
                            preview: false
                        });
                        const stateItem = treeProvider.findItemAtPosition(loc.range.start);
                        if (stateItem) {
                            treeView.reveal(stateItem, { select: true, focus: false, expand: true });
                        }
                        return;
                    }
                    // Couldn't resolve the target state — fall through to source navigation
                }
                // For non-implementable types, double-click is the same as single-click
            }

            // Clicking an already-selected, expanded node collapses it.
            if (wasAlreadySelected
                && treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None
                && expandedItems.has(treeItem)) {
                treeProvider.collapseItem(treeItem);
                expandedItems.delete(treeItem);
                return;
            }

            await vscode.window.showTextDocument(treeItem.uri, {
                selection: treeItem.range,
                preserveFocus: true,
                preview: false
            });
            treeView.reveal(treeItem, { select: true, focus: false, expand: true });
        }
    );

    // ── Cursor sync ───────────────────────────────────────────────────────────
    let isTreeSelectionChange = false;

    const cursorChangeListener = vscode.window.onDidChangeTextEditorSelection(async (e) => {
        if (!followCursor || isTreeSelectionChange || treeProvider.getFilterText()) { return; }

        const editor = e.textEditor;
        if (editor !== vscode.window.activeTextEditor) { return; }

        if (selectionTimeout) { clearTimeout(selectionTimeout); }

        selectionTimeout = setTimeout(() => {
            const position = editor.selection.active;
            const item = treeProvider.findItemAtPosition(position);

            if (item && treeView.visible) {
                isTreeSelectionChange = true;
                treeView.reveal(item, { select: true, focus: false });
                setTimeout(() => { isTreeSelectionChange = false; }, 300);
            }
            
            // Sync with graph view
            if (item && item.node && item.node.type === 'state') {
                graphViewProvider.highlightState(item.node.label);
            }
        }, 300);
    });

    // ── Go to implementation for focused tree item (F12 when tree focused) ───
    const goToImplementationSelectedCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.goToImplementationSelected',
        async () => {
            const selected = treeView.selection[0];
            if (selected) {
                await vscode.commands.executeCommand(
                    'xstateMachineOutline.goToImplementation',
                    selected
                );
            }
        }
    );

    // ── Definition / Implementation provider — F12 / Shift+F12 in editor ────────
    const xstateLanguages = [
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'typescriptreact' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'javascriptreact' },
    ];

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('xstate');
    const pendingDiagnosticUpdates = new Map<string, NodeJS.Timeout>();

    const clearPendingDiagnosticUpdate = (uri: vscode.Uri) => {
        const key = uri.toString();
        const timeout = pendingDiagnosticUpdates.get(key);
        if (timeout) {
            clearTimeout(timeout);
            pendingDiagnosticUpdates.delete(key);
        }
    };

    const updateDiagnostics = (document: vscode.TextDocument) => {
        clearPendingDiagnosticUpdate(document.uri);

        if (!isSupportedXStateDocument(document)) {
            diagnosticCollection.delete(document.uri);
            return;
        }

        diagnosticCollection.set(document.uri, validateXStateDocument(document));
    };

    const scheduleDiagnostics = (document: vscode.TextDocument, delay = 200) => {
        clearPendingDiagnosticUpdate(document.uri);

        if (!isSupportedXStateDocument(document)) {
            diagnosticCollection.delete(document.uri);
            return;
        }

        const key = document.uri.toString();
        pendingDiagnosticUpdates.set(key, setTimeout(() => {
            pendingDiagnosticUpdates.delete(key);
            updateDiagnostics(document);
        }, delay));
    };

    function extractNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
        const line = document.lineAt(position.line).text;
        const col  = position.character;
        // Walk left/right over identifier chars (works inside quoted strings too)
        let s = col, e = col;
        while (s > 0 && /[a-zA-Z0-9_$]/.test(line[s - 1])) { s--; }
        while (e < line.length && /[a-zA-Z0-9_$]/.test(line[e])) { e++; }
        const name = line.slice(s, e);
        if (!name || name.length < 2) { return null; }
        const tsKeywords = new Set(['const','let','var','function','return','import','export',
            'from','class','interface','type','enum','extends','implements','new','this',
            'true','false','null','undefined','if','else','for','while','switch','case']);
        return tsKeywords.has(name) ? null : name;
    }

    const definitionProvider = vscode.languages.registerDefinitionProvider(
        xstateLanguages,
        {
            async provideDefinition(document, position) {
                const name = extractNameAtPosition(document, position);
                if (!name) { return null; }
                const result = await ImplementationFinder.findImplementation(name, document);
                if (!result) { return null; }
                return new vscode.Location(result.document.uri, result.range);
            }
        }
    );

    const implementationProvider = vscode.languages.registerImplementationProvider(
        xstateLanguages,
        {
            async provideImplementation(document, position) {
                const name = extractNameAtPosition(document, position);
                if (!name) { return null; }
                const result = await ImplementationFinder.findImplementation(name, document);
                if (!result) { return null; }
                return new vscode.Location(result.document.uri, result.range);
            }
        }
    );

    // ── Completion provider for XState machine configurations ───────────────
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        xstateLanguages,
        new XStateCompletionProvider(),
        ':', // Trigger after colon (property assignments)
        '\'', // Trigger for string value suggestions
        '"', // Trigger for string value suggestions
        '`', // Trigger for template-string value suggestions
    );

    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        xstateLanguages,
        new XStateCodeActionProvider(),
        { providedCodeActionKinds: XStateCodeActionProvider.providedCodeActionKinds }
    );

    const refProvider = vscode.languages.registerReferenceProvider(
        xstateLanguages,
        new XStateReferenceProvider(workspaceScanner)
    );

    const renameProvider = vscode.languages.registerRenameProvider(
        xstateLanguages,
        new XStateRenameProvider(workspaceScanner)
    );

    const hoverProvider = vscode.languages.registerHoverProvider(
        xstateLanguages,
        new XStateHoverProvider(workspaceScanner)
    );

    const editorChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) { return; }
        treeProvider.refresh();
        scheduleDiagnostics(editor.document, 0);
    });

    const documentOpenListener = vscode.workspace.onDidOpenTextDocument((document) => {
        scheduleDiagnostics(document, 0);
    });

    const documentCloseListener = vscode.workspace.onDidCloseTextDocument((document) => {
        clearPendingDiagnosticUpdate(document.uri);
        diagnosticCollection.delete(document.uri);
    });

    const documentChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
        scheduleDiagnostics(e.document);

        if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
            setImmediate(() => treeProvider.handleDocumentChange(e.document));
        }
    });

    vscode.workspace.textDocuments.forEach((document) => updateDiagnostics(document));

    if (vscode.window.activeTextEditor) {
        setTimeout(() => {
            if (!followCursor) { return; }
            const position = vscode.window.activeTextEditor!.selection.active;
            const item = treeProvider.findItemAtPosition(position);
            if (item && treeView.visible) {
                treeView.reveal(item, { select: true, focus: false });
            }
        }, 500);
    }

    const graphViewProvider = new XStateGraphViewProvider(context.extensionUri, treeProvider);

    // When the user selects a node in the tree, sync the diagram:
    // - state node  → highlight it in the current graph
    // - machine node → switch the graph to show that machine
    const treeSelectionListener = treeView.onDidChangeSelection(e => {
        if (isTreeSelectionChange) { return; } // ignore programmatic reveals driven by cursor sync
        const item = e.selection[0];
        if (!item?.node) { return; }
        if (item.node.type === 'state') {
            graphViewProvider.highlightState(item.node.label);
        } else if (item.node.type === 'machine') {
            graphViewProvider.show(item.node, item.node.label);
        }
    });

    const openGraphViewCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.openGraphView',
        (treeItem) => {
            if (!treeItem?.node) { return; }
            
            let machineNode = treeItem.node;
            
            // If they clicked on a state, find the root machine using the workspaceScanner cache
            if (machineNode.type === 'state' && treeItem.uri) {
                const fileMachines = workspaceScanner.getFile(treeItem.uri);
                if (fileMachines) {
                    for (const m of fileMachines.machines) {
                        if (m.range.contains(machineNode.range)) {
                            machineNode = m;
                            break;
                        }
                    }
                }
            }
            
            graphViewProvider.show(machineNode, machineNode.label);
        }
    );

    context.subscriptions.push(
        treeView,
        expandListener,
        collapseListener,
        treeSelectionListener,
        filterViewRegistration,
        refreshCommand,
        setScopeFileCommand,
        setScopeFileActiveCommand,
        setScopeWorkspaceCommand,
        setScopeWorkspaceActiveCommand,
        setViewGroupedCommand,
        setViewGroupedActiveCommand,
        setViewFlatCommand,
        setViewFlatActiveCommand,
        setStateConfigsShowCommand,
        setStateConfigsShowActiveCommand,
        setStateConfigsHideCommand,
        setStateConfigsHideActiveCommand,
        setGroupHandlersOnCommand,
        setGroupHandlersOffCommand,
        setSortChildrenSortedCommand,
        setSortChildrenOriginalCommand,
        toggleFollowCursorCommand,
        toggleFollowCursorActiveCommand,
        toggleGraphSyncExpansionCommand,
        toggleGraphSyncExpansionActiveCommand,
        filterCommand,
        clearFilterCommand,
        editNodeCommand,
        addChildStateCommand,
        addTransitionCommand,
        addReferenceCommand,
        deleteNodeCommand,
        openGraphViewCommand,
        refreshGraphOnlyCommand,
        navigateToNodeCommand,
        goToImplementationCommand,
        definitionProvider,
        implementationProvider,
        completionProvider,
        codeActionProvider,
        refProvider,
        renameProvider,
        hoverProvider,
        diagnosticCollection,
        goToImplementationSelectedCommand,
        editorChangeListener,
        documentOpenListener,
        documentCloseListener,
        documentChangeListener,
        cursorChangeListener,
        {
            dispose: () => {
                pendingDiagnosticUpdates.forEach((timeout) => clearTimeout(timeout));
                pendingDiagnosticUpdates.clear();
            }
        }
    );
}

export function deactivate() {}
