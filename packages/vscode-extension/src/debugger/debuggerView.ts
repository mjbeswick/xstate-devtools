// packages/vscode-extension/src/debugger/debuggerView.ts
//
// The "XState Debugger" sidebar webview view: live actor list, the selected
// actor's status / active state / context, and the recent event log. It is a
// thin renderer — all state lives in the DebuggerController's shared store; the
// controller pushes a DebuggerViewModel here, and this view posts back user
// intents (select actor, connect, disconnect).
import * as vscode from 'vscode';
import type { DebuggerController, DebuggerView, DebuggerViewModel } from './debuggerController';

export class DebuggerViewProvider implements vscode.WebviewViewProvider, DebuggerView {
    public static readonly viewType = 'xstateDebugger';

    private view: vscode.WebviewView | null = null;
    private lastModel: DebuggerViewModel | null = null;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly controller: DebuggerController,
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.controller.logLine('debugger view resolved');
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((msg) => {
            this.controller.logLine(`webview → ${msg?.command ?? '(unknown)'}`);
            switch (msg?.command) {
                case 'selectActor': this.controller.selectActor(msg.sessionId ?? null); return;
                case 'connect': this.controller.connect(); return;
                case 'disconnect': this.controller.disconnect(); return;
                case 'timeTravel': this.controller.timeTravel(typeof msg.seq === 'number' ? msg.seq : null); return;
                case 'dispatch': this.controller.dispatch({ type: String(msg.eventType) }); return;
                case 'dispatchCustom': this.controller.dispatchCustom(String(msg.type ?? ''), String(msg.payload ?? '')); return;
                case 'capture': this.controller.capturePersisted(); return;
                case 'restore': void this.controller.restore(); return;
                case 'exitReplay': this.controller.exitReplay(); return;
                case 'jserror': this.controller.logLine(`webview JS error: ${msg.error}`); return;
                case 'ready': if (this.lastModel) { this.post(this.lastModel); } return;
            }
        });

        webviewView.onDidDispose(() => {
            if (this.view === webviewView) { this.view = null; }
            this.controller.setView(null);
        });

        this.controller.setView(this);
    }

    postModel(model: DebuggerViewModel): void {
        this.lastModel = model;
        this.post(model);
    }

    private post(model: DebuggerViewModel): void {
        void this.view?.webview.postMessage({ command: 'model', model });
    }

    private getHtml(webview: vscode.Webview): string {
        // Load the panel script as a bundled external file (out/webview/debugger.js),
        // the same pattern as the statechart diagram webview — robust where an
        // inline <script> proved unreliable in this view.
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'debugger.js'),
        );
        const nonce = makeNonce();
        const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; padding: 0; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-sideBar-background); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.open { background: var(--vscode-charts-green); }
  .dot.connecting { background: var(--vscode-charts-yellow); }
  .dot.idle, .dot.closed { background: var(--vscode-descriptionForeground); }
  .dot.error { background: var(--vscode-charts-red); }
  .bar .status { flex: 1; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { font-family: inherit; font-size: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 2px 10px; border-radius: 2px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .section { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .section h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); font-weight: 600; }
  .actor { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 3px; cursor: pointer; white-space: nowrap; }
  .actor:hover { background: var(--vscode-list-hoverBackground); }
  .actor.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .actor.stopped { opacity: .55; }
  .chip { display: inline-block; padding: 0 6px; margin: 1px 3px 1px 0; border-radius: 9px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 11px; }
  pre.ctx { margin: 0; max-height: 240px; overflow: auto; font-family: var(--vscode-editor-font-family); font-size: 12px; white-space: pre; background: var(--vscode-textCodeBlock-background); padding: 6px; border-radius: 3px; }
  table.events { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.events td { padding: 1px 6px 1px 0; white-space: nowrap; color: var(--vscode-foreground); }
  table.events td.t { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
  table.events td.ev { width: 99%; overflow: hidden; text-overflow: ellipsis; }
  .muted { color: var(--vscode-descriptionForeground); }
  .empty { color: var(--vscode-descriptionForeground); padding: 16px 10px; text-align: center; font-size: 12px; }
  .banner { display: flex; align-items: center; gap: 8px; padding: 4px 10px; font-size: 12px; }
  .banner.tt { background: var(--vscode-inputValidation-warningBackground, rgba(255,200,0,.15)); color: var(--vscode-foreground); }
  .banner.replay { background: var(--vscode-inputValidation-infoBackground, rgba(100,100,255,.15)); }
  .banner .grow { flex: 1; }
  .tx { display: flex; align-items: center; gap: 6px; padding: 2px 4px; }
  .tx button { padding: 1px 8px; }
  .tx .ev { font-family: var(--vscode-editor-font-family); }
  .tx .gd { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .custom { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .custom input, .custom textarea { font-family: var(--vscode-editor-font-family); font-size: 12px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 3px 6px; }
  .custom textarea { resize: vertical; min-height: 38px; }
  .row { display: flex; gap: 6px; align-items: center; }
  table.events tr.evrow { cursor: pointer; }
  table.events tr.evrow:hover td { background: var(--vscode-list-hoverBackground); }
  table.events tr.tt td { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  table.events tr.future td { opacity: .5; }
  .tree { font-size: 12px; }
  .tnode { display: flex; align-items: center; gap: 6px; padding: 1px 4px; border-radius: 3px; white-space: nowrap; }
  .tnode.active { background: var(--vscode-list-activeSelectionBackground, rgba(0,160,0,.18)); font-weight: 600; }
  .tnode .tag { font-size: 9px; text-transform: uppercase; letter-spacing: .03em; padding: 0 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); opacity: .8; }
  .tnode .dotg { width: 7px; height: 7px; border-radius: 50%; flex: none; background: transparent; }
  .tnode.active .dotg { background: var(--vscode-charts-green); }
</style>
</head>
<body>
  <div class="bar">
    <span id="dot" class="dot idle"></span>
    <span id="status" class="status">Not connected (build D)</span>
    <button id="toggle">Connect</button>
  </div>
  <div id="body"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) { out += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return out;
}
