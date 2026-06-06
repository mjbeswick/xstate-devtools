# xState Devtools

A Visual Studio Code extension that displays XState state machines as an interactive **tree outline** and an interactive **statechart diagram**, with search and smart navigation. It analyzes your source statically (no need to run your app) and works with both XState v4 and v5.

![xState Devtools showing the machine outline, search, and source navigation](https://github.com/mjbeswick/xstate-devtools/raw/main/packages/vscode-extension/images/screenshot.png)

## Features

### Outline & analysis
- 📦 **Workspace scanning** — finds all XState machines across your project, updating live as you edit
- 🌲 **Machine outline** — nested/parallel states, transitions, targets, entry/exit/transition actions, guards, invokes, actors, delays, context, and XState v5 `setup` implementations
- 🧠 **Context-aware autocomplete** — suggests valid machine, state, transition, invoke, and setup properties, plus valid target/action/guard/actor references
- ✅ **Invalid property highlighting** — unknown config properties appear directly in the tree with red error styling
- ✏️ **Tree editing** — context-menu actions let you add/remove nodes, rename items, and change supported property values from the outline
- 🔍 **Search** — a dedicated search box (styled like the Extensions view) with type filtering and keyboard navigation
- 🎯 **Smart navigation** — click to jump to source; double-click an action/guard to jump to its implementation, or a transition target to jump to the target state
- 🧭 **Cursor sync** — highlights the tree node matching your editor cursor
- 🎨 **Theme-aware icons** — node icons use VS Code codicons and theme colors

### Statechart diagram
- 🗺️ **Visual statechart** — render any machine (or any compound state) as a Harel-style diagram in its own editor tab. Use **View State Diagram** from a tree item's context menu / inline action.
- 🧱 **One tab per machine** — each machine opens in its own tab and remembers its own layout direction
- 🤖 **Automatic layout** — hierarchical (Sugiyama / ELK "layered") layout with smooth, cusp-free bezier transitions and distributed connection points
- ↧ / ↦ **Top-down / left-right toggle** — switch flow direction per diagram; the choice persists across refreshes
- 🔭 **Pan & zoom** — drag to pan, scroll to zoom, plus toolbar **zoom in / out / fit**
- 🌳 **Reflects tree expansion** — collapsed states render as single blocks; **expand all / collapse all** from the toolbar, or expand/collapse individual regions by clicking them
- 🎯 **Sub-diagrams** — open **View State Diagram** on a compound state to focus on just that subtree
- 🔗 **Two-way sync** — click a state in the diagram to select it in the tree; click an event label to select that transition; selecting in the tree highlights the node in the diagram
- ✨ **Hover highlighting** — hovering a state emphasizes its connected transitions and dims the rest
- 🖼️ **Export** — save the current diagram as **SVG** or **PNG**

## Statechart diagram conventions

| Element | Rendering |
| --- | --- |
| **State** | Rounded rectangle |
| **Initial state** | Filled dot with an arrow into the state |
| **Final state** | Rounded rectangle with a second inner outline |
| **Parallel (orthogonal) state** | Dark **dashed** border with an italic `parallel` tag in the title bar |
| **Compound state (collapsed)** | Single box marked with `⊕` |
| **Region (expanded compound state)** | Outline box with a title bar (no fill) |
| **Machine root** | Labelled root box framing the whole chart |
| **Transition** | Curved arrow labelled `EVENT [guard] / action1, action2` |
| **Entry / exit actions** | Listed inside the state box below a divider (`entry/ …`, `exit/ …`) |
| **Selected / highlighted state** | Filled with the selection color and outlined with the focus color |

### Diagram toolbar

| Button | Action |
| --- | --- |
| `+` / `−` | Zoom in / out |
| `⊡` | Fit to screen |
| `↧` / `↦` | Toggle layout direction (top-down ↔ left-right) |
| `⊞` / `⊟` | Expand all / collapse all states |
| `SVG` / `PNG` | Export the diagram as an image |

## Tree icons

| Node type | Icon (codicon) | Color token |
| --- | --- | --- |
| Machine | `package` | `charts.blue` |
| State (normal) | `circle-filled` | `symbolIcon.fieldForeground` |
| State (initial) | `circle-filled` | `charts.green` |
| State (final) | `circle-filled` | `charts.red` |
| State (parallel) | `circle-outline` (hollow) | `charts.blue` |
| File group | `file-code` | default |
| Loading | `loading~spin` | default |
| `on` handler group | `inbox` | `charts.orange` |
| Transition (event) | `symbol-event` | `charts.orange` |
| Transition (`onDone` / `onError`) | `circle-filled` | `charts.orange` |
| Transition target | `target` | `terminal.ansiBrightMagenta` |
| Action | `rocket` | `symbolIcon.methodForeground` |
| Entry action | `debug-step-into` | `symbolIcon.methodForeground` |
| Exit action | `debug-step-out` | `symbolIcon.methodForeground` |
| Guard | `shield` | `terminal.ansiCyan` |
| Invoke | `circuit-board` | `charts.yellow` |
| Actor | `play-circle` | `charts.yellow` |
| Delay | `history` | `terminal.ansiYellow` |
| Setup section | `settings-gear` | `terminal.ansiBlue` |
| Context | `symbol-variable` | `symbolIcon.variableForeground` |
| Context property | `symbol-property` | `symbolIcon.propertyForeground` |
| Invalid property | `error` | `terminal.ansiRed` |

Nodes with diagnostics override the color: **errors** use `testing.iconFailed` (red) and **warnings** use `testing.iconQueued` (orange/yellow).

## Colors

All colors are VS Code theme tokens, so the extension matches your active theme (light, dark, or high-contrast).

**Tree** uses the icon color tokens listed above — chiefly `charts.blue` (machines, parallel states), `charts.green` (initial), `charts.red` (final), and `charts.orange` (transitions / handlers).

**Diagram** derives every color from the editor theme:

| Theme token | Used for |
| --- | --- |
| `--vscode-editor-foreground` | State / region borders, transition arrows, and node labels |
| `--vscode-editor-background` | Canvas background and transition-label backgrounds |
| `--vscode-editorWidget-background` | State box fill |
| `--vscode-descriptionForeground` | Transition labels and entry/exit action text |
| `--vscode-list-activeSelectionBackground` | Fill of a highlighted (selected) state |
| `--vscode-focusBorder` | Border of a highlighted (selected) state |
| `--vscode-charts-blue` | Parallel-state icon in the tree |

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

The outline also detects XState v5 setup sections such as:

```typescript
const machine = setup({
  actions: { saveDraft: () => {} },
  guards: { canSubmit: () => true },
  actors: { loadUser: fromPromise(async () => {}) },
  delays: { RETRY_DELAY: 1000 }
}).createMachine({ ... });
```

## Usage

1. Open a JavaScript or TypeScript project that uses XState.
2. Click the **xState Devtools** icon in the activity bar to open the **Search** and **Outline** views.
3. Navigate the outline:
   - **Click** any node to jump to its source.
   - **Double-click** an action, guard, entry, exit, or invoke to go to its implementation (or press **F12** with the node focused).
   - **Double-click** a transition target to jump to the target state's definition.
   - **Right-click** tree nodes to edit them from the outline, add child states/transitions/references, delete supported nodes, or open **Go to Implementation**.
   - Type in the **Search** box and use ↑/↓/Enter to move through results; the funnel button filters results by node type.
4. Open the diagram:
   - Use **View State Diagram** (inline icon or right-click) on a machine or compound state to open the statechart in a new tab.
   - Click states/events to sync back to the tree, drag to pan, scroll to zoom, and use the toolbar to change direction, expand/collapse, fit, or export.

The Outline view's title bar exposes toggles for scope (file/workspace), view mode (grouped/flat), showing state configs, cursor following, whether the diagram reflects tree expansion, grouping event handlers under `on`, and child sort order.

Autocomplete works in JavaScript and TypeScript machine configs, and uses dropdowns for supported value selections such as valid target states and setup-defined actions/guards/actors.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `xstateOutline.defaultScope` | `workspace` | Scan the current file only, or the whole workspace |
| `xstateOutline.defaultViewMode` | `flat` | Flat list of machines, or grouped by file |
| `xstateOutline.showStateConfigs` | `false` | Include `createStateConfig`/`stateConfig` patterns in the outline |
| `xstateOutline.followCursor` | `true` | Reveal the tree node matching the editor cursor |
| `xstateOutline.graphReflectsTreeExpansion` | `true` | Make the diagram render only the states expanded in the outline |
| `xstateOutline.groupEventHandlers` | `false` | Group a state's event-handler transitions under an `on` node |
| `xstateOutline.sortChildren` | `original` | Order child nodes by source order (`original`) or alphabetically (`sorted`) |

## Requirements

- Visual Studio Code 1.78.0 or higher
- A JavaScript or TypeScript project using XState

## Known limitations

- Only detects statically defined machines (not dynamically generated ones)
- Context values are shown one level deep to avoid clutter
- Tree editing currently focuses on the common object/string forms; complex conditional transition arrays and other advanced shapes may still fall back to manual source editing
- In a focused sub-diagram, transitions whose target lies outside the selected subtree are not drawn

## License

MIT
