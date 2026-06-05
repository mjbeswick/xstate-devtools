import * as vscode from 'vscode';
import { MachineNode } from './parser';
import { XStateMachineTreeProvider } from './treeProvider';

export class XStateGraphViewProvider {
    public static readonly viewType = 'xstateGraphView';

    private panel: vscode.WebviewPanel | undefined;
    private currentMachine: MachineNode | undefined;
    // Maps a graph node id back to the source range of the state it represents,
    // and the parser node (used to resolve collapse state against the tree).
    private nodeById = new Map<string, MachineNode>();

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly treeProvider: XStateMachineTreeProvider
    ) {}

    public show(machineNode: MachineNode, title: string) {
        this.currentMachine = machineNode;

        if (this.panel) {
            this.panel.title = `XState Graph: ${title}`;
            this.panel.reveal(vscode.ViewColumn.Beside, true);
            this.update();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                XStateGraphViewProvider.viewType,
                `XState Graph: ${title}`,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts: true,
                    localResourceRoots: [this.extensionUri]
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            }, null);

            // Handle messages from the webview
            this.panel.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'stateClicked':
                            this.navigateToState(message.id);
                            return;
                        case 'eventClicked':
                            this.simulateEvent(message.eventName);
                            return;
                    }
                },
                undefined
            );

            this.update();
        }
    }

    public highlightState(stateName: string) {
        if (this.panel) {
            this.panel.webview.postMessage({ command: 'highlight', stateId: stateName.replace(/[^a-zA-Z0-9_]/g, '_') });
        }
    }

    private simulateEvent(eventName: string) {
        if (!this.currentMachine) return;
        
        vscode.window.showInformationMessage(`Static simulation: Fired event '${eventName}'. Full simulation engine coming soon!`);
        // For a full simulation, we would traverse this.currentMachine from the currently highlighted state
        // along the transition matching eventName to find the target state, then call highlightState(targetName).
    }

    private navigateToState(id: string) {
        if (!this.currentMachine || !this.currentMachine.uri) return;

        const foundNode = this.nodeById.get(id);
        if (foundNode && foundNode.range) {
            vscode.workspace.openTextDocument(this.currentMachine.uri).then(doc => {
                vscode.window.showTextDocument(doc, { selection: foundNode.range, preserveFocus: true });
            });
        }
    }

    public refresh() {
        this.update();
    }

    private update() {
        if (!this.panel || !this.currentMachine) {
            return;
        }

        const config = vscode.workspace.getConfiguration('xstateOutline');
        const reflectExpansion = config.get<boolean>('graphReflectsTreeExpansion', false);
        const payload = this.buildElements(this.currentMachine, reflectExpansion);

        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, payload);
    }

    /**
     * Walk the parser's MachineNode tree into a Cytoscape elements payload:
     * states → (compound) nodes, transitions → edges. Target names are resolved
     * to node ids the same way the old Mermaid output did (sanitized, last-wins).
     */
    private buildElements(machine: MachineNode, reflectExpansion: boolean): GraphPayload {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const nameToId = new Map<string, string>();
        const idByNode = new Map<MachineNode, string>();
        const collapsedIds: string[] = [];
        this.nodeById = new Map<string, MachineNode>();
        let counter = 0;

        const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

        const collect = (n: MachineNode, parentId?: string) => {
            const id = `n${counter++}`;
            idByNode.set(n, id);
            this.nodeById.set(id, n);
            const name = sanitize(n.label);
            nameToId.set(name, id);

            const childStates = (n.children ?? []).filter(c => c.type === 'state');
            nodes.push({
                data: {
                    id,
                    label: n.label,
                    name,
                    parent: parentId,
                    compound: childStates.length > 0,
                    initial: !!n.isInitial,
                    final: !!n.isFinal,
                },
            });

            if (reflectExpansion && childStates.length > 0) {
                const treeItem = this.treeProvider.getTreeItemForNode(n);
                if (treeItem && treeItem.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
                    collapsedIds.push(id);
                }
            }

            for (const c of childStates) {
                collect(c, id);
            }
        };

        const rootStates = machine.type === 'state'
            ? [machine]
            : (machine.children ?? []).filter(c => c.type === 'state');
        for (const r of rootStates) {
            collect(r, undefined);
        }

        // Edges (second pass so all target ids exist).
        const addEdges = (n: MachineNode) => {
            if (n.type === 'state') {
                const sourceId = idByNode.get(n);
                if (sourceId) {
                    const transitions = (n.children ?? []).filter(c => c.type === 'transition');
                    for (const t of transitions) {
                        const target = t.children?.find(c => c.type === 'target');
                        if (!target) { continue; }
                        const targetName = sanitize(target.label.replace(/^#/, '').split('.').pop() ?? '');
                        const targetId = nameToId.get(targetName);
                        if (targetId) {
                            edges.push({
                                data: { id: `e${counter++}`, source: sourceId, target: targetId, label: t.label },
                            });
                        }
                    }
                }
            }
            for (const c of (n.children ?? [])) {
                addEdges(c);
            }
        };
        addEdges(machine);

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
        body { background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        #cy { position: absolute; inset: 0; width: 100%; height: 100%; }
    </style>
</head>
<body>
    <div id="cy"></div>
    <script nonce="${nonce}">window.__GRAPH__ = ${json};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

interface GraphNode {
    data: {
        id: string;
        label: string;
        name: string;
        parent?: string;
        compound?: boolean;
        initial?: boolean;
        final?: boolean;
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
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
