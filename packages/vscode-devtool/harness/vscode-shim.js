// Minimal `vscode` stand-in so parser.ts can run under Node in the harness.
// Only the surface the parser actually touches at runtime is implemented:
// Position, Range, Uri, and the TextDocument methods getText/positionAt/fileName/uri.
class Position {
    constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
    constructor(start, end) { this.start = start; this.end = end; }
    contains(posOrRange) {
        // Accept a Position or a Range, like vscode.Range.contains.
        const lo = posOrRange.start ?? posOrRange;
        const hi = posOrRange.end ?? posOrRange;
        const afterStart = lo.line > this.start.line ||
            (lo.line === this.start.line && lo.character >= this.start.character);
        const beforeEnd = hi.line < this.end.line ||
            (hi.line === this.end.line && hi.character <= this.end.character);
        return afterStart && beforeEnd;
    }
}
const Uri = {
    file: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
};
module.exports = { Position, Range, Uri };
