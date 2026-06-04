# Changelog

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

