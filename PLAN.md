# PLAN: Time-travel, session save/load, and live rewind

## Goal

Let a developer using the live debugger (Chrome extension panel + adapter) **select a
past event in the log and inspect machine state as of that point**, **save / export /
import a debug session**, and eventually **rewind a running machine to a past state**.

Three phases, ordered by dependency and risk. Phases 1 and 2a ride on data that already
flows today. Phase 2b adds a new adapter capability (persisted snapshots) that Phase 3
depends on.

---

## Architecture context (read before starting)

The live debugger spans two packages (the `vscode-extension` package is a separate
static-analysis tool — **not** involved here):

- **`packages/adapter`** — runs inside the user's app. Uses XState v5's native
  `inspect` callback (not `@xstate/inspect`). Key file `src/core.ts`:
  - `createInspector(transport, source)` returns `{ inspect, dispose }`.
  - `inspect` branches on `@xstate.actor` / `@xstate.snapshot` / `@xstate.event` and
    calls `transport.send(...)` with a `PageToExtensionMessage`.
  - It keeps a live `actorRefs: Map<sessionId, AnyActorRef>` and subscribes to inbound
    `ExtensionToPageMessage` — today it handles `XSTATE_DISPATCH` by calling
    `ref.send(event)` (core.ts:78-89). **This is the template for the new restore path.**
  - `serializeSnapshot` (core.ts:31) produces a **lossy display snapshot**:
    `{ value, context (sanitized), status, error }`. This is NOT XState's persisted
    snapshot and CANNOT be used to restore an actor.
  - Two transports, both two-way: browser (`src/index.ts`, via `window.postMessage`) and
    Node WebSocket server (`src/server.ts`, default `ws://localhost:9301`).

- **`packages/chrome-extension`** — the DevTools panel.
  - `src/shared/types.ts` — the message protocol (`PageToExtensionMessage`,
    `ExtensionToPageMessage`) and serialized shapes (`SerializedSnapshot`, `EventRecord`,
    `ActorRecord`). **All new message types and fields go here first.**
  - `src/panel/store.ts` — Zustand store. Holds `events: EventRecord[]` (capped at
    `MAX_EVENTS = 500`), `registeredSnapshots`, and `timeTravelSeq`. Already has a
    `timeTravel(seq)` action and a pure `getDisplaySnapshot(state, sessionId)` reconstructor.
  - `src/panel/App.tsx` — connects both transports, rebases `globalSeq` onto one panel
    timeline in `ingest()`, and exposes a `dispatch(message)` callback (provided via
    `DispatchContext`) that broadcasts an `ExtensionToPageMessage` over both transports.
  - `src/panel/components/EventLog.tsx` — the event log list. **Row click already calls
    `timeTravel(evt.globalSeq)` + `selectActor(evt.sessionId)`** (EventLog.tsx:99-102).
  - `src/panel/components/SidePanel.tsx` — context/snapshot inspector + existing
    "Send event" UI (consumes `DispatchContext`).

### Two facts that shape everything

1. **Read-only time-travel already works.** Clicking a log row time-travels; `getDisplaySnapshot`
   reconstructs the snapshot as of `timeTravelSeq`. Phase 1 is polish, not construction.
2. **Stored snapshots are lossy.** Restoring real machine state needs
   `actorRef.getPersistedSnapshot()`, which the adapter never captures today. That capture
   is Phase 2b and gates Phase 3.

---

## Conventions for agents

- TypeScript throughout. Match surrounding style (the codebase uses inline `style={{}}`
  objects, no CSS framework, 2-space indent, `.js` import specifiers even for `.ts(x)`
  files — keep that).
- After each phase (a logical batch), **create a git commit** (per repo CLAUDE.md). Use
  conventional-commit prefixes consistent with history (`feat(panel):`, `feat(adapter):`,
  `fix(...)`).
- **Update `packages/chrome-extension/README.md`** in the same commit as any
  feature/behavior change (per project memory).
- Build/verify the extension with the package's existing build script; package the VSIX
  (if touched) with `vsce package --no-dependencies` (monorepo hoists deps to root).
- Do not break the existing `XSTATE_DISPATCH` "Send event" feature — it's the reference
  implementation you're extending.
- When adding a message type, update **both** union types in `types.ts` AND every
  `switch (msg.type)` / handler that the compiler flags. Let `tsc` find the call sites.

---

## Phase 1 — Read-only time-travel polish  ·  *small, low risk*

**Outcome:** time-travel is obvious and reversible; all inspector panels follow the
selected event; user always knows whether they're viewing live or history.

- [x] **Audit data flow.** `MachineTree` (tree highlight, via `getActiveNodeIds`) and
      `SidePanel` (context/status) both read through `getDisplaySnapshot(state, sessionId)`.
      No panel ignores `timeTravelSeq`. No change needed.
- [x] **"Viewing history" banner.** Already existed in `Layout.tsx`; enhanced to show the
      selected event's type + timestamp and a keyboard hint, alongside "Back to live".
