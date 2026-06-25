import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discover, findMachine } from '../src/scan';
import { listMachines, machineMermaid, computeTestPaths } from '@xstate-devtools/diagram-core';

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

let dir: string;

beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {}); // parser logs
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xstate-mcp-'));
    fs.writeFileSync(path.join(dir, 'toggle.ts'), SRC);
    fs.writeFileSync(path.join(dir, 'not-a-machine.ts'), 'export const x = 1;\n');
});

afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

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
});
