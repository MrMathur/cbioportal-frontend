// Mirrors the server's classification.ts (codebook version 5): the
// classification streamed as a `data-classification` part before each guided
// reply.

export const CODEBOOK_VERSION = 5;

export const SLOT_NAMES = [
    'cohort',
    'study',
    'entity',
    'measure',
    'groups',
    'filter',
] as const;
export type SlotName = typeof SLOT_NAMES[number];

export type SlotStatus = 'specified' | 'ambiguous' | 'missing';
export type SlotSource = 'chat' | 'user' | 'page';
export type Move = 'same' | 'refine' | 'broaden' | 'sibling' | 'new';
export type Goal = 'explore' | 'describe' | 'explain' | 'confirm';

export interface Slot {
    status: SlotStatus;
    value: string | null;
    options: string[];
    source: SlotSource;
}

export type Slots = Record<SlotName, Slot>;

export interface Classification {
    codebook_version: number;
    request_type: 'data' | 'interface' | 'catalog' | 'out_of_scope';
    oos_subtype: 'knowledge' | 'software' | 'coding' | 'critique' | null;
    goal: Goal | null;
    slots: Slots;
    needs_groups: boolean;
    core_slots: SlotName[];
    level: 'L1' | 'L2' | 'L3' | 'L4' | null;
    guidance_degree: string;
    multi_part: boolean;
    answerability: 'ui' | 'custom' | 'unavailable';
    move: Move | null;
    // Whether the study open on the page fits the question (its study and
    // filters count as fixed).
    open_study_applies?: boolean;
    drafts: {
        broad_aim: string;
        working_question: string;
        concrete_analysis: string;
    };
    rationale: string;
    checks: string[];
    message: string;
}

export function isClassification(value: unknown): value is Classification {
    const c = value as Partial<Classification> | null;
    return (
        !!c &&
        c.codebook_version === CODEBOOK_VERSION &&
        typeof c.request_type === 'string' &&
        !!c.slots &&
        SLOT_NAMES.every(n => typeof c.slots?.[n]?.status === 'string') &&
        !!c.drafts
    );
}

export const SLOT_LABELS: Record<SlotName, string> = {
    cohort: 'Cohort',
    study: 'Study',
    entity: 'Gene / alteration',
    measure: 'What to learn',
    groups: 'Groups to compare',
    filter: 'Filters',
};

export function emptySlots(): Slots {
    const slots = {} as Slots;
    for (const name of SLOT_NAMES) {
        slots[name] = {
            status: 'missing',
            value: null,
            options: [],
            source: 'chat',
        };
    }
    return slots;
}
