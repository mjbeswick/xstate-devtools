# Trail Panel — Spec

> Status: **implemented** (`src/trailView.ts`, wired in `extension.ts`; Incoming
> in `src/incomingView.ts`). Grounded in the current code:
> forward target jump at `extension.ts:403` (`navigateToNode` double-click-target
> branch), `treeProvider.resolveTargetLocation` (`treeProvider.ts:176`), and the
> graph's `stateClicked` / `revealInTree` path (`graphView.ts`).

## Goal

When exploring a large machine by jumping along transitions, you lose your path.
The **Trail** is a dynamically-built, ordered list of the states you've walked
through, letting you revisit any step without losing the rest of the path. It is
**never prepopulated** — it starts empty and grows only from navigation.

## Core model

- A **Trail** is an ordered list of states representing a *walk* through one
  machine, plus a **current** pointer.
- It is **two-ended**: following a *target* (forward) appends to the tail;
  following a *previous / incoming* source (backward) prepends to the head.
- The current pointer marks "where you are" in the walk; clicking a trail item
  moves the pointer and navigates, **without mutating** the list.

```
TrailEntry = { label, uri, range, machineKey }   // a resolved state
Trail      = { entries: TrailEntry[], current: number, machineKey }
```

## What fills it — navigation → mutation

The trail reacts only to **explicit jumps**, not to plain selection or cursor-sync.

| User action | Mutation |
| --- | --- |
| **Forward target jump** from state A (double-click a target, or graph target nav) | If empty → seed `[A, B]`, current→B. Else if current is the tail → push B. Else (jumped from mid-trail) → **truncate after current**, push B. current→B |
| **Backward "previous" jump** to state A (from an Incoming-panel item) | If empty → seed `[A, B]`. Else if current is the head → unshift A. Else → truncate before current, unshift A. current→A |
| **Click a trail item** | current → that item; navigate; **no mutation** |
| **Plain selection** (tree click, cursor-sync) | No mutation. If the selected state *is* in the trail, move the current highlight to it; otherwise leave the trail untouched |
| **Clear** (toolbar button) | Empty the trail |
| **Navigation lands in a different machine** | Clear + reseed in the new machine (a trail is single-machine) |

Divergence (forward-from-middle ⇒ truncate-after) is browser-history semantics:
"I went a different way from here." Clicking never truncates; only a *new* jump
does.

## Display

- A new **TreeView** under the activity-bar container
  (`TrailTreeProvider implements vscode.TreeDataProvider`), consistent with the
  Outline.
- Each row: **state label**, with the **via-event** as the dimmed `description`
  (e.g. `loading` · `via FETCH`). The **current** entry gets a distinct
  icon / marker.
- Order reads head→tail as the path. Clicking a row = navigate (reveal in
  Outline + open source + highlight in graph) and set current.
- Title-bar buttons: **Clear**, and optionally **Remove from here** (trim tail
  past current).
- Empty state: a `viewsWelcome` line — "Navigate a transition target to start a
  trail."

## Integration hooks (where to record)

- **Forward (target):** `extension.ts:403` — the `navigateToNode`
  double-click-target branch already resolves the destination via
  `resolveTargetLocation`. The *source* state is the state owning the clicked
  target node. Record both. Also the graph's target-navigation path.
- **Backward (previous):** the future **Incoming** panel's "navigate to source"
  action records an unshift. **This is the dependency** — the backward end of the
  trail can't fill until Incoming exists; forward-only works today.
- A single `TrailService` exposes `recordForward(from, to)`,
  `recordBackward(to, from)`, `goTo(index)`, `clear()`, and fires an event the
  provider listens to.

## Resilience & scope

- **Identity after edits:** store `uri+label+range`; on document change,
  re-resolve entries (reuse the graph's `matchMachine` approach — match by label
  + nearest start line) and drop states that no longer exist.
- **Single machine:** entries carry `machineKey`; a jump into another machine
  resets.
- **Lifetime:** in-memory for the session (cleared on reload). Optional
  `workspaceState` persistence later.
- **Cap & cycles:** a walk may revisit a state (legit cycle), so allow duplicates
  but cap length (~50, drop from the far end).

## Decisions (current defaults)

1. **Divergence:** truncate-after-current (browser semantics). *[chosen]*
2. **Cross-machine:** reset + reseed in the new machine. *[chosen]*
3. **Naming:** **"Trail"** — not "Trace" (which implies a runtime event log; this
   extension is static). *[chosen]*
4. **Panel real estate:** TBD — standalone view vs. sharing a collapsible panel
   with **Incoming**. Four activity-bar views (Search, Outline, Incoming, Trail)
   is getting busy; revisit when Incoming lands.

## Phasing

1. **Incoming transitions** — reverse index + panel + context action. Prerequisite
   for backward fill, useful on its own.
2. **TrailService + Trail view**, wired to the forward target hook (works
   standalone, forward-only).
3. Wire the **backward** record to Incoming's "navigate to source" action.

## Notes

- This supersedes the earlier hidden back/forward-buttons idea — a visible trail
  is more discoverable and is exactly the "click any item without destroying the
  list" behaviour intended.
- Reuses existing building blocks: `resolveTargetLocation`,
  `findItemAtPosition`, the graph's `matchMachine` re-resolution, the
  `TreeDataProvider` + `view/title` + `viewsWelcome` patterns already in the
  extension.
