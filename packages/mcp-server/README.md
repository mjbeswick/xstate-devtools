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

## Develop

```bash
npm run build   # bundle to dist/index.js (vscode aliased to a headless shim)
npm run check   # type-check
npm test        # unit tests
```
