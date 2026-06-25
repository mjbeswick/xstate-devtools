import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    validateSource,
    listMachines,
    describeMachine,
    machineMermaid,
    renderTestPathsMarkdown,
} from '@xstate-devtools/diagram-core';
import { candidateFiles, discover, findMachine, type MachineRef } from './scan';

// stdout is the JSON-RPC channel — the shared parser does an unconditional
// console.log, so redirect it (and anything else) to stderr to avoid corrupting
// the protocol stream.
console.log = (...args: unknown[]) => console.error(...args);

const ROOT = process.env.XSTATE_MCP_ROOT || process.cwd();

function text(s: string) { return { content: [{ type: 'text' as const, text: s }] }; }

function notFound(refs: MachineRef[], id: string) {
    const ids = [...new Set(refs.map((r) => r.machine.label))];
    return text(`No machine "${id}" found under ${ROOT}. Available: ${ids.length ? ids.join(', ') : '(none)'}.`);
}

const machineInput = {
    machine: z.string().describe("The machine's id (from list_machines)."),
    file: z.string().optional().describe('Optional source path substring to disambiguate machines that share an id.'),
};

function main() {
    const server = new McpServer({ name: 'xstate-mcp', version: '0.1.0' });

    server.registerTool('list_machines', {
        title: 'List XState machines',
        description: 'List every XState machine in the workspace, with its id, source file, line, and state count. Use this first to discover what exists.',
        inputSchema: {},
    }, async () => {
        const refs = discover(ROOT);
        if (refs.length === 0) { return text(`No XState machines found under ${ROOT}.`); }
        return text(JSON.stringify(listMachines(refs.map((r) => r.machine)), null, 2));
    });

    server.registerTool('describe_machine', {
        title: 'Describe XState machine',
        description: 'Return one machine as JSON: states (hierarchy, initial/final/parallel flags, entry/exit actions, invoked services) and transitions (source, target, event).',
        inputSchema: machineInput,
    }, async ({ machine, file }) => {
        const refs = discover(ROOT);
        const ref = findMachine(refs, machine, file);
        if (!ref) { return notFound(refs, machine); }
        const resolve = (src: string) => findMachine(refs, src)?.machine;
        return text(JSON.stringify(describeMachine(ref.machine, resolve), null, 2));
    });

    server.registerTool('machine_diagram', {
        title: 'XState machine diagram (Mermaid)',
        description: 'Return a Mermaid `stateDiagram-v2` for one machine.',
        inputSchema: machineInput,
    }, async ({ machine, file }) => {
        const refs = discover(ROOT);
        const ref = findMachine(refs, machine, file);
        if (!ref) { return notFound(refs, machine); }
        const resolve = (src: string) => findMachine(refs, src)?.machine;
        return text(machineMermaid(ref.machine, resolve));
    });

    server.registerTool('test_paths', {
        title: 'XState test paths',
        description: 'Shortest event sequence to reach each state of a machine (structural — guards assumed takeable), unreachable states flagged, plus copy-paste test skeletons.',
        inputSchema: machineInput,
    }, async ({ machine, file }) => {
        const refs = discover(ROOT);
        const ref = findMachine(refs, machine, file);
        if (!ref) { return notFound(refs, machine); }
        const resolve = (src: string) => findMachine(refs, src)?.machine;
        return text(renderTestPathsMarkdown(ref.machine, resolve));
    });

    server.registerTool('validate', {
        title: 'Validate XState machines',
        description: 'Run XState diagnostics (invalid config properties, unknown transition targets, unreachable states, etc.) over the workspace or one file.',
        inputSchema: {
            file: z.string().optional().describe('Optional source path substring. Omit to validate every XState file.'),
        },
    }, async ({ file }) => {
        const candidates = candidateFiles(ROOT).filter((c) => !file || c.file.includes(file));
        if (candidates.length === 0) { return text(file ? `No XState file matching "${file}".` : `No XState files under ${ROOT}.`); }
        const blocks: string[] = [];
        let total = 0;
        for (const { file: f, text: src } of candidates) {
            const diags = validateSource(f, src);
            if (diags.length === 0) { continue; }
            total += diags.length;
            const lines = diags.map((d) => `  [${d.severity}] ${d.line}:${d.character} ${d.message}`);
            blocks.push(`${f}\n${lines.join('\n')}`);
        }
        if (total === 0) { return text(`No XState problems found in ${candidates.length} file(s).`); }
        return text(`${total} problem(s):\n\n${blocks.join('\n\n')}`);
    });

    const transport = new StdioServerTransport();
    server.connect(transport).catch((err) => { console.error(err); process.exit(1); });
}

main();
