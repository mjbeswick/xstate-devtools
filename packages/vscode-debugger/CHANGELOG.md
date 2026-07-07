# Changelog

## [1.4.0] - 2026-07-07

### Added
- **Find in the events log** — a VS Code-style find widget (⌘F / Ctrl+F with the panel focused, or the search icon in the panel title), floating over the log like the terminal search. Case / whole-word / regex toggles, a match count, and **↑/↓** (Enter / Shift+Enter) step the selection through matches. Space-separated terms are AND-ed, a `-` prefix excludes (`fetch -TICK`), and matching covers event type, actor name, and the full event payload.

### Fixed
- The events log now follows new events when live and stays pinned on the selected event while events stream in (the scroll-lock previously adjusted a container that never scrolled).
- **Collapse All** in the Instances view now sticks — the tree starts fully collapsed and no longer re-expands rows as events stream in. Event-click reveal still expands the path to the hit actor.
- Clicking a node in the Instances tree no longer moves focus to the opened editor/diagram; explicit **Go to Source** / **Reveal in Diagram** still do.

### Changed
- Event history cap raised from 500 to 5000 (single cap in the shared store; the view no longer re-trims to 200 rows).

## [1.3.0] - 2026-07-02

### Removed
- The session **import/export replay** feature (Import/Export Session, the replay banner and `● Replay` indicator). Live debugging, time-travel, and capture/restore snapshot are unaffected.

### Fixed
- Clicking an event in the log no longer scrolls the list — the clicked row stays where it is.

### Changed
- Dropped the `⏱ Time travel — seq N` message above the Instances tree (time travel is already shown by the selected/dimmed rows and the title-bar **Back to Live** action).

## [1.2.0] - 2026-07-02

### Added
- Collapse-all icon on the Instances view title.

### Fixed
- The Instances tree no longer flashes green/black as events stream in (the active-state decoration is no longer globally re-resolved on every event).

## [1.1.0] - 2026-07-01

- Version bump for a coordinated release with the XState Devtools extension; no functional changes since 1.0.0.

## [1.0.0] - 2026-07-01

First stable release.

### Added
- **Event tree** — the selected (or latest) event's payload as an expandable JSON tree in the Debugger sidebar, following the Events log selection / time-travel. Right-click a node to **Copy Value** / **Copy Key**, or use the **Copy** icon in the view title to copy the whole event as JSON.
- **Event log keyboard navigation** — with the log focused, **←/→** step to the previous/next event and **Esc** returns to live.
- **Select an event → reveal its actor** — selecting an event selects the actor it hit and expands/reveals it in the Instances tree, so the Context and Event trees (and diagram) follow.
- **Scroll-lock** — the selected event row stays pinned in the log while new events stream in.
- **Focus on attach** — the XState events panel comes to the front when the debugger connects.
- **Navigate on select** — selecting an instance opens its **diagram** or jumps to its **source**, toggled in the Instances **⋯** menu (`xstateDebugger.navigateTarget`).

### Changed
- **Instances title bar** — moved show/hide-stopped and follow-in-diagram into a **⋯** overflow menu (leaving connect/disconnect inline); menu toggles read as `Option: New State`.
- **No simulator in the debugger diagram** — the interactive simulator is hidden here (you inspect a real running actor instead).
- **Leaner Events panel** — removed the in-panel "EVENTS" heading and the time-travel banner; time travel is shown by the selected/dimmed rows, the Instances tree message, and the title-bar **Back to Live** action.
