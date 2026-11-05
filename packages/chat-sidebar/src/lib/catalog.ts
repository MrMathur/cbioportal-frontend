import {
    Catalog,
    CatalogMatches,
    matchCatalog,
    StudyContext,
} from './catalogMatch';
import { guidanceEnabled } from './guidanceFlags';
import { PageEvent } from './page-events';
import { studyIdsFromHref } from './pageStudies';
import { embedded, isFromParent, parentOrigin } from './parent-origin';

// The portal's catalog and the context of the studies on screen, requested
// from the host (its catalog.ts), which fetches them with the portal's own API
// client. Only used by the guided assistant.

let catalog: Catalog | undefined;
let catalogError: string | undefined;
let studyContext: StudyContext | undefined;
let selectedStudyIds: string[] = [];
let requestedContextKey = '';

const catalogWaiters = new Set<() => void>();
const changeListeners = new Set<() => void>();

/** Called when the catalog or the open studies' context arrives. */
export function subscribeToCatalog(listener: () => void): () => void {
    changeListeners.add(listener);
    return () => {
        changeListeners.delete(listener);
    };
}

function notifyChange(): void {
    for (const listener of changeListeners) listener();
}

function requestCatalog(): void {
    window.parent.postMessage(
        { type: 'chat-sidebar:requestCatalog' },
        parentOrigin()
    );
}

function onMessage(e: MessageEvent): void {
    if (!isFromParent(e)) return;
    if (e.data?.type === 'chat-sidebar:catalog') {
        if (e.data.catalog) {
            catalog = e.data.catalog as Catalog;
            catalogError = undefined;
        } else {
            catalogError = String(e.data.error ?? 'unknown error');
            console.warn('[chat-sidebar] catalog unavailable:', catalogError);
        }
        for (const resolve of catalogWaiters) resolve();
        catalogWaiters.clear();
        notifyChange();
        return;
    }
    if (e.data?.type === 'chat-sidebar:studyContext') {
        const context = e.data.context as StudyContext | undefined;
        if (context) {
            studyContext = context;
            notifyChange();
        }
    }
}

/** Starts listening and asks for the catalog; a no-op unless enabled. */
export function initCatalog(): void {
    if (!guidanceEnabled || !embedded) return;
    window.addEventListener('message', onMessage);
    requestCatalog();
}

/** Called with every snapshot the host sends. */
export function setCatalogPage(event: PageEvent): void {
    if (!guidanceEnabled || !embedded) return;
    selectedStudyIds = studyIdsFromHref(event.href);
    const key = [...selectedStudyIds].sort().join(',');
    if (!key || key === requestedContextKey) return;
    requestedContextKey = key;
    window.parent.postMessage(
        {
            type: 'chat-sidebar:requestStudyContext',
            studyIds: selectedStudyIds,
        },
        parentOrigin()
    );
}

export function getSelectedStudyIds(): readonly string[] {
    return selectedStudyIds;
}

export function getCatalog(): Catalog | undefined {
    return catalog;
}

export function getStudyContext(): StudyContext | undefined {
    return studyContext;
}

// Long enough for the host's first fetch on a cold page; the message is sent
// without catalog matches after that rather than held up.
const CATALOG_WAIT_MS = 4000;

/** The catalog, waiting briefly for it if the host hasn't answered yet. */
export async function waitForCatalog(): Promise<Catalog | undefined> {
    if (catalog || !guidanceEnabled || !embedded) return catalog;
    if (catalogError) {
        catalogError = undefined;
        requestCatalog();
    }
    await new Promise<void>(resolve => {
        const done = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            catalogWaiters.delete(done);
            resolve();
        }, CATALOG_WAIT_MS);
        catalogWaiters.add(done);
    });
    return catalog;
}

/** Catalog entries the text plausibly refers to, or undefined without one. */
export async function matchCatalogFor(
    text: string
): Promise<CatalogMatches | undefined> {
    const loaded = await waitForCatalog();
    if (!loaded) return undefined;
    return matchCatalog(loaded, text, selectedStudyIds, studyContext);
}
