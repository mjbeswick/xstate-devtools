import * as vscode from 'vscode';
import * as ts from 'typescript';

export class ImplementationFinder {

    static async findImplementation(
        functionName: string,
        document: vscode.TextDocument
    ): Promise<{ range: vscode.Range; document: vscode.TextDocument } | null> {
        // 1. Current document
        const local = this.findInDocument(functionName, document);
        if (local) { return { range: local, document }; }

        // 2. All directly imported files
        const imported = await this.findInAllImports(functionName, document);
        if (imported) { return imported; }

        // 3. Workspace symbol search via TypeScript language server
        const ws = await this.findViaWorkspaceSymbols(functionName, document);
        if (ws) { return ws; }

        // 4. Workspace text search — catches property keys in object literals
        //    (not indexed as workspace symbols by the TS server)
        const text = await this.findViaTextSearch(functionName, document);
        if (text) { return text; }

        return null;
    }

    // ── Workspace symbol provider (most reliable) ──────────────────────────────

    private static async findViaWorkspaceSymbols(
        functionName: string,
        preferredDocument: vscode.TextDocument
    ): Promise<{ range: vscode.Range; document: vscode.TextDocument } | null> {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
            'vscode.executeWorkspaceSymbolProvider',
            functionName
        );
        if (!symbols || symbols.length === 0) { return null; }

        const preferred = [
            vscode.SymbolKind.Function,
            vscode.SymbolKind.Method,
            vscode.SymbolKind.Variable,
            vscode.SymbolKind.Constant,
        ];

        // Exact name match, prefer function-like kinds, prefer same workspace folder
        const exact = symbols.filter(s => s.name === functionName);
        if (exact.length === 0) { return null; }

        const ranked = exact.sort((a, b) => {
            const ai = preferred.indexOf(a.kind);
            const bi = preferred.indexOf(b.kind);
            const aScore = ai === -1 ? 99 : ai;
            const bScore = bi === -1 ? 99 : bi;
            // Prefer same file
            const sameA = a.location.uri.fsPath === preferredDocument.uri.fsPath ? -1 : 0;
            const sameB = b.location.uri.fsPath === preferredDocument.uri.fsPath ? -1 : 0;
            return (aScore + sameA) - (bScore + sameB);
        });

