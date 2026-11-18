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
    addPageAction,
    addPageNavigation,
    addQuestion,
    QuestionEntry,
    Topic,
    updateLatestPageStep,
    updateLatestQuestion,
} from './topics';
import { filterKeysFromHref } from './pageSlots';
import { studyIdsFromHref } from './pageStudies';

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
    // The latest message when its classification failed, so the box can say
    // it is out of date and offer to classify it again; empty otherwise.
    failedMessage: string;
    // Working questions to pick from, offered for an exploring question.
    questionSuggestions: string[];
    // The slots the chat is asking the user for: missing or ambiguous core
    // slots, and the study while it isn't settled (L3).
    askedSlots: SlotName[];
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
        failedMessage: '',
        questionSuggestions: [],
        askedSlots: [],
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
                failedMessage: str(parsed.failedMessage),
                questionSuggestions: Array.isArray(parsed.questionSuggestions)
                    ? parsed.questionSuggestions.filter(
                          (q: unknown): q is string => typeof q === 'string'
                      )
                    : [],
                askedSlots: Array.isArray(parsed.askedSlots)
                    ? parsed.askedSlots.filter((n: unknown): n is SlotName =>
                          SLOT_NAMES.includes(n as SlotName)
                      )
                    : [],
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
        next.failedMessage === active.failedMessage &&
        next.questionSuggestions === active.questionSuggestions &&
        next.askedSlots === active.askedSlots &&
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
        slotsBeforePage = {};
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
            // A reply to a filter change on the page belongs to the page step
            // already recorded for it, not to a new question.
            const added = c.from_page
                ? { topics: state.topics, started: undefined, entry: undefined }
                : addQuestion(state.topics, c, href);
            started = added.started;
            entry = added.entry;
            const next: ResearchState = {
                ...state,
                editedSinceMessage: false,
                failedMessage: '',
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
            // A question the user wrote stays while they ask the same thing;
            // a refinement or sibling question gets the classifier's new one.
            const questionByUser =
                state.questionByUser &&
                !newTopic &&
                (c.move === null || c.move === 'same');
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
                questionSuggestions: c.question_suggestions ?? [],
                askedSlots: askedSlotsOf(c),
                dismissed: question === state.question && state.dismissed,
            };
        },
        (prev, next) =>
            Boolean(next.question || next.aim) &&
            (prev.question !== next.question || prev.aim !== next.aim)
    );
    if (localThreadId === active.localThreadId) {
        for (const name of SLOT_NAMES) {
            if (c.slots[name].source !== 'page') delete slotsBeforePage[name];
        }
    }
    replyFromPage.set(localThreadId, c.from_page === true);
    trackLatestPage = !c.from_page && localThreadId === active.localThreadId;
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

// What the chat asks the user for after this message: the core slots it
// lacks or finds ambiguous, and the study while it isn't settled (L3).
export function askedSlotsOf(c: Classification): SlotName[] {
    const asked = c.core_slots.filter(n => c.slots[n].status !== 'specified');
    if (c.level === 'L3' && !asked.includes('study')) asked.push('study');
    return asked;
}

