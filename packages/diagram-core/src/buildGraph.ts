// Pure MachineNode → graph/sim converter, extracted from graphView so it can
// run headless (LM tools, MCP server). No vscode imports.
import { MachineNode } from './parser';
import { SimModel, SimState, SimTransition } from './machineModel';

export interface GraphNode {
    data: {
        id: string; label: string; name: string;
        parent?: string; compound?: boolean;
        initial?: boolean; final?: boolean; start?: boolean; parallel?: boolean;
        history?: 'shallow' | 'deep'; ghost?: boolean;
        entryActions?: string[]; exitActions?: string[]; internalTransitions?: string[];
        invokes?: string[]; description?: string;
        /** True when a single invoke resolves to a real, openable machine but
         * isn't nested inline (e.g. deduped) — gates the drill-to-open '+'. */
        invokeOpenable?: boolean;
        nodeType?: string;
    };
}
export interface GraphEdge {
    data: { id: string; source: string; target: string; label: string };
}
export interface GraphPayload {
    nodes: GraphNode[];
    edges: GraphEdge[];
    collapsedIds?: string[];
    /** Structural model for the interactive simulator. */
    sim?: SimModel;
}

export interface BuildGraphOptions {
    /** Collapse compound states that the host reports as not-expanded. */
    reflectExpansion?: boolean;
    /** Whether a node is currently expanded in an outline tree. */
    isExpanded?: (node: MachineNode) => boolean;
    /** Resolve an invoke `src` to a machine, to nest invoked machines inline. */
    resolveInvoke?: (src: string) => MachineNode | undefined;
    /** Out-param: filled with id → MachineNode (the webview needs it for clicks). */
    nodeById?: Map<string, MachineNode>;
    /** Out-param: roots of machines nested inline. */
    invokedRoots?: MachineNode[];
}

/** Child state nodes, excluding the synthetic `type:` marker. */
export function childStatesOf(node: MachineNode): MachineNode[] {
    return (node.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker);
}

/** Stable identity for a machine (file path + line + label). */
export function machineKey(machine: MachineNode): string {
    const path = machine.uri?.fsPath ?? '';
    const line = machine.range?.start.line ?? 0;
    return `${path}::${line}::${machine.label}`;
}

