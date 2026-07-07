# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension that statically analyzes JavaScript/TypeScript source for XState machines (v4 and v5) and renders them as an interactive tree outline, with search, navigation, and "go to implementation" for actions/guards.

## Commands

```bash
npm install        # install deps (required before first build; node_modules is gitignored)
npm run compile    # tsc -p ./  → emits to out/ (the extension's main is ./out/extension.js)
npm run watch      # tsc -w; recompiles on change during development
npm run lint       # eslint src --ext ts
```

There is **no test suite** — verification is manual. Press `F5` (the "Run Extension" launch config) to open an Extension Development Host; its `preLaunchTask` compiles first. Open a JS/TS project containing XState machines and use the "xState Devtools" activity-bar view.

**`out/` is gitignored and must be compiled before launching.** A missing `out/extension.js` is the cause of "Cannot find module .../out/extension.js" activation failures — run `npm run compile`.

## Architecture

> **Shared code lives in `@xstate-devtools/diagram-core`** (`packages/diagram-core`). The static-analysis + diagram modules — `parser.ts`, `workspaceScanner.ts`, `graphView.ts`, `machineModel.ts`, `treeEditor.ts`, `utils.ts`, `xstateSchema.ts`, `export/mermaid.ts`, `findStaticMachine`, and the `webview/graph.ts` webview — were extracted there so both this extension and the standalone **vscode-debugger** extension can bundle them. They're imported from `@xstate-devtools/diagram-core` (a source-only workspace package, bundled by esbuild). `graphView` takes an optional `reflectsExpansion(node)` callback instead of depending on `treeProvider`. The live debugger itself now lives in `packages/vscode-debugger`.

Everything is wired together in `src/extension.ts` `activate()`. The data flows in one direction:

```
source files → parser (AST) → MachineNode[] → workspaceScanner (cache) → treeProvider → TreeView / search webview
```

- **`parser.ts`** — pure, static analysis using the TypeScript compiler API (`typescript`). `XStateMachineParser.parseMachines(document)` walks the AST looking for `createMachine`/`Machine`/`setup().createMachine`/`createStateConfig`/`stateConfig` calls and produces a recursive `MachineNode` tree. `MachineNode` (defined here) is the single shared data shape across the whole extension — `{ type, label, range, uri, children?, isInitial?, isFinal?, isStateConfig? }`. The parser only sees statically-defined machines; dynamically generated configs are invisible.

- **`workspaceScanner.ts`** — finds candidate files via `vscode.workspace.findFiles`, parses them, and caches the results as `FileMachines[]` (`{ uri, relativePath, machines: MachineNode[] }`). Maintains a `FileSystemWatcher` to re-parse on change/create/delete. `getCached()` is the source of truth for workspace-scope rendering and search.

- **`treeProvider.ts`** — `XStateMachineTreeProvider implements vscode.TreeDataProvider`. Wraps `MachineNode`s in `XStateMachineTreeItem`s (icon/codicon per node `type`, color via `ThemeColor`). Owns all view state and the in-memory item caches (`nodeItemCache`, `parentMap`) used for `reveal()` and cursor sync. Also hosts `search()` (flattens cached machines into `SearchResultData[]`) and `resolveTargetLocation()` (maps a transition target's state name back to the defining state's location for jump-to navigation).

- **`implementationFinder.ts`** — resolves a bare action/guard/service name to its source definition with a fallback chain: same document → imported modules → workspace symbols → workspace text search. Used by the "Go to Implementation" command.

- **`filterView.ts`** — `FilterWebviewViewProvider`, a webview-based search box (the `xstateMachineOutlineSearch` view) styled to mirror VS Code's Extensions search. Communicates with the extension host via `postMessage` (`search`/`selectItem` in, `results`/`focus`/`clear` out). Uses `@vscode/codicons` (loaded from `node_modules` as a webview resource) — keep icons consistent with the tree's `ThemeIcon` names in `treeProvider.getIcon()`.

There are two contributed views (see `package.json` `contributes.views`): the search webview and the `xstateMachineOutline` tree, both under the `xstate-outline` activity-bar container.

## View state & menu conventions

Four user-facing modes are persisted in the `xstateOutline` configuration **and** mirrored to `setContext` keys so the title-bar menu `when` clauses can show the correct toggle:

| Setting | Context key | Values |
| --- | --- | --- |
| `defaultScope` | `xstateOutline.scopeIsWorkspace` | `file` / `workspace` |
| `defaultViewMode` | `xstateOutline.viewModeIsFlat` | `grouped` / `flat` |
| `showStateConfigs` | `xstateOutline.showStateConfigs` | boolean |
| `followCursor` | `xstateOutline.followCursor` | boolean |

When adding/altering a mode: update the config property, call `vscode.commands.executeCommand('setContext', ...)` whenever it changes, and contribute paired `set*`/`set*Active` commands + `view/title` menu entries gated on the context key. The context keys are set **before** the tree provider is created in `activate()` so the first menu render is correct.

## Navigation behavior

All tree items navigate to their source `range` via the `xstateMachineOutline.navigateToNode` command on click. That command implements a manual single-vs-double-click distinction (timestamp comparison against `DOUBLE_CLICK_MS`):

- **Single click** → reveal the node's own source location.
- **Double click** on `action`/`guard`/`entry`/`exit`/`invoke` → "Go to Implementation".
- **Double click** on a `target` → jump to the referenced state's definition (`treeProvider.resolveTargetLocation`).

Cursor sync (`onDidChangeTextEditorSelection`, gated on `followCursor`) reveals the tree item whose range contains the editor cursor, using `findItemAtPosition`.

## Conventions

- `engines.vscode` is `^1.78.0`. Node typings target `@types/node` 18; `tsconfig` is `commonjs` / `ES2020`, `strict`.
- The `docs/` folder contains many historical feature/status notes; they are point-in-time and not authoritative about current behavior — trust the code.
