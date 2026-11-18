// The badges a reply places on the portal (its set_highlights call) and the
// tokens its text refers to them by. One plan is the source of both: the
// reply asks for marks, this validates them against the page and numbers the
// results, the reply then writes its sentences starting with the returned
// tokens. Pure, so the rules can be tested.

export type Cue = 'context' | 'result' | 'next_step';

export interface PlanMark {
    // What the text starts the matching sentence with: [[1]], [[context]],
    // [[next]].
    token: string;
    cue: Cue;
    // Result marks only, 1-based in reading order.
    number?: number;
    targetType: string;
    targetId: string;
    label: string;
    tooltip: string;
    // A part of a multi-part answer, or 'shared'.
    part: string;
    // On a page the user isn't on yet (a tab of Results View or Group
    // Comparison); shown once they get there.
    elsewhere?: boolean;
}

export interface BadgePlan {
    marks: PlanMark[];
    parts: string[];
}

export interface Candidate {
    targetType: string;
    targetId: string;
    label: string;
    description?: string;
}

export interface RequestedMark {
    cue?: unknown;
    target?: unknown;
    tooltip?: unknown;
    part?: unknown;
}

export interface Rejection {
    target: string;
    reason: string;
}

export const MAX_RESULTS = 5;
export const MAX_TOOLTIP_WORDS = 10;
// The Study View element that carries the context marker: the selected
// patients and samples.
export const CONTEXT_TARGET = {
    targetType: 'control',
    targetId: 'cohort-summary',
};

// Tabs of pages the user may not be on yet (mirrors the server's marks.ts).
export const OTHER_PAGE_TABS: readonly Candidate[] = [
    ['results-tab', 'oncoprint', 'OncoPrint'],
    ['results-tab', 'cancerTypesSummary', 'Cancer Types Summary'],
    ['results-tab', 'mutualExclusivity', 'Mutual Exclusivity'],
    ['results-tab', 'plots', 'Plots'],
    ['results-tab', 'mutations', 'Mutations'],
    ['results-tab', 'comparison', 'Comparison/Survival'],
    ['results-tab', 'coexpression', 'Co-expression'],
    ['results-tab', 'download', 'Download'],
    ['comparison-tab', 'overlap', 'Overlap'],
    ['comparison-tab', 'survival', 'Survival'],
    ['comparison-tab', 'clinical', 'Clinical'],
    ['comparison-tab', 'alterations', 'Genomic Alterations'],
    ['comparison-tab', 'mrna', 'mRNA'],
    ['comparison-tab', 'protein', 'Protein'],
].map(([targetType, targetId, label]) => ({ targetType, targetId, label }));

export function markKey(m: { targetType: string; targetId: string }): string {
    return `${m.targetType}:${m.targetId}`;
}

/** At most MAX_TOOLTIP_WORDS words, without a leading token or number. */
export function cleanTooltip(text: string): string {
    const words = text
        .replace(/\[\[[^\]]*\]\]/g, ' ')
        .replace(/^\s*(\(?\d+[.)]|[-•])\s+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
    return words.length > MAX_TOOLTIP_WORDS
        ? `${words.slice(0, MAX_TOOLTIP_WORDS).join(' ')}…`
        : words.join(' ');
}

function asCue(value: unknown): Cue | undefined {
    return value === 'context' || value === 'result' || value === 'next_step'
        ? value
        : undefined;
}

function resolvePart(value: unknown, parts: readonly string[]): string {
    if (parts.length === 0 || typeof value !== 'string') return 'shared';
    const wanted = value.trim().toLowerCase();
    return parts.find(p => p.toLowerCase() === wanted) ?? 'shared';
}

/**
 * Checks the reply's marks against the elements on the page (and the tabs
 * of other pages), keeps at most one context, five results and one next
 * step, numbers the results in the order given and cleans the tooltips.
 */
export function buildPlan(
    requested: readonly RequestedMark[],
    candidates: readonly Candidate[],
    parts: readonly string[]
): { plan: BadgePlan; rejected: Rejection[] } {
    const onPage = new Map(candidates.map(c => [markKey(c), c]));
    const elsewhere = new Map(OTHER_PAGE_TABS.map(c => [markKey(c), c]));
    const marks: PlanMark[] = [];
    const rejected: Rejection[] = [];
    const used = new Set<string>();
    let results = 0;
    let hasContext = false;
    let hasNext = false;

    for (const r of requested) {
        const cue = asCue(r.cue);
        const target = typeof r.target === 'string' ? r.target.trim() : '';
        const tooltip = cleanTooltip(
            typeof r.tooltip === 'string' ? r.tooltip : ''
        );
        const part = resolvePart(r.part, parts);
        if (!cue) {
            rejected.push({ target, reason: 'unknown cue' });
            continue;
        }
        if (cue === 'context') {
            const key = markKey(CONTEXT_TARGET);
            const candidate = onPage.get(key);
            if (hasContext) {
                rejected.push({ target, reason: 'only one context mark' });
            } else if (!candidate) {
                rejected.push({
                    target,
                    reason: 'no cohort shown on this page (Study View only)',
                });
            } else {
                hasContext = true;
                used.add(key);
                marks.push({
                    token: '[[context]]',
                    cue,
                    ...CONTEXT_TARGET,
                    label: candidate.label,
                    tooltip,
                    part: 'shared',
                });
            }
            continue;
        }
        const candidate = onPage.get(target) ?? elsewhere.get(target);
        if (!candidate) {
            rejected.push({ target, reason: 'not an element you can mark' });
            continue;
        }
        if (used.has(target)) {
            rejected.push({ target, reason: 'already marked' });
            continue;
        }
        if (cue === 'next_step') {
            if (hasNext) {
                rejected.push({ target, reason: 'only one next-step mark' });
                continue;
            }
            hasNext = true;
        } else if (results >= MAX_RESULTS) {
            rejected.push({ target, reason: `at most ${MAX_RESULTS} results` });
            continue;
        }
        used.add(target);
        const number = cue === 'result' ? ++results : undefined;
        marks.push({
            token: cue === 'result' ? `[[${number}]]` : '[[next]]',
            cue,
            number,
            targetType: candidate.targetType,
            targetId: candidate.targetId,
            label: candidate.label,
            tooltip: tooltip || candidate.label,
            part,
            elsewhere: !onPage.has(target) || undefined,
        });
    }
    return { plan: { marks, parts: [...parts] }, rejected };
}

