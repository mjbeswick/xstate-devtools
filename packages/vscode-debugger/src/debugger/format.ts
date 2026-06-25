// packages/vscode-debugger/src/debugger/format.ts
//
// Compact, deduped rendering of a machine's active leaf states. A machine with
// many parallel regions yields the same leaf name repeatedly (e.g. "idle" per
// region); collapse those into "idle ×8" instead of "idle, idle, idle, …".

function leafCounts(leaves: string[]): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const l of leaves) { counts.set(l, (counts.get(l) ?? 0) + 1); }
    return [...counts.entries()];
}

/** Deduped display tokens, e.g. ["idle", "idle", "charging"] → ["idle ×2", "charging"]. */
export function summarizeLeafTokens(leaves: string[]): string[] {
    return leafCounts(leaves).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));
}

/**
 * Flatten an XState StateValue to its leaf state names, without needing the
 * machine definition. Used for actors synthesized from bare snapshots (no
 * machine), e.g. "running" or { a: 'idle', b: { c: 'x' } } → ["running"] /
 * ["idle", "x"].
 */
export function stateValueLeaves(value: unknown): string[] {
    if (typeof value === 'string') { return [value]; }
    if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).flatMap(stateValueLeaves);
    }
    return [];
}

/** Deduped one-line summary, capped, e.g. "idle ×8, charging" or "…, +3 more". */
export function summarizeLeaves(leaves: string[], cap = 6): string {
    const parts = summarizeLeafTokens(leaves);
    if (parts.length <= cap) { return parts.join(', '); }
    return parts.slice(0, cap).join(', ') + `, +${parts.length - cap} more`;
}
