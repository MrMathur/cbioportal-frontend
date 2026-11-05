import { PageEvent } from './page-events';

// Navigation the sidebar started (go_to_page, the portal following the
// research question, a restore), so a tool that needs the page the user will
// see can wait for it to finish loading.

let pendingFrom: string | undefined;
let pending = false;
let latestSettled: PageEvent | undefined;
const waiters = new Set<() => void>();

/** Called just before the sidebar asks the portal to navigate. */
export function markNavigationStarted(fromHref: string | undefined): void {
    pending = true;
    pendingFrom = fromHref;
}

/** Called with every settled page the host reports. */
export function noteSettledPage(event: PageEvent): void {
    latestSettled = event;
    if (pending && event.href !== pendingFrom) {
        pending = false;
        for (const resolve of waiters) resolve();
        waiters.clear();
    }
}

/**
 * The settled page the user is on, after any navigation the sidebar started
 * has landed (or the timeout passed, in which case the latest one).
 */
export async function waitForPageReady(
    timeoutMs = 15_000
): Promise<PageEvent | undefined> {
    if (pending) {
        await new Promise<void>(resolve => {
            const done = () => {
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                waiters.delete(done);
                pending = false;
                resolve();
            }, timeoutMs);
            waiters.add(done);
        });
    }
    return latestSettled;
}
