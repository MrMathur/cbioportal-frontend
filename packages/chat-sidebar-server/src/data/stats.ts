// Statistics the data tools report: summaries, correlations, group tests,
// Kaplan-Meier and the log-rank test. Pure, so each is tested against
// reference values (R, cBioPortal's own tests).

// --- Special functions ---

function logGamma(x: number): number {
    // Lanczos approximation (g = 7, n = 9).
    const c = [
        0.99999999999980993,
        676.5203681218851,
        -1259.1392167224028,
        771.32342877765313,
        -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
        9.9843695780195716e-6,
        1.5056327351493116e-7,
    ];
    if (x < 0.5) {
        return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    }
    x -= 1;
    let a = c[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += c[i] / (x + i);
    return (
        0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
    );
}

/** Regularized lower incomplete gamma P(a, x). */
function gammaP(a: number, x: number): number {
    if (x <= 0) return 0;
    if (x < a + 1) {
        let sum = 1 / a;
        let term = sum;
        for (let n = 1; n < 1000; n++) {
            term *= x / (a + n);
            sum += term;
            if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
        }
        return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
    }
    // Continued fraction for Q(a, x).
    let b = x + 1 - a;
    let c = 1e300;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 1000; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < 1e-300) d = 1e-300;
        c = b + an / c;
        if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-15) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Upper tail of the chi-square distribution. */
export function chiSquareSurvival(x: number, dof: number): number {
    if (!(x > 0)) return 1;
    return Math.max(0, 1 - gammaP(dof / 2, x / 2));
}

function betaContinuedFraction(a: number, b: number, x: number): number {
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    d = 1 / d;
    let h = d;
    for (let m = 1; m < 1000; m++) {
        const m2 = 2 * m;
        let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < 1e-300) d = 1e-300;
        c = 1 + aa / c;
        if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d;
        h *= d * c;
        aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < 1e-300) d = 1e-300;
        c = 1 + aa / c;
        if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
}

/** Regularized incomplete beta I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const front = Math.exp(
        logGamma(a + b) -
            logGamma(a) -
            logGamma(b) +
            a * Math.log(x) +
            b * Math.log(1 - x)
    );
    return x < (a + 1) / (a + b + 2)
        ? (front * betaContinuedFraction(a, b, x)) / a
        : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-sided p-value of Student's t. */
export function tTwoSided(t: number, dof: number): number {
    if (!isFinite(t)) return 0;
    return incompleteBeta(dof / (dof + t * t), dof / 2, 0.5);
}

/** Two-sided p-value of a standard normal z. */
export function normalTwoSided(z: number): number {
    return chiSquareSurvival(z * z, 1);
}

// --- Summaries ---

export interface Summary {
    n: number;
    mean: number;
    median: number;
    q1: number;
    q3: number;
    min: number;
    max: number;
}

function quantileSorted(sorted: number[], p: number): number {
    // R's default (type 7).
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function summarize(values: number[]): Summary | undefined {
    const v = values.filter(x => isFinite(x)).sort((a, b) => a - b);
    if (v.length === 0) return undefined;
    return {
        n: v.length,
        mean: v.reduce((s, x) => s + x, 0) / v.length,
        median: quantileSorted(v, 0.5),
        q1: quantileSorted(v, 0.25),
        q3: quantileSorted(v, 0.75),
        min: v[0],
        max: v[v.length - 1],
    };
}

// --- Correlation ---

function ranks(values: number[]): number[] {
    const order = values
        .map((v, i) => [v, i] as const)
        .sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(values.length);
    for (let i = 0; i < order.length; ) {
        let j = i;
        while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
        const avg = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) r[order[k][1]] = avg;
        i = j + 1;
    }
    return r;
}

export interface Correlation {
    n: number;
    r: number;
    p: number;
}

export function pearson(x: number[], y: number[]): Correlation | undefined {
    const pairs = x
        .map((xi, i) => [xi, y[i]] as const)
        .filter(([a, b]) => isFinite(a) && isFinite(b));
    const n = pairs.length;
    if (n < 3) return undefined;
    const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
    const my = pairs.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const [a, b] of pairs) {
        sxy += (a - mx) * (b - my);
        sxx += (a - mx) ** 2;
        syy += (b - my) ** 2;
    }
    if (sxx === 0 || syy === 0) return undefined;
    const r = sxy / Math.sqrt(sxx * syy);
    const t = r * Math.sqrt((n - 2) / Math.max(1e-300, 1 - r * r));
    return { n, r, p: tTwoSided(t, n - 2) };
}

/** Spearman's rho, with the t approximation for its p-value. */
export function spearman(x: number[], y: number[]): Correlation | undefined {
    const pairs = x
        .map((xi, i) => [xi, y[i]] as const)
        .filter(([a, b]) => isFinite(a) && isFinite(b));
    if (pairs.length < 3) return undefined;
    return pearson(ranks(pairs.map(p => p[0])), ranks(pairs.map(p => p[1])));
}

// --- Group tests ---

