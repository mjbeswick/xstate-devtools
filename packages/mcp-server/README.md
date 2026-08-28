# @xstate-devtools/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **XState** analysis over any workspace, no VS Code required. It statically parses your JS/TS source (XState v4 and v5) and answers structured queries, so an AI agent can reason about your state machines instead of grepping source text.

It reuses the same analysis engine as the [XState Devtools](../vscode-devtool/README.md) VS Code extension (`@xstate-devtools/diagram-core`).

## Tools

| Tool | Description |
| --- | --- |
| `list_machines` | Every machine in the workspace: id, file, line, state count. |
| `describe_machine` | One machine as JSON: states (hierarchy, initial/final/parallel, entry/exit actions, invokes) plus transitions. |
| `machine_diagram` | Mermaid `stateDiagram-v2` for a machine. |
| `test_paths` | Shortest event sequence to reach each state, unreachable states flagged, plus test skeletons. |
| `validate` | XState diagnostics (invalid properties, unknown transition targets, unreachable states, etc). |
| `find_references` | Every place a name is *used* as an action, guard, invoked actor, or event, with machine, state, file, and line. |
| `setup_coverage` | Which actions/guards/actors a machine references, and which are missing from `setup()` (plus which declared ones are unused). |
| `list_events` | A machine's `send()` API: every event, the states that handle it, and any guard or target. |
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

Or run the built binary directly:

```bash
XSTATE_MCP_ROOT=/path/to/project node dist/index.js
```

## Benchmark: MCP vs. manual file reading

To measure the effect of structured access, we gave an agent the same task against the same large, complex XState machine twice: once with only file-read/grep tools, once with the `xstate` MCP server enabled.

**Task.** Enumerate every top-level sibling of three named states in a 9,101-line machine, listing each one's child states, `on` events, and whether it has a matching entry action, verifying actual nesting depth rather than guessing from indentation.

**Results.**

| Metric | Without MCP | With MCP | Change |
| --- | --- | --- | --- |
| Tool calls | 40 | 6 | −85% |
| Wall time | 5m 22s | 1m 59s | −63% |
| Tool time | 3m 17s | 3.8s | −98% |
| Output tokens | 12,673 | 4,608 | −64% |
| Total tokens (input + cache + output) | 1,676,796 | 163,993 | −90% |

Without the server, the agent had no structural view of the machine. It read the file in chunks and delegated to a subagent that grepped raw text across saved tool-output files to reconstruct the hierarchy by eye — 40 tool calls and 1.7M tokens, over five minutes. With the server, a single `describe_machine` call returned the parsed state/transition graph directly: 6 tool calls, 164K tokens, under two minutes, with the state hierarchy read straight from the parsed AST rather than inferred from source indentation.

**Takeaways:**

- **Fewer round-trips** — one structured query replaced dozens of read/grep calls and a delegated subagent.
- **Lower cost** — 90% fewer total tokens, since the agent no longer had to re-read large spans of source into context.
- **Faster** — under two minutes end to end, versus over five without.
- **Correct by construction** — state and transition data comes from the parsed AST, not text pattern-matching, so nesting depth and sibling counts can't be misread the way raw indentation was.
