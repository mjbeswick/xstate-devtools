// packages/vscode-extension/src/debugger/debuggerSetup.ts
//
// Detects how ready the current workspace is for the live debugger and exposes
// it via the `xstateDebugger.setup` context key, which drives the tailored
// help text in the disconnected Instances panel (see package.json viewsWelcome).
//
// Ladder: no-xstate → no-adapter → no-server-adapter → inspect-not-wired → ready.
import * as vscode from 'vscode';
import * as ts from 'typescript';
import { WorkspaceScanner, SCAN_EXCLUDE_GLOB } from '../workspaceScanner';

export type DebuggerSetupState =
    | 'unknown'
    | 'no-xstate'
    | 'no-adapter'
    | 'no-server-adapter'
    | 'inspect-not-wired'
    | 'ready';

const SOURCE_SCAN_CAP = 2000;

export class DebuggerSetupDetector implements vscode.Disposable {
    private state: DebuggerSetupState = 'unknown';
    private running: Promise<void> | null = null;

    constructor(private readonly scanner: WorkspaceScanner) {}

    getState(): DebuggerSetupState {
        return this.state;
    }

    /** Recompute the setup state and publish it to the context key (deduped). */
    refresh(): Promise<void> {
        if (this.running) { return this.running; }
        this.running = this.detect()
            .then((next) => this.apply(next))
            .catch(() => this.apply('unknown'))
            .finally(() => { this.running = null; });
        return this.running;
    }

    private async apply(next: DebuggerSetupState): Promise<void> {
        this.state = next;
        await vscode.commands.executeCommand('setContext', 'xstateDebugger.setup', next);
    }

    private async detect(): Promise<DebuggerSetupState> {
        const pkgs = await this.readPackageJsons();
        const hasDep = (name: string) => pkgs.some((deps) => name in deps);

        const usesXState = this.scanner.getCached().some((f) => f.machines.length > 0) || hasDep('xstate');
        if (!usesXState) { return 'no-xstate'; }
        if (!hasDep('@xstate-devtools/adapter')) { return 'no-adapter'; }

        const { hasServerAdapter, hasInspectWired } = await this.scanSource();
        if (!hasServerAdapter) { return 'no-server-adapter'; }
        if (!hasInspectWired) { return 'inspect-not-wired'; }
        return 'ready';
    }

    private async readPackageJsons(): Promise<Array<Record<string, unknown>>> {
        const files = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**', 50);
        const out: Array<Record<string, unknown>> = [];
        for (const uri of files) {
            try {
                const pkg = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
                out.push({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
            } catch { /* ignore unreadable/malformed */ }
        }
        return out;
    }

    private async scanSource(): Promise<{ hasServerAdapter: boolean; hasInspectWired: boolean }> {
        const files = await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx}', SCAN_EXCLUDE_GLOB, SOURCE_SCAN_CAP);
        let hasServerAdapter = false;
        let hasInspectWired = false;
        // Read in bounded-concurrency batches (not 2000 reads at once → no FD
        // exhaustion), and stop at the first batch boundary once both markers
        // are found so the common case still short-circuits early.
        const BATCH = 16;
        for (let i = 0; i < files.length && !(hasServerAdapter && hasInspectWired); i += BATCH) {
            const batch = files.slice(i, i + BATCH);
            const texts = await Promise.all(batch.map(async (uri) => {
                try { return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'); }
                catch { return null; }
            }));
            for (let j = 0; j < texts.length; j++) {
                const text = texts[j];
                if (!text) { continue; }
                if (!hasServerAdapter && text.includes('createServerAdapter')) { hasServerAdapter = true; }
                if (!hasInspectWired && text.includes('createActor') && text.includes('inspect')) {
                    if (fileWiresInspect(batch[j].fsPath, text)) { hasInspectWired = true; }
                }
            }
        }
        return { hasServerAdapter, hasInspectWired };
    }

    dispose(): void {
        // No owned resources; triggers/watchers are disposed by the caller.
    }
}

/** True if the file calls `createActor(…, { inspect … })` (the correct wiring). */
function fileWiresInspect(fsPath: string, text: string): boolean {
    let wired = false;
    const sf = ts.createSourceFile(fsPath, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
        if (wired) { return; }
        if (ts.isCallExpression(node)) {
            const name = ts.isIdentifier(node.expression) ? node.expression.text
                : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
                    : '';
            if ((name === 'createActor' || name === 'interpret') && node.arguments.length >= 2) {
                const opts = node.arguments[node.arguments.length - 1];
                if (ts.isObjectLiteralExpression(opts) && opts.properties.some(hasInspectProp)) {
                    wired = true;
                    return;
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return wired;
}

function hasInspectProp(p: ts.ObjectLiteralElementLike): boolean {
    const n = p.name;
    if (!n) { return false; }
    if (ts.isIdentifier(n)) { return n.text === 'inspect'; }
    if (ts.isStringLiteral(n)) { return n.text === 'inspect'; }
    return false;
}
