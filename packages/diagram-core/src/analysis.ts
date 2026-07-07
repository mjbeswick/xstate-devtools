// Pure analysis facade over a parsed MachineNode, shared by the in-editor
// Language Model Tools and the headless MCP server. No vscode imports.
import { MachineNode } from './parser';
import { buildGraphPayload } from './buildGraph';
import { toMermaid } from './export/mermaid';
import { indexModel, shortestPaths, SimState } from './machineModel';

type ResolveInvoke = (src: string) => MachineNode | undefined;

export interface MachineSummary {
    id: string;
    file?: string;
    line?: number;
    stateCount: number;
    type: string;
}

/** Count state descendants (excluding the synthetic `type:` marker). */
function countStates(node: MachineNode): number {
    let n = 0;
    for (const c of node.children ?? []) {
        if (c.type === 'state' && !c.isTypeMarker) { n += 1 + countStates(c); }
    }
    return n;
}

/** One-line summary per machine — for a "what machines are here" listing. */
export function listMachines(machines: MachineNode[]): MachineSummary[] {
    return machines.map((m) => ({
        id: m.label,
        file: m.uri?.fsPath,
        line: m.range ? m.range.start.line + 1 : undefined,
        stateCount: countStates(m),
        type: m.type,
    }));
}

export interface MachineDescription {
    id: string;
    states: Array<{
        id: string; label: string; parent?: string;
        compound?: boolean; initial?: boolean; final?: boolean; parallel?: boolean;
        entryActions?: string[]; exitActions?: string[]; invokes?: string[];
    }>;
    transitions: Array<{ source: string; target: string; event: string }>;
}

/** Structured states + transitions for a machine (derived from the graph payload). */
export function describeMachine(machine: MachineNode, resolveInvoke?: ResolveInvoke): MachineDescription {
    const payload = buildGraphPayload(machine, { resolveInvoke });
    return {
        id: machine.label,
        states: payload.nodes.map((n) => ({
            id: n.data.id,
            label: n.data.label,
            parent: n.data.parent,
            compound: n.data.compound,
            initial: n.data.initial,
            final: n.data.final,
            parallel: n.data.parallel,
            entryActions: n.data.entryActions?.length ? n.data.entryActions : undefined,
            exitActions: n.data.exitActions?.length ? n.data.exitActions : undefined,
            invokes: n.data.invokes?.length ? n.data.invokes : undefined,
        })),
        transitions: payload.edges.map((e) => ({ source: e.data.source, target: e.data.target, event: e.data.label })),
    };
}

/** Mermaid `stateDiagram-v2` source for a machine. */
export function machineMermaid(machine: MachineNode, resolveInvoke?: ResolveInvoke): string {
    return toMermaid(buildGraphPayload(machine, { resolveInvoke }));
}

export interface TestPaths {
    machine: string;
    total: number;
    reachable: Array<{ label: string; events: string[] }>;
    unreachable: string[];
}

/** Shortest event sequence to reach each state (structural — guards assumed
 *  takeable), plus the states that can't be reached. */
export function computeTestPaths(machine: MachineNode, resolveInvoke?: ResolveInvoke): TestPaths {
    const model = buildGraphPayload(machine, { resolveInvoke }).sim!;
    const idx = indexModel(model);
    const paths = shortestPaths(idx);
    const states = model.states.filter((s) => s.id !== model.rootId);
    const eventsOf = (s: SimState) => (paths.get(s.id) ?? []).map((t) => t.event);
    return {
        machine: machine.label,
        total: states.length,
        reachable: states.filter((s) => paths.get(s.id) !== null).map((s) => ({ label: s.label, events: eventsOf(s) })),
        unreachable: states.filter((s) => paths.get(s.id) === null).map((s) => s.label),
    };
}

export type ReferenceKind = 'action' | 'guard' | 'actor' | 'event';
export interface Reference {
    kind: ReferenceKind;
    name: string;
    machine: string;
    state?: string;
    file?: string;
    line: number;
}

/** Every place `name` is USED (action/guard/actor/event) across the given machines. */
export function findReferences(machines: MachineNode[], name: string): Reference[] {
    const out: Reference[] = [];
    const walk = (node: MachineNode, machine: string, state: string | undefined) => {
        // Don't report setup() declarations as usages.
        if (node.type === 'setup') { return; }
        if (node.label === name && !node.isInline) {
            let kind: ReferenceKind | undefined;
            if (node.type === 'action' || node.type === 'entry' || node.type === 'exit') { kind = 'action'; }
            else if (node.type === 'guard' && node.guardCombinator === undefined) { kind = 'guard'; }
            else if (node.type === 'invoke') { kind = 'actor'; }
            else if (node.type === 'transition') { kind = 'event'; }
            if (kind) { out.push({ kind, name, machine, state, file: node.uri?.fsPath, line: (node.range?.start.line ?? 0) + 1 }); }
        }
        const childState = node.type === 'state' ? node.label : state;
        for (const c of node.children ?? []) { walk(c, machine, childState); }
    };
    for (const m of machines) { walk(m, m.label, undefined); }
    return out;
}

