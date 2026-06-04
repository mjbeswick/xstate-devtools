# xState Devtools

A Visual Studio Code extension that displays XState state machines as an interactive tree outline, with search and smart navigation. It analyzes your source statically (no need to run your app) and works with both XState v4 and v5.

![xState Devtools showing the machine outline, search, and source navigation](https://github.com/mjbeswick/xstate-devtools/raw/main/packages/vscode-extension/images/screenshot.png)

## Features

- 📦 **Workspace scanning** — finds all XState machines across your project, updating live as you edit
- 🌲 **Machine outline** — nested/parallel states, transitions, entry/exit/transition actions, guards, invokes, and context
- 🔍 **Search** — a dedicated search box (styled like the Extensions view) with type filtering and keyboard navigation
- 🎯 **Smart navigation** — click to jump to a definition; double-click an action/guard to jump to its implementation, or a transition target to jump to the target state
- 🧭 **Cursor sync** — highlights the tree node matching your editor cursor
- 🎨 **Theme-aware icons** — node icons use VS Code codicons and theme colors

## Supported patterns

The extension detects statically defined machines in these forms:

**XState v4**
```typescript
const machine = createMachine({ ... });
const machine = Machine({ ... });
```

**XState v5**
```typescript
const machine = setup({ ... }).createMachine({ ... });
const machine = journeySetup.createMachine({ ... });
const config  = createStateConfig({ ... });
const config  = stateConfig({ ... });
```

## Usage

1. Open a JavaScript or TypeScript project that uses XState.
2. Click the **xState Devtools** icon in the activity bar to open the **Search** and **Outline** views.
3. Navigate:
   - **Click** any node to jump to its source.
   - **Double-click** an action, guard, entry, exit, or invoke to go to its implementation (or press **F12** with the node focused).
   - **Double-click** a transition target to jump to the target state's definition.
   - Type in the **Search** box and use ↑/↓/Enter to move through results; the funnel button filters results by node type.

The Outline view's title bar exposes toggles for scope (file/workspace), view mode (grouped/flat), showing state configs, and cursor following.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `xstateOutline.defaultScope` | `workspace` | Scan the current file only, or the whole workspace |
| `xstateOutline.defaultViewMode` | `flat` | Flat list of machines, or grouped by file |
| `xstateOutline.showStateConfigs` | `false` | Include `createStateConfig`/`stateConfig` patterns in the outline |
| `xstateOutline.followCursor` | `true` | Reveal the tree node matching the editor cursor |

## Requirements

- Visual Studio Code 1.78.0 or higher
- A JavaScript or TypeScript project using XState

## Known limitations

- Only detects statically defined machines (not dynamically generated ones)
- Context values are shown one level deep to avoid clutter

## License

MIT
