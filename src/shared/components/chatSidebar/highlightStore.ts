// Highlights the chat iframe picked for the research question, rendered as
// badges by ChatHighlightBadge. The iframe owns the question and the LLM call;
// this only holds the latest annotations it sent for the page on screen.

import { action, observable } from 'mobx';

export type HighlightTargetType =
    | 'study'
    | 'visualization'
    | 'results-tab'
    | 'comparison-tab'
    | 'control';

const TARGET_TYPES: readonly HighlightTargetType[] = [
    'study',
    'visualization',
    'results-tab',
    'comparison-tab',
    'control',
];

// What a badge says: a part of the answer (numbered), the cohort being
// looked at, or a possible next step. Each has its own shape.
export type HighlightCue = 'context' | 'result' | 'next_step';

export interface HighlightAnnotation {
    targetType: HighlightTargetType;
    targetId: string;
    label: string;
    rank: number;
    // The tooltip: why the badge is there.
    reason: string;
    cue: HighlightCue;
    // Result badges: their number in the chat's answer.
    number?: number;
    // Whether the chat's text refers to this badge, so hovering one finds
    // the other.
    linked: boolean;
}

const MAX_RESULTS = 5;
const MAX_ANNOTATIONS = MAX_RESULTS + 2;
const EMPHASIS_MS = 1600;
export const FOCUS_BODY_CLASS = 'chat-highlight-focus';

const state = observable(
    {
        annotations: [] as HighlightAnnotation[],
        focus: false,
        // The badge hovered in the chat (its number chip), pulsed here.
        hoveredKey: null as string | null,
        // The badge just scrolled to from the chat, briefly emphasised.
        emphasizedKey: null as string | null,
    },
    { annotations: observable.ref }
);

export function highlightKey(targetType: string, targetId: string): string {
    return `${targetType}:${targetId}`;
}

function isCue(value: unknown): value is HighlightCue {
    return value === 'context' || value === 'result' || value === 'next_step';
}

// Payloads from sidebars before cue types are results, numbered by rank.
function normalize(a: HighlightAnnotation): HighlightAnnotation {
    const cue = isCue(a.cue) ? a.cue : 'result';
    return {
        ...a,
        cue,
        number:
            cue === 'result'
                ? typeof a.number === 'number'
                    ? a.number
                    : a.rank
                : undefined,
        linked: a.linked === true,
    };
}

// At most five results, one context marker and one next step.
function withinLimits(
    annotations: HighlightAnnotation[]
): HighlightAnnotation[] {
    const counts: Record<HighlightCue, number> = {
        result: 0,
        context: 0,
        next_step: 0,
    };
    const limits: Record<HighlightCue, number> = {
        result: MAX_RESULTS,
        context: 1,
        next_step: 1,
    };
    return annotations.filter(a => ++counts[a.cue] <= limits[a.cue]);
}

function isAnnotation(value: unknown): value is HighlightAnnotation {
    const a = value as Partial<HighlightAnnotation> | null;
    return (
        !!a &&
        TARGET_TYPES.includes(a.targetType as HighlightTargetType) &&
        typeof a.targetId === 'string' &&
        typeof a.label === 'string' &&
        typeof a.rank === 'number' &&
        typeof a.reason === 'string' &&
        a.reason.trim().length > 0
    );
}

function syncBodyClass() {
    document.body.classList.toggle(
        FOCUS_BODY_CLASS,
        state.focus && state.annotations.length > 0
    );
}

/** Takes the iframe's message payload as sent; anything malformed is dropped. */
export const setHighlights = action((annotations: unknown, focus: unknown) => {
    state.annotations = (Array.isArray(annotations) ? annotations : [])
        .filter(isAnnotation)
        .map(normalize)
        .sort((a, b) => a.rank - b.rank);
    state.annotations = withinLimits(state.annotations).slice(
        0,
        MAX_ANNOTATIONS
    );
    state.focus = focus === true;
    syncBodyClass();
});

export const clearHighlights = action(() => {
    state.annotations = [];
    state.focus = false;
    state.hoveredKey = null;
    syncBodyClass();
});

/** A number chip hovered in the chat (null: no longer). */
export const setHoveredHighlight = action((key: string | null) => {
    state.hoveredKey = key;
});

let emphasisTimer: ReturnType<typeof setTimeout> | undefined;

/** Briefly emphasises a badge's element after scrolling to it. */
export const emphasizeHighlight = action((key: string) => {
    state.emphasizedKey = key;
    clearTimeout(emphasisTimer);
    emphasisTimer = setTimeout(
        action(() => {
            state.emphasizedKey = null;
        }),
        EMPHASIS_MS
    );
});

export function getHoveredHighlight(): string | null {
    return state.hoveredKey;
}

// Who to tell when a linked badge is hovered here: the chat, which marks
// the matching sentence. Set by ChatSidebar.
let hoverListener: ((key: string | null) => void) | undefined;

export function setBadgeHoverListener(
    listener: ((key: string | null) => void) | undefined
): void {
    hoverListener = listener;
}

export function notifyBadgeHover(annotation: HighlightAnnotation | null): void {
    if (annotation && !annotation.linked) return;
    hoverListener?.(
        annotation
            ? highlightKey(annotation.targetType, annotation.targetId)
            : null
    );
}

export function getHighlights(): readonly HighlightAnnotation[] {
    return state.annotations;
}

export function getHighlight(
    targetType: HighlightTargetType,
    targetId: string
): HighlightAnnotation | undefined {
    return state.annotations.find(
        a => a.targetType === targetType && a.targetId === targetId
    );
}

/**
 * Marks a candidate's root element so focus mode can fade the ones without a
 * badge. Read inside an observer render so it updates with the highlights.
 */
export function highlightTargetProps(
    targetType: HighlightTargetType,
    targetId: string
): Record<string, string> {
    const props: Record<string, string> = {
        'data-chat-highlight-target': `${targetType}:${targetId}`,
    };
    const annotation = getHighlight(targetType, targetId);
    if (annotation) {
        props['data-chat-highlighted'] = 'true';
        props['data-chat-cue'] = annotation.cue;
        const key = highlightKey(targetType, targetId);
        if (state.hoveredKey === key) props['data-chat-hovered'] = 'true';
        if (state.emphasizedKey === key) props['data-chat-emphasis'] = 'true';
    }
    return props;
}
