import { getCatalog } from './catalog';
import { Classification } from './classification';
import { guidanceEnabled } from './guidanceFlags';
import { logGuidanceEvent } from './guidanceLog';
import { getLatestPageEvents, getPageType } from './page-events';
import { notifyNavigate } from './portal-link';
import {
    CurrentPage,
    pathFor,
    PortalTarget,
    targetForClassification,
    targetForSlots,
} from './portalTarget';
import { expectPageNavigation, getActiveResearch } from './researchQuestion';

// Moves the portal along with the research question (portalTarget.ts): after
// a message is classified, and after the user edits the slots in the box.

function currentPage(): CurrentPage {
    return {
        href: getLatestPageEvents().settledSnapshot?.href,
        pageType: getPageType(),
    };
}

function go(
    target: PortalTarget | null,
    trigger: 'classification' | 'slot_edit'
): void {
    if (!target) return;
    const path = pathFor(target);
    expectPageNavigation();
    notifyNavigate(path);
    const research = getActiveResearch();
    logGuidanceEvent(
        'portal_navigation',
        research.threadId ?? research.localThreadId,
        { trigger, href: path, target: target.kind }
    );
}

/** After a message's classification arrives, for the chat on screen. */
export function syncPortalToClassification(
    c: Classification,
    localThreadId: string
): void {
    if (!guidanceEnabled) return;
    if (localThreadId !== getActiveResearch().localThreadId) return;
    go(
        targetForClassification(c, getCatalog()?.studies ?? [], currentPage()),
        'classification'
    );
}

/** After the user changed a slot in the research question box. */
export function syncPortalToSlots(): void {
    if (!guidanceEnabled) return;
    go(
        targetForSlots(
            getActiveResearch().slots,
            getCatalog()?.studies ?? [],
            currentPage()
        ),
        'slot_edit'
    );
}
