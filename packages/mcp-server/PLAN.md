# Plan: scoped `describe_machine`

## Goal

The comparison test showed `describe_machine` returning the *entire* machine
JSON even when the agent only wanted one state's immediate children — the
response was too large to use directly, forcing an extra
grep-the-saved-output round trip. Add optional scoping so an agent can ask
for just a subtree.

## Approach

Add `parent` (state label or id) and `depth` (levels below `parent`,
default unlimited) params to `describeMachine`. Filter `states` to that
subtree and `transitions` to edges whose source is in the filtered set.
Reuse the label-or-id matching already used by `stateDetail`.

## Steps

- [ ] `diagram-core/src/analysis.ts`: extend `describeMachine(machine, resolveInvoke, opts?)` with `opts: { parent?: string; depth?: number }`
  - [ ] resolve `parent` to a node id via label-or-id match (same as `stateDetail`)
  - [ ] walk `payload.nodes` parent chains to keep only descendants of that id, and only `depth` levels deep
  - [ ] filter `transitions` to `source` in the kept id set
  - [ ] no `parent` given → unchanged behavior (whole machine), so this is additive
- [ ] `diagram-core` unit test: scoped call on a small fixture machine returns only the expected subtree
- [ ] `mcp-server/src/index.ts`: add optional `parent`/`depth` zod fields to `describe_machine`'s `inputSchema`, pass through, mention in the tool description
- [ ] `mcp-server/README.md`: document the new params in the Tools table
- [ ] `npm run check` + `npm test` in both packages

## Open questions

- none — scoping is purely additive, no breaking change to the existing shape
