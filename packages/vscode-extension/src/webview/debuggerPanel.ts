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

// Injected by the host (see debuggerView.getHtml): which slice to render.
const ROLE: string = (window as { __ROLE__?: string }).__ROLE__ || 'debugger';

const toggleBtn = document.getElementById('toggle');
if (ROLE === 'events') {
    // The events panel doesn't own the connection — hide its Connect button.
    if (toggleBtn) { toggleBtn.style.display = 'none'; }
} else if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
        const open = toggleBtn.dataset.connected === '1';
        vscode.postMessage({ command: open ? 'disconnect' : 'connect' });
    });
}

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

    // Replay / time-travel banner — shared global state, shown in both views.
    let banner = '';
    if (m.replayMode) {
        banner = '<div class="banner replay"><span class="grow">● Replay' + (m.replayName ? (' · ' + esc(m.replayName)) : '') +
            '</span><button class="secondary" id="exit-replay">Exit replay</button></div>';
    } else if (m.timeTravelSeq !== null) {
        banner = '<div class="banner tt"><span class="grow">⏱ Time travel · seq ' + m.timeTravelSeq +
            '</span><button class="secondary" id="back-live">Back to live</button></div>';
    }

    if (ROLE === 'events') {
        body.innerHTML = banner + renderEvents(m);
        // Keep the selected event in view while time-travelling — the innerHTML
        // rebuild otherwise resets scroll to the top (newest) on every new event,
        // yanking the user off the row they selected.
        if (m.timeTravelSeq !== null) {
            body.querySelector('tr.tt')?.scrollIntoView({ block: 'nearest' });
        }
    } else if (!m.selected) {
        // Instances now live in the native "Instances" tree; this webview is the
        // inspector for whatever is selected there.
        const hint = !live
            ? 'Connect to a running app, then select an instance in the Instances view.'
            : (m.actors.length
                ? 'Select an instance in the Instances view.'
                : 'No running machine instances yet. Make sure the app calls createServerAdapter().');
        body.innerHTML = banner + '<div class="empty">' + hint + '</div>';
    } else {
        body.innerHTML = banner + renderInspector(m);
    }

    // Wire listeners — each guarded; only the relevant elements exist per role.
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

// Selected actor inspector: state summary, context, dispatch, persisted.
// (The instances + machine state tree live in the native "Instances" TreeView.)
function renderInspector(m: any): string {
    if (!m.selected) { return ''; }
    const s = m.selected;
    let html = '<div class="section"><h3>State</h3>';
    html += '<div class="muted">' + esc(s.machineId || s.sessionId) + ' · ' + esc(s.status) + '</div>';
    html += '<div style="margin-top:4px">' + (s.activeLeaves.length
        ? s.activeLeaves.map((l: string) => '<span class="chip">' + esc(l) + '</span>').join('')
        : '<span class="muted">—</span>') + '</div>';
    html += '</div>';

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
    return html;
}

// Event log (bottom panel) — newest first, with the actor each event hit,
// clickable to time-travel.
function renderEvents(m: any): string {
    const labelBy: Record<string, string> = {};
    for (const a of m.actors) { labelBy[a.sessionId] = a.label; }
    let html = '<div class="section"><h3>Events</h3>';
    if (!m.events.length) {
        html += '<div class="muted">' + (m.status === 'open'
            ? 'No events captured yet.' : 'Connect from the Debugger view to capture events.') + '</div>';
    } else {
        html += '<table class="events">';
        for (let i = m.events.length - 1; i >= 0; i--) {
            const ev = m.events[i];
            const isCur = m.timeTravelSeq !== null && ev.seq === m.timeTravelSeq;
            const isFuture = m.timeTravelSeq !== null && ev.seq > m.timeTravelSeq;
            html += '<tr class="evrow' + (isCur ? ' tt' : '') + (isFuture ? ' future' : '') + '" data-seq="' + ev.seq + '">' +
                '<td class="t">' + esc(fmtTime(ev.time)) + '</td>' +
                '<td class="t">' + esc(labelBy[ev.sessionId] || '') + '</td>' +
                '<td class="ev">' + esc(ev.type) + '</td>' +
                '<td class="t">#' + ev.seq + '</td></tr>';
        }
        html += '</table>';
    }
    html += '</div>';
    return html;
}

function fmtTime(ms: number): string {
    if (!ms) { return ''; }
    const d = new Date(ms);
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

vscode.postMessage({ command: 'ready' });
