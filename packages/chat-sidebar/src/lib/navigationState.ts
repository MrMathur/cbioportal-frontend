import { PageEvent } from './page-events';
import { studyIdsFromHref } from './pageStudies';

// Navigation the sidebar started (go_to_page, the portal following the
// research question, a restore), so a tool that needs the page the user will
// see can wait for it to finish loading.

let pendingFrom: string | undefined;
let pendingTo: string | undefined;
let pending = false;
let latestSettled: PageEvent | undefined;
const waiters = new Set<() => void>();

// A page that has landed keeps filling in after its first settled report
// (Study View lists its charts a moment later), so it counts as ready once
// no new report has come for QUIET_MS, or SETTLE_MAX_MS after landing.
const QUIET_MS = 1_000;
const SETTLE_MAX_MS = 5_000;
let landedAt: number | undefined;
let quietTimer: ReturnType<typeof setTimeout> | undefined;

function release(): void {
    clearTimeout(quietTimer);
    quietTimer = undefined;
    landedAt = undefined;
    pending = false;
    for (const resolve of waiters) resolve();
    waiters.clear();
}

/**
 * Called just before the sidebar asks the portal to navigate, from the page
 * it is on to a portal path ("/study/summary?id=…").
 */
export function markNavigationStarted(
    fromHref: string | undefined,
    toPath?: string
): void {
    clearTimeout(quietTimer);
    quietTimer = undefined;
    landedAt = undefined;
    pending = true;
    pendingFrom = fromHref;
    pendingTo = toPath;
}

// The page type the host reports for a portal path (its pageDetails.ts), or
// undefined for paths without one.
function expectedPageType(path: string): string | undefined {
    const pathname = path.split(/[?#]/)[0].replace(/\/+$/, '');
    if (pathname === '' || pathname.endsWith('/index.do')) {
        return 'studySelection';
    }
    if (/\/study(\/|$)/.test(pathname)) return 'study';
    if (/\/results(\/|$)/.test(pathname)) return 'results';
    if (/\/comparison(\/|$)/.test(pathname)) return 'groupComparison';
    if (/\/patient(\/|$)/.test(pathname)) return 'patient';
    return undefined;
}

/**
 * Whether a settled page is the one a navigation was going to. The address
 * changes as soon as the portal starts navigating, while the old page may
 * still be what the host describes; so the page type, and the studies, must
 * match the path too.
 */
export function hasLanded(
    event: PageEvent,
    fromHref: string | undefined,
    toPath: string | undefined
): boolean {
    if (event.href === fromHref) return false;
    if (!toPath) return true;
    const expected = expectedPageType(toPath);
    if (!expected) return true;
    const pageType = event.details.available
        ? String(event.details.pageType)
        : undefined;
    if (pageType !== expected) return false;
    const wanted = studyIdsFromHref(
        `https://portal${toPath.startsWith('/') ? '' : '/'}${toPath}`
    );
    if (wanted.length === 0) return true;
    const shown = new Set(studyIdsFromHref(event.href));
    return wanted.every(id => shown.has(id));
}

/** Called with every settled page the host reports. */
export function noteSettledPage(event: PageEvent): void {
    latestSettled = event;
    if (!pending) return;
    if (landedAt === undefined) {
        if (!hasLanded(event, pendingFrom, pendingTo)) return;
        landedAt = Date.now();
    }
    clearTimeout(quietTimer);
    if (Date.now() - landedAt >= SETTLE_MAX_MS) {
        release();
        return;
    }
    quietTimer = setTimeout(release, QUIET_MS);
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
                if (waiters.size === 0) release();
                resolve();
            }, timeoutMs);
            waiters.add(done);
        });
    }
    return latestSettled;
}
