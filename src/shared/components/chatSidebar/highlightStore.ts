// Highlights the chat iframe picked for the research question, rendered as
// badges by ChatHighlightBadge. The iframe owns the question and the LLM call;
// this only holds the latest annotations it sent for the page on screen.

import { action, observable } from 'mobx';

export type HighlightTargetType =
    | 'study'
    | 'visualization'
    | 'results-tab'
    | 'comparison-tab';

const TARGET_TYPES: readonly HighlightTargetType[] = [
    'study',
    'visualization',
    'results-tab',
    'comparison-tab',
];

export interface HighlightAnnotation {
    targetType: HighlightTargetType;
    targetId: string;
    label: string;
    rank: number;
    reason: string;
}

const MAX_ANNOTATIONS = 5;
export const FOCUS_BODY_CLASS = 'chat-highlight-focus';

const state = observable(
    {
        annotations: [] as HighlightAnnotation[],
        focus: false,
    },
    { annotations: observable.ref }
);

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
        .sort((a, b) => a.rank - b.rank)
        .slice(0, MAX_ANNOTATIONS);
    state.focus = focus === true;
    syncBodyClass();
});

export const clearHighlights = action(() => {
    state.annotations = [];
    state.focus = false;
    syncBodyClass();
});

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
    if (getHighlight(targetType, targetId)) {
        props['data-chat-highlighted'] = 'true';
    }
    return props;
}
