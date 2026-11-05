import { getCatalog, getStudyContext, subscribeToCatalog } from './catalog';
import { guidanceEnabled } from './guidanceFlags';
import { PageEvent } from './page-events';
import { slotsFromPage } from './pageSlots';
import { setPageSlots } from './researchQuestion';

// Keeps the research-question slots in step with the page (page → slots):
// on every settled page, and again once the catalog or the open studies'
// context arrives, which names the study and the filtered attributes.

let page: PageEvent | undefined;

function sync(): void {
    if (!guidanceEnabled || !page) return;
    setPageSlots(
        slotsFromPage(page.href, page.details, getCatalog(), getStudyContext())
    );
}

export function setPageSyncPage(event: PageEvent): void {
    if (event.pending) return;
    page = event;
    sync();
}

if (guidanceEnabled) subscribeToCatalog(sync);
