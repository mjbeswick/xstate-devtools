# @xstate-devtools/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **XState** analysis over any workspace — no VS Code required. It statically parses your JS/TS source (XState v4 & v5) and answers structured queries, so an AI agent can reason about your state machines.

It reuses the same analysis engine as the [XState Devtools](../vscode-devtool/README.md) VS Code extension (`@xstate-devtools/diagram-core`).

## Tools

| Tool | Description |
| --- | --- |
| `list_machines` | Every machine in the workspace: id, file, line, state count. |
| `describe_machine` | One machine as JSON — states (hierarchy, initial/final/parallel, entry/exit actions, invokes) + transitions. |
| `machine_diagram` | Mermaid `stateDiagram-v2` for a machine. |
| `test_paths` | Shortest event sequence to reach each state, unreachable states flagged, plus test skeletons. |
| `validate` | XState diagnostics (invalid properties, unknown transition targets, unreachable states, …). |
| `find_references` | Everywhere a name is *used* as an action, guard, invoked actor, or event, with machine, state, file and line. |
| `setup_coverage` | Which actions/guards/actors a machine references and which are missing from `setup()` (and which declared ones are unused). |
| `list_events` | A machine's `send()` API — every event, the states that handle it, and any guard/target. |
| `state_detail` | One state's entry/exit actions, invokes, and outgoing transitions. |

## Usage

The server scans the directory given by `XSTATE_MCP_ROOT` (defaults to the process working directory).

### Claude Code / Desktop (MCP client config)

```json
{
  "mcpServers": {
    "xstate": {
      "command": "npx",
      "args": ["-y", "@xstate-devtools/mcp"],
      "env": { "XSTATE_MCP_ROOT": "/absolute/path/to/your/project" }
    }
  }
}
```

Or run the built binary directly: `XSTATE_MCP_ROOT=/path/to/project node dist/index.js`.

## Results

A real-world comparison of an AI agent answering the same question about a large, complex XState machine, with and without this MCP server enabled.

**Test:** ask an agent to enumerate every top-level sibling of three named states in a 9,101-line complex XState machine, listing each one's child states, `on` events, and whether it has a matching entry action — instructed to verify actual nesting depth, not guess from indentation. Run twice against the same file: once with only file-read/grep tools, once with the `xstate` MCP server enabled.

**Savings:**

| | Without MCP | With MCP | Change |
| --- | --- | --- | --- |
| Tool calls | 40 | 6 | −85% |
| Wall time | 5m22s | 1m59s | −63% |
| Tool time | 3m17s | 3.8s | −98% |
| Output tokens | 12,673 | 4,608 | −64% |
| Total tokens (input + cache + output) | 1,676,796 | 163,993 | −90% |
| States found | 29 | 25 | — |

Without the server, the agent had no structural view of the machine, so it read the file in chunks and delegated to a subagent that grepped raw text across saved tool-output files to reconstruct the hierarchy by eye. That approach burned 40 tool calls and 1.7M tokens, took over five minutes, and still over-counted states by misreading indentation. With the server, a single `describe_machine` call returned the parsed state/transition graph directly — 6 tool calls, 164K tokens, under two minutes, and a structurally correct answer instead of an inferred one.

**What using the server improved:**

- **Fewer round-trips** — one structured query replaced dozens of read/grep calls and a delegated subagent.
- **Lower cost** — 90% fewer total tokens, since the agent no longer had to re-read large spans of source into context.
- **Faster** — under two minutes end to end, versus over five without.
- **Correct by construction** — state/transition data comes from the parsed AST, not text pattern-matching, so nesting depth and sibling counts can't be misread the way raw indentation was.

## Develop

```bash
npm run build   # bundle to dist/index.js (vscode aliased to a headless shim)
npm run check   # type-check
npm test        # unit tests
```
