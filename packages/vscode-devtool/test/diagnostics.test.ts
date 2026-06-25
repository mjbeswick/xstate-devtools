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

    it('marks unknown setup references as Errors and unreachable as a Warning', () => {
        const src = `
            import { setup } from 'xstate';
            export const m = setup({
                actions: { known: () => {} },
            }).createMachine({
                initial: 'idle',
                states: {
                    idle: { entry: 'mystery' },
                    orphan: {},
                },
            });
        `;
        const diags = validateXStateDocument(makeDoc(src));
        const byCode = (code: string) => diags.find(d => d.code === code);
        expect(byCode(XSTATE_DIAGNOSTIC_CODES.unknownAction)?.severity).toBe(vscode.DiagnosticSeverity.Error);
        expect(byCode(XSTATE_DIAGNOSTIC_CODES.unreachableState)?.severity).toBe(vscode.DiagnosticSeverity.Warning);
    });

    it('does not flag inline action/guard implementations passed by identifier', () => {
        // `guard: isReady` / `entry: logIt` reference local functions directly — inline
        // implementations, not setup() names — so they must not be reported as unknown.
        const src = `
            import { setup } from 'xstate';
            const isReady = () => true;
            const logIt = () => {};
            export const m = setup({ actions: {}, guards: {} }).createMachine({
                initial: 'idle',
                states: {
                    idle: {
                        entry: logIt,
                        on: { GO: { target: 'idle', guard: isReady, actions: [logIt] } },
                    },
                },
            });
        `;
        const codes = validateXStateDocument(makeDoc(src)).map(d => d.code);
        expect(codes).not.toContain(XSTATE_DIAGNOSTIC_CODES.unknownGuard);
        expect(codes).not.toContain(XSTATE_DIAGNOSTIC_CODES.unknownAction);
    });

    it('recognizes setup actions defined with method-shorthand or shorthand syntax', () => {
        // logError uses method shorthand; ping uses shorthand property — both are
        // valid XState v5 setup forms and must not be reported as unknown.
        const src = `
            import { setup } from 'xstate';
            const ping = () => {};
            export const m = setup({
                actions: {
                    logError({ context }, params) { context.log(params); },
                    ping,
                },
            }).createMachine({
                initial: 'idle',
                states: {
                    idle: { entry: ['logError', 'ping'] },
                },
            });
        `;
        const codes = validateXStateDocument(makeDoc(src)).map(d => d.code);
        expect(codes).not.toContain(XSTATE_DIAGNOSTIC_CODES.unknownAction);
    });

    it('does not flag same-named states in different regions (scoped resolution)', () => {
        // 'idle' recurs in two regions; each is reached by a sibling target within
        // its own region. Bare-name resolution would mark one of them unreachable.
        const src = `
            createMachine({
                type: 'parallel',
                states: {
                    a: {
                        initial: 'idle',
                        states: { idle: { on: { GO: 'busy' } }, busy: {} },
                    },
                    b: {
                        initial: 'idle',
                        states: { idle: { on: { GO: 'busy' } }, busy: {} },
                    },
                },
            });
        `;
        expect(unreachable(src)).toEqual([]);
    });

    it('follows machine-root on handlers with dot-relative targets', () => {
        const src = `
            createMachine({
                initial: 'idle',
                states: { idle: {}, error: {} },
                on: { FAIL: { target: '.error' } },
            });
        `;
        expect(unreachable(src)).toEqual([]);
    });

    it('enters a compound initial even when first reached by a deep target', () => {
        // 'wrap' is reached first by the deep target 'wrap.done', then plainly via
        // 'GO'. Its initial child 'inner' must still count as reachable.
        const src = `
            createMachine({
                initial: 'start',
                states: {
                    start: { on: { JUMP: 'wrap.done', GO: 'wrap' } },
                    wrap: {
                        initial: 'inner',
                        states: { inner: {}, done: {} },
                    },
                },
            });
        `;
        expect(unreachable(src)).toEqual([]);
    });

    it('skips reachability analysis for spread-composed states', () => {
        // The states are partly external (...shared), so reachability is unknowable —
        // the checker must not guess and emit false positives.
        const src = `
            const shared = {};
            createMachine({
                initial: 'idle',
                states: { ...shared, idle: {}, lonely: {} },
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

/** Guard names flagged as unused (never referenced) by the validator. */
function unusedGuards(src: string): string[] {
    return validateXStateDocument(makeDoc(src))
        .filter(d => d.code === XSTATE_DIAGNOSTIC_CODES.unusedGuard)
        .map(d => /Guard '([^']+)'/.exec(d.message)?.[1] ?? '')
        .sort();
}

/** Guard names flagged as unknown (not defined in setup) by the validator. */
function unknownGuards(src: string): string[] {
    return validateXStateDocument(makeDoc(src))
        .filter(d => d.code === XSTATE_DIAGNOSTIC_CODES.unknownGuard)
        .map(d => /Guard '([^']+)'/.exec(d.message)?.[1] ?? '')
        .sort();
}

/** Wrap a transition `guard:` value in a minimal setup() machine that defines `names` as guards. */
function machineWithGuard(guardExpr: string, names: string[]): string {
    const guards = names.map(n => `${n}: () => true`).join(', ');
    return `
        import { setup, and, or, not, stateIn } from 'xstate';
        export const m = setup({
            guards: { ${guards} },
        }).createMachine({
            initial: 'idle',
            states: {
                idle: { on: { GO: { target: 'idle', guard: ${guardExpr} } } },
            },
        });
    `;
}

describe('guard reference resolution (and/or/not, issue #1)', () => {
    it('does not flag guards referenced via and([...])', () => {
        expect(unusedGuards(machineWithGuard(`and(['isA', 'isB'])`, ['isA', 'isB']))).toEqual([]);
    });

    it('does not flag guards referenced via or([...])', () => {
        expect(unusedGuards(machineWithGuard(`or(['isA', 'isB'])`, ['isA', 'isB']))).toEqual([]);
    });

    it('does not flag a guard referenced via not(...)', () => {
        expect(unusedGuards(machineWithGuard(`not('isA')`, ['isA']))).toEqual([]);
    });

    it('resolves guards nested inside combinators', () => {
        const src = machineWithGuard(`and(['isA', or(['isB', 'isC'])])`, ['isA', 'isB', 'isC']);
        expect(unusedGuards(src)).toEqual([]);
    });

    it('resolves the guard named by a { type, params } object', () => {
        const src = machineWithGuard(`{ type: 'isGreaterThan', params: { n: 10 } }`, ['isGreaterThan']);
        expect(unusedGuards(src)).toEqual([]);
        expect(unknownGuards(src)).toEqual([]);
    });

    it('resolves guards inside a { type: "and", params: [...] } combinator object', () => {
        const src = machineWithGuard(`{ type: 'and', params: ['isA', 'isB'] }`, ['isA', 'isB']);
        expect(unusedGuards(src)).toEqual([]);
    });

    it('still flags a genuinely unused guard alongside a used one', () => {
        const src = machineWithGuard(`and(['isA'])`, ['isA', 'lonely']);
        expect(unusedGuards(src)).toEqual(['lonely']);
    });

    it('still flags an unknown guard string referenced inside a combinator', () => {
        const src = machineWithGuard(`and(['isA', 'typo'])`, ['isA']);
        expect(unknownGuards(src)).toEqual(['typo']);
    });

    it('does not treat stateIn(...) as a guard reference', () => {
        // stateIn('active') names a *state*, not a setup guard — the string must not
        // be resolved as a guard (no spurious unknown), and a real unused guard
        // alongside it is still reported.
        const src = machineWithGuard(`and([stateIn('active'), 'isA'])`, ['isA', 'lonely']);
        expect(unknownGuards(src)).toEqual([]);
        expect(unusedGuards(src)).toEqual(['lonely']);
    });

    it('resolves object-form guards nested inside combinators (and([not({type}), not({type})]))', () => {
        const guardExpr = `and([
            not({ type: 'isServiceFail', params: { service: 'contact' } }),
            not({ type: 'isComponentFail', params: { name: 'Printer' } }),
        ])`;
        const src = machineWithGuard(guardExpr, ['isServiceFail', 'isComponentFail']);
        expect(unusedGuards(src)).toEqual([]);
        expect(unknownGuards(src)).toEqual([]);
    });

    it('resolves guards inside a combinator written with the v4 cond alias', () => {
        const src = `
            import { and } from 'xstate';
            export const m = setup({
                guards: { isA: () => true, isB: () => true },
            }).createMachine({
                initial: 'idle',
                states: {
                    idle: { on: { GO: { target: 'idle', cond: and(['isA', 'isB']) } } },
                },
            });
        `;
        expect(unusedGuards(src)).toEqual([]);
    });
});
