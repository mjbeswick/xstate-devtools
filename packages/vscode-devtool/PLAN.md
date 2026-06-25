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

- [x] `src/machineModel.ts` — pure, serializable `SimModel` (`SimState[]` +
  `SimTransition[]` + `rootId`), no VS Code imports. Built **inside**
  `buildElements()` so it reuses the exact diagram ids and the existing
  target-resolution logic (no second traversal to drift out of sync). Carried on
  the payload as `payload.sim`.
- [x] Structural interpreter in the same module: `indexModel`, `initialConfig`,
  `enabledTransitions(config)`, `fire(config, transition)`, `isDone`. LCA-based
  exit/entry correctly isolates parallel regions and defaults sibling regions on
  entry. A `config` is the set of active state ids (leaves + ancestors).
  (History pseudo-states resolve structurally only — deep/shallow restore is a
  known MVP gap; guards are never auto-evaluated.)
- [x] Active-state overlay in `webview/graph.ts` — `paintSim()` greens the active
  config, fades the rest, and emphasizes edges touching it. Re-asserted after
  every `render()`; selection styling yields to it while simulating.
- [x] Host plumbing — the model rides on `payload.sim`; no per-step host round-trip
  needed (the interpreter runs in the webview).

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

- [x] **▷ Sim** toggle on the diagram toolbar → enters simulate mode (expands all,
  shows the initial config via the Phase 0 overlay). A side panel hosts the UI.
- [x] Event affordances — each enabled transition is its own button
  (`EVENT [guard] → target`), so guarded branches are explicit user choices;
  clicking calls `fire()` and repaints. Edges touching the active config are
  emphasized.
- [x] Trace panel — ordered list of fired events + resulting leaf states, with
  **step-back** (restores the pre-fire config) and **reset**. Canvas clicks are
  suppressed while simulating so nothing collapses out from under it; live source
  edits restart the run.
- [x] `after`/`always`/`onDone`/`onError` — surfaced as explicitly fireable events
  (labelled by the parser, e.g. `after 1000ms`), since timing/guards aren't static.
- [x] README: simulator added to the Diagram features + toolbar line.
- [ ] (Deferred) Keyboard shortcuts for the simulator; per-panel trace persistence
  across diagram reloads.

## Phase 3 — Test-path & coverage generation

- [x] `machineModel.ts`: `shortestPaths(idx)` — BFS over the *configuration*
  graph (keyed by sorted active ids so cycles and internal no-ops terminate).
  Reuses `initialConfig`/`enabledTransitions`/`fire`.
- [~] ~~**How Do I Reach This State?**~~ — built (shortest path + Copy + Replay in
  Simulator), then **removed** (low value); the replay/`__REPLAY__`/`simReplay`
  plumbing and `shortestPathTo` were removed with it.
- [x] **Generate Test Paths** (outline → machine) → Markdown report: shortest path
  to every reachable state, unreachable states flagged, plus `createActor` test
  skeletons. (Subsumes the optional coverage view for now.)
- [x] README: Features subsection (Test paths & coverage).
- [ ] (Deferred) Dedicated coverage *tree view*; `simplePaths` enumeration for
  exhaustive suites (shortest-path skeletons cover the common case).

## Phase 3b — Fuller test coverage

**Goal.** "Generate Test Paths" today emits one shortest path per reachable
state — that's *state* coverage. Add **transition coverage** (every edge
traversed at least once) and optional **simple-path enumeration**, and let the
user pick the strategy. Transition coverage is the primary deliverable; simple
paths is bounded/opt-in because it can explode.

**What today's output misses (the motivation).** A transition that isn't the
shortest route to any new state is never exercised: self-loops, `RETRY`/back
edges, the non-shortest branch of a guarded fork, alternate longer routes.
State coverage can pass while those edges are untested.

### Decisions / open questions
- [ ] **UX: one report vs. a mode picker.** Recommended: a QuickPick on
  "Generate Test Paths" — *State coverage* (current), *Transition coverage*
  (new default), *Simple paths (bounded)*. Confirm vs. always emitting all three
  sections in one report.
- [ ] **Minimal path set vs. one-path-per-edge.** Recommended: greedy set-cover
  so the skeleton has *few* paths that together cover all transitions, not one
  test per edge. Confirm the extra reduction step is wanted (simpler = one path
  per uncovered edge).
- [ ] **Simple-path caps.** Hard caps required (e.g. ≤200 paths, ≤depth 40);
  emit a "truncated — showed N, more exist" note. Confirm the default cap.