/**
 * Wilcoxon rank-sum (Mann-Whitney) test, normal approximation with tie and
 * continuity correction, as R's wilcox.test(exact = FALSE).
 */
export function wilcoxon(a: number[], b: number[]): number | undefined {
    const x = a.filter(isFinite);
    const y = b.filter(isFinite);
    const n1 = x.length;
    const n2 = y.length;
    if (n1 === 0 || n2 === 0) return undefined;
    const all = [...x, ...y];
    const r = ranks(all);
    const r1 = r.slice(0, n1).reduce((s, v) => s + v, 0);
    const u = r1 - (n1 * (n1 + 1)) / 2;
    const mu = (n1 * n2) / 2;
    const counts = new Map<number, number>();
    for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1);
    let ties = 0;
    for (const t of counts.values()) ties += t ** 3 - t;
    const n = n1 + n2;
    const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1))));
    if (sigma === 0) return 1;
    const diff = u - mu;
    const z = (diff - Math.sign(diff) * 0.5) / sigma;
    return normalTwoSided(z);
}

/** Kruskal-Wallis test across two or more groups, tie-corrected. */
export function kruskalWallis(groups: number[][]): number | undefined {
    const gs = groups.map(g => g.filter(isFinite)).filter(g => g.length > 0);
    if (gs.length < 2) return undefined;
    const all = gs.flat();
    const n = all.length;
    const r = ranks(all);
    let offset = 0;
    let h = 0;
    for (const g of gs) {
        const sum = r
            .slice(offset, offset + g.length)
            .reduce((s, v) => s + v, 0);
        h += (sum * sum) / g.length;
        offset += g.length;
    }
    h = (12 / (n * (n + 1))) * h - 3 * (n + 1);
    const counts = new Map<number, number>();
    for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1);
    let ties = 0;
    for (const t of counts.values()) ties += t ** 3 - t;
    const correction = 1 - ties / (n ** 3 - n);
    if (correction <= 0) return 1;
    return chiSquareSurvival(h / correction, gs.length - 1);
}

/** Chi-square test of independence for a contingency table. */
export function chiSquareTest(table: number[][]): number | undefined {
    const rows = table.filter(r => r.some(v => v > 0));
    if (rows.length < 2) return undefined;
    const cols = rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0));
    const keep = cols.map(c => c > 0);
    const t = rows.map(r => r.filter((_, j) => keep[j]));
    const colSums = cols.filter((_, j) => keep[j]);
    if (colSums.length < 2) return undefined;
    const total = colSums.reduce((s, v) => s + v, 0);
    let x2 = 0;
    for (const r of t) {
        const rs = r.reduce((s, v) => s + v, 0);
        r.forEach((o, j) => {
            const e = (rs * colSums[j]) / total;
            x2 += (o - e) ** 2 / e;
        });
    }
    return chiSquareSurvival(x2, (t.length - 1) * (colSums.length - 1));
}

function logChoose(n: number, k: number): number {
    return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * Fisher's exact test on a 2x2 table [[a, b], [c, d]], with the odds ratio.
 * `greater` is the one-sided p for co-occurrence, `less` for mutual
 * exclusivity (as cBioPortal's Mutual Exclusivity tab), `twoSided` as R.
 */
export function fisherExact(
    a: number,
    b: number,
    c: number,
    d: number
): { oddsRatio: number; less: number; greater: number; twoSided: number } {
    const r1 = a + b;
    const c1 = a + c;
    const n = a + b + c + d;
    const lo = Math.max(0, r1 + c1 - n);
    const hi = Math.min(r1, c1);
    const logDenominator = logChoose(n, c1);
    const prob = (x: number) =>
        Math.exp(logChoose(r1, x) + logChoose(n - r1, c1 - x) - logDenominator);
    const pObserved = prob(a);
    let less = 0;
    let greater = 0;
    let twoSided = 0;
    for (let x = lo; x <= hi; x++) {
        const p = prob(x);
        if (x <= a) less += p;
        if (x >= a) greater += p;
        if (p <= pObserved * (1 + 1e-7)) twoSided += p;
    }
    return {
        oddsRatio: b * c === 0 ? Infinity : (a * d) / (b * c),
        less: Math.min(1, less),
        greater: Math.min(1, greater),
        twoSided: Math.min(1, twoSided),
    };
}

/** Benjamini-Hochberg q-values, in the input order. */
export function benjaminiHochberg(pValues: number[]): number[] {
    const n = pValues.length;
    const order = pValues
        .map((p, i) => [p, i] as const)
        .sort((a, b) => b[0] - a[0]);
    const q = new Array<number>(n);
    let running = 1;
    order.forEach(([p, i], k) => {
        const rank = n - k;
        running = Math.min(running, (p * n) / rank);
        q[i] = running;
    });
    return q;
}

// --- Survival ---

export interface SurvivalEvent {
    months: number;
    // true: the event (death, progression) happened at `months`; false:
    // censored then.
    event: boolean;
}

export interface KaplanMeier {
    n: number;
    events: number;
    // Months at which the curve first reaches 50% or below; undefined when
    // it never does ("not reached").
    medianMonths?: number;
    // Survival estimate at given months (e.g. 12, 36, 60), when follow-up
    // reaches them.
    at: { months: number; survival: number }[];
}

export function kaplanMeier(
    data: SurvivalEvent[],
    marks: number[] = [12, 36, 60]
): KaplanMeier {
    const sorted = [...data].sort((a, b) => a.months - b.months);
    let atRisk = sorted.length;
    let survival = 1;
    let medianMonths: number | undefined;
    const curve: { months: number; survival: number }[] = [];
    for (let i = 0; i < sorted.length; ) {
        const t = sorted[i].months;
        let deaths = 0;
        let leaving = 0;
        while (i < sorted.length && sorted[i].months === t) {
            if (sorted[i].event) deaths++;
            leaving++;
            i++;
        }
        if (deaths > 0) {
            survival *= 1 - deaths / atRisk;
            curve.push({ months: t, survival });
            if (medianMonths === undefined && survival <= 0.5) medianMonths = t;
        }
        atRisk -= leaving;
    }
    const lastFollowUp = sorted.length ? sorted[sorted.length - 1].months : 0;
    const at = marks
        .filter(m => m <= lastFollowUp)
        .map(m => {
            let s = 1;
            for (const point of curve) {
                if (point.months <= m) s = point.survival;
                else break;
            }
            return { months: m, survival: s };
        });
    return {
        n: sorted.length,
        events: sorted.filter(e => e.event).length,
        medianMonths,
        at,
    };
}

function invert(matrix: number[][]): number[][] | undefined {
    const n = matrix.length;
    const a = matrix.map((row, i) => [
        ...row,
        ...row.map((_, j) => (i === j ? 1 : 0)),
    ]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
        }
        if (Math.abs(a[pivot][col]) < 1e-12) return undefined;
        [a[col], a[pivot]] = [a[pivot], a[col]];
        const p = a[col][col];
        for (let j = 0; j < 2 * n; j++) a[col][j] /= p;
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = a[r][col];
            for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j];
        }
    }
    return a.map(row => row.slice(n));
}