export function buildGraphPayload(
    machine: MachineNode,
    opts: BuildGraphOptions = {},
): GraphPayload {
    const reflectExpansion = opts.reflectExpansion ?? false;
    const nodeById = opts.nodeById ?? new Map<string, MachineNode>();
    const invokedRoots = opts.invokedRoots ?? [];
        const nodes: GraphNode[] = [];
        const nameToId = new Map<string, string>();
        const idByNode = new Map<MachineNode, string>();
        // Each state's parent state node — for XState-style relative target
        // resolution (a bare target is a sibling, not a same-named state elsewhere).
        const parentNodeOf = new Map<MachineNode, MachineNode | undefined>();
        // Nodes belonging to an inlined invoked machine — visual only. They're
        // kept out of the simulator/test-path model (that simulates THIS machine,
        // not the separate invoked actor).
        const foreignNodes = new Set<MachineNode>();
        const collapsedIds: string[] = [];
        // Parallel structural model for the simulator (same ids as the diagram).
        const simStates: SimState[] = [];
        const simTransitions: SimTransition[] = [];
        let simCounter = 0;
        let counter = 0;
        // Machines already nested inline (by stable key) — dedups repeat invokes
        // and breaks cycles (a machine that, directly or transitively, invokes
        // itself is nested only once).
        const nestedMachineKeys = new Set<string>();

        const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');

        const collect = (n: MachineNode, parentId: string | undefined, isRoot: boolean, foreign = false) => {
            const id = `n${counter++}`;
            idByNode.set(n, id);
            nodeById.set(id, n);
            if (foreign) { foreignNodes.add(n); }
            const name = sanitize(n.label);
            nameToId.set(name, id);

            // Exclude the synthetic `type: …` marker — the graph shows
            // parallel-ness via the state's own styling, not a child node.
            const childStates = (n.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker);
            const entryActions = (n.children ?? []).filter(c => c.type === 'entry').map(c => c.label);
            const exitActions  = (n.children ?? []).filter(c => c.type === 'exit').map(c => c.label);
            // Internal (action-only) transitions: an event that runs actions
            // without a target. There's no state change, so it's not an edge —
            // it belongs inside the state box like entry/exit, shown as
            // `EVENT [guard] / actions` (Harel internal-transition convention).
            const internalTransitions = (n.children ?? [])
                .filter(c => c.type === 'transition'
                    && !(c.children ?? []).some(cc => cc.type === 'target')
                    && (c.children ?? []).some(cc => cc.type === 'action'))
                .map(c => {
                    const guard = c.children?.find(cc => cc.type === 'guard');
                    const acts = (c.children ?? []).filter(cc => cc.type === 'action').map(cc => cc.label);
                    return `${c.label}${guard ? ` [${guard.label}]` : ''} / ${acts.join(', ')}`;
                });
            // Invoked services on this state (shown as `invoke <src>` rows).
            const invokes = (n.children ?? []).filter(c => c.type === 'invoke').map(c => c.label);
            const nodeData: GraphNode['data'] = {
                id, label: n.label, name,
                parent: parentId,
                compound: childStates.length > 0,
                initial: !!n.isInitial,
                final: !!n.isFinal,
                parallel: !!n.isParallel,
                history: n.historyType,
                entryActions,
                exitActions,
                internalTransitions,
                invokes,
                description: n.description,
                nodeType: n.type,
            };
            nodes.push({ data: nodeData });

            // Mirror the state into the simulator model (same id as the diagram).
            // Foreign (inlined invoked-machine) nodes are visual only — excluded.
            if (!foreign) {
                const simType: SimState['type'] = n.isFinal ? 'final'
                    : n.isParallel ? 'parallel'
                    : childStates.length > 0 ? 'compound'
                    : 'atomic';
                simStates.push({
                    id, label: n.label, parent: parentId, type: simType,
                    initial: !!n.isInitial, historyType: n.historyType,
                });
            }

            // A compound state renders as a single collapsed block unless it is
            // currently expanded in the tree. Using the live expansion set (not
            // the cached tree item) means this is correct even for nodes whose
            // tree items have never been rendered. Root states are never
            // collapsed — a diagram rooted at a state must always show it open.
            if (reflectExpansion && !isRoot && childStates.length > 0 && !(opts.isExpanded?.(n) ?? false)) {
                collapsedIds.push(id);
            }

            for (const c of childStates) { parentNodeOf.set(c, n); collect(c, id, false, foreign); }

            // Nest each resolvable invoked machine inline as children of this
            // state: its top-level states become children of `id`, so the state
            // gets the normal expand/collapse affordance and drills in. A machine
            // is nested at most once per diagram (dedup also breaks invoke
            // cycles); nested machines default to collapsed.
            let nestedHere = false;
            for (const src of invokes) {
                const m = opts.resolveInvoke?.(src);
                if (!m) { continue; }
                nodeData.invokeOpenable = true;
                const mKey = machineKey(m);
                if (nestedMachineKeys.has(mKey)) { continue; }
                nestedMachineKeys.add(mKey);
                invokedRoots.push(m);
                nestedHere = true;
                for (const r of childStatesOf(m)) { parentNodeOf.set(r, m); collect(r, id, false, true); }
            }
            if (nestedHere) {
                nodeData.compound = true;
                if (reflectExpansion && !isRoot && childStates.length === 0 && !(opts.isExpanded?.(n) ?? false)) {
                    collapsedIds.push(id);
                }
            }
        };

        // When the diagram is rooted at a single state (a sub-diagram), that
        // state is always shown expanded. When rooted at a machine, its
        // top-level states respect their own tree expansion state.
        const isSubDiagram = machine.type === 'state';

        // Frame an actual machine in a labelled root box (Harel convention).
        // This also lets a parallel machine root carry its parallel styling,
        // which would otherwise be lost (the machine node isn't a state).
        let rootParentId: string | undefined;
        if (!isSubDiagram) {
            rootParentId = `n${counter++}`;
            nodeById.set(rootParentId, machine);
            nodes.push({
                data: {
                    id: rootParentId, label: machine.label, name: sanitize(machine.label),
                    parent: undefined, compound: true, parallel: !!machine.isParallel,
                },
            });
            simStates.push({
                id: rootParentId, label: machine.label, parent: undefined,
                type: machine.isParallel ? 'parallel' : 'compound',
            });
        }

        const rootStates = isSubDiagram
            ? [machine]
            : (machine.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker);
        for (const r of rootStates) {
            parentNodeOf.set(r, isSubDiagram ? undefined : machine);
            collect(r, rootParentId, isSubDiagram);
        }

        // Resolve a transition's target string to a diagram node id, the way
        // XState scopes it: a bare `target` is a sibling (child of the source's
        // parent); a dotted path descends from there; a leading `.` is relative
        // to the source itself; `#id` is global. Only when relative resolution
        // fails do we fall back to the flat last-segment name map — which is what
        // used to mis-resolve a sibling to a same-named state elsewhere.
        const childStateNodes = (scope: MachineNode | undefined): MachineNode[] =>
            scope ? (scope.children ?? []).filter(c => c.type === 'state' && !c.isTypeMarker) : rootStates;
        const globalByLeaf = (raw: string): string | undefined =>
            nameToId.get(sanitize(raw.replace(/^#/, '').split('.').pop() ?? ''));
        const resolveTargetId = (source: MachineNode, raw: string): string | undefined => {
            if (!raw) { return undefined; }
            if (raw.startsWith('#')) { return globalByLeaf(raw); }
            let scope = raw.startsWith('.') ? source : parentNodeOf.get(source);
            const segs = (raw.startsWith('.') ? raw.slice(1) : raw).split('.').filter(Boolean);
            let node: MachineNode | undefined;
            for (const seg of segs) {
                node = childStateNodes(scope).find(k => k.label === seg);
                if (!node) { return globalByLeaf(raw); }
                scope = node;
            }
            return node ? idByNode.get(node) : globalByLeaf(raw);
        };
        // The simulator's root: the machine box, or the focused state itself.
        const simRootId = rootParentId ?? idByNode.get(machine) ?? '';

        // Edges: merge transitions between the same source→target pair so multiple
        // events on one arrow don't stack into an unreadable blob.
        const edgeMap = new Map<string, { source: string; target: string; labels: string[] }>();
        // In a focused sub-diagram, transitions can target a state outside the
        // shown subtree. Rather than dropping them, point them at a faded ghost
        // "exit" stub labelled with the external target.
        const ghostByName = new Map<string, string>();
        const addEdges = (n: MachineNode) => {
            if (n.type === 'state') {
                const sourceId = idByNode.get(n);
                if (sourceId) {
                    // A state's outgoing transitions: its direct `on:` handlers
                    // plus the onDone/onError defined on its invoke(s) — those
                    // also move the state when the invoked actor settles.
                    const directT = (n.children ?? []).filter(c => c.type === 'transition');
                    const invokeT = (n.children ?? [])
                        .filter(c => c.type === 'invoke')
                        .flatMap(inv => (inv.children ?? []).filter(c => c.type === 'transition'));

                    // Emit one merged edge for source→target, building the Harel
                    // label `EVENT [guard] / action1, action2`.
                    const emitEdge = (targetRaw: string, eventLabel: string, guardLabel?: string, actionLabels: string[] = []) => {
                        // Resolve relative to the source state (XState scoping), so a
                        // sibling target isn't confused with a same-named state elsewhere.
                        const realTarget = resolveTargetId(n, targetRaw);
                        let targetId = realTarget;
                        if (!targetId) {
                            if (!isSubDiagram) { return; }
                            const display = targetRaw.replace(/^#/, '');
                            const ghostName = sanitize(display.split('.').pop() ?? '');
                            targetId = ghostByName.get(ghostName);
                            if (!targetId) {
                                targetId = `n${counter++}`;
                                ghostByName.set(ghostName, targetId);
                                nodes.push({ data: { id: targetId, label: display, name: sanitize(display), parent: undefined, ghost: true } });
                            }
                        }
                        const key = `${sourceId} ${targetId}`;
                        let entry = edgeMap.get(key);
                        if (!entry) { entry = { source: sourceId, target: targetId, labels: [] }; edgeMap.set(key, entry); }
                        // Harel label, but with the actions on their own line so a
                        // long event name + several actions don't run into one
                        // wide, hard-to-read row. The leading `/` also marks the
                        // row as the transition's actions (and lets the webview map
                        // a click on it back to its owning event).
                        let label = eventLabel ?? '';
                        if (guardLabel) { label += ` [${guardLabel}]`; }
                        if (actionLabels.length) { label += `\n/ ${actionLabels.join(', ')}`; }
                        label = label.trim();
                        if (label && !entry.labels.includes(label)) { entry.labels.push(label); }
                        // Simulator transition — only when the target is a real
                        // diagram state (skip ghost/out-of-diagram stubs) and the
                        // source isn't a foreign (inlined invoked-machine) node.
                        if (realTarget && !foreignNodes.has(n)) {
                            simTransitions.push({
                                id: `st${simCounter++}`, source: sourceId, event: eventLabel ?? '',
                                guard: guardLabel, target: realTarget, actions: actionLabels,
                            });
                        }
                    };

                    for (const t of [...directT, ...invokeT]) {
                        // Conditional transition (array of branches): each branch is
                        // a `transition` whose label is its own target. Emit an edge
                        // per branch so guarded multi-target transitions all show.
                        const branches = (t.children ?? []).filter(c => c.type === 'transition');
                        if (branches.length > 0) {
                            for (const b of branches) {
                                // The branch's target is its `target` child, not its
                                // display label (which now reads `when guard → target`).
                                const bTarget = b.children?.find(c => c.type === 'target');
                                if (!bTarget) { continue; }  // action-only branch, no target → no edge
                                const g = b.children?.find(c => c.type === 'guard');
                                const acts = (b.children ?? []).filter(c => c.type === 'action').map(a => a.label);
                                emitEdge(bTarget.label, t.label ?? '', g?.label, acts);
                            }
                            continue;
                        }
                        const target = t.children?.find(c => c.type === 'target');
                        const guard   = t.children?.find(c => c.type === 'guard');
                        const actions = (t.children ?? []).filter(c => c.type === 'action').map(a => a.label);
                        if (!target) {
                            // Internal transition (event, no target): no state change,
                            // but still a fireable event in the simulator (unless
                            // the source is a foreign inlined invoked-machine node).
                            if (t.label && !foreignNodes.has(n)) {
                                simTransitions.push({
                                    id: `st${simCounter++}`, source: sourceId,
                                    event: t.label, guard: guard?.label, actions,
                                });
                            }
                            continue;
                        }
                        emitEdge(target.label, t.label ?? '', guard?.label, actions);
                    }
                }
            }
            for (const c of (n.children ?? [])) { addEdges(c); }
        };
        addEdges(machine);
        // Emit the internal transitions of each inlined invoked machine too.
        for (const m of invokedRoots) { addEdges(m); }

        const edges: GraphEdge[] = [];
        for (const entry of edgeMap.values()) {
            edges.push({ data: { id: `e${counter++}`, source: entry.source, target: entry.target, label: entry.labels.join('\n') } });
        }

        // Filled start-node for each region's initial state (Harel convention).
        const starts: GraphNode[] = [];
        for (const node of nodes) {
            if (!node.data.initial) { continue; }
            const startId = `start_${counter++}`;
            starts.push({ data: { id: startId, label: '', name: startId, parent: node.data.parent, start: true } });
            edges.push({ data: { id: `e${counter++}`, source: startId, target: node.data.id, label: '' } });
        }
        nodes.push(...starts);

        const sim: SimModel = { rootId: simRootId, states: simStates, transitions: simTransitions };
        return { nodes, edges, collapsedIds, sim };
}
