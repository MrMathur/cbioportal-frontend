// The guided assistant (request classification, research question levels,
// earlier questions) is opt-in. The host passes its flags in this iframe's
// URL; the iframe's own localStorage works too, for the dev server opened on
// its own.

function readFlag(param: string, storageKey: string): boolean {
    if (new URLSearchParams(window.location.search).get(param) === '1') {
        return true;
    }
    try {
        return localStorage.getItem(storageKey) === '1';
    } catch {
        return false;
    }
}

export const guidanceEnabled = readFlag('guidance', 'chat-sidebar:guidance');

// The per-reply classification badge, for checking the classifier. Kept
// separate so study participants never see it.
export const guidanceDebug =
    guidanceEnabled && readFlag('guidanceDebug', 'chat-sidebar:guidanceDebug');

const SESSION_KEY = 'chat-sidebar:guidanceSession';

function readSessionId(): string {
    try {
        const existing = sessionStorage.getItem(SESSION_KEY);
        if (existing) return existing;
        const id = crypto.randomUUID();
        sessionStorage.setItem(SESSION_KEY, id);
        return id;
    } catch {
        return crypto.randomUUID();
    }
}

// One per browser tab session; ties the log's events together.
export const guidanceSessionId = guidanceEnabled ? readSessionId() : '';

// Optional participant code for a user study, passed by the host from its
// own localStorage (chat-sidebar:participant).
export const guidanceParticipant =
    new URLSearchParams(window.location.search).get('participant') ?? '';
