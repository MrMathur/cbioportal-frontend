import { Candidate, CONTEXT_TARGET, markKey } from './badgePlan';
import { PageEvent } from './page-events';

// The elements of a page the reply may mark (the host's highlight
// candidates), as sent to the chat server and returned by go_to_page.

const MAX_TARGETS = 80;

export function pageCandidates(event: PageEvent | undefined): Candidate[] {
    const raw = event?.details.highlightCandidates;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
        (c): c is Candidate =>
            typeof c?.targetType === 'string' &&
            typeof c.targetId === 'string' &&
            typeof c.label === 'string'
    );
}

/**
 * What the reply is offered: the page's elements without its study list
 * (hundreds of studies; the server offers the catalog's matching ones) and
 * without the cohort summary, which only the context mark uses.
 */
export function markableTargets(event: PageEvent | undefined): Candidate[] {
    const contextKey = markKey(CONTEXT_TARGET);
    return pageCandidates(event)
        .filter(c => c.targetType !== 'study' && markKey(c) !== contextKey)
        .slice(0, MAX_TARGETS)
        .map(({ targetType, targetId, label, description }) => ({
            targetType,
            targetId,
            label,
            description,
        }));
}

export function pageTypeOf(event: PageEvent | undefined): string | undefined {
    return event?.details.available
        ? String(event.details.pageType)
        : undefined;
}
