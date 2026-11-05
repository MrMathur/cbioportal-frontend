import { Classification, Slots } from './classification';

// Earlier questions grouped into topics: a `new` move starts a topic,
// refinements, broadenings and sibling moves stay in the current one. Pure,
// so the grouping and the compact listing can be tested.

export type QuestionMove = 'start' | 'same' | 'refine' | 'broaden' | 'sibling';

export interface QuestionEntry {
    id: string;
    at: string;
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

/** Applies a change to the latest question of the latest topic. */
export function updateLatestQuestion(
    topics: readonly Topic[],
    patch: Partial<Pick<QuestionEntry, 'href' | 'finding'>>
): Topic[] {
    const current = topics[0];
    if (!current || current.questions.length === 0) return [...topics];
    const questions = [...current.questions];
    const last = questions[questions.length - 1];
    if (
        (patch.href === undefined || patch.href === last.href) &&
        (patch.finding === undefined || patch.finding === last.finding)
    ) {
        return [...topics];
    }
    questions[questions.length - 1] = { ...last, ...patch };
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
