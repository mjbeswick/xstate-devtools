import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from './fuzzyMatch';

describe('fuzzyMatch', () => {
    it('matches a subsequence and rejects a non-subsequence', () => {
        expect(fuzzyMatch('kp', 'keep')).not.toBeNull();
        expect(fuzzyMatch('ckeep', 'clubcard.keep')).not.toBeNull();
        expect(fuzzyMatch('xyz', 'clubcard.keep')).toBeNull();
        // order matters: 'pk' is not a subsequence of 'keep'
        expect(fuzzyMatch('pk', 'keep')).toBeNull();
    });

    it('returns contiguous matched ranges', () => {
        // 'keep' is one consecutive run at index 0
        expect(fuzzyMatch('keep', 'keep')!.ranges).toEqual([[0, 4]]);
        // 'ck' = c(0) then k(9) in 'clubcard.keep' → two ranges
        expect(fuzzyMatch('ck', 'clubcard.keep')!.ranges).toEqual([[0, 1], [9, 10]]);
    });

    it('ranks consecutive and word-boundary matches above scattered ones', () => {
        // 'keep' as a whole word after '.' should beat scattered letters
        const boundary = fuzzyMatch('keep', 'clubcard.keep')!.score;
        const scattered = fuzzyMatch('crd', 'clubcard.keep')!.score;
        expect(boundary).toBeGreaterThan(scattered);
    });

    it('treats an empty query as a match with no ranges', () => {
        expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, ranges: [] });
    });
});
