// Minimal `vscode` stand-in so the shared diagram-core parser/diagnostics run
// in a headless Node process. esbuild aliases `vscode` to this module; only the
// surface those modules touch is implemented (Position/Range/Uri/Diagnostic).
export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
    public readonly start: Position;
    public readonly end: Position;
    constructor(start: Position, end: Position);
    constructor(startLine: number, startChar: number, endLine: number, endChar: number);
    constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
        if (typeof a === 'number') {
            this.start = new Position(a, b as number);
            this.end = new Position(c as number, d as number);
        } else {
            this.start = a;
            this.end = b as Position;
        }
    }
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

export enum DiagnosticSeverity { Error = 0, Warning = 1, Information = 2, Hint = 3 }

export enum DiagnosticTag { Unnecessary = 1, Deprecated = 2 }

export class Diagnostic {
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error;
    public source?: string;
    public code?: string | number;
    public tags?: DiagnosticTag[];
    constructor(public range: Range, public message: string, severity?: DiagnosticSeverity) {
        if (severity !== undefined) { this.severity = severity; }
    }
}
