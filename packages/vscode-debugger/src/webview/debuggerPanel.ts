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
    if (msg && msg.command === 'toggleFind' && ROLE === 'events') { toggleFind(); }
});

// Events panel keyboard nav (only when this webview is focused): ⌘/Ctrl+F find,
// ← previous, → next, Esc closes find or goes back to live. VS Code does not
// forward workbench keybindings into a focused webview, so ⌘F lives here.
if (ROLE === 'events') {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFind(true); return; }
        if (e.key === 'Escape' && evFindOpen) { e.preventDefault(); toggleFind(false); return; }
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

function render(m: any): void {
    const live = m.status === 'open';
    const body = $('body');

    if (ROLE === 'events') {
        renderEventsPanel(m);
        return; // events role wires its own row listeners below
    }

    if (!m.selected) {
        // Instances now live in the native "Instances" tree; this webview is the
        // inspector for whatever is selected there.
        const hint = !live
            ? 'Connect to a running app, then select an instance in the Instances view.'
            : (m.actors.length
                ? 'Select an instance in the Instances view.'
                : 'No running machine instances yet. Make sure the app calls createServerAdapter().');
        body.innerHTML = '<div class="empty">' + hint + '</div>';
    } else {
        body.innerHTML = renderInspector(m);
    }

    // Wire listeners — each guarded; only the relevant elements exist per role.
    body.querySelectorAll('.dispatch').forEach((el) => {
        el.addEventListener('click', () => vscode.postMessage({ command: 'dispatch', eventType: (el as HTMLElement).dataset.ev }));
    });
    document.getElementById('capture')?.addEventListener('click', () => vscode.postMessage({ command: 'capture' }));
    document.getElementById('restore')?.addEventListener('click', () => vscode.postMessage({ command: 'restore' }));
    document.getElementById('cev-send')?.addEventListener('click', () => vscode.postMessage({
        command: 'dispatchCustom',
        type: (document.getElementById('cev-type') as HTMLInputElement | null)?.value || '',
        payload: (document.getElementById('cev-payload') as HTMLTextAreaElement | null)?.value || '',
    }));
}

// Events panel: a VS Code-style find widget (hidden until ⌘/Ctrl+F or the
// title-bar icon) above the rebuilt list; only #evbody is replaced per model
// push, so the input, its text, and focus survive streaming re-renders.
let evModel: any = null;
let evFilter = '';
let evFindOpen = false;
let evCase = false;
let evWord = false;
let evRegex = false;
let evShownSeqs: number[] = []; // ascending seqs of visible rows — count + ↑/↓ nav

function renderEventsPanel(m: any): void {
    evModel = m;
    const body = $('body');
    if (!document.getElementById('findw')) {
        body.innerHTML =
            '<div id="findw" class="findw" style="display:none">' +
                '<div class="finput">' +
                    '<input id="evfilter" type="text" placeholder="Find" />' +
                    '<button id="f-case" class="fbtn ftog" title="Match Case">Aa</button>' +
                    '<button id="f-word" class="fbtn ftog" title="Match Whole Word"><u>ab</u></button>' +
                    '<button id="f-regex" class="fbtn ftog" title="Use Regular Expression">.*</button>' +
                '</div>' +
                '<span id="f-count" class="fcount"></span>' +
                '<span class="fspace"></span>' +
                '<button id="f-prev" class="fbtn" title="Previous Match (Shift+Enter)">↑</button>' +
                '<button id="f-next" class="fbtn" title="Next Match (Enter)">↓</button>' +
                '<button id="f-close" class="fbtn" title="Close (Escape)">✕</button>' +
            '</div><div id="evbody"></div>';
        const inp = document.getElementById('evfilter') as HTMLInputElement;
        inp.addEventListener('input', () => { evFilter = inp.value; renderEventList(); });
        inp.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? 'up' : 'down'); }
        });
        wireToggle('f-case', () => { evCase = !evCase; });
        wireToggle('f-word', () => { evWord = !evWord; });
        wireToggle('f-regex', () => { evRegex = !evRegex; });
        document.getElementById('f-prev')?.addEventListener('click', () => stepMatch('up'));
        document.getElementById('f-next')?.addEventListener('click', () => stepMatch('down'));
        document.getElementById('f-close')?.addEventListener('click', () => toggleFind(false));
    }
    renderEventList();
}

function wireToggle(id: string, flip: () => void): void {
    const el = document.getElementById(id) as HTMLElement;
    el.addEventListener('click', () => { flip(); el.classList.toggle('on'); renderEventList(); });
}

function toggleFind(open?: boolean): void {
    const w = document.getElementById('findw');
    if (!w) { return; }
    evFindOpen = open === undefined ? !evFindOpen : open;
    w.style.display = evFindOpen ? '' : 'none';
    if (evFindOpen) {
        const inp = document.getElementById('evfilter') as HTMLInputElement;
        inp.focus();
        inp.select();
    }
    renderEventList();
}

