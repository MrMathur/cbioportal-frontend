import { Classification, Slots } from './classification';

// Earlier questions grouped into topics: a `new` move starts a topic,
// refinements, broadenings and sibling moves stay in the current one. Pure,
// so the grouping and the compact listing can be tested.

export type QuestionMove = 'start' | 'same' | 'refine' | 'broaden' | 'sibling';

export interface QuestionEntry {
    id: string;
    at: string;
    // A question asked in the chat, or a change the user made on the page
    // (Study View filters), recorded as a step of the current topic.
    kind?: 'question' | 'page';
    // For a page change: the filters before it (filterKeysFromHref), so a
    // burst of clicks is judged as one change, and what the page filters on
    // after it ("Sex: Female; ...", empty when none).
    pageBaseline?: string[];
    pageFilters?: string;
    // For any other step on the page (studies ticked, the gene form opened,
    // another page opened), what the user did, worded to follow "I".
    pageNavigation?: string;
    text: string;
    move: QuestionMove;
    requestType: Classification['request_type'];
    level: Classification['level'];
    goal: Classification['goal'];
    aim: string;
    question: string;
    slots: Slots;
    // The page the user worked on for this question, tracked until the next
    // question; restoring navigates back to it (Study View filters included).
    href?: string;
    // First sentence of the reply's final text part.
    finding?: string;
}

export interface Topic {
    id: string;
    title: string;
    startedAt: string;
    updatedAt: string;
    questions: QuestionEntry[];
}

const MAX_TOPICS = 50;
const MAX_QUESTIONS_PER_TOPIC = 100;

function newId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`;
}

function topicTitle(c: Classification): string {
    return (c.drafts.broad_aim || c.message).trim().slice(0, 120);
}

/**
 * Adds a classified question, newest topic first. Returns the new list and
 * the topic that was started, if any.
 */
export function addQuestion(
    topics: readonly Topic[],
    c: Classification,
    href: string | undefined,
    now: Date = new Date()
): { topics: Topic[]; started?: Topic; entry: QuestionEntry } {
    const at = now.toISOString();
    const current = topics[0];
    const startsTopic = !current || c.move === null || c.move === 'new';
    const entry: QuestionEntry = {
        id: newId(),
        at,
        kind: 'question',
        text: c.message,
        move: startsTopic ? 'start' : (c.move as QuestionMove),
        requestType: c.request_type,
        level: c.level,
        goal: c.goal,
        aim: c.drafts.broad_aim,
        question: c.drafts.working_question,
        slots: c.slots,
        href,
    };
    if (startsTopic) {
        const started: Topic = {
            id: newId(),
            title: topicTitle(c),
            startedAt: at,
            updatedAt: at,
            questions: [entry],
        };
        return {
            topics: [started, ...topics].slice(0, MAX_TOPICS),
            started,
            entry,
        };
    }
    const updated: Topic = {
        ...current,
        updatedAt: at,
        questions: [...current.questions, entry].slice(
            -MAX_QUESTIONS_PER_TOPIC
        ),
    };
    return { topics: [updated, ...topics.slice(1)], entry };
}

/**
 * Applies a change to the latest question asked in the chat in the latest
 * topic (page changes recorded after it are skipped).
 */
export function updateLatestQuestion(
    topics: readonly Topic[],
    patch: Partial<Pick<QuestionEntry, 'href' | 'finding'>>
): Topic[] {
    const current = topics[0];
    if (!current || current.questions.length === 0) return [...topics];
    const questions = [...current.questions];
    let index = questions.length - 1;
    while (index > 0 && questions[index].kind === 'page') index--;
    const last = questions[index];
    if (last.kind === 'page') return [...topics];
    if (
        (patch.href === undefined || patch.href === last.href) &&
        (patch.finding === undefined || patch.finding === last.finding)
    ) {
        return [...topics];
    }
    questions[index] = { ...last, ...patch };
    return [{ ...current, questions }, ...topics.slice(1)];
}

export function matchesSearch(topic: Topic, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
        topic.title.toLowerCase().includes(q) ||
        topic.questions.some(
            entry =>
                entry.text.toLowerCase().includes(q) ||
                entry.question.toLowerCase().includes(q) ||
                (entry.finding ?? '').toLowerCase().includes(q)
        )
    );
}

export const RECENT_TOPICS = 3;
export const LATEST_QUESTIONS = 3;

/**
 * The questions a collapsed topic shows: the first and the latest three,
 * with how many are hidden between them.
 */
export function compactQuestions(
    questions: readonly QuestionEntry[]
): { shown: QuestionEntry[]; hiddenCount: number; hiddenAfter: number } {
    if (questions.length <= LATEST_QUESTIONS + 1) {
        return { shown: [...questions], hiddenCount: 0, hiddenAfter: -1 };
    }
    return {
        shown: [questions[0], ...questions.slice(-LATEST_QUESTIONS)],
        hiddenCount: questions.length - 1 - LATEST_QUESTIONS,
        hiddenAfter: 0,
    };
}

const SENTENCE_END = /(?<=[.!?])\s/;
const MAX_FINDING_CHARS = 160;

/** A one-line finding: the first sentence of the text's first prose block. */
export function findingFromReply(text: string): string | undefined {
    const blocks = text
        .replace(/```[\s\S]*?```/g, ' ')
        .split(/\n\s*\n/)
        .map(b => b.trim())
        .filter(Boolean);
    const block = blocks.find(
        b => !/^#{1,6}\s/.test(b) && !/^\|/.test(b) && /[a-z]/i.test(b)
    );
    if (!block) return undefined;
    const plain = block
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`>#]/g, '')
        .replace(/^\s*[-\d.]+\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
    const sentence = plain.split(SENTENCE_END)[0] ?? plain;
    return sentence.length > MAX_FINDING_CHARS
        ? `${sentence.slice(0, MAX_FINDING_CHARS - 1)}…`
        : sentence;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
    const seconds = Math.max(
        0,
        Math.round((now.getTime() - new Date(iso).getTime()) / 1000)
    );
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
}

