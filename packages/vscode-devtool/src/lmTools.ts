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
    fuzzyMatch,
    findReferences,
    listEvents,
    stateDetail,
    computeSetupCoverage,
} from '@xstate-devtools/diagram-core';
import { ImplementationFinder } from './implementationFinder';

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

const line1 = (m: MachineNode): number => (m.range ? m.range.start.line + 1 : 0);

/** Resolve an id to a single machine, or an explanatory result the tool can return
 *  directly — a candidate list when ambiguous, a fuzzy-suggested not-found otherwise. */
function resolve(
    files: FileMachines[],
    id: string,
    file?: string,
): { ref?: MachineRef; error?: vscode.LanguageModelToolResult } {
    let cands = flatten(files).filter((x) => x.machine.label === id);
    if (cands.length === 0) { return { error: notFound(files, id) }; }
    if (file) {
        const narrowed = cands.filter((x) => x.file.includes(file) || (x.machine.uri?.fsPath ?? '').includes(file));
        if (narrowed.length > 0) { cands = narrowed; }
    }
    if (cands.length > 1) {
        const list = cands.map((c) => `  ${c.file}:${line1(c.machine)}`).join('\n');
        return { error: result(`Multiple machines named "${id}". Pass "file" to disambiguate:\n${list}`) };
    }
    return { ref: cands[0] };
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
    const best = ids
        .map((c) => ({ c, m: fuzzyMatch(id, c) }))
        .filter((x): x is { c: string; m: NonNullable<typeof x.m> } => x.m !== null)
        .sort((a, b) => b.m.score - a.m.score)[0];
    const hint = best ? `Did you mean "${best.c}"? ` : '';
    return result(`No machine "${id}" found. ${hint}Available machines: ${ids.length ? ids.join(', ') : '(none in this workspace)'}.`);
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
        const refs = flatten(files);
        if (refs.length === 0) { return result('No XState machines found in this workspace.'); }
        // Terse one line per machine (relative paths) — far cheaper than pretty JSON.
        const sums = listMachines(refs.map((x) => x.machine));
        const lines = refs.map((r, i) => `${r.machine.label} — ${r.file}:${sums[i].line ?? line1(r.machine)} (${sums[i].stateCount} states)`);
        return result(lines.join('\n'));
    });

    tool<{ machine: string; file?: string }>('xstate_describe_machine', async ({ machine, file }) => {
        const files = await allFiles(scanner);
        const r = resolve(files, machine, file);
        if (r.error) { return r.error; }
        return result(JSON.stringify(describeMachine(r.ref!.machine, invokeResolver(files))));
    });

    tool<{ machine: string; file?: string }>('xstate_machine_diagram', async ({ machine, file }) => {
        const files = await allFiles(scanner);
        const r = resolve(files, machine, file);
        if (r.error) { return r.error; }
        return result(machineMermaid(r.ref!.machine, invokeResolver(files)));
    });

    tool<{ machine: string; file?: string }>('xstate_test_paths', async ({ machine, file }) => {
        const files = await allFiles(scanner);
        const r = resolve(files, machine, file);
        if (r.error) { return r.error; }
        return result(renderTestPathsMarkdown(r.ref!.machine, invokeResolver(files)));
    });

    tool<{ name: string; machine?: string; file?: string }>('xstate_find_implementation', async ({ name, machine, file }) => {
        const files = await allFiles(scanner);
        if (files.length === 0) { return result('No XState files in this workspace.'); }
        // Start the search from the referenced machine's file when given, else a file hint, else the first.
        let startUri: vscode.Uri | undefined;
        if (machine) { startUri = resolve(files, machine, file).ref?.machine.uri; }
        if (!startUri) {
            const f = file ? files.find((ff) => ff.relativePath.includes(file) || ff.uri.fsPath.includes(file)) : undefined;
            startUri = (f ?? files[0]).uri;
        }
        const doc = await vscode.workspace.openTextDocument(startUri);
        const hit = await ImplementationFinder.findImplementation(name, doc);
        if (!hit) { return result(`No implementation found for "${name}".`); }
        const rel = vscode.workspace.asRelativePath(hit.document.uri);
        const start = hit.range.start.line;
        const end = Math.min(start + 5, hit.document.lineCount - 1);
        const snippet = hit.document.getText(new vscode.Range(start, 0, end, hit.document.lineAt(end).text.length));
        return result(`${rel}:${start + 1}\n\n${snippet}`);
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

    tool<{ name: string; file?: string }>('xstate_find_references', async ({ name, file }) => {
        const files = await allFiles(scanner);
        let refs = flatten(files);
        if (file) { refs = refs.filter((x) => x.file.includes(file) || (x.machine.uri?.fsPath ?? '').includes(file)); }
        const found = findReferences(refs.map((x) => x.machine), name);
        if (found.length === 0) { return result(`No references to "${name}" as an action/guard/actor/event.`); }
        const lines = found.map((r) => {
            const rel = r.file ? vscode.workspace.asRelativePath(r.file) : '?';
            return `[${r.kind}] ${r.machine}${r.state ? ' › ' + r.state : ''} — ${rel}:${r.line}`;
        });
        return result(lines.join('\n'));
    });

    tool<{ machine: string; file?: string }>('xstate_setup_coverage', async ({ machine, file }) => {
        const files = await allFiles(scanner);
        const r = resolve(files, machine, file);
        if (r.error) { return r.error; }
        const doc = await vscode.workspace.openTextDocument(r.ref!.machine.uri);
        const cov = computeSetupCoverage(doc, doc.offsetAt(r.ref!.machine.range.start));
        if (!cov) { return result(`Could not analyse setup() for "${machine}".`); }
        if (!cov.hasSetup) { return result(`"${cov.machine}" has no setup() block — actions/guards/actors are inline or unresolved.`); }
        const line = (title: string, s: { referenced: string[]; missing: string[]; unused: string[] }) =>
            `${title}: ${s.referenced.length} referenced` +
            (s.missing.length ? `, MISSING: ${s.missing.join(', ')}` : ', none missing') +
            (s.unused.length ? ` (unused: ${s.unused.join(', ')})` : '');
        return result([
            `Setup coverage — ${cov.machine}`,
            line('Actions', { referenced: cov.referenced.actions, missing: cov.missing.actions, unused: cov.unused.actions }),
            line('Guards', { referenced: cov.referenced.guards, missing: cov.missing.guards, unused: cov.unused.guards }),
            line('Actors', { referenced: cov.referenced.actors, missing: cov.missing.actors, unused: cov.unused.actors }),
        ].join('\n'));
    });

    tool<{ machine: string; file?: string }>('xstate_list_events', async ({ machine, file }) => {
        const files = await allFiles(scanner);
        const r = resolve(files, machine, file);
        if (r.error) { return r.error; }
        const events = listEvents(r.ref!.machine, invokeResolver(files));
        if (events.length === 0) { return result(`"${r.ref!.machine.label}" handles no events.`); }
        const lines = events.map((e) => {
            const hs = e.handlers.map((h) => `${h.state}${h.target ? '→' + h.target : ' (internal)'}${h.guard ? ' [' + h.guard + ']' : ''}`).join(', ');
            return `${e.auto ? '(auto) ' : ''}${e.event} — ${hs}`;
        });
        return result(lines.join('\n'));
    });

    tool<{ machine: string; state: string; file?: string }>('xstate_state_detail', async ({ machine, state, file }) => {
        const files = await allFiles(scanner);
        const r = resolve(files, machine, file);
        if (r.error) { return r.error; }
        const d = stateDetail(r.ref!.machine, state, invokeResolver(files));
        if (!d) {
            const labels = describeMachine(r.ref!.machine, invokeResolver(files)).states.map((s) => s.label);
            return result(`No state "${state}" in "${r.ref!.machine.label}". States: ${labels.join(', ')}.`);
        }
        const flags = [d.parallel && 'parallel', d.compound && 'compound', d.initial && 'initial', d.final && 'final'].filter(Boolean).join(', ');
        const out: string[] = [`State "${d.state}"${flags ? ' (' + flags + ')' : ''} in ${d.machine}${d.parent ? ' › ' + d.parent : ''}`];
        if (d.entryActions) { out.push(`entry: ${d.entryActions.join(', ')}`); }
        if (d.exitActions) { out.push(`exit: ${d.exitActions.join(', ')}`); }
        if (d.invokes) { out.push(`invoke: ${d.invokes.join(', ')}`); }
        if (d.transitions.length) {
            out.push('transitions:');
            for (const t of d.transitions) {
                out.push(`  ${t.event}${t.target ? ' → ' + t.target : ''}${t.guard ? ' [' + t.guard + ']' : ''}${t.actions ? ' / ' + t.actions.join(', ') : ''}`);
            }
        }
        if (d.ambiguous) { out.push(`(note: ${d.ambiguous} states share the label "${d.state}"; showing the first)`); }
        return result(out.join('\n'));
    });
}
