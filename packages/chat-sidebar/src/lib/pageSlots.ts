import { Catalog, StudyContext } from './catalogMatch';
import { SlotName } from './classification';
import { studyIdsFromHref } from './pageStudies';

// The research-question slots a portal page fixes: the open study, the Study
// View filters (cancer type filters as the cohort, other clinical filters as
// the filter, gene filters as the entity) and the Results View gene query.
// Pure, so it can be tested without a host page.

export type PageSlots = Partial<Record<SlotName, string>>;

const COHORT_ATTRIBUTES = new Set([
    'CANCER_TYPE',
    'CANCER_TYPE_DETAILED',
    'ONCOTREE_CODE',
]);
const MAX_NAMED = 3;
const MAX_STUDIES_NAMED = 3;

interface DataFilterValue {
    value?: string;
    start?: number;
    end?: number;
}

interface StudyViewFilterLike {
    clinicalDataFilters?: {
        attributeId?: string;
        values?: DataFilterValue[];
    }[];
    geneFilters?: {
        geneQueries?: { hugoGeneSymbol?: string }[][];
    }[];
    sampleIdentifiers?: unknown[];
}

function listNames(values: string[]): string {
    if (values.length <= MAX_NAMED) return values.join(', ');
    return `${values.slice(0, MAX_NAMED).join(', ')} +${values.length -
        MAX_NAMED}`;
}

function formatValues(values: DataFilterValue[] = []): string {
    return listNames(
        values.map(v => {
            if (typeof v.value === 'string') return v.value;
            const hasStart = typeof v.start === 'number';
            const hasEnd = typeof v.end === 'number';
            if (hasStart && hasEnd) return `${v.start}–${v.end}`;
            if (hasStart) return `≥ ${v.start}`;
            if (hasEnd) return `≤ ${v.end}`;
            return '';
        })
    );
}

/** Study View's filters from the snapshot href's #filterJson=… fragment. */
export function filtersFromHref(href: string): StudyViewFilterLike | undefined {
    const hashAt = href.indexOf('#');
    if (hashAt < 0) return undefined;
    const match = /(?:^|&)filterJson=(.*)$/s.exec(href.slice(hashAt + 1));
    if (!match) return undefined;
    for (const candidate of [match[1], safeDecode(match[1])]) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch {
            /* try the decoded form */
        }
    }
    return undefined;
}

function safeDecode(text: string): string {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

function pageKind(href: string): 'study' | 'results' | 'other' {
    try {
        const path = new URL(href).pathname;
        if (/\/study(\/|$)/.test(path)) return 'study';
        if (/\/results(\/|$)/.test(path)) return 'results';
    } catch {
        /* not a page URL */
    }
    return 'other';
}

export function slotsFromPage(
    href: string,
    details: Record<string, unknown>,
    catalog?: Catalog,
    studyContext?: StudyContext
): PageSlots {
    const kind = pageKind(href);
    if (kind === 'other') return {};
    const slots: PageSlots = {};

    const studyIds = studyIdsFromHref(href);
    if (studyIds.length > 0) {
        const names = studyIds.map(
            id => catalog?.studies.find(s => s.studyId === id)?.name ?? id
        );
        slots.study =
            names.length > MAX_STUDIES_NAMED
                ? `${names.length} studies`
                : names.join('; ');
    }

    if (kind === 'results') {
        const genes = Array.isArray(details.hugoGeneSymbols)
            ? details.hugoGeneSymbols.filter(
                  (g): g is string => typeof g === 'string'
              )
            : [];
        if (genes.length) slots.entity = listNames(genes);
        return slots;
    }

    const filters = filtersFromHref(href);
    if (!filters) return slots;
    const attributeName = (id: string) =>
        studyContext?.clinicalAttributes.find(a => a.id === id)?.name ?? id;

    const cohortParts: string[] = [];
    const filterParts: string[] = [];
    for (const f of filters.clinicalDataFilters ?? []) {
        if (!f.attributeId) continue;
        const values = formatValues(f.values);
        if (!values) continue;
        if (COHORT_ATTRIBUTES.has(f.attributeId)) {
            cohortParts.push(values);
        } else {
            filterParts.push(`${attributeName(f.attributeId)}: ${values}`);
        }
    }
    if ((filters.sampleIdentifiers ?? []).length > 0) {
        filterParts.push('custom sample selection');
    }
    if (cohortParts.length) slots.cohort = cohortParts.join('; ');
    if (filterParts.length) slots.filter = filterParts.join('; ');

    const genes = new Set<string>();
    for (const g of filters.geneFilters ?? []) {
        for (const group of g.geneQueries ?? []) {
            for (const query of group) {
                if (query.hugoGeneSymbol) genes.add(query.hugoGeneSymbol);
            }
        }
    }
    if (genes.size) slots.entity = listNames([...genes]);
    return slots;
}
