import * as vscode from 'vscode';
import { MachineNode } from './parser';
import { XStateMachineTreeProvider } from './treeProvider';

interface PanelEntry {
    panel: vscode.WebviewPanel;
    machine: MachineNode;
    nodeById: Map<string, MachineNode>;
    title: string;
}

export class XStateGraphViewProvider {
    public static readonly viewType = 'xstateGraphView';

    // One panel per machine — keyed by stable machine identity (file path + line + label).
    private panels = new Map<string, PanelEntry>();
    // The key of the panel the user most recently focused, used for highlight/simulate.
    private activeKey: string | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly treeProvider: XStateMachineTreeProvider
    ) {}

    private machineKey(machine: MachineNode): string {
        const path = machine.uri?.fsPath ?? '';
        const line = machine.range?.start.line ?? 0;
        return `${path}::${line}::${machine.label}`;
    }

    public show(machineNode: MachineNode, title: string) {
        const key = this.machineKey(machineNode);
        const existing = this.panels.get(key);
        if (existing) {
            existing.panel.reveal();
            this.activeKey = key;
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            XStateGraphViewProvider.viewType,
            `XState Graph: ${title}`,
            { viewColumn: vscode.ViewColumn.Active },
            { enableScripts: true, localResourceRoots: [this.extensionUri] }
        );

        const entry: PanelEntry = { panel, machine: machineNode, nodeById: new Map(), title };
        this.panels.set(key, entry);
        this.activeKey = key;

        panel.onDidDispose(() => {
            this.panels.delete(key);
            if (this.activeKey === key) {
                this.activeKey = [...this.panels.keys()].at(-1);
            }
        });

        panel.onDidChangeViewState(e => {
            if (e.webviewPanel.active) { this.activeKey = key; }
        });

        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'stateClicked': this.navigateToState(message.id, entry); return;
                case 'eventClicked': this.simulateEvent(message.eventName); return;
                case 'exportSvg':   this.saveExport(message.data, 'svg', title); return;
                case 'exportPng':   this.saveExport(message.data, 'png', title); return;
            }
        });

        this.updatePanel(key);
    }

    public highlightState(stateName: string) {
        const entry = this.activeKey ? this.panels.get(this.activeKey) : undefined;
        entry?.panel.webview.postMessage({
            command: 'highlight',
            stateId: stateName.replace(/[^a-zA-Z0-9_]/g, '_'),
        });
    }

    public refresh() {
        for (const key of this.panels.keys()) { this.updatePanel(key); }
    }

    private simulateEvent(eventName: string) {
        vscode.window.showInformationMessage(
            `Static simulation: Fired event '${eventName}'. Full simulation engine coming soon!`
        );
    }

    private navigateToState(id: string, entry: PanelEntry) {
        if (!entry.machine.uri) { return; }
        const foundNode = entry.nodeById.get(id);
        if (foundNode?.range) {
            vscode.workspace.openTextDocument(entry.machine.uri).then(doc => {
                vscode.window.showTextDocument(doc, { selection: foundNode.range, preserveFocus: true });
            });
        }
    }

    private async saveExport(data: string, format: 'svg' | 'png', machineTitle: string) {
        const safeTitle = machineTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`${safeTitle}.${format}`),
            filters: format === 'svg' ? { 'SVG Image': ['svg'] } : { 'PNG Image': ['png'] },
        });
        if (!saveUri) { return; }
        const bytes = format === 'svg'
            ? Buffer.from(data, 'utf8')
            : Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64');
        await vscode.workspace.fs.writeFile(saveUri, bytes);
        vscode.window.showInformationMessage(`Graph exported: ${saveUri.fsPath}`);
    }

    private updatePanel(key: string) {
        const entry = this.panels.get(key);
        if (!entry) { return; }
        entry.nodeById.clear();
        const config = vscode.workspace.getConfiguration('xstateOutline');
        const reflectExpansion = config.get<boolean>('graphReflectsTreeExpansion', true);
        const payload = this.buildElements(entry.machine, reflectExpansion, entry.nodeById);
        entry.panel.webview.html = this.getHtmlForWebview(entry.panel.webview, payload);
    }

    private buildElements(
        machine: MachineNode,
        reflectExpansion: boolean,
        nodeById: Map<string, MachineNode>
    ): GraphPayload {
        const nodes: GraphNode[] = [];
        const nameToId = new Map<string, string>();
        const idByNode = new Map<MachineNode, string>();
        const collapsedIds: string[] = [];
        let counter = 0;

        const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

        const collect = (n: MachineNode, parentId?: string) => {
            const id = `n${counter++}`;
            idByNode.set(n, id);
            nodeById.set(id, n);
            const name = sanitize(n.label);
            nameToId.set(name, id);

            const childStates = (n.children ?? []).filter(c => c.type === 'state');
            const entryActions = (n.children ?? []).filter(c => c.type === 'entry').map(c => c.label);
            const exitActions  = (n.children ?? []).filter(c => c.type === 'exit').map(c => c.label);
            nodes.push({
                data: {
                    id, label: n.label, name,
                    parent: parentId,
                    compound: childStates.length > 0,
                    initial: !!n.isInitial,
                    final: !!n.isFinal,
                    entryActions,
                    exitActions,
                },
            });

            if (reflectExpansion && childStates.length > 0) {
                const treeItem = this.treeProvider.getTreeItemForNode(n);
                if (treeItem && treeItem.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
                    collapsedIds.push(id);
                }
            }

            for (const c of childStates) { collect(c, id); }
        };

        const rootStates = machine.type === 'state'
            ? [machine]
            : (machine.children ?? []).filter(c => c.type === 'state');
        for (const r of rootStates) { collect(r, undefined); }

        // Edges: merge transitions between the same source→target pair so multiple
        // events on one arrow don't stack into an unreadable blob.
        const edgeMap = new Map<string, { source: string; target: string; labels: string[] }>();
        const addEdges = (n: MachineNode) => {
            if (n.type === 'state') {
                const sourceId = idByNode.get(n);
                if (sourceId) {
                    for (const t of (n.children ?? []).filter(c => c.type === 'transition')) {
                        const target = t.children?.find(c => c.type === 'target');
                        if (!target) { continue; }
                        const targetName = sanitize(target.label.replace(/^#/, '').split('.').pop() ?? '');
                        const targetId = nameToId.get(targetName);
                        if (!targetId) { continue; }
                        const key = `${sourceId} ${targetId}`;
                        let entry = edgeMap.get(key);
                        if (!entry) {
                            entry = { source: sourceId, target: targetId, labels: [] };
                            edgeMap.set(key, entry);
                        }
                        // Harel label: EVENT [guard] / action1, action2
                        const guard   = t.children?.find(c => c.type === 'guard');
                        const actions = (t.children ?? []).filter(c => c.type === 'action');
                        let label = t.label ?? '';
                        if (guard) { label += ` [${guard.label}]`; }
                        if (actions.length) { label += ` / ${actions.map(a => a.label).join(', ')}`; }
                        label = label.trim();
                        if (label && !entry.labels.includes(label)) { entry.labels.push(label); }
                    }
                }
            }
            for (const c of (n.children ?? [])) { addEdges(c); }
        };
        addEdges(machine);

        const edges: GraphEdge[] = [];
        for (const entry of edgeMap.values()) {
            edges.push({ data: { id: `e${counter++}`, source: entry.source, target: entry.target, label: entry.labels.join('\n') } });
        }

        // Filled start-node for each region's initial state (Harel convention).
        const starts: GraphNode[] = [];
        for (const node of nodes) {
            if (!node.data.initial) { continue; }
            const startId = `start_${counter++}`;
            starts.push({ data: { id: startId, label: '', name: startId, parent: node.data.parent, start: true } });
            edges.push({ data: { id: `e${counter++}`, source: startId, target: node.data.id, label: '' } });
        }
        nodes.push(...starts);

        return { nodes, edges, collapsedIds };
    }

    private getHtmlForWebview(webview: vscode.Webview, payload: GraphPayload): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'graph.js')
        );
        const nonce = getNonce();
        const json = JSON.stringify(payload);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>XState Graph</title>
    <style>
        html, body { padding: 0; margin: 0; height: 100%; width: 100%; overflow: hidden; }
        body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        #cy { position: absolute; inset: 0; }
        /* Smooth transitions for hover interactivity */
        path { transition: stroke-opacity 0.12s ease, stroke-width 0.12s ease; }
        [data-event] { transition: opacity 0.12s ease; }
        rect { transition: stroke-opacity 0.12s ease, stroke-width 0.12s ease, fill 0.12s ease; }
        #toolbar {
            position: absolute;
            bottom: 12px;
            right: 12px;
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 1px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3));
            border-radius: 6px;
            padding: 3px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.16);
            user-select: none;
        }
        #toolbar button {
            background: none;
            border: none;
            color: var(--vscode-icon-foreground, var(--vscode-editor-foreground));
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-family: var(--vscode-font-family, system-ui, sans-serif);
            line-height: 1.4;
            white-space: nowrap;
        }
        #toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,0.1)); }
        #toolbar button:active { background: var(--vscode-toolbar-activeBackground, rgba(127,127,127,0.2)); }
        .tb-sep { width: 1px; height: 14px; background: var(--vscode-widget-border, rgba(127,127,127,0.3)); margin: 0 2px; }
    </style>
</head>
<body>
    <div id="cy"></div>
    <div id="toolbar">
        <button id="btn-zoom-in"  title="Zoom in">+</button>
        <button id="btn-zoom-out" title="Zoom out">−</button>
        <button id="btn-fit"      title="Fit to screen">⊡</button>
        <div class="tb-sep"></div>
        <button id="btn-export-svg" title="Export as SVG">SVG</button>
        <button id="btn-export-png" title="Export as PNG">PNG</button>
    </div>
    <script nonce="${nonce}">window.__GRAPH__ = ${json};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

interface GraphNode {
    data: {
        id: string; label: string; name: string;
        parent?: string; compound?: boolean;
        initial?: boolean; final?: boolean; start?: boolean;
        entryActions?: string[]; exitActions?: string[];
    };
}
interface GraphEdge {
    data: { id: string; source: string; target: string; label: string };
}
interface GraphPayload {
    nodes: GraphNode[];
    edges: GraphEdge[];
    collapsedIds?: string[];
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return text;
}