        const best = ranked[0];
        try {
            const doc = await vscode.workspace.openTextDocument(best.location.uri);
            return { range: best.location.range, document: doc };
        } catch {
            return null;
        }
    }

    // ── Workspace text search — finds property keys not indexed as symbols ──────

    private static async findViaTextSearch(
        functionName: string,
        preferredDocument: vscode.TextDocument
    ): Promise<{ range: vscode.Range; document: vscode.TextDocument } | null> {
        const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Matches the name as a property key (with or without quotes) followed by a colon,
        // or as a function/const declaration — but NOT a plain usage/import
        const pattern = new RegExp(
            `(?:^|[\\s{,])(?:['"]?${escaped}['"]?\\s*:|` +
            `(?:function\\s+${escaped}\\s*\\()|` +
            `(?:(?:const|let|var)\\s+${escaped}\\s*=))`,
            'm'
        );

        const files = await vscode.workspace.findFiles(
            '**/*.{ts,tsx,js,jsx}',
            '**/node_modules/**'
        );

        const srcDir = preferredDocument.uri.fsPath.replace(/[/\\][^/\\]+$/, '');
        const sorted = [...files].sort((a, b) => {
            // Prefer files in the same directory first
            const aClose = a.fsPath.startsWith(srcDir) ? 0 : 1;
            const bClose = b.fsPath.startsWith(srcDir) ? 0 : 1;
            return aClose - bClose;
        });

        for (const uri of sorted) {
            if (uri.fsPath === preferredDocument.uri.fsPath) { continue; }
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const text = doc.getText();
                const match = pattern.exec(text);
                if (match) {
                    // Find the position of the actual name within the match
                    const nameIdx = match.index + match[0].indexOf(functionName);
                    const pos = doc.positionAt(nameIdx);
                    return { range: new vscode.Range(pos, pos), document: doc };
                }
            } catch { /* skip unreadable files */ }
        }
        return null;
    }

    // ── AST search in a single document ───────────────────────────────────────

    private static findInDocument(
        functionName: string,
        document: vscode.TextDocument
    ): vscode.Range | null {
        const source = ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true
        );

        return (
            this.findInMachineOptions(source, functionName, document) ??
            this.findFunctionDeclaration(source, functionName, document) ??
            this.findVariableFunction(source, functionName, document)
        );
    }

    // ── Search all imported files ──────────────────────────────────────────────

    private static async findInAllImports(
        functionName: string,
        document: vscode.TextDocument
    ): Promise<{ range: vscode.Range; document: vscode.TextDocument } | null> {
        const source = ts.createSourceFile(
            document.fileName,
            document.getText(),
            ts.ScriptTarget.Latest,
            true
        );

        const docDir = document.fileName.substring(0, document.fileName.lastIndexOf('/'));
        const candidates: vscode.Uri[] = [];

        ts.forEachChild(source, node => {
            if (
                ts.isImportDeclaration(node) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier)
            ) {
                const importPath = node.moduleSpecifier.text;
                if (!importPath.startsWith('.')) { return; } // skip node_modules

                const resolved = `${docDir}/${importPath}`;
                for (const ext of ['.ts', '.tsx', '.js', '.jsx', '']) {
                    candidates.push(vscode.Uri.file(resolved + ext));
                }
            }
        });

        for (const uri of candidates) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const range = this.findInDocument(functionName, doc);
                if (range) { return { range, document: doc }; }
            } catch {
                // file doesn't exist with this extension
            }
        }

        return null;
    }

    // ── AST helpers ────────────────────────────────────────────────────────────

    private static findInMachineOptions(
        source: ts.SourceFile,
        functionName: string,
        document: vscode.TextDocument
    ): vscode.Range | null {
        let result: vscode.Range | null = null;

        const visit = (node: ts.Node) => {
            if (result) { return; }

            if (ts.isCallExpression(node)) {
                const text = node.expression.getText();
                const isSetup = text === 'setup' || text.endsWith('.setup');
                const isMachine = text === 'createMachine' || text === 'Machine' ||
                    text.endsWith('.createMachine') || text.endsWith('.Machine');

                if (isSetup && node.arguments.length >= 1) {
                    const arg = node.arguments[0];
                    if (ts.isObjectLiteralExpression(arg)) {
                        result = this.searchInOptions(arg, functionName, document);
                    }
                }
                if (isMachine && node.arguments.length >= 2) {
                    const opts = node.arguments[1];
                    if (ts.isObjectLiteralExpression(opts)) {
                        result = this.searchInOptions(opts, functionName, document);
                    }
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(source);
        return result;
    }

    private static searchInOptions(
        options: ts.ObjectLiteralExpression,
        functionName: string,
        document: vscode.TextDocument
    ): vscode.Range | null {
        const sections = ['actions', 'guards', 'services', 'activities', 'delays', 'actors'];

        for (const prop of options.properties) {
            if (
                ts.isPropertyAssignment(prop) &&
                ts.isIdentifier(prop.name) &&
                sections.includes(prop.name.text) &&
                ts.isObjectLiteralExpression(prop.initializer)
            ) {
                for (const fp of prop.initializer.properties) {
                    const name =
                        ts.isPropertyAssignment(fp) || ts.isMethodDeclaration(fp) || ts.isShorthandPropertyAssignment(fp)
                            ? ts.isIdentifier(fp.name) ? fp.name.text
                            : ts.isStringLiteral(fp.name) ? fp.name.text
                            : null
                            : null;

                    if (name === functionName) {
                        return this.nodeToRange(fp.name as ts.Node, document);
                    }
                }
            }
        }
        return null;
    }

    private static findFunctionDeclaration(
        source: ts.SourceFile,
        functionName: string,
        document: vscode.TextDocument
    ): vscode.Range | null {
        let result: vscode.Range | null = null;
        const visit = (node: ts.Node) => {
            if (result) { return; }
            if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
                result = this.nodeToRange(node, document);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        return result;
    }

    private static findVariableFunction(
        source: ts.SourceFile,
        functionName: string,
        document: vscode.TextDocument
    ): vscode.Range | null {
        let result: vscode.Range | null = null;
        const visit = (node: ts.Node) => {
            if (result) { return; }
            if (
                ts.isVariableDeclaration(node) &&
                ts.isIdentifier(node.name) &&
                node.name.text === functionName &&
                node.initializer &&
                (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
            ) {
                result = this.nodeToRange(node, document);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        return result;
    }

    static extractFunctionName(label: string): string | null {
        const match =
            label.match(/(?:entry|exit|action|guard):\s*(.+)/) ??
            label.match(/^(.+)$/);
        return match ? match[1].trim() : null;
    }

    private static nodeToRange(node: ts.Node, document: vscode.TextDocument): vscode.Range {
        return new vscode.Range(
            document.positionAt(node.getStart()),
            document.positionAt(node.getEnd())
        );
    }
}
