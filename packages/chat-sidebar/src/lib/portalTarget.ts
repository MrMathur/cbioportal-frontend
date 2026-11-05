import { CatalogStudy } from './catalogMatch';
import { Classification, Slots } from './classification';
import { studyIdsFromHref } from './pageStudies';

// Where the portal should be for the research question, so the visualization
// panel follows it: the home page (study list, with the matching studies
// highlighted) while the study isn't settled, the study's Study View once it
// is. Pure, so the mapping can be tested.

export type PortalTarget =
    | { kind: 'home' }
    | { kind: 'study'; studyId: string };

/** A study slot's value as a study id: "Name [id]", the name, or the id. */
export function studyIdFromValue(
    value: string | null,
    studies: readonly CatalogStudy[]
): string | undefined {
    if (!value) return undefined;
    const bracket = /\[([^\]]+)\]\s*$/.exec(value);
    if (bracket) return bracket[1];
    const wanted = value.trim().toLowerCase();
    return studies.find(
        s =>
            s.studyId.toLowerCase() === wanted ||
            s.name.toLowerCase() === wanted
    )?.studyId;
}

// Where the portal is now: its URL and the page type its details report
// ('studySelection' is the home page's study list).
export interface CurrentPage {
    href: string | undefined;
    pageType: string | undefined;
}

function isHome(current: CurrentPage): boolean {
    return current.pageType === 'studySelection';
}

function isOnStudy(href: string | undefined, studyId: string): boolean {
    if (!href) return false;
    try {
        return (
            /\/study(\/|$)/.test(new URL(href).pathname) &&
            studyIdsFromHref(href).length === 1 &&
            studyIdsFromHref(href)[0] === studyId
        );
    } catch {
        return false;
    }
}

function fromSlots(
    slots: Slots,
    studies: readonly CatalogStudy[],
    current: CurrentPage
): PortalTarget | null {
    const study = slots.study;
    if (study.status === 'specified') {
        const studyId = studyIdFromValue(study.value, studies);
        if (!studyId) return null;
        return isOnStudy(current.href, studyId)
            ? null
            : { kind: 'study', studyId };
    }
    return isHome(current) ? null : { kind: 'home' };
}

/**
 * Where a classified message should take the portal, or null to stay. At L4
 * the reply opens the exact view itself; when the open page fits the
 * question, the user stays on it.
 */
export function targetForClassification(
    c: Classification,
    studies: readonly CatalogStudy[],
    current: CurrentPage
): PortalTarget | null {
    if (c.request_type !== 'data' && c.request_type !== 'catalog') return null;
    if (c.open_study_applies) return null;
    if (c.request_type === 'catalog') {
        return isHome(current) ? null : { kind: 'home' };
    }
    if (c.level === 'L4') return null;
    return fromSlots(c.slots, studies, current);
}

/** Where the portal should go after the user edited the slots in the box. */
export function targetForSlots(
    slots: Slots,
    studies: readonly CatalogStudy[],
    current: CurrentPage
): PortalTarget | null {
    return fromSlots(slots, studies, current);
}

export function pathFor(target: PortalTarget): string {
    return target.kind === 'home'
        ? '/'
        : `/study/summary?id=${encodeURIComponent(target.studyId)}`;
}
