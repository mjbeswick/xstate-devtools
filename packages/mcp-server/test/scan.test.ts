import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discover, findMachine } from '../src/scan';
import { listMachines, machineMermaid, computeTestPaths, describeMachine } from '@xstate-devtools/diagram-core';

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

const NESTED_SRC = `
import { createMachine } from 'xstate';
export const nested = createMachine({
  id: 'nested',
  initial: 'a',
  states: {
    a: {
      initial: 'a1',
      states: {
        a1: { initial: 'a1x', states: { a1x: {} } },
        a2: {},
      },
    },
    b: {},
  },
});
`;

let dir: string;
let nestedDir: string;

beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {}); // parser logs
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xstate-mcp-'));
    fs.writeFileSync(path.join(dir, 'toggle.ts'), SRC);
    fs.writeFileSync(path.join(dir, 'not-a-machine.ts'), 'export const x = 1;\n');

    nestedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xstate-mcp-nested-'));
    fs.writeFileSync(path.join(nestedDir, 'nested.ts'), NESTED_SRC);
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(nestedDir, { recursive: true, force: true });
});

describe('mcp scan', () => {
    it('discovers machines from disk and skips non-machine files', () => {
        const refs = discover(dir);
        expect(refs.length).toBe(1);
        expect(refs[0].machine.label).toBe('toggle');
        expect(listMachines(refs.map((r) => r.machine))[0].stateCount).toBe(3);
    });

    it('findMachine resolves by id, and analysis runs on the result', () => {
        const refs = discover(dir);
        const ref = findMachine(refs, 'toggle');
        expect(ref).toBeDefined();
        expect(machineMermaid(ref!.machine)).toContain('stateDiagram-v2');
        const tp = computeTestPaths(ref!.machine);
        expect(tp.unreachable).toContain('orphan');
    });

    it('describeMachine scopes to a subtree by parent/depth', () => {
        const refs = discover(nestedDir);
        const ref = findMachine(refs, 'nested');
        expect(ref).toBeDefined();

        const labelsOf = (states: { label: string; parent?: string }[]) =>
            states.filter((s) => s.label && s.parent !== undefined).map((s) => s.label);

        const full = describeMachine(ref!.machine);
        expect(labelsOf(full.states).sort()).toEqual(['a', 'a1', 'a1x', 'a2', 'b'].sort());

        const scoped = describeMachine(ref!.machine, undefined, { parent: 'a' });
        expect(labelsOf(scoped.states).sort()).toEqual(['a1', 'a1x', 'a2'].sort());

        const oneLevel = describeMachine(ref!.machine, undefined, { parent: 'a', depth: 1 });
        expect(labelsOf(oneLevel.states).sort()).toEqual(['a1', 'a2'].sort());
    });
});
