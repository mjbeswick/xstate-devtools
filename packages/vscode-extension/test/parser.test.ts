import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { XStateMachineParser, MachineNode } from '../src/parser';

const TESTING_DIR = path.resolve(__dirname, '../testing');

// The parser logs progress via console.log; keep test output clean.
beforeAll(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

// A TextDocument good enough for the parser: getText / fileName / uri /
// positionAt (offset → line/character via a scanned line-start table).
function makeDoc(text: string, fileName: string): vscode.TextDocument {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) { if (text[i] === '\n') { lineStarts.push(i + 1); } }
    return {
        getText: () => text,
        fileName,
        uri: vscode.Uri.file(fileName),
        positionAt(offset: number) {
            let lo = 0, hi = lineStarts.length - 1;
            while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= offset) { lo = m; } else { hi = m - 1; } }
            return new vscode.Position(lo, offset - lineStarts[lo]);
        },
    } as unknown as vscode.TextDocument;
}

function parseFixture(name: string): MachineNode[] {
    const file = path.join(TESTING_DIR, name);
    return XStateMachineParser.parseMachines(makeDoc(fs.readFileSync(file, 'utf8'), file));
}

// Compact, range-free view of the tree — captures semantic structure
// (type/label/flags/children) without brittle position data.
function serialize(n: MachineNode): Record<string, unknown> {
    const o: Record<string, unknown> = { type: n.type, label: n.label };
    if (n.isInitial) { o.initial = true; }
    if (n.isFinal) { o.final = true; }
    if (n.isParallel) { o.parallel = true; }
    if (n.historyType) { o.history = n.historyType; }
    if (n.isTypeMarker) { o.typeMarker = true; }
    if (n.isStateConfig) { o.stateConfig = true; }
    if (n.description) { o.description = n.description; }
    if (n.children?.length) { o.children = n.children.map(serialize); }
    return o;
}

// Find a descendant state by label (depth-first).
function findState(roots: MachineNode[], label: string): MachineNode | undefined {
    const stack = [...roots];
    while (stack.length) {
        const n = stack.shift()!;
        if (n.type === 'state' && n.label === label) { return n; }
        if (n.children) { stack.push(...n.children); }
    }
    return undefined;
}
const childLabels = (n: MachineNode | undefined, type: string) =>
    (n?.children ?? []).filter(c => c.type === type).map(c => c.label);

const FIXTURES = [
    'trafficLight.machine.ts',
    'checkout.machine.ts',
    'complexMachine.ts',
    'internalActions.machine.ts',
    'invokeMachine.machine.ts',
    'advancedTransitions.machine.ts',
];

describe('parser snapshots', () => {
    for (const name of FIXTURES) {
        it(`parses ${name}`, () => {
            const machines = parseFixture(name);
            expect(machines.length).toBeGreaterThan(0);
            expect(machines.map(serialize)).toMatchSnapshot();
        });
    }
});

describe('transition coverage', () => {
    it('internal (action-only) transitions: actions, no target', () => {
        const active = findState(parseFixture('internalActions.machine.ts'), 'active');
        const transitions = (active?.children ?? []).filter(c => c.type === 'transition');
        const increment = transitions.find(t => t.label === 'INCREMENT');
        expect(increment).toBeDefined();
        expect(childLabels(increment, 'action')).toEqual(['doIncrement']);
        expect(childLabels(increment, 'target')).toEqual([]);
        const decrement = transitions.find(t => t.label === 'DECREMENT');
        expect(childLabels(decrement, 'guard')).toEqual(['isPositive']);
    });

    it('invoke onDone/onError carry a target node', () => {
        const loading = findState(parseFixture('invokeMachine.machine.ts'), 'loading');
        const invoke = loading?.children?.find(c => c.type === 'invoke');
        const onDone = invoke?.children?.find(c => c.type === 'transition' && c.label === 'onDone');
        const onError = invoke?.children?.find(c => c.type === 'transition' && c.label === 'onError');
        expect(childLabels(onDone, 'target')).toEqual(['success']);
        expect(childLabels(onError, 'target')).toEqual(['failure']);
        expect(childLabels(onDone, 'action')).toEqual(['storeUser']);
    });

    it('after / always / state-level onDone become transitions', () => {
        const roots = parseFixture('advancedTransitions.machine.ts');
        const validating = findState(roots, 'validating');
        const always = validating?.children?.find(c => c.type === 'transition' && c.label === 'always');
        // `always` with an array of branches: each branch is a transition child.
        expect((always?.children ?? []).filter(c => c.type === 'transition').length).toBe(2);

        const invalid = findState(roots, 'invalid');
        const after = (invalid?.children ?? []).filter(c => c.type === 'transition');
        expect(after.some(t => t.label === 'after 3000ms')).toBe(true);

        const confirming = findState(roots, 'confirming');
        const onDone = confirming?.children?.find(c => c.type === 'transition' && c.label === 'onDone');
        expect(childLabels(onDone, 'target')).toEqual(['done']);
    });

    it('targeted transition keeps its target as a child node', () => {
        const idle = findState(parseFixture('invokeMachine.machine.ts'), 'idle');
        const fetch = idle?.children?.find(c => c.type === 'transition' && c.label === 'FETCH');
        expect(childLabels(fetch, 'target')).toEqual(['loading']);
    });
});

