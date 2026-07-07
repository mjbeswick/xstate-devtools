import type { GraphNode, GraphPayload } from '../buildGraph';

// Convert a diagram payload (the same nodes/edges the statechart renders from)
// into Mermaid `stateDiagram-v2` text. Reusing the payload keeps the export in
// lockstep with the visual diagram — same hierarchy, same merged edge labels.
//
// We key every state on its synthetic, collision-free id (`n0`, `n1`, …) and
// attach the human label via Mermaid's `state "Label" as id` / `id : Label`
// forms, because Mermaid state ids are global — two same-named states in
// different regions would otherwise clash.
export function toMermaid(payload: GraphPayload): string {
    // Drop the synthetic initial-dot nodes and out-of-diagram ghost stubs; their
    // edges are re-derived from the `initial` flag below.
    const real = payload.nodes.filter(n => !n.data.start && !n.data.ghost);
    const realIds = new Set(real.map(n => n.data.id));

    const childrenOf = new Map<string | undefined, GraphNode[]>();
    for (const n of real) {
        const p = n.data.parent;
        const list = childrenOf.get(p) ?? [];
        list.push(n);
        childrenOf.set(p, list);
    }
    const isComposite = (id: string) => (childrenOf.get(id)?.length ?? 0) > 0;

    // Mermaid labels: quotes break the `state "…" as` form; brackets/slashes are
    // fine in edge labels but `"` and newlines are not.
    const esc = (s: string) => s.replace(/"/g, "'").replace(/\n/g, ' ');

    const out: string[] = ['stateDiagram-v2'];
    const pad = (d: number) => '    '.repeat(d);

    const renderNode = (n: GraphNode, depth: number) => {
        const { id, label } = n.data;
        if (isComposite(id)) {
            out.push(`${pad(depth)}state "${esc(label)}" as ${id} {`);
            const kids = childrenOf.get(id) ?? [];
            const init = kids.find(k => k.data.initial);
            if (init) { out.push(`${pad(depth + 1)}[*] --> ${init.data.id}`); }
            // Parallel state: separate its regions with Mermaid's `--` divider.
            kids.forEach((k, i) => {
                if (n.data.parallel && i > 0) { out.push(`${pad(depth + 1)}--`); }
                renderNode(k, depth + 1);
            });
            out.push(`${pad(depth)}}`);
        } else {
            out.push(`${pad(depth)}${id} : ${esc(label)}`);
        }
        // A final state transitions to the terminal pseudo-state.
        if (n.data.final) { out.push(`${pad(depth)}${id} --> [*]`); }
        // Entry/exit/invoke/internal transitions and history have no first-class
        // Mermaid construct — surface them in a note so nothing is silently lost.
        const notes: string[] = [
            ...(n.data.entryActions ?? []).map(a => `entry / ${a}`),
            ...(n.data.exitActions ?? []).map(a => `exit / ${a}`),
            ...(n.data.invokes ?? []).map(a => `invoke ${a}`),
            ...(n.data.internalTransitions ?? []),
        ];
        if (n.data.history) { notes.push(`history (${n.data.history})`); }
        if (notes.length) {
            out.push(`${pad(depth)}note right of ${id}`);
            for (const line of notes) { out.push(`${pad(depth + 1)}${esc(line)}`); }
            out.push(`${pad(depth)}end note`);
        }
    };

    const roots = childrenOf.get(undefined) ?? [];
    const rootInit = roots.find(r => r.data.initial);
    if (rootInit) { out.push(`${pad(1)}[*] --> ${rootInit.data.id}`); }
    for (const r of roots) { renderNode(r, 1); }

    // Edges (skip any touching the dropped start/ghost nodes). Merged labels
    // carry newlines in the diagram; render them as <br> for Mermaid.
    for (const e of payload.edges) {
        if (!realIds.has(e.data.source) || !realIds.has(e.data.target)) { continue; }
        const label = (e.data.label ?? '').replace(/\n/g, '<br>').replace(/"/g, "'");
        out.push(`${pad(1)}${e.data.source} --> ${e.data.target}${label ? ` : ${label}` : ''}`);
    }

    return out.join('\n');
}
