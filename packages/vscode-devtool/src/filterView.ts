import * as vscode from 'vscode';
import { SearchResultData } from './treeProvider';

export class FilterWebviewViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'xstateMachineOutlineSearch';

    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    private _onDidSearch = new vscode.EventEmitter<{ text: string; types: string[] }>();
    readonly onDidSearch = this._onDidSearch.event;

    private _onDidRequestTypes = new vscode.EventEmitter<void>();
    readonly onDidRequestTypes = this._onDidRequestTypes.event;

    private _onDidSelectItem = new vscode.EventEmitter<{ uriStr: string; line: number; char: number }>();
    readonly onDidSelectItem = this._onDidSelectItem.event;

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Loaded from bundled assets (copied by the copy-codicons build step) rather
        // than node_modules, so it works regardless of npm workspace hoisting.
        const codiconsUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'resources', 'codicons', 'codicon.css')
        );

        const sort = vscode.workspace.getConfiguration('xstateOutline').get<string>('searchSort', 'relevance');
        webviewView.webview.html = this.getHtml(codiconsUri.toString(), sort);

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'search') {
                this._onDidSearch.fire({ text: msg.text, types: msg.types ?? [] });
            } else if (msg.type === 'requestTypes') {
                this._onDidRequestTypes.fire();
            } else if (msg.type === 'selectItem') {
                this._onDidSelectItem.fire({ uriStr: msg.uriStr, line: msg.line, char: msg.char });
            }
        });
    }

    focusInput(): void {
        this._view?.webview.postMessage({ type: 'focus' });
    }

    clearInput(): void {
        this._view?.webview.postMessage({ type: 'clear' });
    }

    showResults(items: SearchResultData[]): void {
        this._view?.webview.postMessage({ type: 'results', items });
    }

    setSort(mode: string): void {
        this._view?.webview.postMessage({ type: 'sort', mode });
    }

    showTypes(counts: { type: string; count: number }[]): void {
        this._view?.webview.postMessage({ type: 'availableTypes', counts });
    }

    private getHtml(codiconsUri: string, initialSort: string): string {
        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${codiconsUri}" rel="stylesheet"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: transparent;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    overflow-x: hidden;
  }
  .codicon { font-size: 16px; line-height: 16px; }

  /* ── Search bar (mirrors VS Code's Extensions search box) ──── */
  .search-bar {
    display: flex; align-items: center; gap: 4px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 0 4px 0 6px;
    margin: 6px 8px 0;
  }
  .search-bar:focus-within { border-color: var(--vscode-focusBorder); }
  .search-icon {
    color: var(--vscode-input-placeholderForeground);
    flex-shrink: 0; font-size: 14px;
  }
  input {
    flex: 1; background: transparent; border: none; outline: none;
    color: var(--vscode-input-foreground);
    font-size: var(--vscode-font-size, 13px);
    font-family: var(--vscode-font-family);
    height: 26px;
  }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }
  .icon-btn {
    background: none; border: none; cursor: pointer; padding: 3px;
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
    flex-shrink: 0; border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
  .icon-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }
  .icon-btn:disabled:hover { background: none; }
  .icon-btn.active {
    color: var(--vscode-inputOption-activeForeground, var(--vscode-foreground));
    background: var(--vscode-inputOption-activeBackground);
  }

  /* ── Type filter toggles (faceted, by type present in results) ─ */
  .type-filters {
    display: none; flex-wrap: wrap; gap: 4px;
    margin: 6px 8px 0;
  }
  .type-toggle {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 1px 7px 1px 6px;
    background: transparent;
    border: 1px solid var(--vscode-checkbox-border, var(--vscode-input-border, transparent));
    border-radius: 10px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer; font-size: 11px; line-height: 18px;
    user-select: none; white-space: nowrap;
  }
  .type-toggle:hover {
    background: var(--vscode-toolbar-hoverBackground);
    color: var(--vscode-foreground);
  }
  .type-toggle:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .type-toggle.active {
    background: var(--vscode-inputOption-activeBackground);
    border-color: var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder));
    color: var(--vscode-inputOption-activeForeground, var(--vscode-foreground));
  }
  .type-toggle-icon { font-size: 13px; line-height: 13px; }
  .type-toggle-count { font-variant-numeric: tabular-nums; }

  /* ── Results (compact, list-density like the outline) ─────── */
  .results-meta {
    margin: 8px 12px 2px; font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .results-list { list-style: none; margin: 0 0 8px; }

  .result-row {
    display: flex; align-items: center; gap: 6px;
    padding: 0 12px; cursor: pointer; line-height: 22px;
  }
  .result-row:hover { background: var(--vscode-list-hoverBackground); }
  .result-row.focused {
    background: var(--vscode-list-focusBackground, var(--vscode-list-activeSelectionBackground));
    color: var(--vscode-list-focusForeground, var(--vscode-list-activeSelectionForeground));
    outline: 1px solid var(--vscode-list-focusOutline, transparent); outline-offset: -1px;
  }
  .result-icon { flex-shrink: 0; font-size: 16px; }
  .result-label { flex-shrink: 0; white-space: nowrap; }
  .result-label .match { font-weight: 600; text-decoration: underline; }
  .result-desc {
    flex: 1; min-width: 0;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .result-row.focused .result-desc { color: inherit; opacity: 0.85; }

  .empty-state {
    margin: 24px 12px; text-align: center;
    color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.6;
  }
</style>
</head>
<body>

<div class="search-bar">
  <span class="codicon codicon-search search-icon"></span>
  <input id="filterInput" type="text" placeholder="Search states, machines, actions…" autocomplete="off" spellcheck="false"/>
  <button class="icon-btn" id="clearBtn" title="Clear search (Esc)" disabled>
    <span class="codicon codicon-close"></span>
  </button>
  <button class="icon-btn" id="filterBtn" title="Filter by type" aria-pressed="false">
    <span class="codicon codicon-filter" id="filterIcon"></span>
  </button>
</div>

<div class="type-filters" id="typeFilters" role="group" aria-label="Filter by type"></div>

<div class="results-meta" id="resultsMeta"></div>
<ul class="results-list" id="resultsList"></ul>

<script>
  const vscode = acquireVsCodeApi();

  const filterInput = document.getElementById('filterInput');
  const clearBtn    = document.getElementById('clearBtn');
  const filterBtn   = document.getElementById('filterBtn');
  const filterIcon  = document.getElementById('filterIcon');
  const typeFilters = document.getElementById('typeFilters');
  const resultsMeta = document.getElementById('resultsMeta');
  const resultsList = document.getElementById('resultsList');

  // ── Type definitions (codicons + theme colors mirror the outline tree) ──
  const TYPES = [
    { id: 'machine',    icon: 'package',          label: 'Machine',    color: 'var(--vscode-charts-blue)' },
    { id: 'state',      icon: 'circle-outline',   label: 'State',      color: 'var(--vscode-symbolIcon-fieldForeground)' },
    { id: 'transition', icon: 'symbol-event',     label: 'Transition', color: 'var(--vscode-charts-orange)' },
    { id: 'action',     icon: 'rocket',           label: 'Action',     color: 'var(--vscode-symbolIcon-methodForeground)' },
    { id: 'entry',      icon: 'debug-step-into',  label: 'Entry',      color: 'var(--vscode-symbolIcon-methodForeground)' },
    { id: 'exit',       icon: 'debug-step-out',   label: 'Exit',       color: 'var(--vscode-symbolIcon-methodForeground)' },
    { id: 'guard',      icon: 'shield',           label: 'Guard',      color: 'var(--vscode-terminal-ansiCyan)' },
    { id: 'invoke',     icon: 'circuit-board',    label: 'Invoke',     color: 'var(--vscode-charts-yellow)' },
    { id: 'actor',      icon: 'account',          label: 'Actor',      color: 'var(--vscode-charts-yellow)' },
    { id: 'context',    icon: 'symbol-variable',  label: 'Context',    color: 'var(--vscode-symbolIcon-variableForeground)' },
    { id: 'target',     icon: 'target',           label: 'Target',     color: 'var(--vscode-terminal-ansiBrightMagenta)' },
  ];

  const TYPE_MAP = {};
  TYPES.forEach(t => { TYPE_MAP[t.id] = t; });

  let activeTypes = new Set();
  let allResults  = [];
  let availableCounts = {};   // { type: count } across the current scope
  let focusedIndex = -1;
  let showChips = false;
  let debounceTimer;
  let sortMode = ${JSON.stringify(initialSort)};   // 'relevance' | 'name' | 'type'

  // TYPES is already in statechart reading order, so its index is the 'type' sort key.
  const TYPE_ORDER = {};
  TYPES.forEach((t, i) => { TYPE_ORDER[t.id] = i; });

  // Order results for display. 'relevance' keeps the host's source order.
  function sortResults(items) {
    if (sortMode === 'name') {
      return [...items].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    }
    if (sortMode === 'type') {
      return [...items].sort((a, b) => {
        const ta = TYPE_ORDER[a.type] ?? 99, tb = TYPE_ORDER[b.type] ?? 99;
        return ta - tb || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
      });
    }
    return items;
  }

  // Ask the host for the types present in scope so the filter chips can be
  // picked before (or without) typing. The host replies with 'availableTypes'.
  function requestTypes() { vscode.postMessage({ type: 'requestTypes' }); }

  // Run the current query through the host. With a query we fetch every label
  // match across all types (types: []) so the chips can facet over the results
  // and the type filter is applied client-side. With an empty box a type filter
  // lists every node of those types (server-side); empty + no filter clears.
  function runSearch() {
    const text = filterInput.value;
    const querying = !!text.trim();
    if (!querying && activeTypes.size === 0) {
      allResults = [];
      renderResults();
      return;
    }
    vscode.postMessage({ type: 'search', text, types: querying ? [] : Array.from(activeTypes) });
  }

  // Counts shown on the chips: facet over the matching results while querying,
  // scope-wide totals when just browsing (so a filter can be picked first).
  function chipCounts() {
    if (!filterInput.value.trim()) { return availableCounts; }
    const counts = {};
    for (const r of allResults) { counts[r.type] = (counts[r.type] || 0) + 1; }
    return counts;
  }

  // The displayed results: host already type-filtered when browsing; filter
  // client-side over the full label-match set while querying.
  function displayResults() {
    if (!filterInput.value.trim() || activeTypes.size === 0) { return allResults; }
    return allResults.filter(r => activeTypes.has(r.type));
  }

  function codicon(name) {
    const el = document.createElement('span');
    el.className = 'codicon codicon-' + name;
    return el;
  }

  // ── Type filter toggles. While browsing these are scope-wide (one per type
  //    in the project, so a filter can be applied before typing); while querying
  //    they facet over the matching results. ─────────────────────────────
  function renderTypeFilters() {
    typeFilters.innerHTML = '';

    const counts = chipCounts();
    // Show a chip per type with a count, plus any active type (even at 0, so a
    // filter that matches nothing while querying stays deselectable).
    const present = TYPES.filter(t => counts[t.id] || activeTypes.has(t.id));
    const canFilter = TYPES.some(t => availableCounts[t.id]);
    syncFilterBtn(canFilter);

    if (!canFilter || !showChips) { typeFilters.style.display = 'none'; return; }
    typeFilters.style.display = 'flex';

    for (const t of present) {
      const count = counts[t.id] || 0;
      const on = activeTypes.has(t.id);
      const btn = document.createElement('button');
      btn.className = 'type-toggle' + (on ? ' active' : '');
      btn.title = (on ? 'Stop filtering by ' : 'Show only ') + t.label + ' (' + count + ')';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');

      const ic = codicon(t.icon);
      ic.classList.add('type-toggle-icon');
      if (t.color) { ic.style.color = t.color; }
      const cnt = document.createElement('span');
      cnt.className = 'type-toggle-count';
      cnt.textContent = count;

      btn.appendChild(ic);
      btn.appendChild(cnt);
      btn.addEventListener('click', () => {
        if (activeTypes.has(t.id)) { activeTypes.delete(t.id); } else { activeTypes.add(t.id); }
        // While querying, allResults already holds every type — just re-filter
        // locally. While browsing, the server filter changes, so re-query.
        if (filterInput.value.trim()) { renderResults(); }
        else { renderTypeFilters(); runSearch(); }
      });
      typeFilters.appendChild(btn);
    }
  }

  function syncFilterBtn(canFilter) {
    // The funnel is always visible, but only enabled when the scope has types.
    filterBtn.disabled = !canFilter;
    const active = showChips || activeTypes.size > 0;
    filterBtn.classList.toggle('active', active);
    filterBtn.setAttribute('aria-pressed', showChips ? 'true' : 'false');
    filterIcon.className = 'codicon codicon-' + (active ? 'filter-filled' : 'filter');
  }

  // The funnel reveals/hides the type-filter chips. Refresh the scope's type
  // list each time it's opened so counts reflect the current files.
  filterBtn.addEventListener('click', () => {
    showChips = !showChips;
    if (showChips) { requestTypes(); }
    renderTypeFilters();
  });

  // ── Search input ─────────────────────────────────────────────
  filterInput.addEventListener('input', () => {
    clearBtn.disabled = filterInput.value.length === 0;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSearch, 200);
  });

  clearBtn.addEventListener('click', () => clearSearch());

  function clearSearch() {
    filterInput.value = '';
    clearBtn.disabled = true;
    allResults = [];
    activeTypes.clear();
    showChips = false;
    renderResults();
    filterInput.focus();
  }

  // ── Keyboard navigation (like the Extensions list) ───────────
  filterInput.addEventListener('keydown', e => {
    const visible = visibleResults();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visible.length) { focusedIndex = Math.min(focusedIndex + 1, visible.length - 1); applyFocus(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visible.length) { focusedIndex = Math.max(focusedIndex - 1, 0); applyFocus(); }
    } else if (e.key === 'Enter') {
      if (focusedIndex >= 0 && visible[focusedIndex]) { openItem(visible[focusedIndex]); }
    } else if (e.key === 'Escape') {
      if (filterInput.value) { clearSearch(); }
    }
  });

  function applyFocus() {
    const rows = resultsList.querySelectorAll('.result-row');
    rows.forEach((r, i) => r.classList.toggle('focused', i === focusedIndex));
    const active = rows[focusedIndex];
    if (active) { active.scrollIntoView({ block: 'nearest' }); }
  }

  function openItem(item) {
    vscode.postMessage({ type: 'selectItem', uriStr: item.uriStr, line: item.line, char: item.char });
  }

  // ── Render ───────────────────────────────────────────────────
  function visibleResults() { return sortResults(displayResults()); }

  function highlightLabel(label) {
    const query = filterInput.value.trim();
    const span = document.createElement('span');
    span.className = 'result-label';
    const idx = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (idx === -1) { span.textContent = label; return span; }
    span.appendChild(document.createTextNode(label.slice(0, idx)));
    const m = document.createElement('span');
    m.className = 'match';
    m.textContent = label.slice(idx, idx + query.length);
    span.appendChild(m);
    span.appendChild(document.createTextNode(label.slice(idx + query.length)));
    return span;
  }

  function renderResults() {
    // Chip counts depend on the current results (when querying), so refresh them
    // whenever results change.
    renderTypeFilters();
    const visible = sortResults(displayResults());
    focusedIndex = -1;
    resultsMeta.textContent = '';
    resultsList.innerHTML = '';

    if (visible.length === 0) {
      // Only show the "no results" hint when something is actually being asked
      // for (a query and/or a type filter) — not on a clean, empty box.
      if (filterInput.value.trim() || activeTypes.size > 0) {
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.textContent = 'No results found.';
        resultsList.appendChild(div);
      }
      return;
    }

    resultsMeta.textContent = visible.length + ' result' + (visible.length === 1 ? '' : 's');

    visible.forEach((item, i) => {
      const typeInfo = TYPE_MAP[item.type] || { icon: 'symbol-misc', label: item.type };

      const li = document.createElement('li');
      li.className = 'result-row';

      // Eventless/automatic transitions get distinct icons (mirrors the tree).
      let iconName = typeInfo.icon;
      if (item.type === 'transition') {
        if (item.label === 'always') { iconName = 'zap'; }
        else if (item.label.indexOf('after ') === 0) { iconName = 'clock'; }
      }

      const iconEl = codicon(iconName);
      iconEl.classList.add('result-icon');
      if (typeInfo.color) { iconEl.style.color = typeInfo.color; }

      const labelEl = highlightLabel(item.label);

      const desc = document.createElement('span');
      desc.className = 'result-desc';
      desc.textContent = item.breadcrumb;

      li.appendChild(iconEl);
      li.appendChild(labelEl);
      li.appendChild(desc);

      li.title = typeInfo.label + ' · ' + item.breadcrumb + ' › ' + item.label;
      li.addEventListener('click', () => { focusedIndex = i; applyFocus(); openItem(item); });

      resultsList.appendChild(li);
    });
  }

  // ── Messages from extension ───────────────────────────────────
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'results') {
      allResults = msg.items || [];
      renderResults();
    } else if (msg.type === 'availableTypes') {
      availableCounts = {};
      for (const c of (msg.counts || [])) { availableCounts[c.type] = c.count; }
      // A previously-active filter for a type no longer in scope is dropped.
      for (const t of Array.from(activeTypes)) { if (!availableCounts[t]) { activeTypes.delete(t); } }
      renderTypeFilters();
    } else if (msg.type === 'sort') {
      sortMode = msg.mode;
      renderResults();
    } else if (msg.type === 'focus') {
      filterInput.focus(); filterInput.select();
    } else if (msg.type === 'clear') {
      filterInput.value = '';
      clearBtn.disabled = true;
      allResults = [];
      activeTypes.clear();
      showChips = false;
      renderResults();
    }
  });

  // Prime the funnel state (enabled iff the scope has types) on load.
  requestTypes();
</script>
</body>
</html>`;
    }
}
