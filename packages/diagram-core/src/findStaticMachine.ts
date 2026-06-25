import type { MachineNode } from './parser';
import type { WorkspaceScanner } from './workspaceScanner';

/** Top-level state labels of a static machine (its root regions/states). */
function topLevelStateLabels(machine: MachineNode): string[] {
    return (machine.children ?? [])
        .filter((c) => c.type === 'state' && !c.isTypeMarker)
        .map((c) => c.label);
}

/**
 * Locate the statically-parsed machine for a running machine. Match by root id
 * first; when several share the id, prefer the file the runtime reported in
 * `sourceLocation`.
 *
 * An anonymous machine has no help from the id — XState v5 defaults its root id
 * to "(machine)", which matches nothing in the workspace (the parser labels such
 * a machine by its variable name). `sourceLocation` doesn't help either: it's
 * the createActor call site, not the createMachine definition. So fall back to a
 * structural fingerprint — the set of top-level state names, which is stable and
 * almost always unique across a workspace's machines.
 */
export function findStaticMachine(
    scanner: WorkspaceScanner,
    machineId: string,
    sourceLocation?: string,
    rootStateKeys?: string[],
): MachineNode | undefined {
    const all: MachineNode[] = [];
    for (const file of scanner.getCached()) {
        for (const machine of file.machines) { all.push(machine); }
    }
    const want = rootStateKeys && rootStateKeys.length > 0 ? new Set(rootStateKeys) : null;
    // How many of the running machine's top-level states this candidate shares —
    // a structural fingerprint used to disambiguate.
    const overlap = (m: MachineNode): number =>
        want ? topLevelStateLabels(m).reduce((n, l) => n + (want.has(l) ? 1 : 0), 0) : 0;

    const byLabel = all.filter((m) => m.label === machineId);
    let candidates: MachineNode[];
    if (byLabel.length > 0) {
        candidates = byLabel;
        // Several machines share this id (e.g. two `id: 'journey'`): keep the
        // ones whose states best match the running machine, not just the first.
        if (want && candidates.length > 1) {
            const best = Math.max(...candidates.map(overlap));
            if (best > 0) { candidates = candidates.filter((m) => overlap(m) === best); }
        }
    } else {
        // No id match — e.g. an anonymous machine whose runtime id is "(machine)".
        // Resolve purely structurally; give up if nothing shares its states.
        if (!want) { return undefined; }
        const best = Math.max(0, ...all.map(overlap));
        if (best === 0) { return undefined; }
        candidates = all.filter((m) => overlap(m) === best);
    }
    if (candidates.length <= 1) { return candidates[0]; }
    if (sourceLocation) {
        const byFile = candidates.find((m) => m.uri && sourceLocation.includes(m.uri.fsPath));
        if (byFile) { return byFile; }
    }
    return candidates[0];
}
