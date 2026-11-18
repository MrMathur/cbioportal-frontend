import { studyIdsFromHref } from './pageStudies';

// What the user did on the page besides changing Study View filters: ticking
// studies in the home page's list, opening the gene query form, opening
// another page. Each is described in words the sidebar sends for them ("On
// the page, I …"), so the chat can say what the step means for the question.
// Pure, so it can be tested.

export interface PageView {
    pageType: string;
    // Sorted study ids: ticked in the list, or the page's own.
    studies: string[];
    // The home page's form: the study list, or the gene form after "Query By
    // Gene".
    step?: 'studies' | 'genes';
    genes: string[];
    // Group Comparison: the groups compared.
    groups?: string[];
}

const MAX_NAMED = 3;

export function pageViewOf(
    href: string,
    details: Record<string, unknown>
): PageView | undefined {
    const pageType =
        typeof details.pageType === 'string' ? details.pageType : undefined;
    if (!pageType) return undefined;
    const strings = (v: unknown) =>
        Array.isArray(v)
            ? v.filter((x): x is string => typeof x === 'string')
            : [];
    const studies =
        pageType === 'studySelection'
            ? strings(details.selectedStudyIds)
            : studyIdsFromHref(href);
    return {
        pageType,
        studies: [...studies].sort(),
        step:
            pageType === 'studySelection'
                ? details.step === 'genes'
                    ? 'genes'
                    : 'studies'
                : undefined,
        genes: pageType === 'results' ? strings(details.hugoGeneSymbols) : [],
        groups:
            pageType === 'groupComparison' && Array.isArray(details.groups)
                ? details.groups
                      .map(g => (g as { name?: unknown } | null)?.name)
                      .filter((n): n is string => typeof n === 'string')
                : undefined,
    };
}

/** Same page and studies (and genes), whatever the form step. */
export function samePage(a: PageView, b: PageView): boolean {
    return (
        a.pageType === b.pageType &&
        sameList(a.studies, b.studies) &&
        sameList(a.genes, b.genes) &&
        sameList(a.groups ?? [], b.groups ?? [])
    );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

function nameList(names: string[]): string {
    if (names.length <= MAX_NAMED) return names.join('; ');
    return `${names.slice(0, MAX_NAMED).join('; ')} and ${names.length -
        MAX_NAMED} more`;
}

/**
 * The user's step from one page view to the next, in words that follow "I"
 * ("selected the study …"), or undefined when it isn't one worth reporting:
 * nothing changed, the selection was cleared, or the user went back to the
 * study list. Filter changes on one study are reported elsewhere (topics.ts).
 */
export function describeNavigation(
    before: PageView,
    after: PageView,
    studyName: (id: string) => string
): string | undefined {
    const studies = nameList(after.studies.map(studyName));
    const sameStudies = sameList(before.studies, after.studies);
    if (after.pageType === 'studySelection') {
        if (after.studies.length === 0) return undefined;
        if (after.step === 'genes') {
            return before.pageType === 'studySelection' &&
                before.step === 'genes' &&
                sameStudies
                ? undefined
                : `clicked "Query By Gene" for ${studies}, which opened the form for entering genes`;
        }
        if (before.pageType === 'studySelection' && sameStudies) {
            return undefined;
        }
        return `selected ${
            after.studies.length === 1 ? 'the study' : 'the studies'
        } ${studies} in the study list`;
    }
    if (samePage(before, after)) return undefined;
    const of = (word: string) => (studies ? ` ${word} ${studies}` : '');
    switch (after.pageType) {
        case 'study':
            return `opened the Study View${of('of')}`;
        case 'results':
            return after.genes.length
                ? `ran a query for ${nameList(after.genes)}${of('in')}`
                : `opened the query results${of('for')}`;
        case 'groupComparison':
            return after.groups?.length
                ? `opened Group Comparison with the groups ${nameList(
                      after.groups
                  )}`
                : `opened Group Comparison${of('for')}`;
        case 'patient':
            return `opened a patient's page${of('in')}`;
        default:
            return undefined;
    }
}
