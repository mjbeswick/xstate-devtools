# Plan: VS Code Live Debugger (Chrome-extension feature parity)

## Goal

Turn the VS Code extension into a live XState debugger with the same features as the
Chrome DevTools panel — live actor inspection, event log, time-travel, event dispatch,
and snapshot restore — by connecting the extension to a running app over the existing
WebSocket protocol and overlaying live state onto the extension's existing ELK Harel
diagram.

**Scope: Node/SSR actors only** (over `createServerAdapter` / WebSocket). Browser-app
debugging is explicitly out of scope — no postMessage/content-script bridge is needed.

## Key facts driving this plan

- The Chrome panel has **no diagram engine** — it renders state as an indented text tree.
  Most of its features are pure functions of captured data (transport-agnostic) and port
  directly to a VS Code webview.
- The runtime-dependent features (dispatch, persisted-snapshot capture, restore) already
  work over the **WebSocket transport** (`createServerAdapter`, `ws://localhost:9301`).
  The VS Code extension host is a Node process, so it can connect as a WS client and get
  full-duplex protocol support.
- Node/SSR machines work out of the box over WS — full-duplex, so dispatch/capture/restore
  all work. (Browser-app transport is out of scope.)
- The VS Code extension already has a real ELK Harel diagram + accurate parser/source
  resolution (`implementationFinder.ts`), which is strictly better than the Chrome panel's
  text tree and best-effort stack-trace `vscode://` links.

## Architecture decision

Do not fork the Chrome panel. Extract shared logic into packages both consume:

- `@xstate-devtools/protocol` — wire types (move `chrome-extension/src/shared/types.ts`).
- `@xstate-devtools/panel-core` — zustand store, `active-nodes.ts`, `session-io.ts`,
  `JsonView`, and presentational components, consumed by both the Chrome panel and the
  VS Code webview.

## UI integration

Extend the existing `xstate-outline` activity-bar container and the graph view — do NOT
hijack VS Code's built-in Run & Debug view (that is DAP; out of scope). Debugger UI is
gated by context keys so it only appears when attached.

- **Status bar item** — connection state (idle/connecting/live/replay) + active actor +
  seq; click to connect/disconnect. Mirrors the chrome `ServerStatusBar`.
- **Sidebar (`xstate-outline`), shown when `xstate.debugger.connected`:**
  - **Actors** (new tree view) — live actor tree, parent→child, status dots, single-select.
  - **Outline** (existing tree) — gains live active-state highlighting for the selected actor.
  - **Inspector** (new webview view) — chrome's `SidePanel`: status, context (`JsonView`),
    transition buttons with Send, persisted-snapshot capture/Restore. Webview (not TreeView)
    for the JSON tree + dispatch form. This is the only genuinely new webview surface.
  - **Errors** (existing) — unchanged.
- **Editor area** — the existing ELK diagram gains a **live mode**: active states glow,
  current state highlighted, transition edges become click-to-dispatch, in-webview toolbar
  (actor picker, time-travel scrubber, record/export/import). The headline differentiator
  over the chrome text tree.
- **Bottom Panel — `XState Events`** (next to Terminal/Problems/Output) — the event
  log/timeline; click an event → time-travel, ←/→ step, Esc back to live.
- **Commands/keybindings** — Connect/Disconnect, Back to Live, Step Back/Forward,
  Dispatch Event…, Export/Import Session. Step keys active only when
  `xstate.debugger.timeTraveling`.
- **Source navigation** — native reveal-in-editor via the real parser/`implementationFinder`,
  replacing chrome's best-effort stack-trace `vscode://` links.
- **Context keys:** `xstate.debugger.connected`, `xstate.debugger.replayMode`,
  `xstate.debugger.timeTraveling`.

## Interaction with the VS Code (DAP) debugger

The two debuggers attach through independent channels — V8 inspector (`:9229`) for DAP vs
the app's own WebSocket (`:9301`) for XState — so both can attach to the same Node process
at once. They are complementary: breakpoint inside an action/guard shows the JS call stack,
while the XState panel shows the state + event path that got there.

Key constraint to document for users: a breakpoint freezes the event loop, so while paused,
live XState updates AND panel→app commands (dispatch/restore) are suspended too (the WS
server shares the app's event loop); they flush on resume. **Time-travel/replay still works
while paused** — it is pure client-side replay and never touches the process. Note also that
XState runs actions during a transition, so a snapshot shown while paused inside an action
may be mid-transition relative to the breakpoint (expected, not a desync).

---

## Phase 0 — De-risk: runtime ↔ static mapping spike

- [ ] Confirm `SerializedMachine.id` + state-node paths from the runtime align with the
      static `MachineNode` tree from `parser.ts` (so live active-state can highlight the
      ELK diagram). Document the matching key and mismatch cases.
- [ ] Verify a VS Code extension host can open a WS client to `ws://localhost:9301` and
      receive `XSTATE_ACTOR_REGISTERED` / `XSTATE_EVENT` from the `example-remix` server
      machine.
- [ ] Decide: highlight on the existing ELK diagram, the text tree (ported), or both.

## Phase 1 — Extract shared core

- [ ] Create `packages/protocol` with the wire types; update chrome-extension imports.
- [ ] Create `packages/panel-core` with store, `active-nodes.ts`, `session-io.ts`,
      `JsonView`, and transport-agnostic components.
- [ ] Refactor chrome-extension to consume both packages; confirm no behavior change
      (existing vitest suites green).

## Phase 2 — WS client + live state on the diagram

- [ ] Add a WS client in the extension host (`extension.ts`) connecting to the server
      adapter; config for URL/port + enable toggle (mirror `ServerStatusBar`).
- [ ] Message-passing bridge: extension host ↔ webview.
- [ ] New "XState Debugger" webview (or a live mode on the existing graph view) that
      consumes `panel-core` store.
- [ ] Live actor list, current state, context inspector, event log.
- [ ] Overlay active-node highlighting onto the existing ELK Harel diagram.
- [ ] Source jump using the real parser/`implementationFinder` instead of stack-trace links.

## Phase 3 — Interaction: dispatch, time-travel, restore

- [ ] Time-travel / replay (client-side, from `panel-core` — no new protocol).
- [ ] Event dispatch (`XSTATE_DISPATCH`): transition buttons + custom event/payload.
- [ ] Persisted-snapshot capture (`XSTATE_REQUEST_PERSISTED`).
- [ ] Live restore (`XSTATE_RESTORE`) with the `useRestorableInspectedMachine` caveat
      surfaced in the UI.
- [ ] Session export/import / replay mode.

## Phase 4 — Polish & docs

- [ ] Settings, status bar, reconnect handling (mirror chrome auto-reconnect).
- [ ] Update `packages/vscode-extension/README.md` (per repo convention) and root README.
- [ ] Package VSIX with `vsce package --no-dependencies`.

## Open questions / decisions

- ~~Separate "Debugger" view vs a "live mode" toggle on the existing graph view?~~
  **Decided:** live-mode toggle on the existing graph view (reuses ELK layout, keeps
  authoring + debugging in one canvas). Only new webview is the Inspector sidebar view.
- Should `panel-core` components be framework-shared as-is, or does the VS Code webview
  theming (VS Code CSS variables) warrant a thin presentational fork?
- Multi-actor: Chrome is single-select today — keep parity or improve?