// Filter clicks this close together are one change.
export const PAGE_ACTION_WINDOW_MS = 30_000;

/**
 * The move a change of page filters makes: only filters added narrows the
 * question (refine), only filters removed widens it (broaden), both is a
 * parallel variation (sibling), e.g. Female → Male. Null when nothing changed.
 */
export function pageActionMove(
    before: readonly string[],
    after: readonly string[]
): 'refine' | 'broaden' | 'sibling' | null {
    const b = new Set(before);
    const a = new Set(after);
    const added = [...a].some(k => !b.has(k));
    const removed = [...b].some(k => !a.has(k));
    if (added && removed) return 'sibling';
    if (added) return 'refine';
    if (removed) return 'broaden';
    return null;
}

export interface PageAction {
    // Filters before and after the change.
    before: string[];
    after: string[];
    // What the page now filters on, for display ("Sex: Female; ...").
    filterText: string;
    aim: string;
    question: string;
    goal: Classification['goal'];
    slots: Slots;
    href: string;
}

function describePageAction(
    move: 'refine' | 'broaden' | 'sibling',
    filterText: string
): string {
    if (!filterText) return 'Removed the filters on the page';
    switch (move) {
        case 'refine':
            return `Narrowed on the page: ${filterText}`;
        case 'broaden':
            return `Widened on the page: ${filterText}`;
        case 'sibling':
            return `Changed the filters on the page: ${filterText}`;
    }
}

/**
 * Records a filter change on the page as a step of the current topic.
 * Changes within PAGE_ACTION_WINDOW_MS of the previous one, with no question
 * in between, update that entry instead, judged from the filters before the
 * first of them; a burst that ends where it started removes the entry.
 * Returns the topics unchanged when there is no topic to add to.
 */
