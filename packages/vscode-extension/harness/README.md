# Graph webview harness

Renders the real statechart webview (`src/webview/graph.ts`) outside VS Code so
the ELK layout and edge routing can be screenshotted and iterated on quickly.

It reuses the **real** parser (`src/parser.ts`, with `vscode` aliased to a thin
shim) and a faithful copy of `GraphView.buildElements` to turn a fixture file
into the `__GRAPH__` payload the webview consumes, then bundles `graph.ts` and
screenshots it with headless Chrome.

```bash
node harness/run.js <fixture.ts> [machineIndex] [DOWN|RIGHT] [outName]

# examples
node harness/run.js testing/checkout.machine.ts 0 DOWN checkout
node harness/run.js testing/complexMachine.ts 0 RIGHT complex

# verify collapse: click the interior of a region by its sanitized name
CLICK_REGION=payment node harness/run.js testing/checkout.machine.ts 0 DOWN collapse-test
```

Output (PNG + standalone HTML) lands in `harness/out/` (gitignored). Requires
Google Chrome at the standard macOS path.
