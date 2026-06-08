// Minimal `vscode` stand-in for unit-testing pure modules (the parser) without
// the VS Code runtime. Only the surface the parser touches is implemented:
// Position, Range, and Uri. Aliased in for `vscode` via vitest.config.ts.
export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
    contains(posOrRange: Position | Range): boolean {
        const lo = posOrRange instanceof Range ? posOrRange.start : posOrRange;
        const hi = posOrRange instanceof Range ? posOrRange.end : posOrRange;
        const afterStart = lo.line > this.start.line ||
            (lo.line === this.start.line && lo.character >= this.start.character);
        const beforeEnd = hi.line < this.end.line ||
            (hi.line === this.end.line && hi.character <= this.end.character);
        return afterStart && beforeEnd;
    }
}

export const Uri = {
    file: (p: string) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
};
