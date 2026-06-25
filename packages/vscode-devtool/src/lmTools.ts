import * as vscode from 'vscode';
import {
    WorkspaceScanner,
    FileMachines,
    MachineNode,
    listMachines,
    describeMachine,
    machineMermaid,
    renderTestPathsMarkdown,
    validateXStateDocument,
} from '@xstate-devtools/diagram-core';

// In-editor Language Model Tools — let VS Code's agent query XState analysis
// over the workspace. All real work is delegated to the shared diagram-core
// facade (the same code the MCP server uses headlessly).

interface MachineRef { machine: MachineNode; file: string }

async function allFiles(scanner: WorkspaceScanner): Promise<FileMachines[]> {
    const cached = scanner.getCached();
    return cached.length > 0 ? cached : scanner.scanWorkspace();
}

function flatten(files: FileMachines[]): MachineRef[] {
    const out: MachineRef[] = [];
    for (const f of files) {
        for (const m of f.machines) { out.push({ machine: m, file: f.relativePath }); }
    }
    return out;
}

function findMachine(files: FileMachines[], id: string, file?: string): MachineRef | undefined {
    let cands = flatten(files).filter((x) => x.machine.label === id);
    if (file && cands.length > 1) {
        cands = cands.filter((x) => x.file.includes(file) || (x.machine.uri?.fsPath ?? '').includes(file));
    }
    return cands[0];
}

/** A resolver so nested invoked machines render in describe/diagram/test-paths. */
function invokeResolver(files: FileMachines[]): (src: string) => MachineNode | undefined {
    return (src) => findMachine(files, src)?.machine;
}

function result(text: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
}

function notFound(files: FileMachines[], id: string): vscode.LanguageModelToolResult {
    const ids = flatten(files).map((x) => x.machine.label);
    return result(`No machine "${id}" found. Available machines: ${ids.length ? ids.join(', ') : '(none in this workspace)'}.`);
}

const SEVERITY = ['Error', 'Warning', 'Info', 'Hint'];

export function registerLanguageModelTools(
    context: vscode.ExtensionContext,
    scanner: WorkspaceScanner,
): void {
    // engines.vscode is ^1.95 so lm.registerTool exists; guard anyway.
    if (!vscode.lm?.registerTool) { return; }

    const tool = <T>(name: string, invoke: (input: T, token: vscode.CancellationToken) => Promise<vscode.LanguageModelToolResult>) => {
        context.subscriptions.push(
            vscode.lm.registerTool<T>(name, {
                invoke: (options, token) => invoke(options.input, token),
            }),
        );
    };

    tool<Record<string, never>>('xstate_list_machines', async () => {
        const files = await allFiles(scanner);
        const list = listMachines(flatten(files).map((x) => x.machine));
        if (list.length === 0) { return result('No XState machines found in this workspace.'); }
        return result(JSON.stringify(list, null, 2));
    });

    tool<{ machine: string; file?: string }>('xstate_describe_machine', async ({ machine, file }) => {
        const files = await allFiles(scanner);
        const ref = findMachine(files, machine, file);
        if (!ref) { return notFound(files, machine); }
        return result(JSON.stringify(describeMachine(ref.machine, invokeResolver(files)), null, 2));
    });

    tool<{ machine: string; file?: string }>('xstate_machine_diagram', async ({ machine, file }) => {
        const files = await allFiles(scanner);
        const ref = findMachine(files, machine, file);
        if (!ref) { return notFound(files, machine); }
        return result(machineMermaid(ref.machine, invokeResolver(files)));
    });

    tool<{ machine: string; file?: string }>('xstate_test_paths', async ({ machine, file }) => {
        const files = await allFiles(scanner);
        const ref = findMachine(files, machine, file);
        if (!ref) { return notFound(files, machine); }
        return result(renderTestPathsMarkdown(ref.machine, invokeResolver(files)));
    });

    tool<{ file?: string }>('xstate_validate', async ({ file }) => {
        const files = await allFiles(scanner);
        const targets = file
            ? files.filter((f) => f.uri.fsPath.includes(file) || f.relativePath.includes(file))
            : files;
        if (targets.length === 0) { return result(file ? `No XState file matching "${file}".` : 'No XState files to validate.'); }

        const blocks: string[] = [];
        let total = 0;
        for (const f of targets) {
            const doc = await vscode.workspace.openTextDocument(f.uri);
            const diags = validateXStateDocument(doc);
            if (diags.length === 0) { continue; }
            total += diags.length;
            const lines = diags.map((d) => {
                const sev = SEVERITY[d.severity as number] ?? 'Info';
                return `  [${sev}] ${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message}`;
            });
            blocks.push(`${f.relativePath}\n${lines.join('\n')}`);
        }
        if (total === 0) { return result(`No XState problems found in ${targets.length} file(s).`); }
        return result(`${total} problem(s):\n\n${blocks.join('\n\n')}`);
    });
}
