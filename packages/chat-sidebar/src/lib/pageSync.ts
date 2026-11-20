import { getCatalog, getStudyContext, subscribeToCatalog } from './catalog';
import { guidanceEnabled } from './guidanceFlags';
import { PageEvent } from './page-events';
import {
    describeNavigation,
    PageView,
    pageViewOf,
    samePage,
} from './pageNavigation';
import { slotsFromPage } from './pageSlots';
import {
    recordPageChange,
    recordPageNavigation,
    setPageSlots,
    subscribeToResearch,
    takeExpectedPageView,
} from './researchQuestion';
import { PREFIX } from './threadStorage';

// Keeps the research-question slots in step with the page (page → slots):
// on every settled page, and again once the catalog or the open studies'
// context arrives, which names the study and the filtered attributes. Also
// records the user's own steps on the page for the chat to respond to.

let page: PageEvent | undefined;
// The last page view with details, to tell what the user's step changed.
let lastView: PageView | undefined;
// A step seen before the chat had loaded (in a new tab), recorded once it has.
let waitingStep: { did: string; href: string; at: number } | undefined;

// The last view is shared with other tabs: the portal opens some pages (Group
// Comparison from a Study View chart) in a new tab, whose sidebar starts
// without one.
const LAST_VIEW_KEY = `${PREFIX}lastPageView`;
const SHARED_VIEW_MS = 60_000;

function saveView(view: PageView): void {
    try {
        localStorage.setItem(
            LAST_VIEW_KEY,
            JSON.stringify({ view, at: Date.now() })
        );
    } catch {
        /* other tabs just won't know where the user came from */
    }
}

function sharedView(): PageView | undefined {
    try {
        const saved = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) ?? 'null');
        if (
            saved &&
            typeof saved.at === 'number' &&
            Date.now() - saved.at < SHARED_VIEW_MS &&
            saved.view &&
            typeof saved.view.pageType === 'string'
        ) {
            return saved.view as PageView;
        }
    } catch {
        /* nothing saved */
    }
    return undefined;
}

function record(did: string, href: string): void {
    waitingStep = recordPageNavigation(did, href)
        ? undefined
        : { did, href, at: Date.now() };
}

function recordWaitingStep(): void {
    if (!waitingStep) return;
    if (Date.now() - waitingStep.at > SHARED_VIEW_MS) {
        waitingStep = undefined;
        return;
    }
    const { did, href } = waitingStep;
    waitingStep = undefined;
    record(did, href);
}

function sync(): void {
    if (!guidanceEnabled || !page) return;
    setPageSlots(
        slotsFromPage(page.href, page.details, getCatalog(), getStudyContext()),
        page.href
    );
}

function studyName(id: string): string {
    return getCatalog()?.studies.find(s => s.studyId === id)?.name ?? id;
}

function recordNavigation(event: PageEvent): void {
    // Pages mid-load report no details; the view they settle on counts.
    const view = pageViewOf(event.href, event.details);
    if (!view) return;
    const before = lastView ?? sharedView();
    lastView = view;
    saveView(view);
    if (!before) return;
    // Where the sidebar itself took the portal: not the user's step.
    if (!samePage(before, view) && takeExpectedPageView()) return;
    const did = describeNavigation(before, view, studyName);
    if (did) record(did, event.href);
}

export function setPageSyncPage(event: PageEvent): void {
    if (event.pending) return;
    page = event;
    sync();
    // After the slots, so a recorded step carries the page's new slots.
    recordNavigation(event);
    recordPageChange(event.href);
}

if (guidanceEnabled) {
    subscribeToCatalog(sync);
    subscribeToResearch(recordWaitingStep);
}