export function addPageAction(
    topics: readonly Topic[],
    action: PageAction,
    now: Date = new Date()
): { topics: Topic[]; entry?: QuestionEntry } {
    const current = topics[0];
    if (!current) return { topics: [...topics] };
    const questions = [...current.questions];
    const last = questions[questions.length - 1];
    const merging =
        last?.kind === 'page' &&
        now.getTime() - new Date(last.at).getTime() <= PAGE_ACTION_WINDOW_MS;
    const baseline = merging
        ? last.pageBaseline ?? action.before
        : action.before;
    const move = pageActionMove(baseline, action.after);
    if (merging) questions.pop();
    if (!move) {
        return {
            topics: merging
                ? [{ ...current, questions }, ...topics.slice(1)]
                : [...topics],
        };
    }
    const entry: QuestionEntry = {
        id: merging ? last.id : newId(),
        at: now.toISOString(),
        kind: 'page',
        pageBaseline: baseline,
        text: describePageAction(move, action.filterText),
        pageFilters: action.filterText,
        move,
        requestType: 'data',
        level: null,
        goal: action.goal,
        aim: action.aim,
        question: action.question,
        slots: action.slots,
        href: action.href,
    };
    questions.push(entry);
    return {
        topics: [
            {
                ...current,
                updatedAt: entry.at,
                questions: questions.slice(-MAX_QUESTIONS_PER_TOPIC),
            },
            ...topics.slice(1),
        ],
        entry,
    };
}

export interface PageNavigation {
    // What the user did, worded to follow "I" (pageNavigation.ts).
    did: string;
    aim: string;
    question: string;
    goal: Classification['goal'];
    slots: Slots;
    href: string;
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Records a step the user took on the page other than a filter change as a
 * step of the current topic. A step within PAGE_ACTION_WINDOW_MS of the
 * previous one of its kind replaces it, so ticking studies one by one is one
 * step. Returns the topics unchanged when there is no topic to add to.
 */
export function addPageNavigation(
    topics: readonly Topic[],
    navigation: PageNavigation,
    now: Date = new Date()
): { topics: Topic[]; entry?: QuestionEntry } {
    const current = topics[0];
    if (!current) return { topics: [...topics] };
    const questions = [...current.questions];
    const last = questions[questions.length - 1];
    const merging =
        last?.kind === 'page' &&
        last.pageNavigation !== undefined &&
        now.getTime() - new Date(last.at).getTime() <= PAGE_ACTION_WINDOW_MS;
    if (merging) questions.pop();
    const entry: QuestionEntry = {
        id: merging ? last.id : newId(),
        at: now.toISOString(),
        kind: 'page',
        pageNavigation: navigation.did,
        text: capitalize(navigation.did),
        move: 'same',
        requestType: 'data',
        level: null,
        goal: navigation.goal,
        aim: navigation.aim,
        question: navigation.question,
        slots: navigation.slots,
        href: navigation.href,
    };
    questions.push(entry);
    return {
        topics: [
            {
                ...current,
                updatedAt: entry.at,
                questions: questions.slice(-MAX_QUESTIONS_PER_TOPIC),
            },
            ...topics.slice(1),
        ],
        entry,
    };
}

// How the chat words a change the user made on the page, as the
// message the sidebar sends on their behalf so the assistant updates its
// answer. Recognised by its opening (isPageUpdateMessage).
export const PAGE_UPDATE_PREFIX = 'On the page, I ';

export function pageUpdateMessage(entry: QuestionEntry): string | undefined {
    if (entry.kind !== 'page') return undefined;
    if (entry.pageNavigation) {
        return `${PAGE_UPDATE_PREFIX}${entry.pageNavigation}. What does this mean for my question, and what should I do here?`;
    }
    const filters = entry.pageFilters ?? '';
    const change =
        entry.move === 'refine'
            ? `narrowed the cohort to ${filters}`
            : entry.move === 'broaden'
            ? filters
                ? `widened the cohort to ${filters}`
                : 'removed the filters'
            : entry.move === 'sibling'
            ? filters
                ? `changed the filters to ${filters}`
                : 'changed the filters'
            : undefined;
    if (!change) return undefined;
    return `${PAGE_UPDATE_PREFIX}${change}. What does this change for my question?`;
}

export function isPageUpdateMessage(text: string): boolean {
    return text.trimStart().startsWith(PAGE_UPDATE_PREFIX);
}

/** Applies a change to the latest page step of the latest topic. */
export function updateLatestPageStep(
    topics: readonly Topic[],
    patch: Partial<Pick<QuestionEntry, 'finding'>>
): Topic[] {
    const current = topics[0];
    if (!current) return [...topics];
    const questions = [...current.questions];
    const index = questions.map(q => q.kind).lastIndexOf('page');
    if (index < 0) return [...topics];
    questions[index] = { ...questions[index], ...patch };
    return [{ ...current, questions }, ...topics.slice(1)];
}
