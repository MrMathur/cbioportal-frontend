// What the reply may mark on the portal this turn (set_highlights). The
// elements must be ones the user will see: the home page's study list when
// the sidebar sends the portal home (it does so below L4 while the study
// isn't settled, mirroring the sidebar's portalTarget.ts), otherwise the
// elements of the page that is open. Pure, so it can be tested.

import { Classification, GuidanceContext } from './classification.js';

export interface MarkTarget {
    targetType: string;
    targetId: string;
    label: string;
    description?: string;
}

export type MarkPage = 'current' | 'home' | 'study-summary';

// Tabs of pages the user isn't on yet, which a next step or the answer's
// results may point at; shown once the user gets there.
export const OTHER_PAGE_TABS: readonly MarkTarget[] = [
    { targetType: 'results-tab', targetId: 'oncoprint', label: 'OncoPrint' },
    {
        targetType: 'results-tab',
        targetId: 'cancerTypesSummary',
        label: 'Cancer Types Summary',
    },
    {
        targetType: 'results-tab',
        targetId: 'mutualExclusivity',
        label: 'Mutual Exclusivity',
    },
    { targetType: 'results-tab', targetId: 'plots', label: 'Plots' },
    { targetType: 'results-tab', targetId: 'mutations', label: 'Mutations' },
    {
        targetType: 'results-tab',
        targetId: 'comparison',
        label: 'Comparison/Survival',
    },
    {
        targetType: 'results-tab',
        targetId: 'coexpression',
        label: 'Co-expression',
    },
    { targetType: 'results-tab', targetId: 'download', label: 'Download' },
    { targetType: 'comparison-tab', targetId: 'overlap', label: 'Overlap' },
    { targetType: 'comparison-tab', targetId: 'survival', label: 'Survival' },
    { targetType: 'comparison-tab', targetId: 'clinical', label: 'Clinical' },
    {
        targetType: 'comparison-tab',
        targetId: 'alterations',
        label: 'Genomic Alterations',
    },
    { targetType: 'comparison-tab', targetId: 'mrna', label: 'mRNA' },
    { targetType: 'comparison-tab', targetId: 'protein', label: 'Protein' },
];

const HOME_CONTROLS: readonly MarkTarget[] = [
    {
        targetType: 'control',
        targetId: 'study-search',
        label: 'Study search box',
    },
    {
        targetType: 'control',
        targetId: 'gene-query',
        label: 'Gene / OQL query box',
    },
];

const MAX_HOME_STUDIES = 25;
const MAX_PAGE_TARGETS = 60;

/** Where the portal will be for this answer (sidebar's portalTarget.ts). */
export function markPage(
    c: Classification,
    pageType: string | undefined
): MarkPage {
    if (c.request_type !== 'data' && c.request_type !== 'catalog') {
        return 'current';
    }
    if (c.open_study_applies) return 'current';
    if (c.request_type === 'catalog') return 'home';
    if (c.level === 'L4') return 'current';
    if (c.slots.study.status === 'specified') return 'study-summary';
    return pageType === 'studySelection' ? 'current' : 'home';
}

function homeTargets(
    c: Classification,
    context: GuidanceContext
): MarkTarget[] {
    const studies = context.catalog?.studies ?? [];
    // The classification's study options first: they are the candidates the
    // answer is meant to list.
    const optionIds = c.slots.study.options
        .map(o => /\[([^\]]+)\]\s*$/.exec(o)?.[1])
        .filter((id): id is string => Boolean(id));
    const byId = new Map(studies.map(s => [s.studyId, s]));
    const optionStudies = optionIds
        .map(id => byId.get(id))
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const ordered = [
        ...optionStudies,
        ...studies.filter(s => !optionIds.includes(s.studyId)),
    ];
    return [
        ...ordered.slice(0, MAX_HOME_STUDIES).map(s => ({
            targetType: 'study',
            targetId: s.studyId,
            label: s.name,
            description: `${s.sampleCount} samples; cancer type ${s.cancerTypeId}`,
        })),
        ...HOME_CONTROLS,
    ];
}

/** The elements the reply may mark, and which page they are on. */
export function markTargetsFor(
    c: Classification,
    context: GuidanceContext
): { page: MarkPage; targets: MarkTarget[] } {
    const page = markPage(c, context.pageType);
    if (page === 'home') return { page, targets: homeTargets(c, context) };
    if (page === 'study-summary') return { page, targets: [] };
    if (context.pageType === 'studySelection') {
        // On the home page already: its study list is the one in the catalog
        // matches, not the hundreds the page offers.
        return { page, targets: homeTargets(c, context) };
    }
    return {
        page,
        targets: (context.pageTargets ?? []).slice(0, MAX_PAGE_TARGETS),
    };
}

function line(t: MarkTarget): string {
    return `${t.targetType}:${t.targetId} | ${t.label}${
        t.description ? ` | ${t.description}` : ''
    }`;
}

/** The marks section of the reply's guidance. */
export function formatMarkTargets(
    page: MarkPage,
    targets: readonly MarkTarget[]
): string {
    const where =
        page === 'home'
            ? 'The sidebar is taking the user to the home page; these are its elements for this answer'
            : page === 'study-summary'
            ? "The sidebar is opening the study's summary page; there is nothing to mark on it this turn"
            : 'Elements on the page the user is on';
    const list = targets.length
        ? targets.map(line).join('\n')
        : "(none: don't call `set_highlights` unless `go_to_page` returns elements)";
    return `### Elements you can mark (\`target\` | label | details)\n\n${where}:\n\n${list}\n\n### Tabs on other pages (for results shown once the user gets there; never for the next step, which goes on this page)\n\n${OTHER_PAGE_TABS.map(
        line
    ).join('\n')}`;
}