export interface EventHandler { state: string; guard?: string; target?: string }
export interface MachineEvent { event: string; auto?: boolean; handlers: EventHandler[] }

const AUTO_EVENT = /^(always$|after |onDone$|onError$)/;

/** The events a machine handles — its `send()` API — with the states that handle each. */
export function listEvents(machine: MachineNode, resolveInvoke?: ResolveInvoke): MachineEvent[] {
    const sim = buildGraphPayload(machine, { resolveInvoke }).sim!;
    const labelById = new Map(sim.states.map((s) => [s.id, s.label]));
    const byEvent = new Map<string, EventHandler[]>();
    for (const t of sim.transitions) {
        const list = byEvent.get(t.event) ?? [];
        list.push({ state: labelById.get(t.source) ?? t.source, guard: t.guard, target: t.target ? labelById.get(t.target) : undefined });
        byEvent.set(t.event, list);
    }
    return [...byEvent.entries()].map(([event, handlers]) => ({ event, auto: AUTO_EVENT.test(event) || undefined, handlers }));
}

export interface StateDetail {
    machine: string;
    state: string;
    id: string;
    parent?: string;
    compound?: boolean; initial?: boolean; final?: boolean; parallel?: boolean;
    entryActions?: string[]; exitActions?: string[]; invokes?: string[];
    transitions: Array<{ event: string; target?: string; guard?: string; actions?: string[] }>;
    ambiguous?: number;
}

/** Focused detail for one state (by label or id): entry/exit/invokes + outgoing transitions. */
export function stateDetail(machine: MachineNode, state: string, resolveInvoke?: ResolveInvoke): StateDetail | undefined {
    const payload = buildGraphPayload(machine, { resolveInvoke });
    const matches = payload.nodes.filter((n) => n.data.label === state || n.data.id === state);
    const node = matches[0];
    if (!node) { return undefined; }
    const labelById = new Map(payload.sim!.states.map((s) => [s.id, s.label]));
    const transitions = payload.sim!.transitions
        .filter((t) => t.source === node.data.id)
        .map((t) => ({ event: t.event, target: t.target ? labelById.get(t.target) : undefined, guard: t.guard, actions: t.actions?.length ? t.actions : undefined }));
    const d = node.data;
    return {
        machine: machine.label, state: d.label, id: d.id, parent: d.parent ? labelById.get(d.parent) : undefined,
        compound: d.compound, initial: d.initial, final: d.final, parallel: d.parallel,
        entryActions: d.entryActions?.length ? d.entryActions : undefined,
        exitActions: d.exitActions?.length ? d.exitActions : undefined,
        invokes: d.invokes?.length ? d.invokes : undefined,
        transitions,
        ambiguous: matches.length > 1 ? matches.length : undefined,
    };
}

/** The Markdown coverage report (shared with the outline's Generate Test Paths). */
export function renderTestPathsMarkdown(machine: MachineNode, resolveInvoke?: ResolveInvoke): string {
    const tp = computeTestPaths(machine, resolveInvoke);
    const lines: string[] = [];
    lines.push(`# Test paths — ${tp.machine}`, '');
    lines.push(
        'Shortest event sequence to reach each state, from the structural',
        `interpreter (guards assumed takeable). ${tp.reachable.length}/${tp.total} states reachable.`,
        '',
    );
    lines.push('## Reachable states', '');
    for (const s of tp.reachable) {
        lines.push(`- **${s.label}** — ${s.events.length ? s.events.map((e) => `\`${e}\``).join(' → ') : '_initial_'}`);
    }
    if (tp.unreachable.length) {
        lines.push('', '## Unreachable states', '');
        for (const label of tp.unreachable) { lines.push(`- ${label}`); }
    }
    lines.push('', '## Test skeletons', '', '```ts',
        `import { createActor } from 'xstate';`,
        `// import { machine } from './your-machine';`, '');
    for (const s of tp.reachable) {
        lines.push(`test('reaches "${s.label}"', () => {`,
            `  const actor = createActor(machine).start();`);
        for (const e of s.events) { lines.push(`  actor.send({ type: '${e}' });`); }
        lines.push(`  // expect(actor.getSnapshot().matches('${s.label}')).toBe(true);`, `});`, '');
    }
    lines.push('```', '');
    return lines.join('\n');
}
