import * as vscode from 'vscode';
import { WorkspaceScanner } from './workspaceScanner';
import { isSupportedXStateDocument, validateXStateDocument } from './diagnostics';

export type ErrorsGrouping = 'file' | 'severity' | 'flat';

/** One file's validated diagnostics, cached by document version. */
interface FileDiagnostics {
    uri: vscode.Uri;
    relativePath: string;
    version: number;
    diagnostics: vscode.Diagnostic[];
}

/** Drop diagnostics that are identical in position, code, and message. */
function dedupeDiagnostics(diagnostics: vscode.Diagnostic[]): vscode.Diagnostic[] {
    const seen = new Set<string>();
    const out: vscode.Diagnostic[] = [];
    for (const d of diagnostics) {
        const key = `${d.code}|${d.range.start.line}:${d.range.start.character}|${d.message}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        out.push(d);
    }
    return out;
}

type FileGroupRow = { kind: 'file'; uri: vscode.Uri; relativePath: string; count: number };
type SeverityGroupRow = { kind: 'severity'; severity: vscode.DiagnosticSeverity; count: number };
type IssueRow = { kind: 'issue'; uri: vscode.Uri; relativePath: string; diagnostic: vscode.Diagnostic };
type Hint = { kind: 'hint'; text: string };
type ErrorNode = FileGroupRow | SeverityGroupRow | IssueRow | Hint;

/** Severity render order (errors first) and their display metadata. */
const SEVERITY_META: Array<{
    severity: vscode.DiagnosticSeverity;
    label: string;
    icon: string;
    color?: vscode.ThemeColor;
}> = [
    { severity: vscode.DiagnosticSeverity.Error, label: 'Errors', icon: 'error', color: new vscode.ThemeColor('testing.iconFailed') },
    { severity: vscode.DiagnosticSeverity.Warning, label: 'Warnings', icon: 'warning', color: new vscode.ThemeColor('testing.iconQueued') },
    { severity: vscode.DiagnosticSeverity.Information, label: 'Info', icon: 'info' },
    { severity: vscode.DiagnosticSeverity.Hint, label: 'Hints', icon: 'info' },
];

function severityMeta(severity: vscode.DiagnosticSeverity) {
    return SEVERITY_META.find(m => m.severity === severity) ?? SEVERITY_META[1];
}

/** A single issue as a paste-friendly line: `path:line:col - message`. */
function formatIssue(relativePath: string, d: vscode.Diagnostic): string {
    const { line, character } = d.range.start;
    return `${relativePath}:${line + 1}:${character + 1} - ${d.message}`;
}

/**
 * "Errors" pane — aggregates every XState diagnostic produced by
 * `validateXStateDocument` (orphaned states, unknown refs, duplicate ids, invalid
 * properties, …) into a navigable tree. Reuses the validator as its data source;
 * it adds no validation logic of its own. Scope follows the outline's file/workspace
 * toggle; grouping (by file / by severity / flat) is user-selectable.
 */
export class ErrorsTreeProvider implements vscode.TreeDataProvider<ErrorNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<ErrorNode | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** Latest validated diagnostics in scope, keyed by canonical file path
     * (fsPath) so a file arriving under two URI representations can't double up. */
    private results = new Map<string, FileDiagnostics>();
    private grouping: ErrorsGrouping;

    constructor(
        private readonly getScope: () => 'file' | 'workspace',
        private readonly workspaceScanner: WorkspaceScanner,
        initialGrouping: ErrorsGrouping,
    ) {
        this.grouping = initialGrouping;
    }

    setGrouping(grouping: ErrorsGrouping): void {
        if (this.grouping === grouping) { return; }
        this.grouping = grouping;
        this._onDidChangeTreeData.fire();
    }

    /** Total issues across all in-scope files — used for the view badge. */
    totalCount(): number {
        let n = 0;
        for (const fd of this.results.values()) { n += fd.diagnostics.length; }
        return n;
    }

    /** Clipboard text for a node: a single issue, or every issue under a group. */
    copyText(node: ErrorNode): string {
        if (node.kind === 'issue') {
            return formatIssue(node.relativePath, node.diagnostic);
        }
        if (node.kind === 'file') {
            const fd = this.results.get(node.uri.fsPath);
            if (!fd) { return ''; }
            return [node.relativePath, ...fd.diagnostics.map(d => '  ' + formatIssue(node.relativePath, d))].join('\n');
        }
        if (node.kind === 'severity') {
            const lines: string[] = [];
            for (const fd of this.results.values()) {
                for (const d of fd.diagnostics) {
                    if (d.severity === node.severity) { lines.push('  ' + formatIssue(fd.relativePath, d)); }
                }
            }
            return [severityMeta(node.severity).label, ...lines].join('\n');
        }
        return '';
    }

    /** Re-validate the in-scope documents and refresh the tree. */
    async refresh(): Promise<void> {
        const next = new Map<string, FileDiagnostics>();

        if (this.getScope() === 'workspace') {
            for (const fm of this.workspaceScanner.getCached()) {
                const entry = await this.validateUri(fm.uri, fm.relativePath);
                if (entry && entry.diagnostics.length > 0) { next.set(fm.uri.fsPath, entry); }
            }
        } else {
            const editor = vscode.window.activeTextEditor;
            if (editor && isSupportedXStateDocument(editor.document)) {
                const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false);
                const diagnostics = dedupeDiagnostics(validateXStateDocument(editor.document));
                if (diagnostics.length > 0) {
                    next.set(editor.document.uri.fsPath, {
                        uri: editor.document.uri, relativePath, version: editor.document.version, diagnostics,
                    });
                }
            }
        }

        this.results = next;
        this._onDidChangeTreeData.fire();
    }

    /** Validate a single uri, reusing the cached result when the version is unchanged. */
    private async validateUri(uri: vscode.Uri, relativePath: string): Promise<FileDiagnostics | undefined> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            if (!isSupportedXStateDocument(document)) { return undefined; }
            const cached = this.results.get(uri.fsPath);
            if (cached && cached.version === document.version) { return cached; }
            return { uri, relativePath, version: document.version, diagnostics: dedupeDiagnostics(validateXStateDocument(document)) };
        } catch {
            return undefined;
        }
    }

    getChildren(el?: ErrorNode): ErrorNode[] {
        if (!el) { return this.rootChildren(); }
        if (el.kind === 'file') {
            const fd = this.results.get(el.uri.fsPath);
            if (!fd) { return []; }
            return fd.diagnostics.map(d => this.issueRow(el.uri, el.relativePath, d));
        }
        if (el.kind === 'severity') {
            const rows: IssueRow[] = [];
            for (const fd of this.results.values()) {
                for (const d of fd.diagnostics) {
                    if (d.severity === el.severity) { rows.push(this.issueRow(fd.uri, fd.relativePath, d)); }
                }
            }
            return rows;
        }
        return [];
    }

    private rootChildren(): ErrorNode[] {
        if (this.totalCount() === 0) {
            return [{ kind: 'hint', text: 'No XState problems found' }];
        }

        if (this.grouping === 'file') {
            const rows: FileGroupRow[] = [];
            for (const fd of this.results.values()) {
                rows.push({ kind: 'file', uri: fd.uri, relativePath: fd.relativePath, count: fd.diagnostics.length });
            }
            return rows.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
        }

        if (this.grouping === 'severity') {
            const counts = new Map<vscode.DiagnosticSeverity, number>();
            for (const fd of this.results.values()) {
                for (const d of fd.diagnostics) { counts.set(d.severity, (counts.get(d.severity) ?? 0) + 1); }
            }
            return SEVERITY_META
                .filter(m => counts.has(m.severity))
                .map(m => ({ kind: 'severity', severity: m.severity, count: counts.get(m.severity)! } as SeverityGroupRow));
        }

        // flat
        const rows: IssueRow[] = [];
        for (const fd of this.results.values()) {
            for (const d of fd.diagnostics) { rows.push(this.issueRow(fd.uri, fd.relativePath, d)); }
        }
        return rows;
    }

    private issueRow(uri: vscode.Uri, relativePath: string, diagnostic: vscode.Diagnostic): IssueRow {
        return { kind: 'issue', uri, relativePath, diagnostic };
    }

    getTreeItem(node: ErrorNode): vscode.TreeItem {
        if (node.kind === 'hint') {
            const item = new vscode.TreeItem(node.text);
            item.description = '';
            return item;
        }

        if (node.kind === 'file') {
            const item = new vscode.TreeItem(node.relativePath, vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${node.count}`;
            item.iconPath = new vscode.ThemeIcon('file');
            item.resourceUri = node.uri;
            item.tooltip = node.uri.fsPath;
            item.contextValue = 'errorFileGroup';
            return item;
        }

        if (node.kind === 'severity') {
            const meta = severityMeta(node.severity);
            const item = new vscode.TreeItem(meta.label, vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${node.count}`;
            item.iconPath = new vscode.ThemeIcon(meta.icon, meta.color);
            item.contextValue = 'errorSeverityGroup';
            return item;
        }

        // issue row
        const meta = severityMeta(node.diagnostic.severity);
        const item = new vscode.TreeItem(node.diagnostic.message);
        item.contextValue = 'errorIssue';
        item.iconPath = new vscode.ThemeIcon(meta.icon, meta.color);
        const line = node.diagnostic.range.start.line + 1;
        // Under a file group the parent already names the file; otherwise show it
        // so issues from different files are never visually identical.
        item.description = this.grouping === 'file' ? `${line}` : `${node.relativePath}:${line}`;
        item.tooltip = `${node.diagnostic.message}\n${node.relativePath}:${line}`;
        item.command = {
            command: 'xstateErrors.open',
            title: 'Go to Problem',
            arguments: [node.uri, node.diagnostic.range],
        };
        return item;
    }
}
