# Changelog

## [1.19.0] - 2026-06-26

### Fixed
- **Invoke-only states no longer show a misleading expand `+`** — a state with no child states but a single invoked actor (e.g. `invoke tickActor`) rendered an expandable `+` even when the actor was a promise/callback with nothing to open; clicking it only produced a "No machine named …" warning. The expand affordance now appears only when the invoke resolves to a real machine in the workspace (nested inline or openable).

## [1.16.0] - 2026-06-19

### Added
- **Live debugger** — attach to a running Node/SSR app that uses the `@xstate-devtools/adapter` server adapter (`createServerAdapter()`, default `ws://127.0.0.1:9301`) directly from the editor:
  - The open statechart **diagram lights up with the real active state** as the machine runs (actual resolved path, real guards/context — not the static simulator's every-branch enumeration).
  - A new **XState Debugger** sidebar view with a live actor tree, the selected actor's status / active state / real context, and an event log.
  - **Time travel** — click any event to freeze the diagram and inspector at that point; "Back to live" resumes. Pure client-side replay.
  - **Send events** — fire the current state's outgoing transitions, or a custom event with a JSON payload.
  - **Persisted snapshots** — capture and (for actors wired with `useRestorableInspectedMachine`) restore.
  - **Session export / import** — save a captured session to JSON and replay it read-only.
  - **Status-bar indicator** with connect/disconnect and auto-reconnect; new `xstateOutline.debuggerUrl` setting.
  - Works alongside the VS Code (V8) debugger — independent transports, so breakpoints and live state inspection compose.

## [1.15.2] - 2026-06-18

### Fixed
- **Clicking a guarded `always`/conditional branch in the diagram now navigates** — each branch of an array transition (`always`, `onDone`, multi-branch `on`) resolved its edge target from the branch's display label (`when <guard> → <target>`) instead of the actual target, so guarded branches became dead/ghost edges. They now resolve and are clickable.
- **Diagram selection no longer jumps to the wrong duplicate** — when two states share a name, clicking one in the diagram echoed a name-based highlight back through the tree that re-selected the *last* same-named state. The diagram now keeps the exact node it was clicked on.

## [1.15.1] - 2026-06-16

### Fixed
- **Function-valued context properties no longer show parentheses** — a context property whose value is a function rendered as `name: (function)`; it now reads `name: function`, consistent with the other inline labels.
- **Selecting another diagram state no longer flashes** — clicking a state applied the edge-focus effect, then the tree reveal it triggers echoed back a passive highlight that reset the edges one frame later. The echo is now ignored when it names the already-selected state.

## [1.15.0] - 2026-06-16

### Changed
- **Guard combinators show a logic-symbol badge** — `and`/`or`/`not` groups now render with a cyan square badge carrying the connective glyph (∧ conjunction, ∨ disjunction, ¬ negation) instead of the shield, distinguishing the logical grouping from leaf guards. Drawn as vector paths for crisp, cross-platform rendering at any size.
- **Inline and combinator guard/action labels read like state markers** — anonymous (unnamed) actions and guards now show a plain kind label (`action`, `guard`) with the qualifier as a dimmed marker (`· inline`), and combinator groups show `guard · and` / `· or` / `· not` — mirroring how `parallel`/`initial`/`final` read on state nodes. Parentheses are no longer wrapped around inline-function labels.
- **Actor nodes use a person icon** — the actor icon is now the `account` (person) codicon in place of the play-circle.

## [1.14.0] - 2026-06-15

### Fixed
- **Go to Implementation now works for guards nested in `and`/`or`/`not`** — for a guard string inside a combinator, the TypeScript definition provider resolves the array element's *type* into xstate's `.d.ts`, so the jump landed in `node_modules` instead of the implementation. Definition results in `node_modules` / `.d.ts` are now ignored, falling through to the name-based finder that resolves the guard against `setup({ guards })` (covers object-form `{ type }` guards too).

## [1.13.0] - 2026-06-15

### Fixed
- **Guards inside `and`/`or`/`not` are no longer flagged as unused** — guards referenced through the XState v5 higher-order guard helpers (`and(['a', 'b'])`, `or([…])`, `not('c')`), arbitrarily nested combinations, and the `{ type, params }` object form (including `and([not({ type: 'isX' }), …])`) are now recognised as used. `stateIn(…)` is correctly treated as a state reference, not a guard. ([#1](https://github.com/mjbeswick/xstate-devtools/issues/1))

### Changed
- **Tree outline surfaces inner guards of `and`/`or`/`not`** — a combinator now renders as a `guard` group with one navigable child per referenced inner guard (recursively), so each inner guard — including object-form `{ type, params }` guards — is clickable for **Go to Implementation** instead of showing the bare `not`/`and`/`or` helper name. Conditional-array branches (`always: [{ … }]`, multi-branch `on`/`onDone`) now also emit a navigable `target` node, matching the string/object transition forms, and their labels read e.g. `when not(isHealthFail) → location`.

## [1.12.0] - 2026-06-15

### Added
- **Generate Setup Stubs** — right-click a machine to scaffold a `setup({ actions, guards, actors, delays })` block with a typed stub for every implementation the machine references, each flagged as already in `setup()` or missing from it. XState built-ins (`assign`, `raise`, `not`, `and`, `stateIn`, …) are skipped

### Removed
- **How Do I Reach This State?** — removed; it added little over **Generate Test Paths**. (The simulator path-replay plumbing it relied on was removed with it.)

## [1.11.0] - 2026-06-15

### Added
- **Eased pan & zoom** — programmatic view changes (fit, zoom buttons/keys, actual-size, pan-to-state, recenter) now animate smoothly; direct wheel/drag stays instant
- **Pan to selected** — selecting a state that's off-screen (from the tree, cursor sync, or keyboard) pans it into view
- **Recenter on collapse** — collapsing/expanding (or toggling internal rows) recenters the diagram, until you take manual control of the view
- **Zoom centres on the focused state** — the zoom buttons/keys zoom into/out of the selected state (or, in the simulator, the active state); wheel zoom still zooms toward the cursor
- **Simulator ↔ outline sync** — the diagram centres when the simulator opens; as you step, the active state is kept on screen and selected in the outline. Click any **active-state chip** or **trace row** to jump to that state
- **Click an event → go to its target** — clicking an event label selects the state it leads to and pans it into view (internal/out-of-diagram targets keep highlighting the transition)
- **Internal-transition toggle** — `xstateOutline.showInternalTransitions` (default true) plus a live diagram-toolbar toggle (`/ƒ`) to show/hide internal (action-only) rows inside state boxes
- **Diagram right-click menu** — replaces the inert copy/cut/paste with **Go to Source** & **Expand/Collapse** for the state under the cursor, plus fit, actual size, expand/collapse all, toggle internal transitions, and SVG/PNG/Mermaid export

### Fixed
- **Collapsing machines/compounds in the outline now sticks** — the click handler no longer force-re-expands the item it just collapsed

## [1.10.1] - 2026-06-12

### Fixed
- **Transition targets now resolve relative to the source state** (XState scoping — a bare `target` is a sibling). Previously a flat, global name lookup meant that in a machine with **duplicate state names** (e.g. a `token`/`basket` nested in a compound *and* a top-level one), a sibling-targeting transition could resolve to the wrong same-named state — drawing diagram edges to the wrong node and making downstream states wrongly report as **unreachable** in the simulator / "How Do I Reach This State?"
- **Final states no longer look like errors** — the diagram's final-state double ring and the outline's final-state bullseye now use the neutral foreground colour instead of red

## [1.10.0] - 2026-06-12

### Added
- **Interactive simulator** — a **▷ Sim** toggle on the diagram lets you walk the machine: the active state configuration lights up green, every enabled transition becomes a button (each guarded branch its own choice, since guards can't be evaluated statically), and a **trace** records your path with **step-back** and **reset**. Correctly enters/exits compound and parallel regions; `after`/`always`/`onDone` are surfaced as explicitly fireable events
- **Test paths & coverage** — right-click a state → **How Do I Reach This State?** for the shortest event sequence (copy it, or **replay it in the simulator**); right-click a machine → **Generate Test Paths** for a Markdown coverage report (shortest path to every state, unreachable states flagged) with copy-paste test skeletons
- **CodeLens** — each `createMachine` gets an inline `▶ View Diagram` action plus live state / transition / problem counts, right above the code (toggle with `xstateOutline.codeLens`)
- **Mermaid export** — export any diagram as `stateDiagram-v2` text to drop straight into Markdown/docs, from the diagram toolbar (`MMD`) or the outline's right-click menu

### Fixed
- The diagram now reliably **centres and fills** when opened — it keeps auto-fitting while the webview panel settles its size, so it no longer opens small in the top-left (most visible opening a focused state sub-diagram)
- **Follow cursor** now expands collapsed ancestors so the cursor's node is revealed and selected, instead of hidden behind a collapsed parent
- Opening the diagram via right-click now opens **centred** rather than nudged toward a corner

## [1.8.0] - 2026-06-09

### Added
- **Harel-statechart icons in the outline** — state nodes now use custom shape-based icons consistent with the diagram: a hollow circle for a state, a filled dot for the initial state, a bullseye for a final state, a dashed-split box for a parallel state, and a circled **H** for history. Drawn in a neutral grey with light/dark variants
- **Live diagram updates** — an open statechart now refreshes automatically as you edit the source, **preserving your pan & zoom**; it also keeps your viewport across collapse/expand and direction changes, and reliably auto-centers when first opened
- **Actual size (100%)** control on the diagram, with a live zoom-percent readout (click it, or press `1`, to reset to 100%)
- **Distinct transition icons** in the tree — `always` (⚡) and `after` (🕐) transitions are now visually distinguished from ordinary events
- **Actionable empty states** — the outline now offers buttons (show state configs, search the workspace, open a folder) instead of a plain message
- Object-form actions (`{ type: 'foo', params: … }`) now render in the outline

### Changed
- **Diagram readability** — initial/final/parallel states are color-coded (green/red/blue), long labels truncate with a full-text tooltip instead of stretching the layout, and event/guard labels use full-contrast text
- Collapsed compound states in the diagram now show a **disclosure chevron** (▸/▾) instead of a small ⊕
- The outline marks initial/final/parallel/history with dimmed text markers and distinct shapes, so the state kind is legible without relying on color
- Diagrams update **incrementally** (no full reload) and retain their context when hidden, so switching editor tabs no longer rebuilds the layout

### Fixed
- Single-click no longer briefly navigates before a double-click runs **Go to Implementation** (the editor no longer jumps twice)
- **Follow cursor** no longer yanks the tree selection while you're interacting with the outline
- Clearer labels for anonymous actions/guards and guarded transition branches (e.g. `when isReady → active`); de-duplicated tooltips

## [1.7.0] - 2026-06-08

### Added
- **Internal (action-only) transitions** — an event that runs actions without changing state now shows inside the state box as `EVENT [guard] / actions` (Harel internal-transition convention) instead of disappearing
- **Invoke `onDone` / `onError`** now render as labelled edges from the invoking state
- **`after` (delayed), `always` (transient), and state-level `onDone`** transitions now appear on the diagram (`after 5000ms`, `always [guard]`, `onDone`)
- **Invoke indicator** — a state that invokes a service shows an `invoke <src>` row in its box
- **State descriptions** surface as a native hover tooltip on the diagram
- **Open the diagram from the editor** — right-click a machine or state in the code (or use the command palette) to open its statechart, with that node selected; opening from the tree now also selects the node

### Fixed
- Conditional (branch-array) transitions — e.g. guarded `always: [...]` or `EVENT: [{...}, {...}]` — now render one edge per branch instead of vanishing
- **Go to Implementation / Definition** resolves transition targets, jumping to the target state's definition
- Hovering a state now fades the **arrowheads** of dimmed edges along with their lines (they previously stayed solid)

### Internal
- Added a **vitest** parser test suite (fixture snapshots + targeted assertions) — the extension's first automated tests

## [1.6.0] - 2026-06-08

### Added
- **Keyboard navigation in the diagram** — arrow keys move the selection between states (auto-panning to keep the selected state in view); **Enter** expands/collapses a compound state or jumps a leaf state to its source; **Shift+arrows** pan; `]`/`[` (or `+`/`-`) zoom; `0` or `.` fits the diagram to the screen

### Changed
- Diagrams now pick their **initial layout direction from the machine's shape** — left-to-right for small, mostly-linear machines; top-down for parallel, large, or wide ones (still toggleable and persisted per diagram)
- Compound states collapse/expand from their **title bar** — clicking the body no longer toggles, so it's harder to collapse a region by accident
- A selected state now uses VS Code's **selection colors** (matching the outline tree), and editor cursor-sync and keyboard navigation share a single active selection

### Fixed
- **Go to Implementation / Definition** now resolves transition targets — invoking it on a target state name (e.g. `CONFIG_LOADED: 'loadingAssets'`) jumps to that state's definition instead of reporting "No implementation found"
- Collapsing a compound state no longer floods the diagram with the hidden subtree's internal transition events

## [1.5.0] - 2026-06-06

### Added
- **Statechart diagram** — render any machine, or any compound state, as an interactive Harel-style statechart in its own editor tab (**View State Diagram**)
  - Automatic hierarchical (ELK "layered") layout with smooth, cusp-free curved transitions and distributed connection points
  - **Top-down / left-right** layout toggle, persisted per diagram
  - Pan, zoom, fit, and **expand all / collapse all**
  - Reflects the outline's expansion state; click a region to expand/collapse it
  - **Two-way sync** — click a state to select it in the tree, click an event label to select its transition; selecting in the tree highlights it in the diagram
  - Hover a state to emphasize its transitions and dim the rest
  - Export the diagram as **SVG** or **PNG**
  - One tab per machine, each remembering its own layout direction
- Harel/SCXML conventions: initial-state arrows, nested regions, a labelled machine root box, dashed boundaries with a `parallel` tag for orthogonal states, final-state double outlines, and `EVENT [guard] / action` transition labels
- Parallel states are marked with a hollow blue circle in the tree
- New settings: `graphReflectsTreeExpansion`, `groupEventHandlers`, `sortChildren`

### Changed
- Rewrote the README as a Marketplace listing with diagram screenshot, icon/color legend, and credit to XState & Stately

## [0.1.0] - 2024-06-03

### Added
- Initial release of XState Machine Outline extension
- Display XState machines in a tree view in the VS Code Explorer
- Support for XState v4 and v5 syntax patterns
- Workspace-wide machine scanning with file watching
- Expandable machine structure showing:
  - States (including nested and parallel states)
  - Transitions with targets
  - Entry/exit actions
  - Invoke declarations with src, onDone, onError
  - Guards/conditions
  - Context with properties
- Click navigation to machine definitions in source code
- "Go to Implementation" for actions and guards
- Cursor synchronization (tree selection follows editor cursor)
- Theme-integrated icons with semantic colors
- Two view modes:
  - **Grouped Mode**: Machines grouped by file (default)
  - **Flat Mode**: All machines at root level
- Toggle button to switch between Grouped and Flat views
- Expandable onDone and onError transitions with:
  - Action nodes
  - Guard nodes
  - Target navigation
- Support for patterns:
  - `createMachine()`
  - `Machine()`
  - `setup().createMachine()`
  - `*.createMachine()` (property access)
  - `createStateConfig()`
  - `stateConfig()`

### Features
- 🔍 Workspace scanning with incremental updates
- 🎨 Theme-aware icon colors
- 🎯 Smart command routing (actions → implementation, states → definition)
- 🔄 Real-time file watching with cache invalidation
- 📊 Tree description shows stats (file count, machine count, view mode)
- ⚡ Debounced cursor synchronization (300ms)
- 🌳 Expandable invoke transitions (onDone/onError) with actions and guards
- 👆 Click action nodes to navigate to implementations

### Technical
- Uses TypeScript Compiler API for robust AST parsing
- Implements VS Code TreeDataProvider
- File watching with Map-based cache
- Zero dependencies beyond VS Code API and TypeScript


### [0.1.1] - 2026-06-03

#### Added
- **Loading indicators** during workspace scanning
  - Shows "Loading..." item with spinning icon in tree
  - Updates tree description to "Scanning workspace..."
  - Progress notification in status bar
  - Provides visual feedback at three UI levels

#### Technical
- Added `isLoading` state tracking to TreeProvider
- Created `createLoadingItem()` method for loading placeholder
- Added 'loading' type to XStateMachineTreeItem union
- Loading state properly set before scan, cleared after completion

#### Benefits
- Better user experience during long scans
- Clear indication that extension is working
- Professional polish matching VS Code UI patterns
- No confusing empty states during parsing

