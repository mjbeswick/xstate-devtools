// Minimal `vscode` stand-in so parser.ts can run under Node in the harness.
// Only the surface the parser actually touches at runtime is implemented:
// Position, Range, Uri, and the TextDocument methods getText/positionAt/fileName/uri.
class Position {
    constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
    constructor(start, end) { this.start = start; this.end = end; }
}
const Uri = {
    file: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
};
module.exports = { Position, Range, Uri };
