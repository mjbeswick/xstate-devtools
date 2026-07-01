# XState Debugger

A live debugger for [XState](https://stately.ai/docs) that attaches to a running app's **server adapter** (`createServerAdapter`) over a WebSocket and lets you inspect actors as they run — without leaving VS Code.

It is the runtime companion to the **xState Devtools** extension (static outline + diagram). They are independent: install either or both. The debugger bundles its own copy of the statechart diagram, so **Reveal in Diagram** / **Follow Actor** work on their own.

## Features

- **Instances** — a tree of running actors (parent → child) with each instance's current state; expand an instance to see its live state-node tree with the active configuration highlighted.
- **Context** — the selected actor's real context as an expandable tree (right-click a value to **Copy**).
- **Events** — every event each actor receives. Click an event to inspect it and pause the log on that row; with the log focused, **← / →** step to the previous / next event and **Esc** returns to live. Also **Step Back / Forward**, **Back to Live**, **Clear**, and **Export / Import session**. Stepping freezes the Instances + Context trees at that point.
- **Event** — a tree in the Debugger sidebar showing the latest (or selected) event's payload as an expandable JSON tree; it follows the Events log selection / time-travel.
- **Reveal in Diagram / Follow Actor** — open the statechart for a running actor and watch its live state light up (including while time-travelling). Right-click a compound state for **Create Diagram From Here**.
- **Send Event…**, **Capture / Restore Snapshot** from the Instances right-click menu.

## Requirements

- VS Code 1.78 or newer.
- An app running XState **v5** actors instrumented with `@xstate-devtools/adapter` (see Setup). The adapter exposes the WebSocket the debugger connects to.

## Setup

1. In your app, wire `createServerAdapter()` from `@xstate-devtools/adapter` and pass its `inspect` to your root actor: `createActor(machine, { inspect })`.
2. Start your app, then **Connect** from the Instances view's title icon.

The Instances view's welcome text detects how ready your workspace is and links to the relevant setup step.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `xstateDebugger.url` | `ws://127.0.0.1:9301` | WebSocket URL of the running app's server adapter. |
| `xstateDebugger.showStopped` | `true` | Show stopped actors in the Instances view. |
| `xstateDebugger.followDiagram` | `false` | Auto-open/reveal the diagram for the selected actor, with its live state highlighted. |
