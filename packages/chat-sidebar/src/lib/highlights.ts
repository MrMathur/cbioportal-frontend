import {
    getSelectedModel,
    subscribe as subscribeToSession,
} from './chatSession';
import { PageEvent } from './page-events';
import { embedded, parentOrigin } from './parent-origin';
import { getActiveResearch, subscribeToResearch } from './researchQuestion';

// Badges on the elements of the user's page most relevant to the chat's
// research question. Requested from the server whenever the question or the
// page's candidate elements change, then posted to the host, which draws them.
// Independent of the chat's own turns.

export interface HighlightAnnotation {
    targetType: string;
    targetId: string;
    label: string;
    rank: number;
    reason: string;
}

interface HighlightCandidate {
    targetType: string;
    targetId: string;
    label: string;
    description?: string;
}

export interface HighlightsState {
    // idle: no question, or a page with nothing to highlight.
    status: 'idle' | 'loading' | 'ready' | 'error';
    annotations: readonly HighlightAnnotation[];
    insight: string;
    // How many elements the page offered; 0 on pages without candidates.
    candidateCount: number;
}

interface Result {
    annotations: HighlightAnnotation[];
    insight: string;
}

const IDLE: HighlightsState = {
    status: 'idle',
    annotations: [],
    insight: '',
    candidateCount: 0,
};

let state: HighlightsState = IDLE;

const listeners = new Set<() => void>();

export function subscribeToHighlights(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getHighlightsState(): HighlightsState {
    return state;
}

interface HighlightsPage {
    href: string;
    // Search string and page type: the page's identity without its tab or
    // filters, which don't change what can be highlighted.
    identity: string;
    pageType: string;
    candidates: HighlightCandidate[];
}

// The latest settled page.
let page: HighlightsPage | undefined;

// Results by request key, kept in sessionStorage too since the iframe can
// reload on navigation. Errors are kept in memory only, so a reload retries.
const SESSION_KEY = 'chat-sidebar:highlights';
const MAX_CACHED = 20;
const cache = new Map<string, Result | 'error'>();
let inFlight: { key: string; controller: AbortController } | undefined;

function readSessionCache(): [string, Result][] {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function remember(key: string, result: Result | 'error'): void {
    cache.delete(key);
    cache.set(key, result);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    if (result === 'error') return;
    const entries = readSessionCache().filter(([k]) => k !== key);
    entries.push([key, result]);
    try {
        sessionStorage.setItem(
            SESSION_KEY,
            JSON.stringify(entries.slice(-MAX_CACHED))
        );
    } catch {
        /* requested again after a reload */
    }
}

function lookUp(key: string): Result | 'error' | undefined {
    return cache.get(key) ?? readSessionCache().find(([k]) => k === key)?.[1];
}

function isCandidate(value: unknown): value is HighlightCandidate {
    const c = value as Partial<HighlightCandidate> | null;
    return (
        typeof c?.targetType === 'string' &&
        typeof c.targetId === 'string' &&
        typeof c.label === 'string'
    );
}

function toPage(event: PageEvent): HighlightsPage {
    const raw = event.details.highlightCandidates;
    const pageType = event.details.available
        ? String(event.details.pageType)
        : 'none';
    let search = '';
    try {
        search = new URL(event.href).search;
    } catch {
        /* identity falls back to the page type */
    }
    return {
        href: event.href,
        identity: `${pageType}${search}`,
        pageType,
        candidates: Array.isArray(raw) ? raw.filter(isCandidate) : [],
    };
}

function requestKey(question: string, p: HighlightsPage): string {
    return JSON.stringify([
        question,
        getSelectedModel(),
        p.identity,
        p.candidates.map(c => `${c.targetType}:${c.targetId}`),
    ]);
}

function publish(next: HighlightsState): void {
    state = next;
    for (const listener of listeners) listener();
    postToHost();
}

let lastPosted = '';

// The host keeps only what was last posted, so this sends the full set.
function postToHost(): void {
    if (!embedded) return;
    const research = getActiveResearch();
    const annotations =
        research.question && !research.dismissed && state.status === 'ready'
            ? state.annotations
            : [];
    const message = {
        type: 'chat-sidebar:highlights',
        annotations,
        focus: research.focus,
    };
    const serialized = JSON.stringify(message);
    if (serialized === lastPosted) return;
    lastPosted = serialized;
    window.parent.postMessage(message, parentOrigin());
}

function abortInFlight(): void {
    inFlight?.controller.abort();
    inFlight = undefined;
}

function update(): void {
    const { question, dismissed } = getActiveResearch();
    if (!question || dismissed || !page || page.candidates.length === 0) {
        abortInFlight();
        publish({ ...IDLE, candidateCount: page?.candidates.length ?? 0 });
        return;
    }
    const key = requestKey(question, page);
    const candidateCount = page.candidates.length;
    const cached = lookUp(key);
    if (cached) {
        abortInFlight();
        publish(
            cached === 'error'
                ? { ...IDLE, status: 'error', candidateCount }
                : { status: 'ready', ...cached, candidateCount }
        );
        return;
    }
    if (inFlight?.key === key) return;
    abortInFlight();
    publish({ ...IDLE, status: 'loading', candidateCount });
    request(key, question, page);
}

function request(key: string, question: string, p: HighlightsPage): void {
    const controller = new AbortController();
    const current = { key, controller };
    inFlight = current;
    fetch('/api/chat/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            question,
            href: p.href,
            pageType: p.pageType,
            candidates: p.candidates,
            model: getSelectedModel(),
        }),
        signal: controller.signal,
    })
        .then(async response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await response.json();
            return {
                annotations: Array.isArray(body.annotations)
                    ? body.annotations
                    : [],
                insight: typeof body.insight === 'string' ? body.insight : '',
            } as Result;
        })
        .then(
            result => {
                remember(key, result);
                if (inFlight !== current) return;
                inFlight = undefined;
                update();
            },
            err => {
                if (controller.signal.aborted) return;
                console.warn('[chat-sidebar] highlights failed', err);
                remember(key, 'error');
                if (inFlight !== current) return;
                inFlight = undefined;
                update();
            }
        );
}

/** Called with every snapshot the host sends. */
export function setHighlightsPage(event: PageEvent): void {
    // Mid-load snapshots describe a page the user never saw; the current
    // badges stay until the page settles.
    if (event.pending) return;
    page = toPage(event);
    update();
}

/** Asks again for the current question and page, after an error. */
export function retryHighlights(): void {
    const { question } = getActiveResearch();
    if (!question || !page) return;
    cache.delete(requestKey(question, page));
    update();
}

subscribeToResearch(update);
subscribeToSession(update);
