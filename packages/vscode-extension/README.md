# xState Devtools

**Explore, navigate, and visualize your [XState](https://stately.ai/docs) machines without leaving VS Code.** xState Devtools turns your state machines into an interactive **outline** and a live **statechart diagram**, analyzing your source statically — no need to run your app. Works with XState **v4 and v5**, in JavaScript and TypeScript.

![xState Devtools showing the machine outline, search, and source navigation](https://github.com/mjbeswick/xstate-devtools/raw/main/packages/vscode-extension/images/screenshot.png)

## Quick start

1. Install the extension and open a JavaScript/TypeScript project that uses XState.
2. Click the **xState Devtools** icon in the activity bar to open the **Search** and **Outline** views.
3. Click any node to jump to its source, or use **View State Diagram** to open a machine as a statechart.

> No configuration required — machines are discovered automatically as you edit.

## Features

### 🌲 Interactive outline
- **Workspace scanning** — finds every XState machine in your project and updates live as you type
- **Full machine tree** — nested & parallel states, transitions, targets, entry/exit/transition actions, guards, invokes, actors, delays, context, and XState v5 `setup` implementations
- **Smart navigation** — click to jump to source; double-click an action or guard to jump to its implementation, or a transition target to jump to the destination state (or press **F12**)
- **Cursor sync** — the tree highlights the node matching your editor cursor
- **Transitions panel** — select a state to see every edge touching it, the icon showing direction: **`←`** incoming (a transition that leads in) and **`→`** outgoing (a transition out). Click any row to jump to the other state — it becomes the selected state and the panel updates to show _its_ transitions, so you can walk the machine edge by edge
- **Search** — a dedicated search box (styled like the Extensions view) with type filtering and keyboard navigation
- **CodeLens** — each `createMachine` gets an inline `▶ View Diagram` action plus live state / transition / problem counts, right above the code (toggle with `xstateOutline.codeLens`)

### ✏️ Editing & authoring
- **Context-aware autocomplete** — suggests valid machine, state, transition, invoke, and setup properties, plus valid target / action / guard / actor references
- **Tree editing** — add, rename, and delete states, transitions, and references straight from the outline
- **Invalid property highlighting** — unknown config properties show up in the tree with a red error icon

### 🚦 Errors pane
A dedicated **Errors** view collects every problem the static analyzer finds across your machines — also shown inline as editor squiggles.

- **What it catches** — unreachable / orphaned states, unknown action / guard / actor references (not defined in `setup()`), duplicate explicit `id`s, invalid config properties, the deprecated `cond`, and unused `setup` entries
- **Real vs. soft** — genuine runtime failures (unknown references, duplicate ids) are **errors**; static heuristics (unreachable state, invalid property) are **warnings**; deprecations and unused-setup entries are informational
- **Severity filter** — show **all**, **warnings & errors** (the default), or **errors only** to focus on what actually fails at runtime
- **Grouping** — organize problems **by file**, **by severity**, or as a **flat list**, from the title-bar menu
- **Navigate & copy** — click a problem to jump to its source; copy a single issue or a whole group (right-click or **Ctrl/Cmd+C**)
- **At a glance** — a badge shows the total count, and the pane follows the outline's file/workspace scope

### 🗺️ Statechart diagram
- **Visual statechart** — render any machine (or any compound state) as a Harel-style diagram in its own editor tab via **View State Diagram** (from the outline _or_ by right-clicking a machine/state in the code)
- **Every transition kind** — `on` events, `after` (delayed), `always` (transient), invoke `onDone`/`onError`, and state-level `onDone`, with `EVENT [guard] / actions` labels; internal (action-only) transitions and invoked services (`invoke <src>`) show inside the state box
- **Automatic layout** — clean hierarchical layout with smooth, curved transitions
- **Top-down ↔ left-right** — a sensible direction is chosen from the machine's shape (left-right for linear machines, top-down for parallel/large ones); flip it anytime and your choice is remembered
- **Live updates** — the diagram refreshes as you edit the source, **preserving your pan & zoom**, and auto-centers when first opened
- **Pan, zoom & fit**, plus **actual size (100%)** and **expand all / collapse all**
- **Keyboard navigation** — arrow keys move the selection between states, **Enter** expands/collapses a compound or jumps a state to its source, **Shift+arrows** pan, `]`/`[` (or `+`/`-`) zoom, `0`/`.` fit, and `1` actual size
- **Reflects the outline** — collapsed states render as single blocks; click a collapsed block to expand it, or a region's title bar to collapse it
- **Two-way sync** — click a state to select it in the tree, click an event to select its transition, and selecting in the tree (or the editor cursor) highlights it in the diagram; a state's `description` shows as a hover tooltip
- **Hover to focus** — hovering a state emphasizes its transitions and dims the rest
- **Export** the diagram as **SVG**, **PNG**, or **Mermaid** (`stateDiagram-v2` — drop it straight into Markdown/docs; also from the right-click menu of any machine/state in the outline)
- **Interactive simulator** — hit **▷ Sim** to walk the machine: the active state configuration lights up green, every enabled transition becomes a button (each guarded branch its own choice, since guards can't be evaluated statically), and a **trace** records your path with **step-back** and **reset**. Correctly enters/exits compound and parallel regions; `after`/`always`/`onDone` are surfaced as explicitly fireable events
- **Focus mode** — open the diagram on a compound state to see just that subtree

## Reading the diagram

![A parallel checkout machine rendered as a statechart, with two concurrent regions, entry/exit actions, guarded transitions, and final states](https://github.com/mjbeswick/xstate-devtools/raw/main/packages/vscode-extension/images/checkout.png)

The diagrams **intentionally follow [Harel statechart](https://en.wikipedia.org/wiki/State_diagram#Harel_statechart) conventions** — the same notation XState itself is based on. Initial-state arrows, nested regions, dashed boundaries for parallel (orthogonal) states, and `EVENT [guard] / action` transition labels are all standard Harel/SCXML notation, so the diagrams read the way a statechart is meant to.

The example above shows a parallel `checkout` machine: the dashed outer box with the `parallel` tag runs its two regions — `payment` and `fulfilment` — concurrently, each with its own initial state (the filled dot), entry/exit actions inside the boxes, guarded transitions like `ADDRESS_VALID [inDeliveryZone]`, and final states (double outline).

| You'll see | Meaning |
| --- | --- |
| Rounded box | A state |
| Filled dot → state | The initial state of a region |
| Box with a double outline | A final state |
| **Dashed** box with a `parallel` tag | A parallel (orthogonal) state — its regions run concurrently |
| Box with a `⊞` (plus) square | A collapsed compound state (click to expand) |
| Region with a `⊟` (minus) title bar | An expanded region (click the title bar to collapse) |
| Outer titled box | The machine itself |
| Curved arrow with a label | A transition, labelled `EVENT [guard] / actions` |
| `entry/ …` and `exit/ …` inside a box | The state's entry/exit actions |

**Diagram toolbar:** zoom out `−`, the live zoom-percent button (click to reset to **100%**), zoom in `+`, fit `⊡`, toggle direction `↧`/`↦`, expand all `⊞`, collapse all `⊟`, export `SVG` / `PNG` / `MMD` (Mermaid), and **▷ Sim** to enter the interactive simulator.

**Diagram keyboard shortcuts:** **arrow keys** move the selection between states, **Enter** expands/collapses the selected compound (or jumps a leaf state to its source), **Shift+arrows** pan, `]`/`[` (or `+`/`-`) zoom, `0` or `.` fits to screen, and `1` resets to actual size.

## Icon & color legend

**State** nodes use custom Harel-statechart shapes — the same notation as the diagram — in a neutral grey with light/dark variants. Every other icon and color is drawn from your **active VS Code theme**, so the extension looks at home in light, dark, and high-contrast themes alike.

| Symbol | Meaning |
| --- | --- |
| 📦 Blue box | Machine |
| ○ Hollow circle | State |
| ● Filled dot | Initial state |
| ◉ Bullseye (double circle) | Final state |
| ▭ Dashed-split box | Parallel (orthogonal) state |
| Ⓗ Circled **H** | History state |
| 🟠 Orange event | Transition (orange inbox = an `on` handler group; ⚡ `always`, 🕐 `after`) |
| 🎯 Magenta target | Transition target |
| 🚀 Action · ⤓ entry · ⤒ exit | Actions (entry/exit/transition) |
| 🛡️ Cyan shield | Guard |
| 🔌 Yellow board | Invoke · ▶️ actor |
| 🕘 Delay · ⚙️ setup section | Timing & v5 `setup` blocks |
| 🔤 Context · 🔧 context property | Machine context |
| ❌ Red error | Invalid / unknown property |

In the diagram, state borders, arrows, and labels follow your editor's foreground color; state fills use the editor widget background; a **selected** state is filled with your theme's selection color and outlined with the focus color. The **initial** dot follows the foreground color (a solid black dot on light themes, per Harel convention); a **final** state's inner outline is red, and **parallel** states use a blue dashed border.

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

It also surfaces v5 `setup` sections:

```typescript
const machine = setup({
  actions: { saveDraft: () => {} },
  guards: { canSubmit: () => true },
  actors: { loadUser: fromPromise(async () => {}) },
  delays: { RETRY_DELAY: 1000 }
}).createMachine({ ... });
```

## Tips

- The Outline title bar has toggles for **scope** (file/workspace), **view mode** (grouped/flat), **state configs**, **cursor following**, whether the **diagram reflects tree expansion**, **grouping event handlers** under `on`, and **child sort order**.
- **Right-click** any tree node for editing actions and **Go to Implementation**.
- In **Search**, use ↑/↓/Enter to move through results and the funnel button to filter by node type.

## Keyboard shortcuts

| Where | Keys | Action |
| --- | --- | --- |
| **Outline** (focused) | **F12** | Go to Implementation for the selected action / guard / target |
| **Errors** pane (focused) | **Ctrl/Cmd+C** | Copy the selected problem(s) or group |
| **Search** | **↑ / ↓ / Enter** | Move through results and open the selected one |
| **Diagram** | **arrow keys** | Move the selection between states |
| **Diagram** | **Enter** | Expand/collapse the selected compound, or jump a leaf state to its source |
| **Diagram** | **Shift+arrows** | Pan |
| **Diagram** | **`]` / `[`** (or **`+` / `-`**) | Zoom in / out |
| **Diagram** | **`0`** or **`.`** | Fit to screen |
| **Diagram** | **`1`** | Reset to actual size (100%) |

> The **F12** and **Ctrl/Cmd+C** bindings are contributed defaults — rebind them in VS Code's *Keyboard Shortcuts* if you prefer.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `xstateOutline.defaultScope` | `workspace` | Scan the current file only, or the whole workspace |
| `xstateOutline.defaultViewMode` | `flat` | Flat list of machines, or grouped by file |
| `xstateOutline.showStateConfigs` | `false` | Include `createStateConfig`/`stateConfig` patterns in the outline |
| `xstateOutline.followCursor` | `true` | Reveal the tree node matching the editor cursor |
| `xstateOutline.graphReflectsTreeExpansion` | `true` | Make the diagram render only the states expanded in the outline |
| `xstateOutline.codeLens` | `true` | Show a CodeLens (counts + "View Diagram") above each machine |
| `xstateOutline.groupEventHandlers` | `false` | Group a state's event-handler transitions under an `on` node |
| `xstateOutline.sortChildren` | `original` | Order child nodes by source order (`original`) or alphabetically (`sorted`) |
| `xstateOutline.errorsGrouping` | `file` | How the Errors pane groups problems: `file`, `severity`, or `flat` |
| `xstateOutline.errorsFilter` | `warning` | Minimum severity shown in the Errors pane: `all`, `warning` (warnings & errors), or `error` |

## Requirements

- Visual Studio Code **1.78.0** or higher
- A JavaScript or TypeScript project using XState

## Known limitations

- Detects statically defined machines only (not dynamically generated ones)
- Context values are shown one level deep to avoid clutter
- Tree editing focuses on common object/string forms; advanced shapes may still need manual source edits
- In a focused sub-diagram, transitions whose target lies outside the selected subtree are not drawn

## Credits & acknowledgements

This extension exists because of [**XState**](https://github.com/statelyai/xstate) and the team at [**Stately**](https://stately.ai). XState is a wonderful, rigorous library — it brings real statecharts to JavaScript and TypeScript, with first-class support for hierarchy, parallel regions, guards, actors, and more, all grounded in decades-old, battle-tested theory. It makes complex application logic predictable, testable, and a genuine pleasure to work with.

xState Devtools is an **independent, community project** and is not affiliated with or endorsed by Stately. All credit for XState, the statechart model, and the broader ecosystem belongs to Stately and the XState contributors. If you build state machines, do yourself a favor and explore the official tooling too:

- 🌐 [Stately](https://stately.ai) — the company and platform behind XState
- 📚 [XState documentation](https://stately.ai/docs)
- 🎨 [Stately Studio — visual statechart editor](https://stately.ai/editor)
- 💻 [XState on GitHub](https://github.com/statelyai/xstate)

## Links

- [Report an issue](https://github.com/mjbeswick/xstate-devtools/issues)
- [Source on GitHub](https://github.com/mjbeswick/xstate-devtools/tree/main/packages/vscode-extension)

## License

MIT — and with gratitude to [Stately](https://stately.ai) and the XState community.