describe('object-form actions', () => {
    const SRC = `
import { createMachine } from 'xstate';
export const m = createMachine({
  id: 'obj',
  initial: 'idle',
  states: {
    idle: {
      on: {
        'sound.play': {
          actions: [{ type: 'playSound', params: ({ event }) => event.params }],
        },
        'locale.change': {
          actions: [
            { type: 'saveSelectedLocale', params: ({ event }) => event.params },
            { type: 'raiseAnalyticsEvent', params: ({ event }) => event.params },
            { type: 'bookmark', params: { bookmark: 'CHANGE_LOCALE' } },
          ],
        },
      },
    },
  },
});`;
    const roots = () => XStateMachineParser.parseMachines(makeDoc(SRC, '/obj.ts'));

    it('renders { type, params } actions from a single-element array', () => {
        const idle = findState(roots(), 'idle');
        const t = idle?.children?.find(c => c.type === 'transition' && c.label === 'sound.play');
        expect(childLabels(t, 'action')).toEqual(['playSound']);
    });

    it('renders every { type, params } action in a multi-element array', () => {
        const idle = findState(roots(), 'idle');
        const t = idle?.children?.find(c => c.type === 'transition' && c.label === 'locale.change');
        expect(childLabels(t, 'action')).toEqual([
            'saveSelectedLocale', 'raiseAnalyticsEvent', 'bookmark',
        ]);
    });
});

describe('fallback labels & branch labeling', () => {
    const SRC = `
import { createMachine } from 'xstate';
export const m = createMachine({
  id: 'fb',
  initial: 'idle',
  states: {
    idle: {
      entry: [() => {}],
      on: {
        GO: [
          { guard: 'isReady', target: 'active' },
          { guard: () => true, target: 'idle' },
          { target: 'done' },
        ],
        PING: { target: 'idle', guard: () => false },
      },
    },
    active: {},
    done: { type: 'final' },
  },
});`;
    const roots = () => XStateMachineParser.parseMachines(makeDoc(SRC, '/fb.ts'));

    it('anonymous array action gets a placeholder, not the bare type word', () => {
        const idle = findState(roots(), 'idle');
        expect(childLabels(idle, 'entry')).toEqual(['(inline entry)']);
    });

    it('named-guard branches lead with the guard; anonymous guard falls back to target', () => {
        const idle = findState(roots(), 'idle');
        const go = idle?.children?.find(c => c.type === 'transition' && c.label === 'GO');
        const branches = (go?.children ?? []).filter(c => c.type === 'transition').map(c => c.label);
        expect(branches).toEqual(['when isReady → active', 'idle', 'done']);
    });

    it('anonymous inline guard renders as a navigable child, not dropped', () => {
        const idle = findState(roots(), 'idle');
        const go = idle?.children?.find(c => c.type === 'transition' && c.label === 'GO');
        const anonBranch = go?.children?.find(c => c.type === 'transition' && c.label === 'idle');
        expect(childLabels(anonBranch, 'guard')).toEqual(['(inline guard)']);
    });
});

describe('structure', () => {
    it('trafficLight: red is a compound state with initial walk', () => {
        const red = findState(parseFixture('trafficLight.machine.ts'), 'red');
        expect(red?.children?.some(c => c.type === 'state' && c.label === 'walk' && c.isInitial)).toBe(true);
    });

    it('checkout is a parallel machine with payment + fulfilment regions', () => {
        const [machine] = parseFixture('checkout.machine.ts');
        expect(machine.isParallel).toBe(true);
        const regions = (machine.children ?? []).filter(c => c.type === 'state').map(c => c.label);
        expect(regions).toEqual(expect.arrayContaining(['payment', 'fulfilment']));
    });
});
