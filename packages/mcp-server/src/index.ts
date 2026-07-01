import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import {
    validateSource,
    listMachines,
    describeMachine,
    machineMermaid,
    renderTestPathsMarkdown,
    findReferences,
    listEvents,
    stateDetail,
    setupCoverageSource,
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
    const server = new McpServer({ name: 'xstate-mcp', version: '0.2.0' });

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

    server.registerTool('find_references', {
        title: 'Find XState references',
        description: 'Find every place a name is USED across the workspace as an XState action, guard, invoked actor (service), or event — the inverse of where it is defined. Returns each usage with its machine, enclosing state, file and line.',
        inputSchema: {
            name: z.string().describe('The action/guard/actor/event name to find usages of.'),
            file: z.string().optional().describe('Optional source path substring to restrict the search.'),
        },
    }, async ({ name, file }) => {
        let refs = discover(ROOT);
        if (file) { refs = refs.filter((r) => r.file.includes(file)); }
        const found = findReferences(refs.map((r) => r.machine), name);
        if (found.length === 0) { return text(`No references to "${name}" as an action/guard/actor/event under ${ROOT}.`); }
        return text(JSON.stringify(found, null, 2));
    });

    server.registerTool('list_events', {
        title: 'List XState events',
        description: "List the events a machine handles — its send() API. For each event, the states that handle it and any guard/target. Eventless (always) and delayed (after) transitions are flagged as automatic.",
        inputSchema: machineInput,
    }, async ({ machine, file }) => {
        const refs = discover(ROOT);
        const ref = findMachine(refs, machine, file);
        if (!ref) { return notFound(refs, machine); }
        const resolve = (src: string) => findMachine(refs, src)?.machine;
        return text(JSON.stringify(listEvents(ref.machine, resolve), null, 2));
    });

    server.registerTool('state_detail', {
        title: 'XState state detail',
        description: 'Focused detail for one state of a machine, by label or id: entry/exit actions, invoked services, and outgoing transitions (event, target, guard, actions).',
        inputSchema: {
            ...machineInput,
            state: z.string().describe("The state's label or id."),
        },
    }, async ({ machine, state, file }) => {
        const refs = discover(ROOT);
        const ref = findMachine(refs, machine, file);
        if (!ref) { return notFound(refs, machine); }
        const resolve = (src: string) => findMachine(refs, src)?.machine;
        const d = stateDetail(ref.machine, state, resolve);
        if (!d) {
            const labels = describeMachine(ref.machine, resolve).states.map((s) => s.label);
            return text(`No state "${state}" in "${ref.machine.label}". States: ${labels.join(', ')}.`);
        }
        return text(JSON.stringify(d, null, 2));
    });

    server.registerTool('setup_coverage', {
        title: 'XState setup() coverage',
        description: 'For one XState v5 machine, which actions/guards/actors are referenced and which are MISSING an implementation in setup() (plus which declared ones are unused).',
        inputSchema: machineInput,
    }, async ({ machine, file }) => {
        const refs = discover(ROOT);
        const ref = findMachine(refs, machine, file);
        if (!ref) { return notFound(refs, machine); }
        let src: string;
        try { src = readFileSync(ref.file, 'utf8'); } catch { return text(`Could not read ${ref.file}.`); }
        const cov = setupCoverageSource(ref.file, src, ref.machine.range.start);
        if (!cov) { return text(`Could not analyse setup() for "${machine}".`); }
        return text(JSON.stringify(cov, null, 2));
    });

    const transport = new StdioServerTransport();
    server.connect(transport).catch((err) => { console.error(err); process.exit(1); });
}

main();
