import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import fg from 'fast-glob';

export interface ImplementationHit { file: string; line: number; snippet: string }

const SECTIONS = ['actions', 'guards', 'services', 'activities', 'delays', 'actors'];

/**
 * Resolve a bare action/guard/actor name to its source definition.
 * Headless port of the VS Code extension's ImplementationFinder — same fallback
 * chain minus the workspace-symbol-provider tier (no TS language service here).
 */
export function findImplementation(root: string, name: string, startFile?: string): ImplementationHit | null {
    const files = fg.sync(['**/*.{ts,tsx,js,jsx,mts,cts}'], {
        cwd: root,
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.next/**', '**/build/**'],
    });
    if (files.length === 0) { return null; }

    const start = startFile ? files.find((f) => f.includes(startFile)) ?? files[0] : files[0];

    const inStart = findInFile(start, name);
    if (inStart) { return inStart; }

    const inImports = findInImports(start, name);
    if (inImports) { return inImports; }

    return findViaTextSearch(files, start, name);
}

function findInFile(file: string, name: string): ImplementationHit | null {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    const pos = findPositionInSource(file, text, name);
    return pos === null ? null : toHit(file, text, pos);
}

function findInImports(fromFile: string, name: string): ImplementationHit | null {
    let text: string;
    try { text = fs.readFileSync(fromFile, 'utf8'); } catch { return null; }
    const source = ts.createSourceFile(fromFile, text, ts.ScriptTarget.Latest, true);
    const dir = path.dirname(fromFile);
    const candidates: string[] = [];

    ts.forEachChild(source, (node) => {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) { return; }
        const spec = node.moduleSpecifier.text;
        if (!spec.startsWith('.')) { return; } // skip node_modules
        const resolved = path.resolve(dir, spec);
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '']) {
            candidates.push(resolved + ext);
        }
    });

    for (const file of candidates) {
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { continue; }
        const hit = findInFile(file, name);
        if (hit) { return hit; }
    }
    return null;
}

function findViaTextSearch(files: string[], preferredFile: string, name: string): ImplementationHit | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Property key (quoted or not) followed by a colon, a function/const declaration,
    // or an object-literal shorthand method `name(` — not a plain call/import.
    const pattern = new RegExp(
        `(?:^|[\\s{,])(?:['"]?${escaped}['"]?\\s*:|` +
        `(?:function\\s+${escaped}\\s*\\()|` +
        `(?:(?:const|let|var)\\s+${escaped}\\s*=))` +
        `|(?:^|[{,])\\s*${escaped}\\s*\\(`,
        'm'
    );

    const dir = path.dirname(preferredFile);
    const sorted = [...files].sort((a, b) => {
        const aClose = a.startsWith(dir) ? 0 : 1;
        const bClose = b.startsWith(dir) ? 0 : 1;
        return aClose - bClose;
    });

    for (const file of sorted) {
        if (file === preferredFile) { continue; }
        let text: string;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const match = pattern.exec(text);
        if (!match) { continue; }
        const idx = match.index + match[0].indexOf(name);
        return toHit(file, text, idx);
    }
    return null;
}

// ── AST search within one file's source ────────────────────────────────────

function findPositionInSource(file: string, text: string, name: string): number | null {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    return (
        findInMachineOptions(source, name) ??
        findFunctionDeclaration(source, name) ??
        findVariableFunction(source, name)
    );
}

function findInMachineOptions(source: ts.SourceFile, name: string): number | null {
    let result: number | null = null;
    const visit = (node: ts.Node) => {
        if (result !== null) { return; }
        if (ts.isCallExpression(node)) {
            const text = node.expression.getText();
            const isSetup = text === 'setup' || text.endsWith('.setup');
            const isMachine = text === 'createMachine' || text === 'Machine' ||
                text.endsWith('.createMachine') || text.endsWith('.Machine');
            if (isSetup && node.arguments.length >= 1 && ts.isObjectLiteralExpression(node.arguments[0])) {
                result = searchInOptions(node.arguments[0] as ts.ObjectLiteralExpression, name);
            }
            if (isMachine && node.arguments.length >= 2 && ts.isObjectLiteralExpression(node.arguments[1])) {
                result = searchInOptions(node.arguments[1] as ts.ObjectLiteralExpression, name);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return result;
}

function searchInOptions(options: ts.ObjectLiteralExpression, name: string): number | null {
    for (const prop of options.properties) {
        if (
            !ts.isPropertyAssignment(prop) ||
            !ts.isIdentifier(prop.name) ||
            !SECTIONS.includes(prop.name.text) ||
            !ts.isObjectLiteralExpression(prop.initializer)
        ) { continue; }

        for (const fp of prop.initializer.properties) {
            const fname =
                ts.isPropertyAssignment(fp) || ts.isMethodDeclaration(fp) || ts.isShorthandPropertyAssignment(fp)
                    ? ts.isIdentifier(fp.name) ? fp.name.text
                    : ts.isStringLiteral(fp.name) ? fp.name.text
                    : null
                    : null;
            if (fname === name) { return (fp.name as ts.Node).getStart(); }
        }
    }
    return null;
}

function findFunctionDeclaration(source: ts.SourceFile, name: string): number | null {
    let result: number | null = null;
    const visit = (node: ts.Node) => {
        if (result !== null) { return; }
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) { result = node.getStart(); }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return result;
}

function findVariableFunction(source: ts.SourceFile, name: string): number | null {
    let result: number | null = null;
    const visit = (node: ts.Node) => {
        if (result !== null) { return; }
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === name &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) { result = node.getStart(); }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return result;
}

function toHit(file: string, text: string, charIndex: number): ImplementationHit {
    const before = text.slice(0, charIndex);
    const line = before.split('\n').length - 1; // 0-based
    const lines = text.split('\n');
    const end = Math.min(line + 5, lines.length - 1);
    return { file, line: line + 1, snippet: lines.slice(line, end + 1).join('\n') };
}
