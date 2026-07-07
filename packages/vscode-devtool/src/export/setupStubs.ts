import type { MachineNode } from '@xstate-devtools/diagram-core';

// Scaffold a `setup({ actions, guards, actors, delays })` block from a machine:
// a typed stub for every action/guard/actor/delay the machine *references*, each
// flagged as already in the machine's `setup()` or missing from it. Pure — it
// just walks the parsed MachineNode tree.

interface Impls { actions: Set<string>; guards: Set<string>; actors: Set<string>; delays: Set<string> }
const emptyImpls = (): Impls => ({ actions: new Set(), guards: new Set(), actors: new Set(), delays: new Set() });

// XState built-ins, surfaced by the parser as the call-expression name (e.g.
// `not('hasRewards')` → "not", `assign({…})` → "assign"). They come from xstate,
// not the user's setup, so they aren't stubs.
const BUILTIN_ACTIONS = new Set([
    'assign', 'raise', 'sendTo', 'sendParent', 'forwardTo', 'enqueueActions',
    'spawnChild', 'stopChild', 'stop', 'log', 'cancel', 'emit', 'pure', 'choose', 'escalate',
]);
const BUILTIN_GUARDS = new Set(['and', 'or', 'not', 'stateIn']);

const isIdent = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s);
// Anonymous/inline references (e.g. "(inline guard)") and the "?" branch marker
// aren't nameable stubs.
const nameable = (s?: string): s is string => !!s && !s.startsWith('(') && s !== '?';
const keyOf = (name: string) => (isIdent(name) ? name : JSON.stringify(name));

/** Collect referenced vs setup-defined implementation names from a machine. */
export function collectImpls(machine: MachineNode): { referenced: Impls; defined: Impls } {
    const referenced = emptyImpls();
    const defined = emptyImpls();

    const walk = (n: MachineNode) => {
        if (n.type === 'setup') {
            // The setup() node's children are the *definitions*, not references.
            for (const c of n.children ?? []) {
                if (!nameable(c.label)) { continue; }
                if (c.type === 'action') { defined.actions.add(c.label); }
                else if (c.type === 'guard') { defined.guards.add(c.label); }
                else if (c.type === 'actor') { defined.actors.add(c.label); }
                else if (c.type === 'delay') { defined.delays.add(c.label); }
            }
            return;
        }
        switch (n.type) {
            case 'action': case 'entry': case 'exit':
                if (nameable(n.label) && !BUILTIN_ACTIONS.has(n.label)) { referenced.actions.add(n.label); }
                break;
            case 'guard':
                if (nameable(n.label) && !BUILTIN_GUARDS.has(n.label)) { referenced.guards.add(n.label); }
                break;
            case 'invoke':  // label is the invoked actor's `src`
                if (nameable(n.label)) { referenced.actors.add(n.label); }
                break;
            case 'transition':
                // Named `after` delays render as "after <name>" (numeric ones as
                // "after 1000ms" — inline, nothing to stub).
                if (n.label?.startsWith('after ')) {
                    const d = n.label.slice('after '.length).trim();
                    if (d && !/^\d+ms$/.test(d) && nameable(d)) { referenced.delays.add(d); }
                }
                break;
        }
        for (const c of n.children ?? []) { walk(c); }
    };
    walk(machine);
    return { referenced, defined };
}

export function toSetupStubs(machine: MachineNode): string {
    const { referenced, defined } = collectImpls(machine);
    const total = referenced.actions.size + referenced.guards.size + referenced.actors.size + referenced.delays.size;
    if (total === 0) {
        return `// No named actions, guards, actors, or delays are referenced in "${machine.label}".\n`;
    }

    const missingCount = (['actions', 'guards', 'actors', 'delays'] as const)
        .reduce((sum, k) => sum + [...referenced[k]].filter(n => !defined[k].has(n)).length, 0);

    const out: string[] = [];
    out.push(`// Setup stubs for "${machine.label}"`);
    out.push(`// ${total} implementation${total === 1 ? '' : 's'} referenced, ${missingCount} not yet in setup({…}).`);
    out.push(`// Each line is flagged "missing" (not in the machine's setup) or "in setup".`);
    out.push(`// Copy the blocks you need into your machine's setup({…}).`);
    out.push('');
    out.push(referenced.actors.size ? `import { setup, fromPromise } from 'xstate';` : `import { setup } from 'xstate';`);
    out.push('');
    out.push('setup({');

    const section = (label: keyof Impls, makeStub: (name: string) => string) => {
        const names = [...referenced[label]].sort((a, b) => a.localeCompare(b));
        if (!names.length) { return; }
        out.push(`  ${label}: {`);
        for (const name of names) {
            const flag = defined[label].has(name) ? 'in setup' : 'missing';
            out.push(`    ${keyOf(name)}: ${makeStub(name)} // TODO (${flag})`);
        }
        out.push(`  },`);
    };

    section('actions', () => `() => {},`);
    section('guards', () => `() => false,`);
    section('actors', () => `fromPromise(async () => {}),`);
    section('delays', () => `1000,`);

    out.push('});');
    out.push('');
    return out.join('\n');
}