// ↑/↓ move the selection through visible rows. The list is newest-first, so
// "down" = older = smaller seq; with nothing selected both start at the top row.
function stepMatch(dir: 'up' | 'down'): void {
    if (!evShownSeqs.length) { return; }
    const cur: number | null = evModel?.timeTravelSeq ?? null;
    const target = cur === null
        ? evShownSeqs[evShownSeqs.length - 1]
        : dir === 'down'
            ? [...evShownSeqs].reverse().find((s) => s < cur)
            : evShownSeqs.find((s) => s > cur);
    if (target !== undefined) { vscode.postMessage({ command: 'timeTravel', seq: target }); }
}

function renderEventList(): void {
    const m = evModel;
    const evbody = document.getElementById('evbody') as HTMLElement;
    // .loglist has no fixed height, so the document — not #loglist — is the
    // real scroll container. Anchor to the row that is *becoming* selected
    // (matched by seq in the current DOM — i.e. exactly where the user
    // clicked it), NOT the previously-selected tr.tt, so clicking a new
    // event doesn't scroll. Also covers streaming and ←/→ stepping.
    const scroller = document.scrollingElement as HTMLElement;
    const rowBefore = m.timeTravelSeq !== null
        ? evbody.querySelector('tr[data-seq="' + m.timeTravelSeq + '"]') as HTMLElement | null
        : null;
    const anchor = rowBefore ? rowBefore.getBoundingClientRect().top : null;

    evbody.innerHTML = renderEvents(m);

    if (anchor !== null) {
        // Selected: pin the selected row at the same viewport offset.
        const rowAfter = evbody.querySelector('tr.tt') as HTMLElement | null;
        if (rowAfter) { scroller.scrollTop += rowAfter.getBoundingClientRect().top - anchor; }
    } else {
        // Live: newest-first list → top shows the latest events.
        scroller.scrollTop = 0;
    }

    evbody.querySelectorAll('tr.evrow').forEach((el) => {
        el.addEventListener('click', () => vscode.postMessage({ command: 'timeTravel', seq: Number((el as HTMLElement).dataset.seq) }));
    });

    const count = document.getElementById('f-count');
    if (count) {
        const q = evFilter.trim();
        count.textContent = evFindOpen && q
            ? (evShownSeqs.length ? String(evShownSeqs.length) + ' results' : 'No results')
            : '';
        const none = !evShownSeqs.length;
        (document.getElementById('f-prev') as HTMLButtonElement).disabled = none;
        (document.getElementById('f-next') as HTMLButtonElement).disabled = none;
    }
}

// Build the row predicate from the find state; null = no filtering. An invalid
// regex matches nothing (the count then reads "No results", like VS Code).
function eventMatcher(): ((hay: string) => boolean) | null {
    const q = evFilter.trim();
    if (!evFindOpen || !q) { return null; }
    const src = evRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = evWord ? '\\b(?:' + src + ')\\b' : src;
    try {
        const re = new RegExp(pattern, evCase ? '' : 'i');
        return (hay) => re.test(hay);
    } catch {
        return () => false;
    }
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
        html += '<div class="muted">' + (m.timeTravelSeq !== null
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
// clickable to time-travel. The list is a focusable scroll container for the
// ←/→/Esc keyboard nav; the selected event's payload is shown by the native
// "Event" tree in the Debugger sidebar.
function renderEvents(m: any): string {
    const labelBy: Record<string, string> = {};
    for (const a of m.actors) { labelBy[a.sessionId] = a.label; }
    let html = '<div class="section">';
    if (!m.events.length) {
        evShownSeqs = [];
        html += '<div class="muted">' + (m.status === 'open'
            ? 'No events captured yet.' : 'Connect from the Debugger view to capture events.') + '</div>';
        return html + '</div>';
    }
    const match = eventMatcher();
    const shown = match
        ? m.events.filter((ev: any) => match(String(ev.type)) || match(labelBy[ev.sessionId] || ''))
        : m.events;
    evShownSeqs = shown.map((ev: any) => ev.seq);
    if (!shown.length) {
        return html + '<div class="muted">No events match the filter.</div></div>';
    }
    html += '<div class="loglist" id="loglist" tabindex="0"><table class="events">';
    for (let i = shown.length - 1; i >= 0; i--) {
        const ev = shown[i];
        const isCur = m.timeTravelSeq !== null && ev.seq === m.timeTravelSeq;
        const isFuture = m.timeTravelSeq !== null && ev.seq > m.timeTravelSeq;
        html += '<tr class="evrow' + (isCur ? ' tt' : '') + (isFuture ? ' future' : '') + '" data-seq="' + ev.seq + '">' +
            '<td class="t">' + esc(fmtTime(ev.time)) + '</td>' +
            '<td class="t">' + esc(labelBy[ev.sessionId] || '') + '</td>' +
            '<td class="ev">' + esc(ev.type) + '</td>' +
            '<td class="t">#' + ev.seq + '</td></tr>';
    }
    html += '</table></div>';
    return html + '</div>';
}

function fmtTime(ms: number): string {
    if (!ms) { return ''; }
    const d = new Date(ms);
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}

vscode.postMessage({ command: 'ready' });
