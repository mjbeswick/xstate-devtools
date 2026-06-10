import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { validateXStateDocument, XSTATE_DIAGNOSTIC_CODES } from '../src/diagnostics';

// A TextDocument good enough for the validator: getText / fileName / uri /
// positionAt (offset → line/character via a scanned line-start table).
function makeDoc(text: string, fileName = 'machine.ts'): vscode.TextDocument {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) { if (text[i] === '\n') { lineStarts.push(i + 1); } }
    return {
        getText: () => text,
        fileName,
        languageId: 'typescript',
        uri: vscode.Uri.file(fileName),
        positionAt(offset: number) {
            let lo = 0, hi = lineStarts.length - 1;
            while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= offset) { lo = m; } else { hi = m - 1; } }
            return new vscode.Position(lo, offset - lineStarts[lo]);
        },
    } as unknown as vscode.TextDocument;
}

/** State names flagged unreachable by the validator, for a given source string. */
function unreachable(src: string): string[] {
    return validateXStateDocument(makeDoc(src))
        .filter(d => d.code === XSTATE_DIAGNOSTIC_CODES.unreachableState)
        .map(d => /State '([^']+)'/.exec(d.message)?.[1] ?? '')
        .sort();
}

describe('unreachable-state reachability walk', () => {
    it('does not flag states reachable through a transition chain', () => {
        const src = `
            createMachine({
                initial: 'idle',
                states: {
                    idle: { on: { FETCH: 'loading' } },
                    loading: { on: { DONE: 'success' } },
                    success: {},
                },
            });
        `;
        expect(unreachable(src)).toEqual([]);
    });

    it('flags a transitively-orphaned cluster (states only reachable from each other)', () => {
        // a↔b are reachable from initial; c↔d only target each other and are
        // never targeted from the reachable set → both unreachable.
        const src = `
            createMachine({
                initial: 'a',
                states: {
                    a: { on: { GO: 'b' } },
                    b: { on: { BACK: 'a' } },
                    c: { on: { GO: 'd' } },
                    d: { on: { BACK: 'c' } },
                },
            });
        `;
        expect(unreachable(src)).toEqual(['c', 'd']);
    });

    it('honors nested initial chains and flags an unreached grandchild', () => {
        const src = `
            createMachine({
                initial: 'parent',
                states: {
                    parent: {
                        initial: 'childA',
                        states: {
                            childA: {},
                            childB: {},
                        },
                    },
                },
            });
        `;
        // parent (initial) and childA (its initial) are reachable; childB is not
        // targeted by anything → unreachable.
        expect(unreachable(src)).toEqual(['childB']);
    });

    it('treats every region of a reachable parallel state as reachable', () => {
        const src = `
            createMachine({
                initial: 'active',
                states: {
                    active: {
                        type: 'parallel',
                        states: {
                            regionA: { initial: 'a1', states: { a1: {} } },
                            regionB: { initial: 'b1', states: { b1: {} } },
                        },
                    },
                },
            });
        `;
        expect(unreachable(src)).toEqual([]);
    });

    it('resolves targets by explicit id', () => {
        const src = `
            createMachine({
                initial: 'idle',
                states: {
                    idle: { on: { FETCH: '#busy' } },
                    loading: { id: 'busy' },
                },
            });
        `;
        expect(unreachable(src)).toEqual([]);
    });
});