- [x] **Keyboard stepping.** `useEffect` keydown listener in `Layout`. `←`/`→` step
      prev/next along the global event timeline (selecting that event's actor too);
      stepping past the newest returns to live; `Esc` returns to live. Ignored while
      focus is in input/textarea/contenteditable.
- [x] **Live-tail behavior while travelling.** Verified: nothing force-resets
      `timeTravelSeq`; EventLog auto-scroll already guards on `timeTravelSeq === null`;
      store.ts clamp on eviction kept.
- [x] **Visual "future" dimming.** EventLog rows with `globalSeq > timeTravelSeq` render at
      0.4 opacity.
- [x] Update README "Time travel" section. Commit: `feat(panel): time-travel banner, keyboard stepping`.

**Acceptance:** click an old event → diagram + context + snapshot all show that point;
banner appears; `←/→` step; "Return to live" + `Esc` restore live tailing; incoming
events don't break out of history view.

---

## Phase 2a — Save / export / import a recorded session  ·  *medium, low risk*

**Outcome:** export the whole captured session to a JSON file and re-load it into the
panel in a read-only "replay" mode. This is the **bug-repro / sharing** feature. Uses only
data already in the store — no adapter changes.

Define a versioned file format (new types in `types.ts`):

```ts
export interface SessionExportV1 {
  formatVersion: 1
  exportedAt: number            // Date.now()
  source: 'live-capture'
  actors: ActorRecord[]         // Array.from(store.actors.values())
  registeredSnapshots: Array<[string, SerializedSnapshot]>  // Map entries
  events: EventRecord[]
}
```

- [x] Add `SessionExportV1` + a `SESSION_FORMAT_VERSION = 1` const to `types.ts`.
- [x] **Serializer/deserializer** in `src/panel/session-io.ts`: `exportSession(state, now)`
      and `importSession(json)` (validates `formatVersion` + array shapes, throws clear errors).
- [x] **Store actions** in `store.ts`: `loadSession(data, name)` (enters replay, lands at
      final state with `timeTravelSeq = null`), `exitReplay()` (resets to empty live state),
      and `replayMode` / `replayName` fields.
- [x] **Replay isolation.** `handleMessage` early-returns when `replayMode`. Replay state is
      surfaced in the new `SessionControls` bar ("● Replay <file> · N events · Exit replay").
- [x] **UI controls.** `SessionControls` in `App.tsx`: Export → Blob download
      `xstate-session-<ts>.json`; Import → hidden file input → `importSession` → `loadSession`,
      with inline error display.
- [x] **Disable dispatch in replay.** `SidePanel` Send buttons disabled + a "Disabled during
      replay" note; the dispatch callback bails when `replayMode`.
- [x] Tests: `session-io.test.ts` (round-trip + validation) and replay-mode store tests.
      Update README. Commit: `feat(panel): export/import debug sessions`.

**Acceptance:** run an app, capture events, Export → JSON file downloads; reload the panel
(or a fresh one), Import the file → events/diagram/time-travel all work read-only; live
messages are ignored until "Exit replay"; round-trip is lossless for everything the store
holds.

**Note for agents:** this exports **display** snapshots only. It is explicitly NOT a
restorable machine state — that's 2b. Say so in the README so users aren't surprised.

---

## Phase 2b — Capture restorable persisted snapshots  ·  *medium, the key unknown*

**Outcome:** the adapter additionally captures XState's persisted snapshot so a machine's
state can later be reconstructed. This is the prerequisite for Phase 3 and for "export a
state you can re-seed", and is the riskiest unknown — **prototype this first if validating
feasibility before committing to the roadmap.**

- [x] **Capture in the adapter.** `core.ts` `safePersistedSnapshot(actorRef)` calls
      `getPersistedSnapshot()` (guarded for actors that lack it) and JSON round-trips the
      result so it stays serializable + restorable; returns `{ persisted }` or `{ error }`.
- [x] **On-demand request.** Added `XSTATE_REQUEST_PERSISTED` (panel→adapter) and
      `XSTATE_PERSISTED_SNAPSHOT` (adapter→panel, carries `persisted?`/`error?`). `core.ts`
      `transport.subscribe` handles the request via the same `stripIfMine` prefix routing as
      `XSTATE_DISPATCH`. (Capture is on-demand, not per-event — avoids large payloads.)
- [x] **Panel side.** Store field `persistedSnapshots: Map<sessionId, PersistedEntry>`;
      response handled in `handleMessage`. The request is sent straight through the existing
      `DispatchContext` from `SidePanel` (no separate App helper needed).
- [x] **Serialization safety.** JSON round-trip in the adapter guarantees transport-safe,
      restorable snapshots; a throw is reported as an error rather than silently dropping.
- [x] **Export format V2** (additive): `SessionExportV2.persistedSnapshots`. `importSession`
      accepts v1 (normalized to v2 with empty array) and v2. `SESSION_FORMAT_VERSION = 2`.
- [x] **UI.** `SidePanel` "Persisted snapshot" section with Capture/Re-capture, JSON view,
      and error display; disabled in replay.
- [x] Tests: adapter `core.test.ts` (request/response, missing-API, cross-source routing),
      session-io v1/v2 + persisted-export tests, store persisted-message tests.
      Commit: `feat(adapter): capture persisted snapshots on demand`.

**Resolved open question:** actors without `getPersistedSnapshot` (or whose snapshot isn't
JSON-serializable) surface a clear error string in the Persisted snapshot section; the
Capture button stays available for retry.

---

## Phase 3 — Live rewind  ·  *larger, highest risk — design honestly*

**Outcome:** from a selected event/snapshot, reset the running machine to that state.

**Hard truth to encode in the UX (not hide):** XState v5 cannot rewind a live actor in
place. The only mechanism is to recreate the actor from a persisted snapshot
(`createActor(logic, { snapshot }).start()`). And already-fired side effects — spawned
children, network calls, messages sent to parents — do NOT un-happen. So this is
**"restart this actor from state X"**, not true time reversal. Label the button and any
confirmation accordingly.

Additional complication: the adapter holds an `actorRef` but does NOT own the actor's
lifecycle — the app created it via `useInspectedMachine`/`useInspectedActorRef`
(`adapter/src/react.tsx`). Recreating an actor inside the adapter leaves the app's React
hook pointing at the dead original. **Resolve the ownership story before writing code.**

- [x] **Spike: ownership & feasibility.** RESOLVED → option (b). The adapter only ever
      receives an `actorRef` via the inspect callback; it never owns the actor's lifecycle
      (the app's `useMachine`/`createActor` does). An adapter-side recreate would orphan the
      app's reference (zombie actor), so restore MUST be driven by the owner. `@xstate/react`'s
      `useMachine` creates the actor once and ignores later `snapshot` option changes, so the
      restorable hook must own a `createActor` instance it can recreate on demand. Chosen
      design: additive `useRestorableInspectedMachine` that owns its actor, registers a
      restore handler with the adapter keyed by `sessionId`, and recreates from the persisted
      snapshot when `XSTATE_RESTORE` arrives. Plain `useInspectedMachine` is unchanged; actors
      not using the restorable hook simply have no restore handler (documented).
- [x] **Protocol.** Added `XSTATE_RESTORE { sessionId, persisted }`. Handled in `core.ts`
      `transport.subscribe` via the same `stripIfMine` routing as `XSTATE_DISPATCH`.
- [x] **Adapter restore path (owner-driven).** `createInspector` now keeps a
      `restoreHandlers` registry + `registerRestore(sessionId, handler)`. On `XSTATE_RESTORE`
      it invokes the owner's handler. `useRestorableInspectedMachine` (additive) owns its
      `createActor` instance and recreates it from the persisted snapshot on restore.
- [x] **Panel UI.** "⏮ Restore to this state" button in the SidePanel Persisted snapshot
      section, shown only when a persisted snapshot is available, with a `window.confirm`
      dialog spelling out the side-effect caveats.
- [x] **Guardrails.** Restore disabled in replay mode and only enabled when a persisted
      snapshot exists; actors without the restorable hook are a documented no-op.
- [x] Tests: adapter restore-registry routing (register/cross-source/unregister). Update
      README "Live rewind (experimental)". Commit: `feat: experimental live rewind`.
- [x] **Example wiring + end-to-end smoke test.** `InspectorProvider` gained an optional
      `adapter` prop (reuse an existing singleton; only self-created adapters are disposed).
      `example-remix` now wraps the app in `<InspectorProvider adapter={adapter}>` and the
      Player Machine card uses `useRestorableInspectedMachine`. Verified end to end with a
      headless Chrome (Playwright) driving the real `window` transport: drive player →
      capture persisted snapshot → STOP→idle → restore → machine rewound to the captured
      `active.playing.normal` state with `position` preserved and the actor recreated
      (2 registrations). README "Live rewind" updated with the provider wiring.

**Acceptance:** ✅ Met — restoring re-seeds the actor to the chosen state, the panel reflects
the new live actor, caveats are shown, and unsupported actors surface an error (button stays
available for retry).

---

## Dependency summary

```
Phase 1 (polish)            ── independent, ship anytime
Phase 2a (session export)   ── independent, uses existing data
Phase 2b (persisted capture)── new adapter capability
        └─> Phase 3 (live rewind) ── requires 2b
```

Recommended order: **1 → 2a → 2b → 3**, committing and updating the README at each step.

## Cross-cutting checklist

- [ ] Every new message type added to BOTH union types in `types.ts` and all handlers.
- [ ] `MAX_EVENTS = 500` cap interaction with export documented (export captures only the
      retained window; note this in the README so users know older events were evicted).
- [ ] README updated in the same commit as each behavior change.
- [ ] No regression to the existing `XSTATE_DISPATCH` "Send event" feature.
- [ ] Extension builds clean; if VSIX is touched, package with `vsce package --no-dependencies`.

## Delete this file when the work is fully complete (per repo CLAUDE.md).
