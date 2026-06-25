import { describe, it, expect } from 'vitest';
import { renamePropertyKey, reindentSnippet } from '../src/treeEditor';

describe('renamePropertyKey', () => {
    it('renames a bare identifier key', () => {
        expect(renamePropertyKey("idle: { on: { GO: 'busy' } }", 'idle2'))
            .toBe("idle2: { on: { GO: 'busy' } }");
    });

    it('renames a quoted key and preserves the rest', () => {
        expect(renamePropertyKey("'some-state': {}", 'other')).toBe('other: {}');
    });

    it('quotes a new name that is not a valid identifier', () => {
        expect(renamePropertyKey('idle: {}', 'my-state')).toBe("'my-state': {}");
    });
});

describe('reindentSnippet', () => {
    it('is a no-op for single-line snippets', () => {
        expect(reindentSnippet("count: 0", '  ', '      ')).toBe("count: 0");
    });

    it('shifts continuation lines and preserves relative nesting', () => {
        // A state captured at 4-space base, pasted at 8-space child indent.
        const src = "busy: {\n      on: { DONE: 'idle' }\n    }";
        const out = reindentSnippet(src, '    ', '        ');
        expect(out).toBe("busy: {\n          on: { DONE: 'idle' }\n        }");
        // first line untouched; `on:` was base+2 → now 8+2=10; closing brace at 8.
        expect(out.split('\n')[1].match(/^ */)![0].length).toBe(10);
        expect(out.split('\n')[2].match(/^ */)![0].length).toBe(8);
    });
});
