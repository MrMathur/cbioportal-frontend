import { PREFIX } from './threadStorage';

// Each chat's research question, which drives the page highlights
// (highlights.ts), plus whether the user has dismissed them and turned on
// focus mode. Keyed by the thread's remote id, so it lives as long as the chat.

export interface ResearchState {
    question: string;
    // Highlights hidden until the question is edited or re-applied.
    dismissed: boolean;
    // Fades the candidates on the page that aren't highlighted.
    focus: boolean;
}

export interface ActiveResearch extends ResearchState {
    threadId: string | undefined;
    // The runtime's id for the thread, which a new chat has before it's saved.
    localThreadId: string | undefined;
    // Bumped each time the chat sets the question, so the bar can show it.
    chatUpdate: number;
}

const EMPTY: ResearchState = { question: '', dismissed: false, focus: false };

function storageKey(threadId: string): string {
    return `${PREFIX}research:${threadId}`;
}

function read(threadId: string): ResearchState {
    try {
        const parsed = JSON.parse(
            localStorage.getItem(storageKey(threadId)) ?? 'null'
        );
        if (parsed && typeof parsed.question === 'string') {
            return {
                question: parsed.question,
                dismissed: parsed.dismissed === true,
                focus: parsed.focus === true,
            };
        }
    } catch {
        /* treated as no question */
    }
    return EMPTY;
}

function write(threadId: string, state: ResearchState): void {
    try {
        if (state.question) {
            localStorage.setItem(storageKey(threadId), JSON.stringify(state));
        } else {
            localStorage.removeItem(storageKey(threadId));
        }
    } catch {
        /* kept for this session only */
    }
}

let active: ActiveResearch = {
    ...EMPTY,
    threadId: undefined,
    localThreadId: undefined,
    chatUpdate: 0,
};

// Questions the chat set before its thread had a remote id, by local id.
const pendingFromChat = new Map<string, string>();

const listeners = new Set<() => void>();

export function subscribeToResearch(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getActiveResearch(): ActiveResearch {
    return active;
}

function publish(next: ActiveResearch): void {
    if (
        next.threadId === active.threadId &&
        next.localThreadId === active.localThreadId &&
        next.chatUpdate === active.chatUpdate &&
        next.question === active.question &&
        next.dismissed === active.dismissed &&
        next.focus === active.focus
    ) {
        return;
    }
    active = next;
    for (const listener of listeners) listener();
}

/**
 * The thread the user is looking at, by remote id (undefined for a chat not
 * yet saved) and local id.
 */
export function setActiveResearchThread(
    threadId: string | undefined,
    localThreadId?: string
): void {
    const pending =
        threadId && localThreadId !== undefined
            ? pendingFromChat.get(localThreadId)
            : undefined;
    if (threadId && pending !== undefined) {
        pendingFromChat.delete(localThreadId!);
        write(threadId, {
            ...read(threadId),
            question: pending,
            dismissed: false,
        });
    }
    publish({
        ...(threadId ? read(threadId) : EMPTY),
        threadId,
        localThreadId,
        chatUpdate:
            pending !== undefined ? active.chatUpdate + 1 : active.chatUpdate,
    });
}

function update(
    threadId: string,
    patch: Partial<ResearchState>,
    fromChat = false
): void {
    const next = { ...read(threadId), ...patch };
    write(threadId, next);
    if (threadId === active.threadId) {
        publish({
            ...active,
            ...next,
            chatUpdate: fromChat ? active.chatUpdate + 1 : active.chatUpdate,
        });
    }
}

/** Setting a question, even the same one, brings dismissed highlights back. */
export function setResearchQuestion(threadId: string, question: string): void {
    update(threadId, { question: question.trim(), dismissed: false });
}

/**
 * The chat's set_research_question tool. The thread may not have its remote id
 * yet (it gets one as its first message is saved), so the question waits under
 * the local id until it does.
 */
export function setResearchQuestionFromChat(
    threadId: string | undefined,
    localThreadId: string,
    question: string
): void {
    const trimmed = question.trim();
    const target =
        threadId ??
        (localThreadId === active.localThreadId ? active.threadId : undefined);
    if (target) {
        update(target, { question: trimmed, dismissed: false }, true);
    } else {
        pendingFromChat.set(localThreadId, trimmed);
    }
}

export function setResearchDismissed(
    threadId: string,
    dismissed: boolean
): void {
    update(threadId, { dismissed });
}

export function setResearchFocus(threadId: string, focus: boolean): void {
    update(threadId, { focus });
}

export function removeResearch(threadId: string): void {
    try {
        localStorage.removeItem(storageKey(threadId));
    } catch {
        /* nothing to clean up */
    }
    if (threadId === active.threadId) {
        publish({ ...active, ...EMPTY });
    }
}
