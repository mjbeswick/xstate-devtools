// A tiny, dependency-free fuzzy (subsequence) matcher for the outline search.
// Greedy left-to-right: every query char must appear in order in the text. The
// score rewards consecutive runs and matches at word boundaries so the best
// matches sort first; `ranges` are contiguous matched spans for highlighting.
//
// ponytail: greedy alignment, not optimal — it takes the first place each char
// fits, which can miss a tighter later run (e.g. query "ab" against "a..ab").
// Fine for short outline queries; swap in a Smith–Waterman/fzf-style DP scorer
// if ranking quality ever matters.

export interface FuzzyMatch {
    score: number;
    ranges: [number, number][];
}

const SEPARATORS = new Set(['.', '_', '-', '/', ' ', ':']);

/** Match `query` as a subsequence of `text` (case-insensitive). Returns the
 *  score and matched ranges, or null if `query` is not a subsequence. An empty
 *  query matches everything with score 0 and no ranges. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
    if (!query) { return { score: 0, ranges: [] }; }

    const q = query.toLowerCase();
    const t = text.toLowerCase();

    const ranges: [number, number][] = [];
    let score = 0;
    let ti = 0;
    let prevMatch = -2; // index of the previous matched char in text

    for (let qi = 0; qi < q.length; qi++) {
        const ch = q[qi];
        const found = t.indexOf(ch, ti);
        if (found === -1) { return null; }

        // Bonuses: start of string, right after a separator, or a camelCase hump.
        const atStart = found === 0;
        const afterSep = found > 0 && SEPARATORS.has(t[found - 1]);
        const camelHump = found > 0 && text[found - 1] >= 'a' && text[found - 1] <= 'z'
            && text[found] >= 'A' && text[found] <= 'Z';
        if (atStart) { score += 10; }
        else if (afterSep || camelHump) { score += 8; }

        if (found === prevMatch + 1) {
            // Consecutive with the previous match — extend its range and reward.
            score += 6;
            ranges[ranges.length - 1][1] = found + 1;
        } else {
            // Gap before this char — small penalty proportional to the jump.
            score -= Math.min(found - ti, 3);
            ranges.push([found, found + 1]);
        }

        prevMatch = found;
        ti = found + 1;
    }

    // Slightly prefer shorter text (a tighter overall match).
    score -= Math.floor(text.length / 50);
    return { score, ranges };
}
