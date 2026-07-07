import * as vscode from 'vscode';
import { MachineNode, XStateMachineParser } from './parser';
import { validateXStateDocument, computeSetupCoverage, type SetupCoverage } from './diagnostics';

// Build the minimal TextDocument the parser/diagnostics actually use
// (getText/fileName/languageId/uri/positionAt/offsetAt) from raw source — no
// real VS Code. In a headless build, `vscode` is aliased to a stub providing
// Position/Range/Uri/Diagnostic/DiagnosticSeverity/DiagnosticTag.
function makeDoc(fileName: string, text: string, languageId = 'typescript'): vscode.TextDocument {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') { lineStarts.push(i + 1); }
    }
    return {
        getText: () => text,
        fileName,
        languageId,
        uri: vscode.Uri.file(fileName),
        positionAt(offset: number) {
            let lo = 0, hi = lineStarts.length - 1;
            while (lo < hi) {
                const m = (lo + hi + 1) >> 1;
                if (lineStarts[m] <= offset) { lo = m; } else { hi = m - 1; }
            }
            return new vscode.Position(lo, offset - lineStarts[lo]);
        },
        offsetAt(position: { line: number; character: number }) {
            const base = lineStarts[Math.min(position.line, lineStarts.length - 1)] ?? 0;
            return base + position.character;
        },
    } as unknown as vscode.TextDocument;
}

/** Parse XState machines from raw source, no VS Code TextDocument needed. */
export function parseSource(fileName: string, text: string): MachineNode[] {
    return XStateMachineParser.parseMachines(makeDoc(fileName, text));
}

/** setup() coverage for one machine from raw source. `machinePos` (a parsed
 *  MachineNode's `range.start`) selects the machine when a file has several. */
export function setupCoverageSource(fileName: string, text: string, machinePos?: { line: number; character: number }): SetupCoverage | undefined {
    const doc = makeDoc(fileName, text);
    return computeSetupCoverage(doc, machinePos ? doc.offsetAt(machinePos as vscode.Position) : undefined);
}

export interface PlainDiagnostic {
    code: string;
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    line: number;        // 1-based for human/agent display
    character: number;   // 1-based
    endLine: number;
    endCharacter: number;
}

const SEVERITY_NAME: Record<number, PlainDiagnostic['severity']> = { 0: 'error', 1: 'warning', 2: 'info', 3: 'hint' };

/** Run the XState diagnostics over raw source, returning plain serializable
 *  results (no vscode types leak out). */
export function validateSource(fileName: string, text: string, languageId = 'typescript'): PlainDiagnostic[] {
    const diags = validateXStateDocument(makeDoc(fileName, text, languageId));
    return diags.map((d) => {
        const code = (d.code && typeof d.code === 'object' ? (d.code as { value?: unknown }).value : d.code) ?? '';
        return {
            code: String(code),
            message: d.message,
            severity: SEVERITY_NAME[d.severity as number] ?? 'info',
            line: d.range.start.line + 1,
            character: d.range.start.character + 1,
            endLine: d.range.end.line + 1,
            endCharacter: d.range.end.character + 1,
        };
    });
}
