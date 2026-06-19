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
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg?.command) {
                case 'selectActor': this.controller.selectActor(msg.sessionId ?? null); return;
                case 'connect': this.controller.connect(); return;
                case 'disconnect': this.controller.disconnect(); return;
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
        const nonce = makeNonce();
        const csp = [
            `default-src 'none'`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `script-src 'nonce-${nonce}'`,
        ].join('; ');
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
</style>
</head>
<body>
  <div class="bar">
    <span id="dot" class="dot idle"></span>
    <span id="status" class="status">Not connected</span>
    <button id="toggle">Connect</button>
  </div>
  <div id="body"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  $('toggle').addEventListener('click', () => {
    const open = $('toggle').dataset.connected === '1';
    vscode.postMessage({ command: open ? 'disconnect' : 'connect' });
  });

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg && msg.command === 'model') { render(msg.model); }
  });

  function render(m) {
    const dot = $('dot');
    dot.className = 'dot ' + m.status;
    const live = m.status === 'open';
    $('status').textContent = live
      ? (m.replayName ? ('Replay · ' + m.replayName) : ('Live · ' + m.url))
      : (m.status === 'connecting' ? ('Connecting · ' + m.url)
        : m.status === 'error' ? ('Error · ' + m.url) : 'Not connected');
    const toggle = $('toggle');
    toggle.textContent = (live || m.status === 'connecting') ? 'Disconnect' : 'Connect';
    toggle.dataset.connected = (live || m.status === 'connecting') ? '1' : '0';

    const body = $('body');
    if (!m.actors.length) {
      body.innerHTML = '<div class="empty">' + (live
        ? 'No actors yet. Make sure the app calls createServerAdapter().'
        : 'Connect to a running app that uses createServerAdapter().') + '</div>';
      return;
    }

    let html = '';
    // Actors
    html += '<div class="section"><h3>Actors</h3>';
    for (const a of m.actors) {
      html += '<div class="actor ' + (a.selected ? 'sel ' : '') + (a.status === 'stopped' ? 'stopped' : '') +
        '" data-id="' + esc(a.sessionId) + '" style="padding-left:' + (4 + a.depth * 14) + 'px">' +
        '<span class="dot ' + (a.status === 'active' ? 'open' : 'idle') + '"></span>' +
        '<span>' + esc(a.label) + '</span></div>';
    }
    html += '</div>';

    // Selected inspector
    if (m.selected) {
      const s = m.selected;
      html += '<div class="section"><h3>State</h3>';
      html += '<div class="muted">status: ' + esc(s.status) + '</div>';
      html += '<div style="margin-top:4px">' + (s.activeLeaves.length
        ? s.activeLeaves.map((l) => '<span class="chip">' + esc(l) + '</span>').join('')
        : '<span class="muted">—</span>') + '</div>';
      html += '</div>';
      html += '<div class="section"><h3>Context</h3><pre class="ctx">' +
        esc(safeJson(s.context)) + '</pre></div>';
    }

    // Event log
    html += '<div class="section"><h3>Events</h3>';
    if (!m.events.length) {
      html += '<div class="muted">No events captured yet.</div>';
    } else {
      html += '<table class="events">';
      for (let i = m.events.length - 1; i >= 0; i--) {
        const ev = m.events[i];
        html += '<tr><td class="t">' + esc(fmtTime(ev.time)) + '</td>' +
          '<td class="ev">' + esc(ev.type) + '</td>' +
          '<td class="t">#' + ev.seq + '</td></tr>';
      }
      html += '</table>';
    }
    html += '</div>';

    body.innerHTML = html;
    for (const el of body.querySelectorAll('.actor')) {
      el.addEventListener('click', () => vscode.postMessage({ command: 'selectActor', sessionId: el.dataset.id }));
    }
  }

  function safeJson(v) {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }
  function fmtTime(ms) {
    if (!ms) { return ''; }
    const d = new Date(ms);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }

  vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
    }
}

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) { out += chars[Math.floor(Math.random() * chars.length)]; }
    return out;
}