const TOKEN = /\[\[(\d+|context|next)\]\]/g;

// A token starts its sentence when it opens a line, a list item, a heading
// or a quote (bold may come first), or follows the end of a sentence.
const LINE_START = /^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+|#{1,6}[ \t]+|>[ \t]*)?(?:\*\*|__)?$/;
const AFTER_SENTENCE = /[.!?:][ \t]+(?:\*\*|__)?$/;

function startsSentence(text: string, index: number): boolean {
    const before = text.slice(0, index);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    return LINE_START.test(line) || AFTER_SENTENCE.test(before);
}

export interface TextCheck {
    // The text refers to every mark once, numbers opening their sentence.
    ok: boolean;
    // The text uses some of the plan's tokens, so its chips can link to the
    // badges. Every token comes from the plan, so a chip's number always
    // matches its badge, even when the text repeats a token or puts it
    // mid-sentence; those are logged, not stripped.
    linkable: boolean;
    // Marks the text never refers to, tokens with no mark, and tokens that
    // don't start their sentence.
    missing: string[];
    unknown: string[];
    misplaced: string[];
    duplicated: string[];
}

/** Whether the text refers to every mark of the plan, once, as it should. */
export function checkText(text: string, plan: BadgePlan): TextCheck {
    const expected = new Set(plan.marks.map(m => m.token));
    const seen = new Map<string, number>();
    const unknown: string[] = [];
    const misplaced: string[] = [];
    for (const match of text.matchAll(TOKEN)) {
        const token = match[0];
        seen.set(token, (seen.get(token) ?? 0) + 1);
        if (!expected.has(token)) {
            unknown.push(token);
            continue;
        }
        // Numbered results must open their sentence, so the chat's numbers
        // line up with the badges; a context or next-step marker inside a
        // sentence still reads as an inline chip.
        const numbered = /^\[\[\d+\]\]$/.test(token);
        if (numbered && !startsSentence(text, match.index!)) {
            misplaced.push(token);
        }
    }
    const missing = [...expected].filter(t => !seen.has(t));
    const duplicated = [...seen]
        .filter(([t, n]) => expected.has(t) && n > 1)
        .map(([t]) => t);
    return {
        linkable: [...seen.keys()].some(t => expected.has(t)),
        ok:
            missing.length === 0 &&
            unknown.length === 0 &&
            misplaced.length === 0 &&
            duplicated.length === 0,
        missing,
        unknown,
        misplaced,
        duplicated,
    };
}

const CHIP_LABELS: Record<string, string> = { context: '◎', next: '→' };

/** Tokens as links the chat renders as chips (#chat-mark-<token>). */
export function tokensToLinks(
    text: string,
    plan: BadgePlan | undefined
): string {
    const known = new Set(plan?.marks.map(m => m.token) ?? []);
    return text.replace(TOKEN, (token, name: string) =>
        known.has(token)
            ? `[${CHIP_LABELS[name] ?? name}](#chat-mark-${name})`
            : ''
    );
}

/** The text without tokens, for a reply whose text and marks disagree. */
export function stripTokens(text: string): string {
    return text.replace(/\[\[(?:\d+|context|next)\]\]\s?/g, '');
}

export function tokenFromHref(href: string | undefined): string | undefined {
    const match = /^#chat-mark-(\d+|context|next)$/.exec(href ?? '');
    return match ? `[[${match[1]}]]` : undefined;
}

/** Whether a mark shows while a part chip is selected ('all' shows all). */
export function visibleForPart(mark: PlanMark, selected: string): boolean {
    return (
        selected === 'all' || mark.part === 'shared' || mark.part === selected
    );
}

/** The context marker's tooltip, from the cohort the slots describe now. */
export function contextTooltip(slots: {
    cohort: { value: string | null; status: string };
    study: { value: string | null; status: string };
    filter: { value: string | null; status: string };
}): string {
    const value = (s: { value: string | null; status: string }) =>
        s.status === 'specified' && s.value ? s.value : null;
    const cohort = value(slots.cohort);
    const study = value(slots.study)?.replace(/\s*\[[^\]]+\]\s*$/, '');
    const filter = value(slots.filter);
    // A study named after the cohort says it already.
    const cohortShown =
        cohort === 'whole study' ||
        (cohort && study?.toLowerCase().includes(cohort.toLowerCase()))
            ? null
            : cohort;
    return cleanTooltip(
        [cohortShown, study, filter].filter(Boolean).join(', ') ||
            'The cohort you are looking at'
    );
}