/**
 * Log-rank test across two or more groups (R's survdiff). Also returns each
 * group's observed and expected events, and for two groups the hazard ratio
 * of the second group against the first ((O2/E2)/(O1/E1)) with its 95% CI.
 */
export function logRank(
    groups: SurvivalEvent[][]
): {
    pValue?: number;
    chiSquare?: number;
    observed: number[];
    expected: number[];
    hazardRatio?: { ratio: number; low: number; high: number };
} {
    const k = groups.length;
    const times = [
        ...new Set(
            groups
                .flat()
                .filter(e => e.event)
                .map(e => e.months)
        ),
    ].sort((a, b) => a - b);
    const observed = groups.map(g => g.filter(e => e.event).length);
    const expected = new Array<number>(k).fill(0);
    const variance = Array.from({ length: k }, () =>
        new Array<number>(k).fill(0)
    );
    for (const t of times) {
        const atRisk = groups.map(g => g.filter(e => e.months >= t).length);
        const deaths = groups.map(
            g => g.filter(e => e.event && e.months === t).length
        );
        const n = atRisk.reduce((s, v) => s + v, 0);
        const d = deaths.reduce((s, v) => s + v, 0);
        if (n === 0) continue;
        for (let i = 0; i < k; i++) {
            expected[i] += (d * atRisk[i]) / n;
            if (n < 2) continue;
            for (let j = 0; j < k; j++) {
                const v =
                    ((d * (n - d)) / (n * n * (n - 1))) *
                    (i === j
                        ? atRisk[i] * (n - atRisk[i])
                        : -atRisk[i] * atRisk[j]);
                variance[i][j] += v;
            }
        }
    }
    let hazardRatio: { ratio: number; low: number; high: number } | undefined;
    if (k === 2 && expected[0] > 0 && expected[1] > 0 && observed[0] > 0) {
        const ratio = observed[1] / expected[1] / (observed[0] / expected[0]);
        const se = Math.sqrt(1 / expected[0] + 1 / expected[1]);
        hazardRatio = {
            ratio,
            low: Math.exp(Math.log(ratio) - 1.959963984540054 * se),
            high: Math.exp(Math.log(ratio) + 1.959963984540054 * se),
        };
    }
    const used = expected.map((e, i) => i).filter(i => expected[i] > 0);
    if (used.length < 2) return { observed, expected, hazardRatio };
    const reduced = used.slice(0, -1);
    const diff = reduced.map(i => observed[i] - expected[i]);
    const inverse = invert(reduced.map(i => reduced.map(j => variance[i][j])));
    if (!inverse) return { observed, expected, hazardRatio };
    let chiSquare = 0;
    for (let i = 0; i < diff.length; i++) {
        for (let j = 0; j < diff.length; j++) {
            chiSquare += diff[i] * inverse[i][j] * diff[j];
        }
    }
    return {
        pValue: chiSquareSurvival(chiSquare, reduced.length),
        chiSquare,
        observed,
        expected,
        hazardRatio,
    };
}
