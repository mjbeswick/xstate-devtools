import * as vscode from 'vscode';
import { MachineNode } from './parser';
import { XStateMachineTreeProvider } from './treeProvider';

export class XStateGraphViewProvider {
    public static readonly viewType = 'xstateGraphView';

    private panel: vscode.WebviewPanel | undefined;
    private currentMachine: MachineNode | undefined;

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
                            this.navigateToState(message.stateId);
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

    private navigateToState(stateSafeName: string) {
        if (!this.currentMachine || !this.currentMachine.uri) return;
        
        // Find the node by matching its sanitized name
        let foundNode: MachineNode | undefined;
        const walk = (n: MachineNode) => {
            if (foundNode) return;
            if (n.type === 'state') {
                const safeName = n.label.replace(/[^a-zA-Z0-9_]/g, '_');
                if (safeName === stateSafeName) {
                    foundNode = n;
                    return;
                }
            }
            if (n.children) {
                for (const child of n.children) {
                    walk(child);
                }
            }
        };
        
        walk(this.currentMachine);
        
        if (foundNode && foundNode.range) {
            vscode.workspace.openTextDocument(this.currentMachine.uri).then(doc => {
                vscode.window.showTextDocument(doc, { selection: foundNode!.range, preserveFocus: true });
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
        const mermaidCode = this.generateMermaid(this.currentMachine, reflectExpansion);
        
        this.panel.webview.html = this.getHtmlForWebview(mermaidCode);
    }

    private generateMermaid(node: MachineNode, reflectExpansion: boolean): string {
        let code = 'stateDiagram-v2\n';
        
        const walk = (n: MachineNode, parentName?: string) => {
            if (n.type === 'state') {
                const safeName = n.label.replace(/[^a-zA-Z0-9_]/g, '_');
                code += `    state "${n.label}" as ${safeName}\n`;
                // Add click event for webview to intercept
                code += `    click ${safeName} call stateClicked()\n`;
                if (n.isInitial && parentName) {
                    code += `    [*] --> ${safeName}\n`;
                }

                if (n.children) {
                    // Check if node is expanded in the tree
                    let shouldWalkChildren = true;
                    if (reflectExpansion) {
                        const treeItem = this.treeProvider.getTreeItemForNode(n);
                        if (treeItem && treeItem.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed) {
                            shouldWalkChildren = false;
                        }
                    }

                    // Gather transitions (we still want to show transitions to siblings even if children are collapsed)
                    const transitions = n.children.filter(c => c.type === 'transition');
                    for (const t of transitions) {
                        const targetNode = t.children?.find(c => c.type === 'target');
                        if (targetNode) {
                            const eventName = t.label;
                            // Clean up target names
                            const targetSafeName = targetNode.label.replace(/^#/, '').split('.').pop()?.replace(/[^a-zA-Z0-9_]/g, '_');
                            if (targetSafeName) {
                                code += `    ${safeName} --> ${targetSafeName} : ${eventName}\n`;
                            }
                        }
                    }

                    // Recursively process nested states
                    if (shouldWalkChildren) {
                        const states = n.children.filter(c => c.type === 'state');
                        if (states.length > 0) {
                            code += `    state ${safeName} {\n`;
                            for (const child of states) {
                                walk(child, safeName);
                            }
                            code += `    }\n`;
                        }
                    }
                }
            } else if (n.type === 'machine') {
                if (n.children) {
                    const states = n.children.filter(c => c.type === 'state');
                    for (const child of states) {
                        walk(child, 'machineRoot');
                    }
                }
            }
        };

        walk(node);
        return code;
    }

    private getHtmlForWebview(mermaidCode: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XState Graph</title>
    <style>
        body {
            padding: 0;
            margin: 0;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .mermaid {
            background-color: white; /* Mermaid default theme works best on white */
            padding: 20px;
            border-radius: 8px;
            overflow: auto;
            max-width: 100vw;
            max-height: 100vh;
        }
        /* Highlight styling injected by script */
        .node.highlighted rect, .node.highlighted circle, .node.highlighted polygon {
            stroke: #ff9900 !important;
            stroke-width: 4px !important;
            fill: #fff3e0 !important;
        }
    </style>
</head>
<body>
    <div class="mermaid">
        ${mermaidCode}
    </div>
    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
        const vscode = acquireVsCodeApi();
        
        mermaid.initialize({ 
            startOnLoad: true, 
            theme: 'default',
            securityLevel: 'loose' // needed to enable clicks
        });

        window.stateClicked = function(stateId) {
            vscode.postMessage({ command: 'stateClicked', stateId });
            highlightState(stateId);
        };

        let currentState = null;

        window.simulateEvent = function(targetId) {
            highlightState(targetId);
        };

        function highlightState(stateId) {
            // Remove previous highlights
            document.querySelectorAll('.node.highlighted').forEach(el => el.classList.remove('highlighted'));
            // Find and add highlight
            const els = document.querySelectorAll('.node');
            els.forEach(el => {
                // Mermaid element IDs are often like 'flowchart-stateId-...' or just match the state name
                if (el.id && el.id.includes(stateId)) {
                    el.classList.add('highlighted');
                }
            });
            currentState = stateId;
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'highlight') {
                highlightState(message.stateId);
            }
        });
        
        // Let's add click handlers to edge labels (transitions) for static simulation
        setTimeout(() => {
            document.querySelectorAll('.edgeLabel').forEach(label => {
                label.style.cursor = 'pointer';
                label.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const text = label.textContent.trim();
                    vscode.postMessage({ command: 'eventClicked', eventName: text });
                });
            });
        }, 1000); // Wait for mermaid to render
    </script>
</body>
</html>`;
    }
}
