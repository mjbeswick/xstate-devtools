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

- [ ] **Audit data flow.** Confirm the diagram view and `SidePanel` context/snapshot view
      both read through `getDisplaySnapshot(state, sessionId)` (store.ts:30), not
      `actor.snapshot` directly. Fix any panel that ignores `timeTravelSeq`. List the
      components touched in the commit body.
- [ ] **"Viewing history" banner.** When `timeTravelSeq !== null`, show a persistent banner
      (top of `Layout` or above `EventLog`) reading e.g. `⏱ Viewing event seq:N (HH:MM:SS) —`
      with a **"Return to live"** button that calls `timeTravel(null)`. Style it like the
      existing `ServerStatusBar` in App.tsx (subtle background, 11px, flex row).
- [ ] **Keyboard stepping.** With time-travel active, `←` / `→` move to the previous/next
      event's `globalSeq` (clamp to the available `events` range; respect the current
      actor filter if one is selected). `Esc` returns to live. Add via a `useEffect`
      key listener in the panel root; ignore when focus is in an `<input>`/`<textarea>`.
- [ ] **Live-tail behavior while travelling.** New events must NOT yank the user back to
      live. EventLog already guards auto-scroll on `timeTravelSeq === null` (EventLog.tsx:28)
      — verify nothing else force-resets `timeTravelSeq`. The existing clamp in store.ts:98
      (when the oldest event is evicted) is correct; keep it.
- [ ] **Visual "future" dimming (optional).** In `EventLog`, render rows with
      `globalSeq > timeTravelSeq` at reduced opacity so the timeline split is visible.
- [ ] Update README "Time travel" section. Commit: `feat(panel): time-travel banner, keyboard stepping`.

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

- [ ] Add `SessionExportV1` + a `SESSION_FORMAT_VERSION = 1` const to `types.ts`.
- [ ] **Serializer/deserializer** in a new `src/panel/session-io.ts`:
      `exportSession(state): SessionExportV1` and
      `importSession(json: unknown): SessionExportV1` (validate `formatVersion`, shape;
      throw a clear error on mismatch).
- [ ] **Store actions** in `store.ts`:
      - `loadSession(data: SessionExportV1)` — replace `actors`/`registeredSnapshots`/
        `events`, set a new flag `replayMode: boolean = true`, and set `timeTravelSeq` to
        the last event's seq so the user lands at the end of the recording.
      - `clearReplay()` — wipe loaded data, `replayMode = false`, return to live.
      - Add `replayMode: boolean` to `InspectorStore` (default `false`).
- [ ] **Replay isolation.** When `replayMode === true`, `handleMessage` must IGNORE
      incoming live messages (otherwise a live app pollutes the replay). Guard the top of
      `handleMessage`. The banner from Phase 1 should switch to a **"Replay: <file> —
      Exit replay"** variant in replay mode.
- [ ] **UI controls.** Add an "Export" + "Import" pair near the `ServerStatusBar` or in a
      small toolbar. Export → `Blob` + `URL.createObjectURL` download named
      `xstate-session-<timestamp>.json`. Import → hidden `<input type="file">` →
      `importSession` → `loadSession`. On import error, show the message inline.
- [ ] **Disable dispatch in replay.** The "Send event" UI in `SidePanel` must be disabled
      (or hidden) when `replayMode` — there is no live actor to receive it.
- [ ] Update README with "Save & replay sessions". Commit: `feat(panel): export/import debug sessions`.

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

- [ ] **Capture in the adapter.** In `core.ts`, add a helper
      `safePersistedSnapshot(actorRef): unknown` using
      `actorRef.getPersistedSnapshot?.()` wrapped in try/catch (some actor types may not
      support it — return `undefined`). XState v5 exposes `getPersistedSnapshot()` on
      actors; confirm the import/typing against the installed `xstate` version.
- [ ] **Decide capture cadence.** Per-event persisted snapshots could be large. Recommended:
      capture on `@xstate.actor` (registration) and ON DEMAND via a new request message,
      rather than on every event. Implement an on-demand request:
      - Add `ExtensionToPageMessage` variant `{ type: 'XSTATE_REQUEST_PERSISTED', sessionId }`.
      - Add `PageToExtensionMessage` variant
        `{ type: 'XSTATE_PERSISTED_SNAPSHOT', sessionId, persisted: unknown, globalSeq, timestamp }`.
      - In `core.ts` `transport.subscribe`, handle the request: look up the ref in
        `actorRefs` (use the same `stripIfMine` prefix logic as `XSTATE_DISPATCH`), call
        `safePersistedSnapshot`, and `transport.send` the response.
- [ ] **Panel side.** Add a store field `persistedSnapshots: Map<sessionId, unknown>` and a
      `dispatch`-backed `requestPersisted(sessionId)` helper in `App.tsx` (broadcast over
      both transports, same as `dispatch`). Handle the response in `handleMessage`.
- [ ] **Serialization safety.** Persisted snapshots can contain values the default JSON
      path mangles. Reuse/extend `packages/adapter/src/sanitize.ts` only if needed — but do
      NOT over-sanitize: a persisted snapshot must stay restorable, so prefer structured
      clone / `JSON` round-trip validation and flag (don't silently drop) non-serializable
      fields.
- [ ] **Extend the export format to V2** (additive): `SessionExportV2` adds
      `persistedSnapshots: Array<[string, unknown]>`. `importSession` must accept both V1
      and V2. Bump `SESSION_FORMAT_VERSION = 2`.
- [ ] Commit: `feat(adapter): capture persisted snapshots on demand`.

**Acceptance:** select an actor, request its persisted snapshot, see it arrive in the
store; export includes it; importing a V1 file still works.

**Open question to resolve during this phase:** which actor types lack
`getPersistedSnapshot` in this XState version, and how to surface "not restorable" in the UI.

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

- [ ] **Spike: ownership & feasibility.** Determine whether restore is viable as
      (a) adapter-side recreate (diverges from the app's hook — likely only useful for
      standalone/server actors), or (b) a hook-level opt-in where `useInspectedMachine`
      exposes a restore handle the adapter can call to swap the actor and re-render. Write
      findings into this file before implementing. Recommend (b) for React apps.
- [ ] **Protocol.** Add `ExtensionToPageMessage` variant
      `{ type: 'XSTATE_RESTORE', sessionId, persisted: unknown }`. Handle it in `core.ts`
      `transport.subscribe` alongside `XSTATE_DISPATCH`.
- [ ] **Adapter restore path.** Implement per the spike decision. At minimum: stop the
      existing actor, `createActor(ref.logic, { snapshot: persisted }).start()`, re-register
      it so the panel sees a fresh registration, and update `actorRefs`.
- [ ] **Panel UI.** A "Restore to this state" button in `SidePanel` (and/or event-log row
      context action), enabled only when a persisted snapshot is available for that actor
      (from Phase 2b). Show a confirmation dialog spelling out the side-effect caveat.
- [ ] **Guardrails.** Disable restore in replay mode; disable when no persisted snapshot
      exists; handle the "actor already stopped" case gracefully.
- [ ] Update README "Live rewind (experimental)" with the caveats. Commit:
      `feat: experimental live rewind from persisted snapshot`.

**Acceptance:** with a supported (likely standalone/server) actor, restoring re-seeds it to
the chosen state and the panel reflects the new live actor; caveats are shown; nothing
crashes for unsupported actor types (button disabled with explanation).

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