/** The latest message's classification failed: the box is out of date. */
export function setClassificationFailed(
    threadId: string | undefined,
    localThreadId: string,
    message: string
): void {
    updateThread(threadId, localThreadId, state => ({
        ...state,
        failedMessage: message,
    }));
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
            askedSlots: trimmed
                ? state.askedSlots.filter(n => n !== name)
                : state.askedSlots,
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

// Whether each chat's latest reply answers a filter change on the page, so
// its finding goes on that page step.
const replyFromPage = new Map<string, boolean>();

export function setLatestFinding(
    threadId: string | undefined,
    localThreadId: string,
    finding: string
): void {
    const onPageStep = replyFromPage.get(localThreadId) === true;
    updateThread(threadId, localThreadId, state => ({
        ...state,
        topics: onPageStep
            ? updateLatestPageStep(state.topics, { finding })
            : updateLatestQuestion(state.topics, { finding }),
    }));
}

// The page's slots as last applied, so a value the chat set from the message
// stays until the page itself changes.
let latestPageSlots: Partial<Record<SlotName, string>> = {};
let appliedPageSlots: Partial<Record<SlotName, string>> = {};
// The chat's slots the page replaced, given back (options included) once the
// page no longer sets them.
let slotsBeforePage: Partial<Record<SlotName, Slot>> = {};

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
        const current = slots[name];
        if (current.source === 'user') continue;
        // A slot taken from the page always mirrors it, so a value the page
        // no longer shows (after navigating, or a reload of this frame)
        // can't linger. A slot the chat set is replaced only when the page
        // itself changes.
        if (current.source === 'page') {
            if (value === current.value) continue;
        } else if (value === appliedPageSlots[name]) {
            continue;
        }
        if (value) {
            if (current.source !== 'page') slotsBeforePage[name] = current;
            slots[name] = {
                status: 'specified',
                value,
                options: [],
                source: 'page',
            };
            changed = true;
        } else if (current.source === 'page') {
            slots[name] = slotsBeforePage[name] ?? {
                status: 'missing',
                value: null,
                options: [],
                source: 'chat',
            };
            delete slotsBeforePage[name];
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

// --- Page changes the user makes, recorded as steps of the current topic ---

// The page last seen, to tell a filter change on the same study from
// navigating elsewhere.
let lastPage:
    | { href: string; study: string; keys: string[] | null }
    | undefined;
// Navigation the sidebar itself triggered (the assistant's go_to_page, a
// restore): the page it lands on is not the user's own change.
let expectedNavigationAt = 0;
const EXPECTED_NAVIGATION_MS = 20_000;

/** Called before the sidebar navigates the portal itself. */
export function expectPageNavigation(): void {
    expectedNavigationAt = Date.now();
    expectedViewAt = expectedNavigationAt;
}

// The same, for the page view the navigation lands on (pageSync.ts), which
// may settle after the URL changes.
let expectedViewAt = 0;

function pageFilterText(): string {
    return [
        latestPageSlots.cohort,
        latestPageSlots.filter,
        latestPageSlots.entity && `genes: ${latestPageSlots.entity}`,
    ]
        .filter(Boolean)
        .join('; ');
}

/**
 * Called with every settled page, after its slots are applied. A change of
 * Study View filters on the same study, made by the user, is added to the
 * current topic as a refine, broaden or sibling step.
 */
export function recordPageChange(href: string): void {
    if (!guidanceEnabled) return;
    const previous = lastPage;
    const current = {
        href,
        study: [...studyIdsFromHref(href)].sort().join(','),
        keys: filterKeysFromHref(href),
    };
    lastPage = current;
    if (!previous || previous.href === href) return;
    if (Date.now() - expectedNavigationAt < EXPECTED_NAVIGATION_MS) {
        expectedNavigationAt = 0;
        return;
    }
    if (
        !current.keys ||
        !previous.keys ||
        !current.study ||
        current.study !== previous.study ||
        active.topics.length === 0
    ) {
        return;
    }
    const before = previous.keys;
    const after = current.keys;
    let recorded: QuestionEntry | undefined;
    let topicId = '';
    updateThread(active.threadId, active.localThreadId, state => {
        const result = addPageAction(state.topics, {
            before,
            after,
            filterText: pageFilterText(),
            aim: state.aim,
            question: templateQuestion(state.goal, state.slots),
            goal: state.goal,
            slots: state.slots,
            href,
        });
        recorded = result.entry;
        topicId = result.topics[0]?.id ?? '';
        return { ...state, topics: result.topics };
    });
    // The question before keeps the page it was asked on.
    trackLatestPage = false;
    if (recorded) {
        logGuidanceEvent(
            'page_action',
            active.threadId ?? active.localThreadId,
            {
                topic_id: topicId,
                question_id: recorded.id,
                move: recorded.move,
                question: recorded.text,
                old_value: before.join(' | '),
                new_value: after.join(' | '),
                href,
            }
        );
    }
}

/**
 * Whether a new page view is where the sidebar itself just navigated the
 * portal. Answers true once per navigation.
 */
export function takeExpectedPageView(): boolean {
    const expected = Date.now() - expectedViewAt < EXPECTED_NAVIGATION_MS;
    expectedViewAt = 0;
    return expected;
}

// Page steps recorded in this tab, which the chat responds to even when they
// are already there as the chat opens (a page opened in a new tab).
const freshPageSteps = new Set<string>();

export function isFreshPageStep(id: string): boolean {
    return freshPageSteps.has(id);
}

/**
 * A step the user took on the page other than a filter change (pageNavigation
 * .ts), added to the current topic so the chat can respond to it. False when
 * there is no topic to add it to (yet).
 */
export function recordPageNavigation(did: string, href: string): boolean {
    if (!guidanceEnabled || active.topics.length === 0) return false;
    let recorded: QuestionEntry | undefined;
    let topicId = '';
    updateThread(active.threadId, active.localThreadId, state => {
        const result = addPageNavigation(state.topics, {
            did,
            aim: state.aim,
            question: templateQuestion(state.goal, state.slots),
            goal: state.goal,
            slots: state.slots,
            href,
        });
        recorded = result.entry;
        topicId = result.topics[0]?.id ?? '';
        return { ...state, topics: result.topics };
    });
    trackLatestPage = false;
    if (recorded) {
        freshPageSteps.add(recorded.id);
        logGuidanceEvent(
            'page_action',
            active.threadId ?? active.localThreadId,
            {
                topic_id: topicId,
                question_id: recorded.id,
                move: 'navigation',
                question: recorded.text,
                href,
            }
        );
    }
    return true;
}
