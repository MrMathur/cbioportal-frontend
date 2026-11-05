import {
    Classification,
    emptySlots,
    Goal,
    Slot,
    SLOT_NAMES,
    SlotName,
    Slots,
} from './classification';
import { guidanceEnabled } from './guidanceFlags';
import { logGuidanceEvent } from './guidanceLog';
import { templateQuestion } from './researchTemplate';
import { PREFIX } from './threadStorage';
import {
    addQuestion,
    QuestionEntry,
    Topic,
    updateLatestQuestion,
} from './topics';

// Each chat's research question, which drives the page highlights
// (highlights.ts), plus whether the user has dismissed them and turned on
// focus mode. With the guided assistant on, it also holds the question's
// three levels (aim, working question, slots) filled from each message's
// classification, and the chat's earlier questions grouped into topics.
// Keyed by the thread's remote id, so it lives as long as the chat.

export interface ResearchState {
    // The working question; what the highlights are chosen for.
    question: string;
    // Highlights hidden until the question is edited or re-applied.
    dismissed: boolean;
    // Fades the candidates on the page that aren't highlighted.
    focus: boolean;
    aim: string;
    concrete: string;
    goal: Goal | null;
    slots: Slots;
    // Written by the user, so a classification doesn't overwrite them within
    // the same topic.
    aimByUser: boolean;
    questionByUser: boolean;
    // The latest message when it was an interface question ("where is the
    // download button?"): the highlights point at controls for it instead of
    // the research question, until the next message.
    interfaceQuery: string;
    // The user changed the question or its slots since the last message, so
    // the box offers to ask with it.
    editedSinceMessage: boolean;
    topics: Topic[];
}

export interface ActiveResearch extends ResearchState {
    threadId: string | undefined;
    // The runtime's id for the thread, which a new chat has before it's saved.
    localThreadId: string | undefined;
    // Bumped each time the chat sets the question, so the bar can show it.
    chatUpdate: number;
}

function empty(): ResearchState {
    return {
        question: '',
        dismissed: false,
        focus: false,
        aim: '',
        concrete: '',
        goal: null,
        slots: emptySlots(),
        aimByUser: false,
        questionByUser: false,
        interfaceQuery: '',
        editedSinceMessage: false,
        topics: [],
    };
}

const EMPTY = empty();

function storageKey(threadId: string): string {
    return `${PREFIX}research:${threadId}`;
}

function parseSlots(value: unknown): Slots {
    const slots = emptySlots();
    const raw = (value ?? {}) as Record<string, Partial<Slot> | undefined>;
    for (const name of SLOT_NAMES) {
        const s = raw[name];
        if (
            s &&
            (s.status === 'specified' ||
                s.status === 'ambiguous' ||
                s.status === 'missing')
        ) {
            slots[name] = {
                status: s.status,
                value: typeof s.value === 'string' ? s.value : null,
                options: Array.isArray(s.options)
                    ? s.options.filter(
                          (o): o is string => typeof o === 'string'
                      )
                    : [],
                source:
                    s.source === 'user' || s.source === 'page'
                        ? s.source
                        : 'chat',
            };
        }
    }
    return slots;
}

function read(threadId: string): ResearchState {
    try {
        const parsed = JSON.parse(
            localStorage.getItem(storageKey(threadId)) ?? 'null'
        );
        if (parsed && typeof parsed.question === 'string') {
            const str = (v: unknown) => (typeof v === 'string' ? v : '');
            return {
                question: parsed.question,
                dismissed: parsed.dismissed === true,
                focus: parsed.focus === true,
                aim: str(parsed.aim),
                concrete: str(parsed.concrete),
                goal: parsed.goal ?? null,
                slots: parseSlots(parsed.slots),
                aimByUser: parsed.aimByUser === true,
                questionByUser: parsed.questionByUser === true,
                interfaceQuery: str(parsed.interfaceQuery),
                editedSinceMessage: parsed.editedSinceMessage === true,
                topics: Array.isArray(parsed.topics) ? parsed.topics : [],
            };
        }
    } catch {
        /* treated as no question */
    }
    return EMPTY;
}

function isEmpty(state: ResearchState): boolean {
    return (
        !state.question &&
        !state.aim &&
        state.topics.length === 0 &&
        SLOT_NAMES.every(n => state.slots[n].status === 'missing')
    );
}

