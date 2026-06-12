# PLAN — Big features: simulation, CodeLens, export, test-paths, live inspection

## Goal

Move the extension beyond static viewing toward the "devtools" its name promises.
Add, in increasing order of effort: inline **CodeLens**, **Mermaid/PlantUML export**,
an **interactive simulator** (flagship), **test-path generation**, and finally
**live runtime inspection**. The simulator and runtime inspector share one piece of
new infrastructure — a static **statechart interpreter** plus an **active-state
overlay** on the existing diagram — so that work is sequenced to be reused, not redone.

## Architecture notes (grounding)

- `parser.ts` `MachineNode` already carries everything needed: `type` (`state` /
  `transition` / `target` / `guard` / `action` / `invoke` / `on` / …), `label`
  (event name on a `transition`, target name on a `target`), `isInitial`,
  `isFinal`, `historyType`, nested `children`, and `range`/`uri`.
- `graphView.ts` `buildElements()` already resolves a **source→target edge graph**
  (`edgeMap`: `{ source, target, labels[] }`) and a `nameToId` map. The simulator's
  transition resolution and the test-path graph are the same graph — factor it out.
- The webview (`webview/graph.ts`) already owns node **geometry** (`geom`),
  selection painting (`applyNodeStyle`/`selectNode`), edge emphasis
  (`refreshEdgeEmphasis`), and host↔webview `postMessage` (`stateClicked`,
  `eventClicked`, `setModel`, `highlight`). The active-state overlay is an
  additive style layer on top of this — no layout changes.
- Host↔webview contract lives in `graphView.ts` `getHtmlForWebview` /
  message handlers and `webview/graph.ts` `window.addEventListener('message')`.

## Open questions / decisions

- [ ] **Guards in simulation** — guards are runtime functions; we can't evaluate
  them statically. Decision: present each guarded branch as a user-selectable
  choice (show `[guardName]` on the button); never auto-pick. Confirm this is the
  desired UX vs. assuming all guards pass.
- [ ] **Real `xstate` vs. our own interpreter** — reconstructing the live config to
  drive the real `xstate` interpreter needs the source's functions (guards/actions/
  actors), which static analysis doesn't have. Decision: ship our own structural
  interpreter (transitions + hierarchy + parallel + initial/entry/exit + history,
  guards as choices). Revisit only if it proves insufficient.
- [ ] **Runtime bridge transport** — v5 `@statelyai/inspect` and v4 `@xstate/inspect`
  are WebSocket-based. Decision: run a local `ws` server in the extension host and
  document a one-line `inspect({ url })` snippet for the user's app. Confirm we're
  willing to add a `ws` dependency (currently dependency-light).
- [ ] **PlantUML** — is Mermaid alone enough for v1? (Mermaid renders in GitHub /
  VS Code Markdown preview natively; PlantUML does not.) Lean Mermaid-only first.

---

## Phase 0 — Shared interpreter + active-state overlay (foundation)

The dependency both the simulator and the live inspector sit on. Build it once.

- [ ] `src/machineModel.ts` — pure, source-of-truth structural model derived from a
  `MachineNode` (no VS Code imports). Compute: state hierarchy & ids (mirroring
  `graphView` `idByNode`/`nameToId`), each state's initial child, parallel regions,
  entry/exit/transition lists, and the resolved transition graph (event → guarded
  targets). Reuse/extract the edge-resolution logic currently inline in
  `buildElements()` so both stay consistent.
- [ ] `interpret(model)` — structural interpreter exposing:
  `initialConfig()`, `enabledEvents(config)`, `send(config, event, branchChoice?)
  → nextConfig`, with correct enter/exit of compound & parallel states and
  shallow/deep history. A `config` is the set of active leaf+ancestor state ids.
- [ ] Active-state overlay in `webview/graph.ts` — given a set of active state ids,
  paint them (reuse `nodeStyle`/`applyNodeStyle` with a new "active" variant) and
  emphasize currently-enabled edges. Add `setActive(ids)` message handling.
- [ ] Host plumbing in `graphView.ts` — `postActiveConfig(ids)` and a generic
  `postMessage({command:'setActive', ids})`.

## Phase 1 — Quick wins (ship first, low risk, self-contained)

