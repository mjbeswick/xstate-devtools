import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findImplementation } from '../src/implementationFinder';

let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xstate-mcp-impl-'));
    fs.writeFileSync(path.join(root, 'machine.ts'), `
import { setup } from 'xstate';
import { logToggle } from './actions';
export const toggle = setup({
  actions: {
    inlineAction() { console.log('inline'); },
  },
}).createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: {}, on: {} },
});
`);
    fs.writeFileSync(path.join(root, 'actions.ts'), `
export function logToggle() { console.log('toggled'); }
`);
    fs.writeFileSync(path.join(root, 'guards.ts'), `
export const isReady = { isReady: () => true };
`);
});

afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('findImplementation', () => {
    it('finds an action defined inline in setup()', () => {
        const hit = findImplementation(root, 'inlineAction', 'machine.ts');
        expect(hit?.file).toMatch(/machine\.ts$/);
    });

    it('finds an implementation in an imported module', () => {
        const hit = findImplementation(root, 'logToggle', 'machine.ts');
        expect(hit?.file).toMatch(/actions\.ts$/);
    });

    it('falls back to a workspace text search', () => {
        const hit = findImplementation(root, 'isReady', 'machine.ts');
        expect(hit?.file).toMatch(/guards\.ts$/);
    });

    it('returns null when nothing matches', () => {
        expect(findImplementation(root, 'doesNotExist', 'machine.ts')).toBeNull();
    });
});
