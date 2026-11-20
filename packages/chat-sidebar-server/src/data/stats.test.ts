import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
    benjaminiHochberg,
    chiSquareSurvival,
    chiSquareTest,
    fisherExact,
    kaplanMeier,
    kruskalWallis,
    logRank,
    pearson,
    spearman,
    summarize,
    wilcoxon,
} from './stats.js';

const here = dirname(fileURLToPath(import.meta.url));

function close(actual: number | undefined, expected: number, tol = 1e-6) {
    assert.ok(
        actual !== undefined && Math.abs(actual - expected) <= tol,
        `${actual} ≉ ${expected}`
    );
}

// The cases cBioPortal's own log-rank test checks against R
// (src/pages/resultsView/survival/logRankTest.spec.ts).
test('log-rank matches R on cBioPortal’s reference cases', () => {
    const cases: {
        exitTime: number[];
        status: number[];
        group: string[];
        p: number;
    }[] = JSON.parse(readFileSync(join(here, 'logRankFixtures.json'), 'utf8'));
    assert.equal(cases.length, 4);
    for (const c of cases) {
        const byGroup = new Map<string, { months: number; event: boolean }[]>();
        c.exitTime.forEach((months, i) => {
            const g = c.group[i];
            if (!byGroup.has(g)) byGroup.set(g, []);
            byGroup.get(g)!.push({ months, event: c.status[i] === 1 });
        });
        close(logRank([...byGroup.values()]).pValue, c.p);
    }
});

test('chi-square tail and contingency test', () => {
    close(chiSquareSurvival(3.841459, 1), 0.05);
    close(chiSquareSurvival(5.991465, 2), 0.05);
    // scipy.stats.chi2_contingency(correction=False)
    close(
        chiSquareTest([
            [10, 20],
            [30, 15],
        ]),
        0.0045864,
        1e-6
    );
});

test('summaries use R’s quantiles', () => {
    const s = summarize([1, 2, 3, 4, 10])!;
    assert.equal(s.median, 3);
    assert.equal(s.q1, 2);
    assert.equal(s.q3, 4);
    assert.equal(s.mean, 4);
});

test('correlations match R', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [2.1, 3.9, 6.2, 7.8, 9.9, 12.5, 13.1, 16.4, 17.8, 21.0];
    // Reference values from scipy.stats (pearsonr, spearmanr).
    close(pearson(x, y)!.r, 0.9968506, 1e-6);
    close(pearson(x, y)!.p, 4.28803e-10, 1e-14);
    // Monotone: Spearman rho = 1.
    close(spearman(x, y)!.r, 1);
    close(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])!.r, 0.8207827, 1e-6);
    close(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])!.p, 0.088587, 1e-6);
});

test('rank tests match R', () => {
    // scipy.stats.mannwhitneyu(method='asymptotic') = R's
    // wilcox.test(exact = FALSE): p = 0.1329195
    close(
        wilcoxon(
            [1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3],
            [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29]
        ),
        0.1329195,
        1e-6
    );
    // scipy.stats.kruskal: p = 0.6799648
    close(
        kruskalWallis([
            [2.9, 3.0, 2.5, 2.6, 3.2],
            [3.8, 2.7, 4.0, 2.4],
            [2.8, 3.4, 3.7, 2.2, 2.0],
        ]),
        0.6799648,
        1e-6
    );
});

test('Fisher’s exact test matches R', () => {
    // fisher.test(matrix(c(3,1,1,3), 2)): p = 0.4857, OR (sample) = 9
    const f = fisherExact(3, 1, 1, 3);
    close(f.twoSided, 0.4857143, 1e-6);
    close(f.greater, 0.2428571, 1e-6);
    assert.equal(f.oddsRatio, 9);
});

test('Benjamini-Hochberg matches p.adjust', () => {
    // p.adjust(c(0.01, 0.04, 0.03, 0.2), "BH") = 0.04 0.0533 0.0533 0.2
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.2]);
    close(q[0], 0.04);
    close(q[1], 0.0533333, 1e-6);
    close(q[2], 0.0533333, 1e-6);
    close(q[3], 0.2);
});

test('Kaplan-Meier median, and “not reached”', () => {
    const km = kaplanMeier([
        { months: 1, event: true },
        { months: 2, event: true },
        { months: 3, event: false },
        { months: 4, event: true },
        { months: 5, event: false },
    ]);
    // S: 0.8 at 1, 0.6 at 2, 0.3 at 4 → median 4.
    assert.equal(km.medianMonths, 4);
    const flat = kaplanMeier([
        { months: 1, event: true },
        { months: 2, event: false },
        { months: 3, event: false },
    ]);
    assert.equal(flat.medianMonths, undefined);
});
