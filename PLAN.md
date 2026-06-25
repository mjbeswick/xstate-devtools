# Plan: rename vscode-extension → vscode-devtool, extract standalone vscode-debugger

## Goal

Split the single VS Code extension into two:
- **`packages/vscode-devtool`** (renamed from `packages/vscode-extension`) — static outline, diagram, errors, navigator. **Keeps its published marketplace identity** (`name: xstate-devtools`, publisher `MichaelBeswick`) so existing installs keep updating.
- **`packages/vscode-debugger`** — new, **standalone** extension for the live debugger (instances/context/events, time-travel, session import/export). Bundles its **own diagram** so reveal/follow/live-overlay work without the devtool extension installed.

Shared diagram + static-analysis code is factored into a new **internal** workspace lib `packages/diagram-core` that both extensions bundle (single source of truth, standalone at runtime — not a marketplace package).

## Decisions (confirmed)
- Diagram coupling: **standalone** — debugger bundles its own diagram (implemented via shared `diagram-core` lib, not copy-paste).
- Identity: **directory rename only**; keep `name: xstate-devtools` + publisher.

## Architecture after split
```
packages/
  diagram-core/      (NEW, internal lib @xstate-devtools/diagram-core)
    parser, machineModel, mermaid, treeEditor, workspaceScanner, utils,
    graphView (decoupled from treeProvider), findStaticMachine, webview/graph.ts
  vscode-devtool/    (renamed) imports diagram-core; outline/errors/navigator + treeProvider
  vscode-debugger/   (NEW) imports diagram-core + panel-core + protocol + ws; own graphView instance
  panel-core/, protocol/  (unchanged, already shared)
```

`graphView` decoupling: its only tie to the outline `treeProvider` is `treeProvider.isNodeExpanded(n)` (graphView.ts:574,598). Replace the constructor `treeProvider` arg with an optional `reflectsExpansion?: (node: MachineNode) => boolean` callback. devtool passes `n => treeProvider.isNodeExpanded(n)`; debugger passes nothing.

`findStaticMachine` (currently `vscode-extension/src/debugger/debuggerCommands.ts`) moves to `diagram-core` since both the debugger and the devtool invoke-resolver use it.

## Steps

### Part A — rename directory (safe, do first)  ☐
- [ ] `git mv packages/vscode-extension packages/vscode-devtool`
- [ ] Root `package.json`: `dev:vscode` script path → `packages/vscode-devtool`; add `dev:debugger` later.
- [ ] `packages/vscode-devtool/package.json`: `repository.directory` + `homepage` → `packages/vscode-devtool`. Keep `name`, `publisher`, `displayName`.
- [ ] Prose/path refs: root `README.md` (28,31), `IMPLEMENTATION_SUMMARY.md` (216), devtool `README.md` image/source URLs.
- [ ] `packages/adapter/src/reconnect-flap.test.ts:8` import → will point at the new debugger package in Part B2; for now repoint to `../../vscode-devtool/src/debugger/wsClient.js` (kept until B2).
- [ ] Verify: `npm install`, `npm run check && npm run compile` in vscode-devtool; `npm test` at root. Commit.

### Part B1 — extract diagram-core  ☐
- [ ] Create `packages/diagram-core` (package.json `@xstate-devtools/diagram-core`, private, tsc build to `dist/`; tsconfig; deps: typescript, elkjs; its own esbuild for `webview/graph.ts` OR consumers build the webview — decide: consumers bundle the webview entry from diagram-core source).
- [ ] `git mv` into it: `parser.ts machineModel.ts utils.ts export/mermaid.ts treeEditor.ts workspaceScanner.ts graphView.ts webview/graph.ts`; add `findStaticMachine` (extract from debuggerCommands.ts).
- [ ] Decouple `graphView` from `treeProvider` (optional callback).
- [ ] Update all `vscode-devtool` imports `./parser` etc → `@xstate-devtools/diagram-core`. devtool keeps `treeProvider.ts`, `errorsView.ts`, `navigatorView.ts`, etc.
- [ ] devtool esbuild: build the graph webview from the diagram-core entry into devtool `out/webview/graph.js`.
- [ ] Verify devtool builds + diagram renders. Commit.

### Part B2 — create vscode-debugger  ☐
- [ ] New `packages/vscode-debugger`: package.json (new name e.g. `xstate-debugger`, displayName "XState Debugger", publisher MichaelBeswick, own `activationEvents` incl. `onView:xstateDebuggerInstances`), tsconfig, esbuild (extension + `out/webview/debugger.js` from debuggerPanel + `out/webview/graph.js` from diagram-core), `.vscodeignore`, `.vscode/launch.json`+`tasks.json`, `resources/debugger.svg`.
- [ ] `git mv` debugger files from vscode-devtool: `src/debugger/*` (drop findStaticMachine, now in diagram-core), `src/webview/debuggerPanel.ts`.
- [ ] Debugger `activate()`: construct its OWN `XStateGraphViewProvider` + `WorkspaceScanner` from diagram-core; wire the debugger block lifted from devtool `extension.ts:809-947` + invoke-resolver bits (1110-1128).
- [ ] Move debugger `contributes` (views, viewsContainers `xstate-debugger`/`xstate-events`, 21 `xstateDebugger.*` commands, debugger menus/keybindings/viewsWelcome, config `debuggerUrl/showStopped/followDiagram` → re-namespace under a debugger config section) OUT of devtool `package.json` INTO the new manifest. Remove them from devtool.
- [ ] Remove debugger imports/wiring from devtool `extension.ts`; devtool keeps the graphView invoke-resolver but resolves only against the static scanner (no running actors).
- [ ] Repoint `packages/adapter/src/reconnect-flap.test.ts` → `../../vscode-debugger/src/debugger/wsClient.js`.
- [ ] Root `package.json`: add `dev:debugger`.
- [ ] Verify: both extensions `npm run check && npm run compile`; root `npm test`. Commit.

### Part C — cleanup + verify  ☐
- [ ] Root `README.md` package table: list both extensions. Per-package READMEs split (debugger sections move out of devtool README into debugger README; memory: keep READMEs in sync).
- [ ] `vsce package --no-dependencies` works for both (elkjs hoisted to root).
- [ ] Manual F5 smoke per package (outline+diagram in devtool; instances/events/reveal-in-diagram in debugger). Commit.

## Risks / notes
- Re-namespacing debugger config keys (`xstateOutline.debugger*` → e.g. `xstateDebugger.*`) is a user-visible settings migration; keep old keys readable or document. Decide during B2.
- `vsce package --no-dependencies` per memory (monorepo hoists elkjs).
- Each extension serves its own copy of the graph webview (`out/webview/graph.js`) built from diagram-core source.
