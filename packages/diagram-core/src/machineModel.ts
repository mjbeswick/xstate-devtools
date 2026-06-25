// A pure, serializable model of a statechart's *structure* plus a small
// structural interpreter, derived from the diagram payload. No VS Code or
// `xstate` imports — it is bundled into the webview and drives the simulator
// (and, later, maps live runtime snapshots onto the diagram).
//
// It is "structural" on purpose: guards and action effects are runtime
// functions we cannot evaluate statically, so the interpreter never decides a
// guard for the user. Instead every guarded branch is offered as a distinct,
// explicitly-fireable transition.

export type SimStateType = 'atomic' | 'compound' | 'parallel' | 'final';

export interface SimState {
    id: string;
    label: string;
    parent?: string;
    type: SimStateType;
    /** True when this state is its parent's initial child. */
    initial?: boolean;
    historyType?: 'shallow' | 'deep';
}

export interface SimTransition {
    id: string;
    /** Source *state* id (always an active-able state). */
    source: string;
    /** Display event label: `NEXT`, `after 1000ms`, `always`, `onDone`, … */
    event: string;
    guard?: string;
    /** Resolved target state id. Undefined ⇒ internal (no state change). */
    target?: string;
    actions?: string[];
}

export interface SimModel {
    /** Diagram-node id of the root (the machine box, or a focused state). */
    rootId: string;
    states: SimState[];
    transitions: SimTransition[];
}

export interface SimIndex {
    model: SimModel;
    byId: Map<string, SimState>;
    childrenOf: Map<string | undefined, SimState[]>;
}

export function indexModel(model: SimModel): SimIndex {
    const byId = new Map<string, SimState>();
    const childrenOf = new Map<string | undefined, SimState[]>();
    for (const s of model.states) {
        byId.set(s.id, s);
        const list = childrenOf.get(s.parent) ?? [];
        list.push(s);
        childrenOf.set(s.parent, list);
    }
    return { model, byId, childrenOf };
}

const childrenOf = (idx: SimIndex, id: string): SimState[] => idx.childrenOf.get(id) ?? [];

const initialChild = (idx: SimIndex, id: string): SimState | undefined => {
    const kids = childrenOf(idx, id);
    return kids.find(k => k.initial) ?? kids[0];
};

/** [id, parent, …, rootId] — the state itself up to the root. */
function ancestorsInclusive(idx: SimIndex, id: string): string[] {
    const chain: string[] = [];
    let cur: string | undefined = id;
    while (cur) {
        chain.push(cur);
        cur = idx.byId.get(cur)?.parent;
    }
    return chain;
}

// Add `id` and its mandatory descendants to `cfg`: a compound enters its initial
// child, a parallel enters *all* its regions, an atomic/final stops.
function enterState(idx: SimIndex, id: string, cfg: Set<string>): void {
    cfg.add(id);
    const st = idx.byId.get(id);
    if (!st) { return; }
    if (st.type === 'parallel') {
        for (const region of childrenOf(idx, id)) { enterState(idx, region.id, cfg); }
    } else if (st.type === 'compound') {
        const init = initialChild(idx, id);
        if (init) { enterState(idx, init.id, cfg); }
    }
}

/** The set of active state ids when the machine starts. */
export function initialConfig(idx: SimIndex): Set<string> {
    const cfg = new Set<string>();
    enterState(idx, idx.model.rootId, cfg);
    return cfg;
}

/** Every transition whose source state is currently active, in tree order. */
export function enabledTransitions(idx: SimIndex, config: Set<string>): SimTransition[] {
    return idx.model.transitions.filter(t => config.has(t.source));
}

function lca(idx: SimIndex, a: string, b: string): string | undefined {
    const aset = new Set(ancestorsInclusive(idx, a));
    for (const id of ancestorsInclusive(idx, b)) {
        if (aset.has(id)) { return id; }
    }
    return undefined;
}

/**
 * Apply a transition to a config and return the next config. Internal
 * transitions (no target) leave the config unchanged. External transitions exit
 * the active subtree under the transition's domain (LCA of source & target),
 * then enter the target plus any default descendants — defaulting sibling
 * regions of any parallel state crossed on the way in.
 */
export function fire(idx: SimIndex, config: Set<string>, transition: SimTransition): Set<string> {
    if (!transition.target || !idx.byId.has(transition.target)) {
        return new Set(config);
    }
    const domain = lca(idx, transition.source, transition.target) ?? idx.model.rootId;

    // Exit every active state strictly below the domain.
    const next = new Set<string>();
    for (const id of config) {
        const isUnderDomain = id !== domain && ancestorsInclusive(idx, id).includes(domain);
        if (!isUnderDomain) { next.add(id); }
    }

    // Re-enter the path from just below the domain down to the target.
    const path: string[] = [];
    for (const id of ancestorsInclusive(idx, transition.target)) {
        if (id === domain) { break; }
        path.unshift(id);
    }
    for (let i = 0; i < path.length; i++) {
        const id = path[i];
        next.add(id);
        const st = idx.byId.get(id);
        if (st?.type === 'parallel') {
            const onPathNext = path[i + 1];
            for (const region of childrenOf(idx, id)) {
                if (region.id !== onPathNext) { enterState(idx, region.id, next); }
            }
        }
    }
    // Finally take the target's own default descendants.
    enterState(idx, transition.target, next);
    return next;
}

/** A top-level final state being active ⇒ the machine has reached done. */
export function isDone(idx: SimIndex, config: Set<string>): boolean {
    for (const id of config) {
        const st = idx.byId.get(id);
        if (st?.type === 'final' && st.parent === idx.model.rootId) { return true; }
    }
    return false;
}

// ── Path finding ────────────────────────────────────────────────────────────
// BFS over the *configuration* graph: a node is a full active-state set, an edge
// is firing one enabled transition. Keyed by the sorted active ids so cycles and
// internal (no-op) transitions don't loop forever.

const configKey = (config: Set<string>): string => [...config].sort().join('|');

/** Every state's shortest path from the initial config (BFS once, recording the
 *  first time each state becomes active). States never reached map to `null`. */
export function shortestPaths(idx: SimIndex): Map<string, SimTransition[] | null> {
    const result = new Map<string, SimTransition[] | null>();
    for (const s of idx.model.states) { result.set(s.id, null); }

    const start = initialConfig(idx);
    for (const id of start) { result.set(id, []); }
    const seen = new Set([configKey(start)]);
    const queue: { config: Set<string>; path: SimTransition[] }[] = [{ config: start, path: [] }];
    while (queue.length) {
        const { config, path } = queue.shift()!;
        for (const t of enabledTransitions(idx, config)) {
            const next = fire(idx, config, t);
            const k = configKey(next);
            if (seen.has(k)) { continue; }
            seen.add(k);
            const nextPath = [...path, t];
            for (const id of next) {
                if (result.get(id) === null) { result.set(id, nextPath); }
            }
            queue.push({ config: next, path: nextPath });
        }
    }
    return result;
}
