// packages/vscode-extension/src/webview/debuggerPanel.ts
//
// Browser-side script for the XState Debugger sidebar webview. Bundled to
// out/webview/debugger.js and loaded via a <script src> (the same proven
// pattern as the statechart diagram webview), rather than inlined into the
// HTML string. Renders the DebuggerViewModel pushed from the extension host and
// posts back user intents (connect, select actor, dispatch, time-travel, …).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare function acquireVsCodeApi(): { postMessage(msg: any): void };

const vscode = acquireVsCodeApi();
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: unknown) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

window.onerror = (message, _src, line, col) => {
    try { ($('status') as HTMLElement).textContent = 'JS error: ' + message + ' @' + line + ':' + col; } catch { /* noop */ }
    try { vscode.postMessage({ command: 'jserror', error: String(message) + ' @' + line + ':' + col }); } catch { /* noop */ }
    return false;
};

$('toggle').addEventListener('click', () => {
    const open = ($('toggle') as HTMLElement).dataset.connected === '1';
    vscode.postMessage({ command: open ? 'disconnect' : 'connect' });
});

window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data;
    if (msg && msg.command === 'model') { render(msg.model); }
});

function render(m: any): void {
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

    // Replay / time-travel banners
    if (m.replayMode) {
        html += '<div class="banner replay"><span class="grow">● Replay' + (m.replayName ? (' · ' + esc(m.replayName)) : '') +
            '</span><button class="secondary" id="exit-replay">Exit replay</button></div>';
    } else if (m.timeTravelSeq !== null) {
        html += '<div class="banner tt"><span class="grow">⏱ Time travel · seq ' + m.timeTravelSeq +
            '</span><button class="secondary" id="back-live">Back to live</button></div>';
    }

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
            ? s.activeLeaves.map((l: string) => '<span class="chip">' + esc(l) + '</span>').join('')
            : '<span class="muted">—</span>') + '</div>';
        html += '</div>';

        // Machine state tree (runtime), with the active configuration highlighted.
        if (s.machine) {
            const activeSet = new Set<string>(s.activeIds || []);
            html += '<div class="section"><h3>Machine</h3><div class="tree">' +
                renderTree(s.machine, activeSet, 0) + '</div></div>';
        }

        html += '<div class="section"><h3>Context</h3><pre class="ctx">' +
            esc(safeJson(s.context)) + '</pre></div>';

        // Dispatch — transition buttons + custom event
        html += '<div class="section"><h3>Send event</h3>';
        if (!m.canInteract) {
            html += '<div class="muted">' + (m.timeTravelSeq !== null || m.replayMode
                ? 'Return to live to send events.' : 'Connect to send events.') + '</div>';
        } else {
            if (s.transitions.length) {
                for (const t of s.transitions) {
                    html += '<div class="tx"><button class="dispatch" data-ev="' + esc(t.eventType) + '">Send</button>' +
                        '<span class="ev">' + esc(t.eventType) + '</span>' +
                        (t.guard ? '<span class="gd">[' + esc(t.guard) + ']</span>' : '') + '</div>';
                }
            } else {
                html += '<div class="muted">No outgoing events from the current state.</div>';
            }
            html += '<div class="custom">' +
                '<input id="cev-type" type="text" placeholder="CUSTOM_EVENT" />' +
                '<textarea id="cev-payload" placeholder=\'{ "key": "value" }\'></textarea>' +
                '<div class="row"><button id="cev-send">Send custom</button></div></div>';
        }
        html += '</div>';

        // Persisted snapshot capture / restore
        html += '<div class="section"><h3>Persisted snapshot</h3>';
        if (!m.canInteract) {
            html += '<div class="muted">Available when live.</div>';
        } else {
            html += '<div class="row"><button id="capture">Capture</button>' +
                (s.persisted.captured ? '<button id="restore" class="secondary">⏮ Restore</button>' : '') + '</div>';
            if (s.persisted.error) { html += '<div class="muted" style="margin-top:4px">' + esc(s.persisted.error) + '</div>'; }
            else if (s.persisted.captured) { html += '<div class="muted" style="margin-top:4px">Snapshot captured.</div>'; }
        }
        html += '</div>';
    }

    // Event log
    html += '<div class="section"><h3>Events</h3>';
    if (!m.events.length) {
        html += '<div class="muted">No events captured yet.</div>';
    } else {
        html += '<table class="events">';
        for (let i = m.events.length - 1; i >= 0; i--) {
            const ev = m.events[i];
            const isCur = m.timeTravelSeq !== null && ev.seq === m.timeTravelSeq;
            const isFuture = m.timeTravelSeq !== null && ev.seq > m.timeTravelSeq;
            html += '<tr class="evrow' + (isCur ? ' tt' : '') + (isFuture ? ' future' : '') + '" data-seq="' + ev.seq + '">' +
                '<td class="t">' + esc(fmtTime(ev.time)) + '</td>' +
                '<td class="ev">' + esc(ev.type) + '</td>' +
                '<td class="t">#' + ev.seq + '</td></tr>';
        }
        html += '</table>';
    }
    html += '</div>';

    body.innerHTML = html;

    body.querySelectorAll('.actor').forEach((el) => {
        el.addEventListener('click', () => vscode.postMessage({ command: 'selectActor', sessionId: (el as HTMLElement).dataset.id }));
    });
    body.querySelectorAll('.dispatch').forEach((el) => {
        el.addEventListener('click', () => vscode.postMessage({ command: 'dispatch', eventType: (el as HTMLElement).dataset.ev }));
    });
    body.querySelectorAll('tr.evrow').forEach((el) => {
        el.addEventListener('click', () => vscode.postMessage({ command: 'timeTravel', seq: Number((el as HTMLElement).dataset.seq) }));
    });
    document.getElementById('exit-replay')?.addEventListener('click', () => vscode.postMessage({ command: 'exitReplay' }));
    document.getElementById('back-live')?.addEventListener('click', () => vscode.postMessage({ command: 'timeTravel', seq: null }));
    document.getElementById('capture')?.addEventListener('click', () => vscode.postMessage({ command: 'capture' }));
    document.getElementById('restore')?.addEventListener('click', () => vscode.postMessage({ command: 'restore' }));
    document.getElementById('cev-send')?.addEventListener('click', () => vscode.postMessage({
        command: 'dispatchCustom',
        type: (document.getElementById('cev-type') as HTMLInputElement | null)?.value || '',
        payload: (document.getElementById('cev-payload') as HTMLTextAreaElement | null)?.value || '',
    }));
}

function renderTree(node: any, activeSet: Set<string>, depth: number): string {
    const active = activeSet.has(node.id);
    const tag = (node.type || 'state').slice(0, 4);
    let html = '<div class="tnode ' + (active ? 'active' : '') + '" style="padding-left:' + (4 + depth * 14) + 'px">' +
        '<span class="dotg"></span><span class="tag">' + esc(tag) + '</span>' +
        '<span>' + esc(node.key || node.id) + '</span></div>';
    const states = node.states || {};
    for (const key of Object.keys(states)) {
        html += renderTree(states[key], activeSet, depth + 1);
    }
    return html;
}

function safeJson(v: unknown): string {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}
function fmtTime(ms: number): string {
    if (!ms) { return ''; }
    const d = new Date(ms);
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

vscode.postMessage({ command: 'ready' });
