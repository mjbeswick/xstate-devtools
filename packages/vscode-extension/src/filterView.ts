import * as vscode from 'vscode';
import { SearchResultData } from './treeProvider';

export class FilterWebviewViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'xstateMachineOutlineSearch';

    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    private _onDidSearch = new vscode.EventEmitter<string>();
    readonly onDidSearch = this._onDidSearch.event;

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

        webviewView.webview.html = this.getHtml(codiconsUri.toString());

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'search') {
                this._onDidSearch.fire(msg.text);
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

    private getHtml(codiconsUri: string): string {
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
  .icon-btn.active {
    color: var(--vscode-inputOption-activeForeground, var(--vscode-foreground));
    background: var(--vscode-inputOption-activeBackground);
  }
  .icon-btn.hidden { display: none; }

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
  <button class="icon-btn hidden" id="clearBtn" title="Clear search (Esc)">
    <span class="codicon codicon-close"></span>
  </button>
  <button class="icon-btn hidden" id="filterBtn" title="Filter by type" aria-pressed="false">
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
    { id: 'machine',    icon: 'package',          label: 'Machine',    color: 'var(--vscode-symbolIcon-classForeground)' },
    { id: 'state',      icon: 'circle-filled',    label: 'State',      color: 'var(--vscode-symbolIcon-fieldForeground)' },
    { id: 'transition', icon: 'symbol-event',     label: 'Transition', color: 'var(--vscode-symbolIcon-eventForeground)' },
    { id: 'action',     icon: 'rocket',           label: 'Action',     color: 'var(--vscode-symbolIcon-methodForeground)' },
    { id: 'entry',      icon: 'debug-step-into',  label: 'Entry',      color: 'var(--vscode-symbolIcon-methodForeground)' },
    { id: 'exit',       icon: 'debug-step-out',   label: 'Exit',       color: 'var(--vscode-symbolIcon-colorForeground)' },
    { id: 'guard',      icon: 'shield',           label: 'Guard',      color: 'var(--vscode-symbolIcon-booleanForeground)' },
    { id: 'invoke',     icon: 'circuit-board',    label: 'Invoke',     color: 'var(--vscode-symbolIcon-eventForeground)' },
    { id: 'context',    icon: 'symbol-variable',  label: 'Context',    color: 'var(--vscode-symbolIcon-variableForeground)' },
    { id: 'target',     icon: 'target',           label: 'Target',     color: 'var(--vscode-terminal-ansiBrightMagenta)' },
  ];

  const TYPE_MAP = {};
  TYPES.forEach(t => { TYPE_MAP[t.id] = t; });

  let activeTypes = new Set();
  let allResults  = [];
  let focusedIndex = -1;
  let showChips = false;
  let debounceTimer;

  function codicon(name) {
    const el = document.createElement('span');
    el.className = 'codicon codicon-' + name;
    return el;
  }

  // ── Type filter toggles (faceted: one per type present in results) ─
  function renderTypeFilters() {
    typeFilters.innerHTML = '';

    const counts = {};
    for (const r of allResults) { counts[r.type] = (counts[r.type] || 0) + 1; }
    const present = TYPES.filter(t => counts[t.id]);

    // Filtering is only meaningful when results span more than one type.
    const canFilter = present.length > 1;
    syncFilterBtn(canFilter);

    if (!canFilter || !showChips) { typeFilters.style.display = 'none'; return; }
    typeFilters.style.display = 'flex';

    for (const t of present) {
      const on = activeTypes.has(t.id);
      const btn = document.createElement('button');
      btn.className = 'type-toggle' + (on ? ' active' : '');
      btn.title = (on ? 'Hide ' : 'Show only ') + t.label + ' (' + counts[t.id] + ')';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');

      const ic = codicon(t.icon);
      ic.classList.add('type-toggle-icon');
      if (t.color) { ic.style.color = t.color; }
      const cnt = document.createElement('span');
      cnt.className = 'type-toggle-count';
      cnt.textContent = counts[t.id];

      btn.appendChild(ic);
      btn.appendChild(cnt);
      btn.addEventListener('click', () => {
        if (activeTypes.has(t.id)) { activeTypes.delete(t.id); } else { activeTypes.add(t.id); }
        renderResults(allResults);
      });
      typeFilters.appendChild(btn);
    }
  }

  function syncFilterBtn(canFilter) {
    // The funnel is only shown when there's something to filter.
    filterBtn.classList.toggle('hidden', !canFilter);
    const active = showChips || activeTypes.size > 0;
    filterBtn.classList.toggle('active', active);
    filterBtn.setAttribute('aria-pressed', showChips ? 'true' : 'false');
    filterIcon.className = 'codicon codicon-' + (active ? 'filter-filled' : 'filter');
  }

  // The funnel reveals/hides the type-filter chips.
  filterBtn.addEventListener('click', () => {
    showChips = !showChips;
    renderTypeFilters();
  });

  // ── Search input ─────────────────────────────────────────────
  filterInput.addEventListener('input', () => {
    const text = filterInput.value;
    clearBtn.classList.toggle('hidden', text.length === 0);
    clearTimeout(debounceTimer);
    if (!text.trim()) {
      allResults = [];
      renderResults([]);
      vscode.postMessage({ type: 'search', text: '' });
      return;
    }
    debounceTimer = setTimeout(() => vscode.postMessage({ type: 'search', text }), 200);
  });

  clearBtn.addEventListener('click', () => clearSearch());

  function clearSearch() {
    filterInput.value = '';
    clearBtn.classList.add('hidden');
    allResults = [];
    activeTypes.clear();
    showChips = false;
    renderResults([]);
    vscode.postMessage({ type: 'search', text: '' });
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
  function visibleResults() {
    return activeTypes.size === 0 ? allResults : allResults.filter(r => activeTypes.has(r.type));
  }

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

  function renderResults(items) {
    // Drop active filters whose type is no longer present, so a stale filter
    // can never hide everything with no toggle left to clear it.
    if (activeTypes.size) {
      const present = new Set(items.map(r => r.type));
      for (const t of Array.from(activeTypes)) { if (!present.has(t)) { activeTypes.delete(t); } }
    }
    renderTypeFilters();

    const visible = activeTypes.size === 0 ? items : items.filter(r => activeTypes.has(r.type));
    focusedIndex = -1;
    resultsMeta.textContent = '';
    resultsList.innerHTML = '';

    if (!visible || visible.length === 0) {
      if (filterInput.value.trim()) {
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.textContent = 'No results found.';
        resultsList.appendChild(div);
      }
      return;
    }

    resultsMeta.textContent = visible.length === allResults.length
      ? visible.length + ' result' + (visible.length === 1 ? '' : 's')
      : visible.length + ' of ' + allResults.length + ' results';

    visible.forEach((item, i) => {
      const typeInfo = TYPE_MAP[item.type] || { icon: 'symbol-misc', label: item.type };

      const li = document.createElement('li');
      li.className = 'result-row';

      const iconEl = codicon(typeInfo.icon);
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
      renderResults(allResults);
    } else if (msg.type === 'focus') {
      filterInput.focus(); filterInput.select();
    } else if (msg.type === 'clear') {
      filterInput.value = '';
      clearBtn.classList.add('hidden');
      allResults = [];
      activeTypes.clear();
      showChips = false;
      renderResults([]);
    }
  });
</script>
</body>
</html>`;
    }
}
