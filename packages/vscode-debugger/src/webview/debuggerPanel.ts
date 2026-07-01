// packages/vscode-debugger/src/webview/debuggerPanel.ts
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
    try { vscode.postMessage({ command: 'jserror', error: String(message) + ' @' + line + ':' + col }); } catch { /* noop */ }
    return false;
};

// Injected by the host (see debuggerView.getHtml): which slice to render.
// Connection is driven from the status-bar item and the Instances title bar,
// so this webview no longer renders its own connection bar/toggle.
const ROLE: string = (window as { __ROLE__?: string }).__ROLE__ || 'debugger';

window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data;
    if (msg && msg.command === 'model') { render(msg.model); }
});

// Events panel keyboard nav (only when this webview is focused): ← previous,
// → next, Esc back to live. Reuses the controller's step/back-to-live logic.
if (ROLE === 'events') {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { return; }
        const command = e.key === 'ArrowLeft' ? 'stepBack'
            : e.key === 'ArrowRight' ? 'stepForward'
            : e.key === 'Escape' ? 'backToLive' : null;
        if (!command) { return; }
        e.preventDefault();
        vscode.postMessage({ command });
    });
}

// Detail-pane width, in px. Kept in a module var so it survives the innerHTML
// rebuild on every event (otherwise each event would reset the drag); reapplied
// in render(). Null = use the CSS default (40%).
let detailBasis: number | null = null;
let dragging = false;

if (ROLE === 'events') {
    window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!dragging) { return; }
        const wrap = document.querySelector('.events-wrap') as HTMLElement | null;
        const detail = document.querySelector('.evdetail') as HTMLElement | null;
        if (!wrap || !detail) { return; }
        const r = wrap.getBoundingClientRect();
        detailBasis = Math.max(200, Math.min(r.right - e.clientX, r.width - 200));
        detail.style.flexBasis = detailBasis + 'px';
        detail.style.width = 'auto';
        e.preventDefault();
    });
    window.addEventListener('mouseup', () => {
        if (!dragging) { return; }
        dragging = false;
        document.getElementById('splitter')?.classList.remove('active');
        document.body.style.userSelect = '';
    });
}

/** Re-attach the splitter drag handle and reapply the remembered width after a rebuild. */
function wireDetailResize(): void {
    document.getElementById('splitter')?.addEventListener('mousedown', (e) => {
        dragging = true;
        document.getElementById('splitter')?.classList.add('active');
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    if (detailBasis !== null) {
        const d = document.querySelector('.evdetail') as HTMLElement | null;
        if (d) { d.style.flexBasis = detailBasis + 'px'; d.style.width = 'auto'; }
    }
}

function render(m: any): void {
    const live = m.status === 'open';
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
    wireDetailResize();
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
// clickable to time-travel. The log list (left) is a focusable scroll container
// for ←/→/Esc keyboard nav; the detail panel (right) shows the selected/latest event.
function renderEvents(m: any): string {
    const labelBy: Record<string, string> = {};
    for (const a of m.actors) { labelBy[a.sessionId] = a.label; }
    let html = '<div class="section"><h3>Events</h3>';
    if (!m.events.length) {
        html += '<div class="muted">' + (m.status === 'open'
            ? 'No events captured yet.' : 'Connect from the Debugger view to capture events.') + '</div>';
        return html + '</div>';
    }
    html += '<div class="events-wrap"><div class="loglist" id="loglist" tabindex="0"><table class="events">';
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
    html += '</table></div><div class="splitter" id="splitter"></div><div class="evdetail">' + renderEventDetail(m, labelBy) + '</div></div>';
    return html + '</div>';
}

// Detail panel: the selected (time-travel) event, else the latest, with full payload.
function renderEventDetail(m: any, labelBy: Record<string, string>): string {
    const d = m.eventDetail;
    if (!d) { return '<div class="muted" style="padding-top:8px">No event selected.</div>'; }
    const label = labelBy[d.sessionId] || '';
    const kind = m.timeTravelSeq === null ? 'latest' : 'selected';
    let html = '<div class="evhdr"><span class="type">' + esc(d.type) + '</span>' +
        '<div class="meta">' + esc(fmtTime(d.time)) + (label ? ' · ' + esc(label) : '') + ' · #' + d.seq + ' · ' + kind + '</div></div>';
    html += '<pre class="ctx">' + esc(JSON.stringify(d.data, null, 2)) + '</pre>';
    return html;
}

function fmtTime(ms: number): string {
    if (!ms) { return ''; }
    const d = new Date(ms);
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

vscode.postMessage({ command: 'ready' });
