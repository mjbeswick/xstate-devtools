# Changelog

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