### 1a. CodeLens above each machine
- [x] `src/codeLensProvider.ts` implementing `vscode.CodeLensProvider`; reparse via
  `XStateMachineParser.parseMachines(document)`, reuse `diagnostics` counts.
- [x] Lens text: `▶ View Diagram · N states · M transitions · ⚠ K problems`, actions
  wired to a new `openGraphViewForNode` command (accepts a `MachineNode`) and the
  Errors view (`xstateMachineErrors.focus`).
- [x] Register for JS/TS/JSX/TSX in `extension.ts`; gate on a new
  `xstateOutline.codeLens` boolean setting (default true).
- [x] README: added to Features; setting added to the Settings table.

### 1b. Mermaid export
- [x] `src/export/mermaid.ts` — pure `toMermaid(payload): string` producing
  `stateDiagram-v2` (nested `state "Label" as id { … }`, `[*] -->` initials,
  `id --> [*]` finals, `--` region dividers for parallel, notes for
  entry/exit/invoke/internal/history). Reuses the diagram payload so edges match
  the diagram exactly.
- [x] `graphViewProvider.exportMermaid()` opens the result in a Markdown doc;
  wired to a diagram-toolbar `MMD` button and the tree context menu
  (`xstateMachineOutline.exportMermaid`).
- [x] README: Features + "Export" line + toolbar line updated.
- [ ] (Deferred) PlantUML export — Mermaid-only for v1.

## Phase 2 — Interactive simulator (flagship)

- [ ] "Simulate" toggle on the diagram toolbar → enters simulate mode: diagram
  shows initial config via the Phase 0 overlay.
- [ ] Event affordances — render enabled events as clickable buttons (reuse
  `eventClicked` plumbing) or highlight fireable edges; clicking sends the event
  through `interpret().send()` and re-renders the overlay. Guarded branches render
  as a small chooser.
- [ ] Trace panel — ordered list of fired events + resulting state; **step back**
  (pop trace, recompute) and **reset**. Persist per-panel in `PanelEntry`.
- [ ] `after`/`always`/`onDone`/`onError` — surface as explicitly fireable
  pseudo-events (can't time them statically); label them as such.
- [ ] README: new Features subsection; Keyboard shortcuts if any added.

## Phase 3 — Test-path & coverage generation

- [ ] On the Phase 0 transition graph, implement `shortestPaths(from,to)` and
  `simplePaths(from)` (BFS/DFS over `enabledEvents`/`send`).
- [ ] Commands: "How do I reach this state?" (tree/diagram context) → show event
  sequence and optionally replay it in the simulator; "Generate test skeleton" →
  emit an `@xstate/test`-style or plain assertion scaffold to a new file.
- [ ] Coverage view (optional) — list states/transitions not covered by generated
  simple paths; reuse the Errors-pane tree styling.
- [ ] README: Features subsection.

## Phase 4 — Live runtime inspection (biggest)

- [ ] Add `ws` dependency; `src/inspectServer.ts` runs a local WebSocket inspector
  bus; status-bar item shows listening/connected; setting for port.
- [ ] Parse inspect-bus messages (`@xstate.actor` / `@xstate.snapshot` /
  `@xstate.event`) for both v5 (`@statelyai/inspect`) and v4 (`@xstate/inspect`).
- [ ] Map a live snapshot's state value → static node ids (by machine id, then by
  state-name path via `nameToId`); drive the Phase 0 overlay with the **real**
  active config; animate on each event.
- [ ] Context watch panel + event log (with payloads); **time-travel** by retaining
  snapshot history and re-driving the overlay.
- [ ] Reconnect handling; "no app connected" empty state; docs snippet for wiring
  `inspect({ url })` into the user's app.
- [ ] README: new top-level Features section; update the "static — no need to run
  your app" framing to note the optional live mode; Requirements.

## Cross-cutting

- [ ] Keep `README.md` in sync **in the same commit** as each behavioural change
  (project rule).
- [ ] Manual verification per phase via `F5` Extension Development Host (no test
  suite). Add a sample machine fixture exercising parallel + history + guards +
  `after`/`always` for simulator/inspector testing.
- [ ] Commit per logical batch (project rule).
- [ ] Delete this file once all phases land (or trim completed phases as we go).
