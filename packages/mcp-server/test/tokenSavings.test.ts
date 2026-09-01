import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { describeMachine } from '@xstate-devtools/diagram-core';
import { discover } from '../src/scan';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Real token counts via Claude's own tokenizer (no generation, so no per-run
// cost beyond the countTokens call). Requires ANTHROPIC_API_KEY; skipped otherwise
// so CI without the key doesn't fail.
const apiKey = process.env.ANTHROPIC_API_KEY;
const maybeIt = apiKey ? it : it.skip;
const model = 'claude-sonnet-5';

function branch(name: string) {
    return `
    ${name}: {
      initial: '${name}Start',
      states: {
        ${name}Start: { on: { NEXT: '${name}Middle' } },
        ${name}Middle: { invoke: { src: '${name}Service', onDone: '${name}End', onError: '${name}Failed' } },
        ${name}End: { type: 'final' },
        ${name}Failed: { on: { RETRY: '${name}Start' } },
      },
    },`;
}

const BRANCHES = ['onboarding', 'billing', 'shipping', 'support', 'returns', 'fraud'];

// A workspace-shaped file: several unrelated sibling subtrees plus surrounding
// module code, the same shape `describe_machine`'s `parent`/`depth` scoping was
// added to avoid reading in full.
const SRC = `
import { createMachine } from 'xstate';

// Shared helpers unrelated to any one branch below.
export function logTransition(name: string) { console.log('->', name); }
export const CONFIG = { retries: 3, timeoutMs: 5000 };

export const workflow = createMachine({
  id: 'workflow',
  initial: 'onboarding',
  states: {${BRANCHES.map(branch).join('')}
  },
});
`;

describe('token savings (Claude tokenizer)', () => {
    maybeIt('scoping describe_machine to one subtree uses fewer tokens than reading the whole file', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xstate-mcp-tokens-'));
        fs.writeFileSync(path.join(dir, 'workflow.ts'), SRC);
        const refs = discover(dir);
        fs.rmSync(dir, { recursive: true, force: true });

        const ref = refs.find((r) => r.machine.label === 'workflow');
        expect(ref).toBeDefined();
        const scoped = JSON.stringify(describeMachine(ref!.machine, () => undefined, { parent: 'billing' }), null, 2);

        const client = new Anthropic({
            apiKey,
            defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
                ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
                : undefined,
        });
        const [rawCount, scopedCount] = await Promise.all([
            client.messages.countTokens({ model, messages: [{ role: 'user', content: SRC }] }),
            client.messages.countTokens({ model, messages: [{ role: 'user', content: scoped }] }),
        ]);

        expect(scopedCount.input_tokens).toBeLessThan(rawCount.input_tokens);
    });
});
