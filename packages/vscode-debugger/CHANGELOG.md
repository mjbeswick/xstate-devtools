# Changelog

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
