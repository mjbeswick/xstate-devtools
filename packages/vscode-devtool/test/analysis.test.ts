import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
    parseSource, listMachines, machineMermaid, computeTestPaths, validateSource,
} from '@xstate-devtools/diagram-core';

// parseMachines logs progress; keep test output clean.
beforeAll(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

const SRC = `
import { createMachine } from 'xstate';
export const toggle = createMachine({
  id: 'toggle',
  initial: 'off',
  states: {
    off: { on: { TOGGLE: 'on' } },
    on: { on: { TOGGLE: 'off' } },
    orphan: {},
  },
});
`;

describe('headless analysis facade', () => {
    it('parseSource + listMachines summarise a machine', () => {
        const machines = parseSource('toggle.ts', SRC);
        expect(machines.length).toBe(1);
        const [summary] = listMachines(machines);
        expect(summary.id).toBe('toggle');
        expect(summary.stateCount).toBe(3); // off, on, orphan
    });

    it('machineMermaid emits a stateDiagram with the states', () => {
        const [m] = parseSource('toggle.ts', SRC);
        const mermaid = machineMermaid(m);
        expect(mermaid).toContain('stateDiagram-v2');
        expect(mermaid).toContain('off');
        expect(mermaid).toContain('on');
    });

    it('computeTestPaths reaches off/on and flags orphan unreachable', () => {
        const [m] = parseSource('toggle.ts', SRC);
        const tp = computeTestPaths(m);
        const reachable = tp.reachable.map((r) => r.label);
        expect(reachable).toContain('off');
        expect(reachable).toContain('on');
        expect(tp.unreachable).toContain('orphan');
    });

    it('validateSource returns plain serialisable diagnostics', () => {
        const diags = validateSource('toggle.ts', SRC);
        expect(Array.isArray(diags)).toBe(true);
        for (const d of diags) {
            expect(typeof d.message).toBe('string');
            expect(['error', 'warning', 'info', 'hint']).toContain(d.severity);
            expect(typeof d.line).toBe('number');
        }
    });
});