function write(threadId: string, state: ResearchState): void {
    try {
        if (isEmpty(state)) {
            localStorage.removeItem(storageKey(threadId));
        } else {
            localStorage.setItem(storageKey(threadId), JSON.stringify(state));
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

// Whether the latest question's page follows the user's navigation: from
// the question until the next one, but not after a restore or a chat switch,
// which would otherwise rewrite where that question was worked on.
let trackLatestPage = false;

// State changed before its thread had a remote id, by local id.
const pending = new Map<string, ResearchState>();

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
        next.focus === active.focus &&
        next.aim === active.aim &&
        next.concrete === active.concrete &&
        next.goal === active.goal &&
        next.slots === active.slots &&
        next.aimByUser === active.aimByUser &&
        next.questionByUser === active.questionByUser &&
        next.interfaceQuery === active.interfaceQuery &&
        next.editedSinceMessage === active.editedSinceMessage &&
        next.topics === active.topics
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
    const waiting =
        localThreadId !== undefined ? pending.get(localThreadId) : undefined;
    if (threadId && waiting) {
        pending.delete(localThreadId!);
        write(threadId, { ...read(threadId), ...waiting });
    }
    const state = threadId ? read(threadId) : waiting ?? EMPTY;
    // Keyed on the local id: a new chat getting its remote id after its
    // first message is the same chat.
    const switched = localThreadId !== active.localThreadId;
    publish({
        ...state,
        threadId,
        localThreadId,
        chatUpdate:
            waiting && threadId ? active.chatUpdate + 1 : active.chatUpdate,
    });
    // Another chat: the page's slots apply to it afresh.
    if (switched && guidanceEnabled) {
        trackLatestPage = false;
        appliedPageSlots = {};
        applyPageSlots();
    }
}

/** The state of a thread, saved or not. */
export function getResearchFor(
    threadId: string | undefined,
    localThreadId: string | undefined
): ResearchState {
    if (threadId) {
        return threadId === active.threadId ? active : read(threadId);
    }
    return (localThreadId && pending.get(localThreadId)) || EMPTY;
}

/**
 * Applies a change to a thread's state: stored once the thread has a remote
 * id, held under its local id until then.
 */
function updateThread(
    threadId: string | undefined,
    localThreadId: string | undefined,
    mutate: (state: ResearchState) => ResearchState,
    // Whether the change came from the chat and is worth flagging in the box.
    fromChat:
        | boolean
        | ((prev: ResearchState, next: ResearchState) => boolean) = false
): void {
    const target =
        threadId ??
        (localThreadId !== undefined && localThreadId === active.localThreadId
            ? active.threadId
            : undefined);
    let next: ResearchState;
    let prev: ResearchState;
    if (target) {
        prev = target === active.threadId ? active : read(target);
        next = mutate(prev);
        write(target, next);
        if (target !== active.threadId) return;
    } else {
        if (localThreadId === undefined) return;
        prev = pending.get(localThreadId) ?? EMPTY;
        next = mutate(prev);
        pending.set(localThreadId, next);
        if (localThreadId !== active.localThreadId) return;
    }
    const {
        threadId: _t,
        localThreadId: _l,
        chatUpdate: _c,
        ...stateOnly
    } = next as ActiveResearch;
    const flag =
        typeof fromChat === 'function' ? fromChat(prev, next) : fromChat;
    publish({
        ...active,
        ...stateOnly,
        chatUpdate: flag ? active.chatUpdate + 1 : active.chatUpdate,
    });
}

function update(
    threadId: string,
    patch: Partial<ResearchState>,
    fromChat = false
): void {
    updateThread(threadId, undefined, s => ({ ...s, ...patch }), fromChat);
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
    updateThread(
        threadId,
        localThreadId,
        s => ({
            ...s,
            question: trimmed,
            questionByUser: guidanceEnabled ? true : s.questionByUser,
            dismissed: false,
        }),
        true
    );
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

// --- Guided assistant ---

export function concreteFromSlots(slots: Slots): string {
    const v = (name: SlotName) =>
        slots[name].status === 'specified' ? slots[name].value : null;
    const cohort = v('cohort');
    return [
        v('measure'),
        v('entity'),
        v('groups'),
        v('filter'),
        v('study') ?? (cohort === 'whole study' ? null : cohort),
    ]
        .filter(Boolean)
        .join(' · ');
}

/** The slots and text the next classification must treat as fixed. */
export function getFixedForRequest(
    threadId: string | undefined,
    localThreadId: string | undefined
): {
    fixedSlots: Partial<Record<SlotName, Omit<Slot, 'options'>>>;
    userAim?: string;
    userQuestion?: string;
} {
    const state = getResearchFor(threadId, localThreadId);
    const fixedSlots: Partial<Record<SlotName, Omit<Slot, 'options'>>> = {};
    for (const name of SLOT_NAMES) {
        const slot = state.slots[name];
        if ((slot.source === 'user' || slot.source === 'page') && slot.value) {
            fixedSlots[name] = {
                status: slot.status,
                value: slot.value,
                source: slot.source,
            };
        }
    }
    return {
        fixedSlots,
        userAim: state.aimByUser ? state.aim : undefined,
        userQuestion: state.questionByUser ? state.question : undefined,
    };
}

/** A message's classification, streamed before its reply. */
export function applyClassification(
    threadId: string | undefined,
    localThreadId: string,
    c: Classification,
    href: string | undefined
): void {
    let started: Topic | undefined;
    let previousTopic: Topic | undefined;
    let entry: QuestionEntry | undefined;
    updateThread(
        threadId,
        localThreadId,
        state => {
            previousTopic = state.topics[0];
            const added = addQuestion(state.topics, c, href);
            started = added.started;
            entry = added.entry;
            const next: ResearchState = {
                ...state,
                editedSinceMessage: false,
                topics: added.topics,
                interfaceQuery: c.request_type === 'interface' ? c.message : '',
            };
            // Interface and out-of-scope messages leave the research
            // question as it was.
            if (c.request_type !== 'data' && c.request_type !== 'catalog') {
                return next;
            }
            const newTopic = Boolean(started) && state.topics.length > 0;
            const aimByUser = state.aimByUser && !newTopic;
            const questionByUser = state.questionByUser && !newTopic;
            const question = questionByUser
                ? state.question
                : c.drafts.working_question.trim();
            return {
                ...next,
                aim: aimByUser ? state.aim : c.drafts.broad_aim.trim(),
                aimByUser,
                question,
                questionByUser,
                concrete: c.drafts.concrete_analysis.trim(),
                goal: c.goal,
                slots: c.slots,
                dismissed: question === state.question && state.dismissed,
            };
        },
        (prev, next) =>
            Boolean(next.question || next.aim) &&
            (prev.question !== next.question || prev.aim !== next.aim)
    );
    trackLatestPage = localThreadId === active.localThreadId;
    if (started) {
        logGuidanceEvent('topic_change', threadId ?? localThreadId, {
            topic_id: started.id,
            topic_title: started.title,
            question: c.message,
            previous_topic_id: previousTopic?.id ?? null,
            previous_topic_title: previousTopic?.title ?? null,
            question_id: entry?.id,
        });
    }
}

export function setSlotByUser(
    threadId: string | undefined,
    localThreadId: string | undefined,
    name: SlotName,
    value: string | null,
    via: 'option' | 'typed' | 'cleared'
): void {
    let oldValue: string | null = null;
    let newQuestion = '';
    updateThread(threadId, localThreadId, state => {
        oldValue = state.slots[name].value;
        const trimmed = value?.trim() || null;
        const slots: Slots = {
            ...state.slots,
            [name]: {
                status: trimmed ? 'specified' : 'missing',
                value: trimmed,
                options: [],
                source: trimmed ? 'user' : 'chat',
            },
        };
        newQuestion = templateQuestion(state.goal, slots);
        return {
            ...state,
            slots,
            question: newQuestion,
            questionByUser: false,
            concrete: concreteFromSlots(slots),
            editedSinceMessage: true,
            dismissed: false,
        };
    });
    logGuidanceEvent(
        via === 'option' ? 'option_pick' : 'slot_edit',
        threadId ?? localThreadId,
        {
            slot: name,
            old_value: oldValue,
            new_value: value?.trim() || null,
            via,
            question: newQuestion,
        }
    );
}

export function setAimByUser(
    threadId: string | undefined,
    localThreadId: string | undefined,
    aim: string
): void {
    let oldValue = '';
    updateThread(threadId, localThreadId, state => {
        oldValue = state.aim;
        const trimmed = aim.trim();
        return {
            ...state,
            aim: trimmed,
            aimByUser: Boolean(trimmed),
            editedSinceMessage: true,
        };
    });
    logGuidanceEvent('aim_edit', threadId ?? localThreadId, {
        old_value: oldValue,
        new_value: aim.trim(),
    });
}

export function setQuestionByUser(
    threadId: string | undefined,
    localThreadId: string | undefined,
    question: string
): void {
    let oldValue = '';
    updateThread(threadId, localThreadId, state => {
        oldValue = state.question;
        const trimmed = question.trim();
        return {
            ...state,
            question: trimmed,
            questionByUser: Boolean(trimmed),
            editedSinceMessage: true,
            dismissed: false,
        };
    });
    logGuidanceEvent('question_edit', threadId ?? localThreadId, {
        old_value: oldValue,
        new_value: question.trim(),
    });
}

/** Brings back an earlier question: its text levels and its slots. */
export function restoreQuestion(
    threadId: string | undefined,
    localThreadId: string | undefined,
    entry: QuestionEntry,
    topic: Topic
): void {
    updateThread(threadId, localThreadId, state => {
        const slots = { ...entry.slots };
        // Restoring is the user's choice, so what it brings back is fixed for
        // the next message.
        for (const name of SLOT_NAMES) {
            if (slots[name].status === 'specified' && slots[name].value) {
                slots[name] = { ...slots[name], source: 'user' };
            }
        }
        return {
            ...state,
            aim: entry.aim,
            aimByUser: Boolean(entry.aim),
            question: entry.question,
            questionByUser: Boolean(entry.question),
            goal: entry.goal,
            slots,
            concrete: concreteFromSlots(slots),
            editedSinceMessage: true,
            dismissed: false,
        };
    });
    trackLatestPage = false;
    logGuidanceEvent('restore', threadId ?? localThreadId, {
        topic_id: topic.id,
        topic_title: topic.title,
        question_id: entry.id,
        question: entry.text,
        href: entry.href ?? null,
    });
}

/** Keeps the latest question's page in step with where the user is. */
export function setLatestQuestionPage(href: string): void {
    if (!trackLatestPage || !active.topics.length) return;
    const topics = updateLatestQuestion(active.topics, { href });
    if (topics[0] === active.topics[0]) return;
    updateThread(active.threadId, active.localThreadId, s => ({
        ...s,
        topics,
    }));
}

export function setLatestFinding(
    threadId: string | undefined,
    localThreadId: string,
    finding: string
): void {
    updateThread(threadId, localThreadId, state => ({
        ...state,
        topics: updateLatestQuestion(state.topics, { finding }),
    }));
}

// The page's slots as last applied, so only changes are synced: a value the
// chat set from the message stays until the page itself changes.
let latestPageSlots: Partial<Record<SlotName, string>> = {};
let appliedPageSlots: Partial<Record<SlotName, string>> = {};

/**
 * Slots read from the page (open study, Study View filters, gene query).
 * A slot whose page value changed takes the new value, unless the user fixed
 * it; a page slot is cleared once the page no longer sets it.
 */
export function setPageSlots(
    pageSlots: Partial<Record<SlotName, string>>
): void {
    if (!guidanceEnabled) return;
    latestPageSlots = pageSlots;
    applyPageSlots();
}

function applyPageSlots(): void {
    const state = active;
    let changed = false;
    const slots: Slots = { ...state.slots };
    for (const name of SLOT_NAMES) {
        const value = latestPageSlots[name];
        if (value === appliedPageSlots[name]) continue;
        const current = slots[name];
        if (current.source === 'user') continue;
        if (value) {
            slots[name] = {
                status: 'specified',
                value,
                options: [],
                source: 'page',
            };
            changed = true;
        } else if (current.source === 'page') {
            slots[name] = {
                status: 'missing',
                value: null,
                options: [],
                source: 'chat',
            };
            changed = true;
        }
    }
    appliedPageSlots = latestPageSlots;
    if (!changed) return;
    updateThread(state.threadId, state.localThreadId, s => ({
        ...s,
        slots,
        concrete: concreteFromSlots(slots),
    }));
}