- [ ] **Self-loops / internal transitions** count toward transition coverage?
  Recommended yes (they're real edges), but they never change the config — the
  covering "path" is `path-to-source + fire(self)`.

### Steps
- [ ] `machineModel.ts` — `transitionCoverage(idx)`: one BFS over the config
  graph recording, per `SimTransition.id`, the first (shortest) path that
  *fires* it (`pathToSourceConfig + [t]`). Returns `Map<transitionId,
  SimTransition[]>` plus the set of **unreachable** transition ids (source
  config never reached). Reuses `enabledTransitions`/`fire`/`configKey`.
- [ ] `machineModel.ts` — `reducePathSet(paths)`: greedy set-cover — repeatedly
  take the candidate path covering the most still-uncovered transitions until all
  are covered. Pure, unit-testable.
- [ ] `machineModel.ts` — `simplePaths(idx, { maxPaths, maxDepth })`: DFS
  enumerating acyclic config paths (a config key may not repeat within a path),
  capped; returns paths + a `truncated` flag.
- [ ] `graphView.generateTestPaths` — branch on the chosen mode; render a
  coverage summary (`X/Y transitions covered`, list uncovered/unreachable edges
  as `source —EVENT→ target`) and `createActor` skeletons from the reduced set.
- [ ] `extension.ts` — QuickPick for the mode before calling through; keep the
  command id stable.
- [ ] **Tests** (vitest, the suite exists): cover `transitionCoverage`
  (every edge hit; back-edge/self-loop cases), `reducePathSet` (minimality),
  and `simplePaths` capping. Fixtures with a guarded fork + a `RETRY` back edge.
- [ ] README + CHANGELOG: note transition-coverage / simple-path modes.
- [ ] PLAN: tick the deferred `simplePaths` item above.

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

## Phase 5 — Invoked-actor drill-in + parallel-region wrapping

**Goal.** Make invoked machines first-class in both the debugger tree and the
diagram, and stop wide parallel states (e.g. `app` with ~15 regions) from
sprawling into one unreadable horizontal row.

### Done
- [x] Diagram: `+` toggle on an invoke-only state opens the invoked machine
  (currently its own diagram tab). `webview/graph.ts` `drillToggle`. *(commit)*
- [x] Tree: invoked child actors nest under the state that invokes them
  (match invoke `src` → child actor `machine.id`), expandable; unmatched /
  spawned actors stay direct children. `debugger/debuggerTreeProvider.ts`. *(commit)*

### 5a. Inline-nest invoked machines in the diagram (fully live)
Replace "open in a new tab" with the invoked machine rendered as expandable
children inside the invoke node, with the live overlay lighting up its active
states from the **child actor's** snapshot.

- [x] **Resolve at build time.** `setInvokeResolver((src) => MachineNode |
  undefined)` on `XStateGraphViewProvider`, wired in `activate()` to
  `findStaticMachine(workspaceScanner, src)`.
- [x] **Nest into the model.** `collect()` nests each resolvable invoke's root
  states as children of the invoke node (`foreign` recursion), marks it
  `compound`, dedups per machine key (breaks cycles + repeats). The node gets
  the normal region expand/collapse; `drillToggle` only fires for unresolvable
  invokes (then `hasChildren` is false). `addEdges(m)` emits each nested
  machine's internal transitions.
- [x] **Keep foreign nodes out of the simulator.** `foreign` flag skips
  `simStates`/`simTransitions` for inlined nodes.
- [x] **Collapse by default** — invoke states with nested children push to
  `collapsedIds` when not expanded in the tree (also keeps 5b wrapping intact:
  collapsed sub-edges resolve to `s===t` and are skipped).
- [x] **Live overlay across actors.** `setLiveConfig` → `applyLiveConfigs(Map<
  label, value>)`: per panel, unions active nodes from the main machine + every
  nested invoked machine (`entry.invokedMachines`), posting once.
  `syncDiagram` builds the map and calls it once so child overlays don't clobber
  the parent's.
- [x] **Node actions on foreign nodes.** Resolve via `entry.nodeById` → the
  foreign node's own `uri`/`range` (reveal-in-tree no-ops gracefully).
- [x] README: updated the `invoke <src>` line.
- [ ] Manual-verify via F5: nested machine expands inline; live child-actor
  states light up; simulator/test-paths still cover only the host machine.

### 5b. Wrap parallel regions into a grid
A parallel state's regions have no edges between them, so ELK `layered` drops
them in one ever-widening row (screenshot: `app`).

- [x] **Understand the prior revert.** Commit `91c241b` reverted `d8f718e`,
  which applied `rectpacking` to *every* parallel node. With the root's
  `elk.hierarchyHandling: INCLUDE_CHILDREN`, edges route globally; rectpacking
  packs region boxes but reserves no space for / doesn't route edges, so any
  parallel state with transitions crossing its regions got mangled.
- [x] **Retry with the fix.** Apply `rectpacking` only when the parallel node's
  subtree has no routed edges (`subtreeHasEdge`, fed by `edgeEndpoints` built in
  `buildElkGraph`). Self-loops are excluded (skipped before endpoints collected),
  so they don't block packing. Edge-crossing parallels keep `layered`.
- [x] README: restored the "wrap into a grid" line (now noting it's the
  independent-regions case). *(B1 resolved: condition on isolation, not count.)*
- [ ] Manual-verify via F5: the wide `app` parallel wraps; a parallel state with
  inter-region transitions still routes correctly with `layered`.

### Open questions
- [x] **A1:** Always nest the *static* structure (diagram is useful offline);
  the live overlay lights it up when a child actor is running.
- [x] **A2:** Bounded by per-machine-key dedup — each machine nests once, which
  also breaks invoke cycles. No separate depth cap needed.
- [ ] **B1:** Wrap all parallel states, or only past a region-count/width
  threshold (small parallel states read fine as a row)?

## Cross-cutting

- [ ] Keep `README.md` in sync **in the same commit** as each behavioural change
  (project rule).
- [ ] Manual verification per phase via `F5` Extension Development Host (no test
  suite). Add a sample machine fixture exercising parallel + history + guards +
  `after`/`always` for simulator/inspector testing.
- [ ] Commit per logical batch (project rule).
- [ ] Delete this file once all phases land (or trim completed phases as we go).
