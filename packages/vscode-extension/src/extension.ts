import * as vscode from 'vscode';
import { XStateMachineTreeProvider } from './treeProvider';
import { MachineNode, XStateMachineParser } from './parser';
import { findNodeAtPosition } from './utils';
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
import { DebuggerController } from './debugger/debuggerController';
import { DebuggerViewProvider } from './debugger/debuggerView';
import { DebuggerTreeProvider } from './debugger/debuggerTreeProvider';
import { DebuggerContextTreeProvider } from './debugger/debuggerContextTreeProvider';
import { NavigatorTreeProvider, TransitionRef } from './navigatorView';
import { ErrorsTreeProvider, ErrorsGrouping, ErrorsFilter } from './errorsView';
import { XStateCodeLensProvider } from './codeLensProvider';
import { toSetupStubs } from './export/setupStubs';

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
    const initialErrorsGrouping = config.get<ErrorsGrouping>('errorsGrouping', 'file');
    const initialErrorsFilter = config.get<ErrorsFilter>('errorsFilter', 'warning');
    let followCursor = config.get<boolean>('followCursor', true);
    // Where a tree-node click navigates: 'code' (jump to source) or 'diagram'
    // (focus the state/machine in the diagram, opening it if needed).
    let navTarget = config.get<'code' | 'diagram'>('navTarget', 'code');

    let graphReflectsTreeExpansion = config.get<boolean>('graphReflectsTreeExpansion', true);
    vscode.commands.executeCommand('setContext', 'xstateOutline.graphReflectsTreeExpansion', graphReflectsTreeExpansion);

    await Promise.all([
        vscode.commands.executeCommand('setContext', 'xstateOutline.scopeIsWorkspace', initialScope === 'workspace'),
        vscode.commands.executeCommand('setContext', 'xstateOutline.viewModeIsFlat', initialViewMode === 'flat'),
        vscode.commands.executeCommand('setContext', 'xstateOutline.showStateConfigs', initialShowStateConfigs),
        vscode.commands.executeCommand('setContext', 'xstateOutline.groupEventHandlers', initialGroupEventHandlers),
        vscode.commands.executeCommand('setContext', 'xstateOutline.sortChildrenIsSorted', initialSortChildren === 'sorted'),
        vscode.commands.executeCommand('setContext', 'xstateErrors.grouping', initialErrorsGrouping),
        vscode.commands.executeCommand('setContext', 'xstateErrors.filter', initialErrorsFilter),
        vscode.commands.executeCommand('setContext', 'xstateOutline.followCursor', followCursor),
        vscode.commands.executeCommand('setContext', 'xstateOutline.graphReflectsTreeExpansion', graphReflectsTreeExpansion),
        vscode.commands.executeCommand('setContext', 'xstateOutline.navIsDiagram', navTarget === 'diagram'),
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
    // Timestamp of the last user-driven tree interaction. Cursor sync uses this to
    // avoid yanking the selection while the user is actively working in the tree.
    let lastTreeInteraction = 0;
    const expandListener = treeView.onDidExpandElement(e => { expandedItems.add(e.element); lastTreeInteraction = Date.now(); });
    const collapseListener = treeView.onDidCollapseElement(e => { expandedItems.delete(e.element); lastTreeInteraction = Date.now(); });

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

    const setNavTarget = (target: 'code' | 'diagram') => {
        navTarget = target;
        vscode.workspace.getConfiguration('xstateOutline').update('navTarget', target, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateOutline.navIsDiagram', target === 'diagram');
    };
    const setNavCodeCommand = vscode.commands.registerCommand('xstateMachineOutline.setNavCode', () => setNavTarget('code'));
    const setNavDiagramCommand = vscode.commands.registerCommand('xstateMachineOutline.setNavDiagram', () => setNavTarget('diagram'));

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
            await XStateTreeEditor.editNode(treeItem.node);
            treeProvider.refresh();
        }
    );

    const addChildStateCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.addChildState',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.addChildState(treeItem.node);
            treeProvider.refresh();
        }
    );

    const addTransitionCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.addTransition',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.addTransition(treeItem.node);
            treeProvider.refresh();
        }
    );

    const addReferenceCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.addReference',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.addReference(treeItem.node);
            treeProvider.refresh();
        }
    );

    const deleteNodeCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.deleteNode',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.deleteNode(treeItem.node);
            treeProvider.refresh();
        }
    );

    const setDescriptionCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setDescription',
        async (treeItem) => {
            if (!treeItem?.node) { return; }
            await XStateTreeEditor.setDescription(treeItem.node);
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
                    // Ignore definitions that land in dependencies or type declarations:
                    // a guard/action implementation lives in the user's own source. For a
                    // guard string nested in and()/or()/not(), the TS server resolves the
                    // *type* of the array element into xstate's .d.ts — following that would
                    // jump into node_modules instead of the impl. Skip those and fall through
                    // to the AST finder, which resolves the name against setup({ guards }).
                    const usable = (defs ?? []).find(d =>
                        !/[/\\]node_modules[/\\]/.test(d.uri.fsPath) && !d.uri.fsPath.endsWith('.d.ts'));
                    if (usable) {
                        await vscode.window.showTextDocument(usable.uri, {
                            selection: usable.range,
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
    // Node types that have a distinct double-click action. Only these defer their
    // single-click navigation behind a timer (so a second click can "upgrade" to
    // the double-click action without first jumping to source). Every other type
    // navigates immediately — no latency for the common case.
    const DOUBLE_CLICK_TYPES = ['action', 'guard', 'entry', 'exit', 'invoke', 'target'];
    let lastClickedItem: unknown = undefined;
    let lastClickTime = 0;
    let pendingClickTimer: NodeJS.Timeout | undefined;
    const DOUBLE_CLICK_MS = 300;

    // Single-click behavior: collapse an already-selected expanded node, else
    // reveal the node's own source location.
    const performSingleClick = async (treeItem: any, wasAlreadySelected: boolean) => {
        if (wasAlreadySelected
            && treeItem.collapsibleState !== vscode.TreeItemCollapsibleState.None
            && expandedItems.has(treeItem)) {
            treeProvider.collapseItem(treeItem);
            expandedItems.delete(treeItem);
            return;
        }
        // Diagram-nav mode: focus the state/machine in the diagram (opening it if
        // needed) instead of jumping the editor. Other node types (actions, guards,
        // …) have no diagram target, so they still navigate to source.
        const nodeType = treeItem.node?.type;
        if (navTarget === 'diagram' && (nodeType === 'state' || nodeType === 'machine')) {
            const node: MachineNode = treeItem.node;
            const root = node.type === 'machine' ? node : (enclosingMachine(node, treeItem.uri) ?? node);
            graphViewProvider.show(root, root.label, node.type === 'state' ? node.label : undefined);
            treeView.reveal(treeItem, { select: true, focus: false });
            return;
        }
        await vscode.window.showTextDocument(treeItem.uri, {
            selection: treeItem.range,
            preserveFocus: true,
            preview: false
        });
        // Select (keep highlighted) but do NOT force-expand: expanding the clicked
        // item here re-opens a machine/compound the moment the user collapses it.
        // `reveal` still auto-expands ancestors to keep the item visible.
        treeView.reveal(treeItem, { select: true, focus: false });
    };

    // Double-click behavior. Returns true if it handled the click; false if the
    // type has no double-click action (caller falls back to single-click).
    const performDoubleClick = async (treeItem: any): Promise<boolean> => {
        const implementable = ['action', 'guard', 'entry', 'exit', 'invoke'];
        if (implementable.includes(treeItem.node?.type)) {
            await vscode.commands.executeCommand('xstateMachineOutline.goToImplementation', treeItem);
            return true;
        }
        // Double-clicking a transition target jumps to the state it points to.
        if (treeItem.node?.type === 'target') {
            const loc = treeProvider.resolveTargetLocation(treeItem.node);
            if (loc) {
                await vscode.window.showTextDocument(loc.uri, {
                    selection: loc.range,
                    preserveFocus: false,
                    preview: false
                });
                // Select the destination state in the outline. Revealing it fires
                // the tree selection listener, which repoints the Transitions pane.
                const stateItem = treeProvider.findItemAtPosition(loc.range.start);
                if (stateItem?.node) {
                    treeView.reveal(stateItem, { select: true, focus: false, expand: true });
                }
                return true;
            }
            // Couldn't resolve the target state — fall through to source navigation.
        }
        return false;
    };

    const navigateToNodeCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.navigateToNode',
        async (treeItem) => {
            if (!treeItem?.uri || !treeItem?.range) { return; }

            const now = Date.now();
            const isDoubleClick = treeItem === lastClickedItem && (now - lastClickTime) < DOUBLE_CLICK_MS;
            const wasAlreadySelected = treeItem === lastClickedItem;
            lastClickTime = now;

            if (isDoubleClick) {
                // Second click in time: cancel the deferred single-click so we
                // never navigate to source AND to implementation on one gesture.
                if (pendingClickTimer) { clearTimeout(pendingClickTimer); pendingClickTimer = undefined; }
                lastClickedItem = undefined; // reset so a third click starts fresh
                if (await performDoubleClick(treeItem)) { return; }
                // Type has no double-click action — do a single navigation instead.
                await performSingleClick(treeItem, wasAlreadySelected);
                return;
            }

            lastClickedItem = treeItem;

            // Types with no double-click action navigate immediately.
            if (!DOUBLE_CLICK_TYPES.includes(treeItem.node?.type)) {
                await performSingleClick(treeItem, wasAlreadySelected);
                return;
            }

            // Defer so a follow-up click can upgrade this to a double-click.
            if (pendingClickTimer) { clearTimeout(pendingClickTimer); }
            pendingClickTimer = setTimeout(() => {
                pendingClickTimer = undefined;
                void performSingleClick(treeItem, wasAlreadySelected);
            }, DOUBLE_CLICK_MS);
        }
    );

    // ── Cursor sync ───────────────────────────────────────────────────────────
    let isTreeSelectionChange = false;

    const TREE_INTERACTION_GRACE_MS = 400;
    const cursorChangeListener = vscode.window.onDidChangeTextEditorSelection(async (e) => {
        if (!followCursor || isTreeSelectionChange || treeProvider.getFilterText()) { return; }

        const editor = e.textEditor;
        if (editor !== vscode.window.activeTextEditor) { return; }

        if (selectionTimeout) { clearTimeout(selectionTimeout); }

        selectionTimeout = setTimeout(() => {
            // Don't fight the user: skip if they just interacted with the tree.
            if (Date.now() - lastTreeInteraction < TREE_INTERACTION_GRACE_MS) { return; }

            const position = editor.selection.active;
            const item = treeProvider.findItemAtPosition(position);

            // Only reveal when it would actually change the selection — re-selecting
            // the already-selected item is what yanks the tree out from under the user.
            if (item && treeView.visible && treeView.selection[0] !== item) {
                isTreeSelectionChange = true;
                // Expand collapsed ancestors so the cursor's node is revealed, not
                // just selected behind a collapsed parent.
                // Tie the guard release to the reveal completing, not a fixed timer.
                void Promise.resolve(treeView.reveal(item, { select: true, focus: false, expand: true }))
                    .then(() => { isTreeSelectionChange = false; }, () => { isTreeSelectionChange = false; });
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
                if (result) { return new vscode.Location(result.document.uri, result.range); }
                // Fall back to a transition target's state definition.
                const state = treeProvider.resolveStateLocationByName(name, document, position);
                return state ? new vscode.Location(state.uri, state.range) : null;
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
                if (result) { return new vscode.Location(result.document.uri, result.range); }
                // Not an action/guard/service — it may be a transition target
                // (state name). Fall back to the state's own definition.
                const state = treeProvider.resolveStateLocationByName(name, document, position);
                return state ? new vscode.Location(state.uri, state.range) : null;
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

    // Gate the editor's "View State Diagram" menu on whether the active file
    // actually contains a machine, so it doesn't clutter every JS/TS file.
    const updateEditorHasMachine = (editor?: vscode.TextEditor) => {
        const hasMachine = !!editor
            && isSupportedXStateDocument(editor.document)
            && XStateMachineParser.parseMachines(editor.document).length > 0;
        vscode.commands.executeCommand('setContext', 'xstateOutline.editorHasMachine', hasMachine);
    };
    updateEditorHasMachine(vscode.window.activeTextEditor);

    const editorChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (!editor) { vscode.commands.executeCommand('setContext', 'xstateOutline.editorHasMachine', false); return; }
        treeProvider.refresh();
        scheduleDiagnostics(editor.document, 0);
        updateEditorHasMachine(editor);
    });

    const documentOpenListener = vscode.workspace.onDidOpenTextDocument((document) => {
        scheduleDiagnostics(document, 0);
    });

    const documentCloseListener = vscode.workspace.onDidCloseTextDocument((document) => {
        clearPendingDiagnosticUpdate(document.uri);
        diagnosticCollection.delete(document.uri);
    });

    let graphUpdateTimer: NodeJS.Timeout | undefined;
    const documentChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
        scheduleDiagnostics(e.document);

        if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
            setImmediate(() => treeProvider.handleDocumentChange(e.document));
            // In file scope the scanner isn't updated on edits, so drive the Errors
            // pane directly. In workspace scope the scanner's change event handles it.
            if (treeProvider.getScope() === 'file' && isSupportedXStateDocument(e.document)) {
                markErrorsDirty(e.document.uri);
            }
        }

        // Live-update any open diagram rooted in this document. Debounced and
        // gated on an actually-open panel so we don't re-parse on every keystroke.
        if (graphViewProvider.hasPanelForDocument(e.document.uri)) {
            if (graphUpdateTimer) { clearTimeout(graphUpdateTimer); }
            const doc = e.document;
            graphUpdateTimer = setTimeout(() => {
                graphUpdateTimer = undefined;
                graphViewProvider.updateForDocument(doc.uri, XStateMachineParser.parseMachines(doc));
            }, 300);
        }
    });

    vscode.workspace.textDocuments.forEach((document) => updateDiagnostics(document));

    if (vscode.window.activeTextEditor) {
        setTimeout(() => {
            if (!followCursor) { return; }
            const position = vscode.window.activeTextEditor!.selection.active;
            const item = treeProvider.findItemAtPosition(position);
            if (item && treeView.visible) {
                treeView.reveal(item, { select: true, focus: false, expand: true });
            }
        }, 500);
    }

    const graphViewProvider = new XStateGraphViewProvider(context.extensionUri, treeProvider);

    // ── Live debugger ──────────────────────────────────────────────────────────
    // Attaches to a running app's server adapter (createServerAdapter) over a
    // WebSocket and overlays each running machine's active state onto its open
    // statechart diagram.
    const debuggerController = new DebuggerController(graphViewProvider);
    // Two webview views back the debugger UI: the instances/inspector panel (its
    // own activity-bar container, dockable to the right) and the event log
    // (bottom panel). Both share the controller's store.
    const debuggerViewRegistration = vscode.window.registerWebviewViewProvider(
        DebuggerViewProvider.debuggerViewType,
        new DebuggerViewProvider(context.extensionUri, debuggerController, 'debugger'),
    );
    const eventsViewRegistration = vscode.window.registerWebviewViewProvider(
        DebuggerViewProvider.eventsViewType,
        new DebuggerViewProvider(context.extensionUri, debuggerController, 'events'),
    );
    // Native instances tree (machine instances + their live state trees).
    const debuggerTreeProvider = new DebuggerTreeProvider(context.extensionUri, debuggerController);
    const debuggerTreeView = vscode.window.createTreeView('xstateDebuggerInstances', {
        treeDataProvider: debuggerTreeProvider,
    });
    const debuggerTreeSelectionListener = debuggerTreeView.onDidChangeSelection((e) => {
        const item = e.selection[0];
        if (item) { debuggerController.selectActor(item.sessionId); }
    });
    // Native context tree for the selected actor (expandable JSON).
    const debuggerContextTreeProvider = new DebuggerContextTreeProvider(debuggerController);
    const debuggerContextTreeView = vscode.window.createTreeView('xstateDebuggerContext', {
        treeDataProvider: debuggerContextTreeProvider,
    });
    // Show/hide stopped actors — toggle in the Instances view's "…" menu.
    const setShowStopped = (value: boolean) => {
        debuggerTreeProvider.setShowStopped(value);
        void vscode.commands.executeCommand('setContext', 'xstateDebugger.showStopped', value);
    };
    void vscode.commands.executeCommand('setContext', 'xstateDebugger.showStopped', debuggerTreeProvider.getShowStopped());
    const debuggerShowStoppedCommand = vscode.commands.registerCommand('xstateDebugger.showStopped', () => setShowStopped(true));
    const debuggerHideStoppedCommand = vscode.commands.registerCommand('xstateDebugger.hideStopped', () => setShowStopped(false));
    const debuggerConnectCommand = vscode.commands.registerCommand('xstateDebugger.connect', () => debuggerController.connect());
    const debuggerDisconnectCommand = vscode.commands.registerCommand('xstateDebugger.disconnect', () => debuggerController.disconnect());
    const debuggerToggleCommand = vscode.commands.registerCommand('xstateDebugger.toggle', () => debuggerController.toggle());
    const debuggerExportSessionCommand = vscode.commands.registerCommand('xstateDebugger.exportSession', () => debuggerController.exportSession());
    const debuggerImportSessionCommand = vscode.commands.registerCommand('xstateDebugger.importSession', () => debuggerController.importSession());

    // "Transitions" view — the selected state's incoming (←) / outgoing (→)
    // transitions.
    const navigatorProvider = new NavigatorTreeProvider(
        node => treeProvider.findMachineContaining(node),
        target => treeProvider.resolveTargetLocation(target),
        node => treeProvider.machineKeyOf(node),
    );
    const navigatorView = vscode.window.createTreeView('xstateMachineNavigator', { treeDataProvider: navigatorProvider });

    // ── Errors pane ──────────────────────────────────────────────────────────
    // Aggregates every XState diagnostic (orphaned states, unknown refs, …) into a
    // navigable tree. Scope follows the outline's file/workspace toggle.
    const errorsProvider = new ErrorsTreeProvider(
        () => treeProvider.getScope(),
        workspaceScanner,
        initialErrorsGrouping,
        initialErrorsFilter,
    );
    const errorsView = vscode.window.createTreeView('xstateMachineErrors', { treeDataProvider: errorsProvider, showCollapseAll: true });

    // Keep the badge in sync with whatever the provider currently shows.
    const updateErrorsBadge = () => {
        const count = errorsProvider.totalCount();
        errorsView.badge = count > 0 ? { value: count, tooltip: 'XState problems' } : undefined;
    };
    const errorsBadgeListener = errorsProvider.onDidChangeTreeData(() => updateErrorsBadge());

    // Incremental refresh: coalesce per-file changes and bulk rebuilds over a short
    // debounce. Bulk (scope change / scan complete) re-validates everything; per-file
    // changes (a single edited/created/deleted machine file) re-validate just that file.
    const errorsDirty = new Set<string>();
    let errorsBulkPending = true;
    let errorsTimer: NodeJS.Timeout | undefined;
    const flushErrors = async () => {
        errorsTimer = undefined;
        if (errorsBulkPending) {
            errorsBulkPending = false;
            errorsDirty.clear();
            await errorsProvider.refresh();
        } else {
            const uris = [...errorsDirty];
            errorsDirty.clear();
            for (const u of uris) { await errorsProvider.updateUri(vscode.Uri.parse(u)); }
        }
    };
    const scheduleErrors = (delay = 300) => {
        if (errorsTimer) { clearTimeout(errorsTimer); }
        errorsTimer = setTimeout(() => void flushErrors(), delay);
    };
    const markErrorsBulk = () => { errorsBulkPending = true; scheduleErrors(); };
    const markErrorsDirty = (uri: vscode.Uri) => { errorsDirty.add(uri.toString()); scheduleErrors(); };

    // Workspace-scope staleness flows through the scanner (it re-parses on edits,
    // file-watcher events, and scans). File scope is driven by editor/document
    // events below instead.
    const errorsScanListener = workspaceScanner.onDidChange(change => {
        if (treeProvider.getScope() !== 'workspace') { return; }
        if (!change) { markErrorsBulk(); }
        else if (change.kind === 'remove') { errorsProvider.removeUri(change.uri); }
        else { markErrorsDirty(change.uri); }
    });

    scheduleErrors(0);

    const openErrorCommand = vscode.commands.registerCommand(
        'xstateErrors.open',
        async (uri: vscode.Uri, range: vscode.Range) => {
            if (!uri || !range) { return; }
            await vscode.window.showTextDocument(uri, { selection: range, preserveFocus: false, preview: false });
        }
    );

    // Copy one or more selected error rows / groups to the clipboard. Invoked
    // from the context menu (passes the clicked node + the full selection) or via
    // the keybinding (no args — fall back to the view's current selection).
    const copyErrorCommand = vscode.commands.registerCommand(
        'xstateErrors.copy',
        async (node?: unknown, selection?: unknown[]) => {
            const nodes = (selection && selection.length ? selection : node ? [node] : errorsView.selection) as Parameters<typeof errorsProvider.copyText>[0][];
            const text = nodes.map(n => errorsProvider.copyText(n)).filter(Boolean).join('\n');
            if (text) { await vscode.env.clipboard.writeText(text); }
        }
    );

    const setErrorsGrouping = (grouping: ErrorsGrouping) => {
        const cfg = vscode.workspace.getConfiguration('xstateOutline');
        cfg.update('errorsGrouping', grouping, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateErrors.grouping', grouping);
        errorsProvider.setGrouping(grouping);
    };
    const setErrorsGroupingFileCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setErrorsGroupingFile', () => setErrorsGrouping('file'));
    const setErrorsGroupingSeverityCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setErrorsGroupingSeverity', () => setErrorsGrouping('severity'));
    const setErrorsGroupingFlatCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setErrorsGroupingFlat', () => setErrorsGrouping('flat'));

    const setErrorsFilter = (filter: ErrorsFilter) => {
        const cfg = vscode.workspace.getConfiguration('xstateOutline');
        cfg.update('errorsFilter', filter, vscode.ConfigurationTarget.Global);
        vscode.commands.executeCommand('setContext', 'xstateErrors.filter', filter);
        errorsProvider.setFilter(filter); // fires onDidChangeTreeData → badge updates
    };
    const setErrorsFilterAllCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setErrorsFilterAll', () => setErrorsFilter('all'));
    const setErrorsFilterWarningsCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setErrorsFilterWarnings', () => setErrorsFilter('warning'));
    const setErrorsFilterErrorsCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.setErrorsFilterErrors', () => setErrorsFilter('error'));

    // File scope is driven by the active editor: switching files rebuilds (it
    // validates only the active doc); scope toggles rebuild for the new scope.
    const errorsEditorListener = vscode.window.onDidChangeActiveTextEditor(() => {
        if (treeProvider.getScope() === 'file') { markErrorsBulk(); }
    });
    const errorsConfigListener = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('xstateOutline.defaultScope')) { markErrorsBulk(); }
    });

    // Click a transition row: navigate to the other state and select it in the
    // outline. Revealing the item fires the tree selection listener, which
    // repoints the Transitions pane at the newly selected state.
    const openTransitionCommand = vscode.commands.registerCommand(
        'xstateNavigator.openTransition',
        async (ref: TransitionRef) => {
            if (!ref?.otherUri) { return; }
            await vscode.window.showTextDocument(ref.otherUri, { selection: ref.otherRange, preserveFocus: false, preview: false });
            const item = treeProvider.findItemAtPosition(ref.otherRange.start);
            if (item && treeView.visible) {
                treeView.reveal(item, { select: true, focus: false, expand: true });
            }
        }
    );
    const showTransitionsCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.showTransitions',
        async (treeItem) => {
            if (treeItem?.node) { navigatorProvider.setFocus(treeItem.node); }
            await vscode.commands.executeCommand('xstateMachineNavigator.focus');
        }
    );
    // When the user clicks a node in the diagram, select the matching item in
    // the tree outline (instead of jumping to source). Revealing the item fires
    // onDidChangeSelection below; the guard stops that from echoing a name-based
    // highlight back to the diagram — which would jump to the wrong duplicate
    // when state names repeat, since the diagram already selected the exact node.
    let isDiagramReveal = false;
    graphViewProvider.setRevealInTreeHandler(node => {
        const item = treeProvider.getTreeItemForNode(node);
        if (item && treeView.visible) {
            isDiagramReveal = true;
            void Promise.resolve(treeView.reveal(item, { select: true, focus: false, expand: true }))
                .then(() => { isDiagramReveal = false; }, () => { isDiagramReveal = false; });
        }
    });

    // When the user selects a node in the tree, sync the diagram:
    // - state node  → highlight it in the current graph
    // - machine node → switch the graph to show that machine
    const treeSelectionListener = treeView.onDidChangeSelection(e => {
        if (isTreeSelectionChange) { return; } // ignore programmatic reveals driven by cursor sync
        const item = e.selection[0];
        if (!item?.node) { return; }
        // Update the Transitions view to track the selected state.
        navigatorProvider.setFocus(item.node);
        // Don't bounce a diagram-originated selection back to the diagram by name.
        if (isDiagramReveal) { return; }
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

            const node = treeItem.node;

            // Root the diagram at whatever was selected:
            //  - a machine node → the whole machine
            //  - a (compound) state node → a focused sub-diagram of that subtree
            // buildElements() already treats a `state` node as a valid root, so
            // a compound state renders as its own statechart. A leaf state has no
            // children to draw, so fall back to the enclosing machine.
            let root = node;
            const hasChildStates = (node.children ?? []).some((c: MachineNode) => c.type === 'state');
            if (node.type === 'state' && !hasChildStates && treeItem.uri) {
                const fileMachines = workspaceScanner.getFile(treeItem.uri);
                if (fileMachines) {
                    for (const m of fileMachines.machines) {
                        if (m.range.contains(node.range)) { root = m; break; }
                    }
                }
            }

            // Select the node that was opened on (the leaf/state itself), even
            // when the diagram is rooted at the enclosing machine.
            graphViewProvider.show(root, root.label, node.label);
        }
    );

    // Same as openGraphView, but driven from the code editor: resolve the
    // machine/state under the cursor and open (and select) it in the diagram.
    const openGraphViewAtCursorCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.openGraphViewAtCursor',
        () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            const machines = XStateMachineParser.parseMachines(editor.document);
            if (machines.length === 0) {
                vscode.window.showInformationMessage('No XState machine found in this file.');
                return;
            }
            const pos = editor.selection.active;
            // Walk from the cursor's innermost node outward to the nearest
            // enclosing state or machine.
            const hit = findNodeAtPosition(machines, pos);
            let target: MachineNode | undefined;
            if (hit) {
                const chain = [...hit.parents, hit.node]; // outermost → innermost
                for (let i = chain.length - 1; i >= 0; i--) {
                    if (chain[i].type === 'state' || chain[i].type === 'machine') { target = chain[i]; break; }
                }
            }
            target = target ?? machines.find(m => m.range.contains(pos)) ?? machines[0];

            // Root: a leaf state opens inside its enclosing machine; a compound
            // state or a machine roots the diagram at itself.
            let root = target;
            const hasChildStates = (target.children ?? []).some(c => c.type === 'state');
            if (target.type === 'state' && !hasChildStates) {
                const enclosing = machines.find(m => m.range.contains(target!.range));
                if (enclosing) { root = enclosing; }
            }
            graphViewProvider.show(root, root.label, target.label);
        }
    );

    // Open the diagram for a specific machine node (used by the editor CodeLens,
    // which always passes a machine — no leaf-state fallback needed).
    const openGraphViewForNodeCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.openGraphViewForNode',
        (node: MachineNode) => {
            if (!node) { return; }
            graphViewProvider.show(node, node.label);
        }
    );

    // Export a machine (or compound state) as Mermaid text, from the tree's
    // context menu. A leaf state falls back to its enclosing machine, mirroring
    // "View State Diagram".
    const exportMermaidCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.exportMermaid',
        (treeItem) => {
            const node: MachineNode | undefined = treeItem?.node;
            if (!node) { return; }
            let root = node;
            const hasChildStates = (node.children ?? []).some((c: MachineNode) => c.type === 'state');
            if (node.type === 'state' && !hasChildStates && treeItem.uri) {
                const fileMachines = workspaceScanner.getFile(treeItem.uri);
                if (fileMachines) {
                    for (const m of fileMachines.machines) {
                        if (m.range.contains(node.range)) { root = m; break; }
                    }
                }
            }
            void graphViewProvider.exportMermaid(root, root.label);
        }
    );

    // A state node's enclosing machine (for the test-path command).
    const enclosingMachine = (node: MachineNode, uri?: vscode.Uri): MachineNode | undefined => {
        if (node.type === 'machine') { return node; }
        if (!uri) { return undefined; }
        const fileMachines = workspaceScanner.getFile(uri);
        return fileMachines?.machines.find(m => m.range.contains(node.range));
    };

    // Generate a coverage report + test skeletons for a whole machine.
    const generateTestPathsCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.generateTestPaths',
        (treeItem) => {
            const node: MachineNode | undefined = treeItem?.node;
            if (!node) { return; }
            let root = node;
            const hasChildStates = (node.children ?? []).some((c: MachineNode) => c.type === 'state');
            if (node.type === 'state' && !hasChildStates) {
                root = enclosingMachine(node, treeItem.uri) ?? node;
            }
            void graphViewProvider.generateTestPaths(root);
        }
    );

    // Scaffold a setup({ actions, guards, actors, delays }) block of stubs for
    // every implementation the machine references (flagging which are missing).
    const generateSetupStubsCommand = vscode.commands.registerCommand(
        'xstateMachineOutline.generateSetupStubs',
        async (treeItem) => {
            const node: MachineNode | undefined = treeItem?.node;
            if (!node) { return; }
            const root = node.type === 'machine' ? node : enclosingMachine(node, treeItem.uri);
            if (!root) { return; }
            const doc = await vscode.workspace.openTextDocument({ language: 'typescript', content: toSetupStubs(root) });
            await vscode.window.showTextDocument(doc, { preview: false });
        }
    );

    // ── CodeLens: stats + "View Diagram" above each machine ─────────────────
    const codeLensProvider = new XStateCodeLensProvider();
    const codeLensRegistration = vscode.languages.registerCodeLensProvider(xstateLanguages, codeLensProvider);
    // Refresh lenses when diagnostics land (the ⚠ problem count) or the setting flips.
    const codeLensDiagnosticsListener = vscode.languages.onDidChangeDiagnostics(() => codeLensProvider.refresh());
    const codeLensConfigListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xstateOutline.codeLens')) { codeLensProvider.refresh(); }
    });

    context.subscriptions.push(
        openGraphViewForNodeCommand,
        exportMermaidCommand,
        generateTestPathsCommand,
        generateSetupStubsCommand,
        codeLensRegistration,
        codeLensDiagnosticsListener,
        codeLensConfigListener,
        treeView,
        navigatorView,
        errorsView,
        openErrorCommand,
        copyErrorCommand,
        setErrorsGroupingFileCommand,
        setErrorsGroupingSeverityCommand,
        setErrorsGroupingFlatCommand,
        setErrorsFilterAllCommand,
        setErrorsFilterWarningsCommand,
        setErrorsFilterErrorsCommand,
        errorsBadgeListener,
        errorsScanListener,
        errorsEditorListener,
        errorsConfigListener,
        openTransitionCommand,
        showTransitionsCommand,
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
        setNavCodeCommand,
        setNavDiagramCommand,
        toggleGraphSyncExpansionCommand,
        toggleGraphSyncExpansionActiveCommand,
        filterCommand,
        clearFilterCommand,
        editNodeCommand,
        addChildStateCommand,
        addTransitionCommand,
        addReferenceCommand,
        deleteNodeCommand,
        setDescriptionCommand,
        openGraphViewCommand,
        openGraphViewAtCursorCommand,
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
        debuggerController,
        debuggerViewRegistration,
        eventsViewRegistration,
        debuggerTreeProvider,
        debuggerTreeView,
        debuggerTreeSelectionListener,
        debuggerContextTreeProvider,
        debuggerContextTreeView,
        debuggerShowStoppedCommand,
        debuggerHideStoppedCommand,
        debuggerExportSessionCommand,
        debuggerImportSessionCommand,
        debuggerConnectCommand,
        debuggerDisconnectCommand,
        debuggerToggleCommand,
        {
            dispose: () => {
                pendingDiagnosticUpdates.forEach((timeout) => clearTimeout(timeout));
                pendingDiagnosticUpdates.clear();
            }
        }
    );
}

export function deactivate() {}
