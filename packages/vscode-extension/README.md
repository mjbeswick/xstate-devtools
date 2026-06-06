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
- **Search** — a dedicated search box (styled like the Extensions view) with type filtering and keyboard navigation

### ✏️ Editing & authoring
- **Context-aware autocomplete** — suggests valid machine, state, transition, invoke, and setup properties, plus valid target / action / guard / actor references
- **Tree editing** — add, rename, and delete states, transitions, and references straight from the outline
- **Invalid property highlighting** — unknown config properties show up in the tree with a red error icon

### 🗺️ Statechart diagram
- **Visual statechart** — render any machine (or any compound state) as a Harel-style diagram in its own editor tab via **View State Diagram**
- **Automatic layout** — clean hierarchical layout with smooth, curved transitions
- **Top-down ↔ left-right** — flip the flow direction to suit each machine; your choice is remembered
- **Pan, zoom & fit**, plus **expand all / collapse all**
- **Reflects the outline** — collapsed states render as single blocks; click a region to expand it
- **Two-way sync** — click a state to select it in the tree, click an event to select its transition, and selecting in the tree highlights it in the diagram
- **Hover to focus** — hovering a state emphasizes its transitions and dims the rest
- **Export** the diagram as **SVG** or **PNG**
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
| Box marked `⊕` | A collapsed compound state (click to expand) |
| Outline box with a title bar | An expanded region |
| Outer titled box | The machine itself |
| Curved arrow with a label | A transition, labelled `EVENT [guard] / actions` |
| `entry/ …` and `exit/ …` inside a box | The state's entry/exit actions |

**Diagram toolbar:** zoom in `+` / out `−`, fit `⊡`, toggle direction `↧`/`↦`, expand all `⊞`, collapse all `⊟`, and export `SVG` / `PNG`.

## Icon & color legend

Every icon and color is drawn from your **active VS Code theme**, so the extension looks at home in light, dark, and high-contrast themes alike.

| Symbol | Meaning |
| --- | --- |
| 📦 Blue box | Machine |
| 🟢 Green dot | Initial state |
| 🔴 Red dot | Final state |
| ⚪ Hollow blue circle | Parallel state |
| 🔵 Filled dot | State |
| 🟠 Orange event | Transition (orange inbox = an `on` handler group) |
| 🎯 Magenta target | Transition target |
| 🚀 Action · ⤓ entry · ⤒ exit | Actions (entry/exit/transition) |
| 🛡️ Cyan shield | Guard |
| 🔌 Yellow board | Invoke · ▶️ actor |
| 🕘 Delay · ⚙️ setup section | Timing & v5 `setup` blocks |
| 🔤 Context · 🔧 context property | Machine context |
| ❌ Red error | Invalid / unknown property |

In the diagram, state borders, arrows, and labels follow your editor's foreground color; state fills use the editor widget background; a **selected** state is filled with your theme's selection color and outlined with the focus color; and **parallel** states use a dark dashed border.

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
