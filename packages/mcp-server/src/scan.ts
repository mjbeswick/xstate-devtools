import * as fs from 'fs';
import fg from 'fast-glob';
import { parseSource, type MachineNode } from '@xstate-devtools/diagram-core';

export interface MachineRef { machine: MachineNode; file: string }

/** Files that plausibly define an XState machine (cheap keyword prefilter). */
export function candidateFiles(root: string): Array<{ file: string; text: string }> {
    const files = fg.sync(['**/*.{ts,tsx,js,jsx,mts,cts}'], {
        cwd: root,
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.next/**', '**/build/**'],
    });
    const out: Array<{ file: string; text: string }> = [];
    for (const file of files) {
        let text: string;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        if (!/\b(createMachine|Machine|createStateConfig|stateConfig)\s*\(/.test(text)) { continue; }
        out.push({ file, text });
    }
    return out;
}

/** Parse every candidate file into machine references. */
export function discover(root: string): MachineRef[] {
    const out: MachineRef[] = [];
    for (const { file, text } of candidateFiles(root)) {
        let machines: MachineNode[];
        try { machines = parseSource(file, text); } catch { continue; }
        for (const m of machines) { out.push({ machine: m, file }); }
    }
    return out;
}

export function findMachine(refs: MachineRef[], id: string, file?: string): MachineRef | undefined {
    let cands = refs.filter((r) => r.machine.label === id);
    if (file && cands.length > 1) { cands = cands.filter((r) => r.file.includes(file)); }
    return cands[0];
}
