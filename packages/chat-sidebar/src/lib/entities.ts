// Entities are terms in a reply tied to something on the dashboard. The model
// writes them as markdown links with a fragment href:
//
//   [PIK3CA](#entity/gene/PIK3CA?role=subject)
//   [TP53](#entity/gene/TP53?role=compare)
//   [Mutation Count](#entity/chart/MUTATION_COUNT)
//   [Invasive Ductal](#entity/category/CANCER_TYPE_DETAILED/Breast%20Invasive%20Ductal%20Carcinoma)
//   [ER Status](#entity/column/ER%20Status)
//
// The role says what part the term plays in the reply, and sets its colour
// here and on the dashboard: the subject of the question, what it is compared
// to, a filter or cohort selection, or supporting context. Without a role a
// term is context.

export type EntityType = 'gene' | 'chart' | 'category' | 'column';
export type EntityRole = 'subject' | 'compare' | 'filter' | 'context';

export interface Entity {
    type: EntityType;
    id: string;
    // The chart a category belongs to.
    chartKey?: string;
    role: EntityRole;
}

const ENTITY_HREF = /^#entity\/(gene|chart|category|column)\/([^?]+)(?:\?(.*))?$/;

// Older replies mark the two sides of a comparison as threads a and b.
const THREAD_ROLES: Record<string, EntityRole> = { a: 'subject', b: 'compare' };
const ROLES: readonly string[] = ['subject', 'compare', 'filter', 'context'];

// A missing or unknown role still links the term, as context.
function roleOf(query: string | undefined): EntityRole {
    const params = new URLSearchParams(query ?? '');
    const role = params.get('role');
    if (role && ROLES.includes(role)) return role as EntityRole;
    return THREAD_ROLES[params.get('thread') ?? ''] ?? 'context';
}

function decode(value: string): string | undefined {
    try {
        return decodeURIComponent(value);
    } catch {
        return undefined;
    }
}

export function parseEntityHref(href: string | undefined): Entity | undefined {
    const match = href ? ENTITY_HREF.exec(href) : null;
    if (!match) return undefined;
    const [, type, path, query] = match;
    const parts = path.split('/').map(decode);
    if (parts.some(part => !part)) return undefined;
    const entityRole = roleOf(query);
    if (type === 'category') {
        if (parts.length !== 2) return undefined;
        return {
            type,
            chartKey: parts[0],
            id: parts[1]!,
            role: entityRole,
        };
    }
    if (parts.length !== 1) return undefined;
    return { type: type as EntityType, id: parts[0]!, role: entityRole };
}

// The parts of the host's page details that say what can be highlighted.
interface StudyPageTargets {
    pageType?: string;
    currentTab?: string;
    visibleCharts?: { uniqueKey: string }[];
    topMutatedGenes?: { gene: string }[];
    categoricalCharts?: {
        uniqueKey: string;
        values: { value: string }[];
    }[];
    clinicalDataColumns?: string[];
}

// Whether the entity has something to highlight on the page as it is now.
export function isEntityOnPage(
    entity: Entity,
    details: StudyPageTargets | undefined
): boolean {
    if (details?.pageType !== 'study') return false;
    if (entity.type === 'column') {
        return (details.clinicalDataColumns ?? []).includes(entity.id);
    }
    if (details.currentTab !== 'summary') return false;
    switch (entity.type) {
        case 'gene':
            return (details.topMutatedGenes ?? []).some(
                g => g.gene === entity.id
            );
        case 'chart':
            return (details.visibleCharts ?? []).some(
                c => c.uniqueKey === entity.id
            );
        case 'category':
            return (details.categoricalCharts ?? []).some(
                c =>
                    c.uniqueKey === entity.chartKey &&
                    c.values.some(v => v.value === entity.id)
            );
    }
}
