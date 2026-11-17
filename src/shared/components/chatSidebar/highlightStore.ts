// The dashboard elements the chat sidebar points at: the term hovered, if any,
// and the terms the user clicked to keep highlighted. The iframe sends both;
// tables and charts read this to mark themselves.

import { action, observable } from 'mobx';

export type ChatHighlightType = 'gene' | 'chart' | 'category' | 'column';
export type ChatHighlightRole = 'subject' | 'compare' | 'filter' | 'context';

export interface ChatHighlight {
    type: ChatHighlightType;
    id: string;
    // The chart a category belongs to.
    chartKey?: string;
    // What the term means in the reply, which sets the mark's colour; context
    // without one.
    role?: ChatHighlightRole;
}

const TYPES: readonly string[] = ['gene', 'chart', 'category', 'column'];
const ROLES: readonly (string | undefined)[] = [
    'subject',
    'compare',
    'filter',
    'context',
    undefined,
];

const MAX_PINNED = 8;

const current = observable.box<ChatHighlight | undefined>(undefined, {
    deep: false,
});

// Terms the user clicked in the sidebar, marked until they are unclicked.
const pinned = observable.box<readonly ChatHighlight[]>([], { deep: false });

export function isChatHighlight(value: unknown): value is ChatHighlight {
    const h = value as Partial<ChatHighlight> | null;
    return (
        !!h &&
        TYPES.includes(h.type as string) &&
        typeof h.id === 'string' &&
        ROLES.includes(h.role) &&
        (h.type !== 'category' || typeof h.chartKey === 'string')
    );
}

/** Takes the iframe's payload as sent; anything malformed clears. */
export const setChatHighlight = action((value: unknown) => {
    current.set(isChatHighlight(value) ? value : undefined);
});

export function getChatHighlight(): ChatHighlight | undefined {
    return current.get();
}

/** Takes the iframe's payload as sent; anything malformed is dropped. */
export const setPinnedChatHighlights = action((value: unknown) => {
    pinned.set(
        (Array.isArray(value) ? value : [])
            .filter(isChatHighlight)
            .slice(0, MAX_PINNED)
    );
});

export function getPinnedChatHighlights(): readonly ChatHighlight[] {
    return pinned.get();
}

function markedBy(
    matches: (highlight: ChatHighlight) => boolean
): { highlight: ChatHighlight; pinned: boolean } | undefined {
    const hovered = getChatHighlight();
    if (hovered && matches(hovered)) {
        return { highlight: hovered, pinned: false };
    }
    const highlight = getPinnedChatHighlights().find(matches);
    return highlight && { highlight, pinned: true };
}

function rowClassName(mark: ReturnType<typeof markedBy>): string | undefined {
    if (!mark) return undefined;
    const role = mark.highlight.role ?? 'context';
    return `chat-highlight-row chat-highlight-${role}${
        mark.pinned ? ' chat-highlight-pinned' : ''
    }`;
}

function isGene(highlight: ChatHighlight, gene: string): boolean {
    return highlight.type === 'gene' && highlight.id === gene;
}

function isCategory(
    highlight: ChatHighlight,
    chartKey: string | undefined,
    value: string
): boolean {
    return (
        highlight.type === 'category' &&
        highlight.chartKey === chartKey &&
        highlight.id === value
    );
}

export function getGeneRowHighlightClassName(gene: string): string | undefined {
    return rowClassName(markedBy(h => isGene(h, gene)));
}

export function isGeneRowHovered(gene: string): boolean {
    const hovered = getChatHighlight();
    return !!hovered && isGene(hovered, gene);
}

export function getCategoryRowHighlightClassName(
    chartKey: string | undefined,
    value: string
): string | undefined {
    return rowClassName(markedBy(h => isCategory(h, chartKey, value)));
}

export function isCategoryRowHovered(
    chartKey: string | undefined,
    value: string
): boolean {
    const hovered = getChatHighlight();
    return !!hovered && isCategory(hovered, chartKey, value);
}

/**
 * Props for a chart's root element. A category highlights the whole chart
 * unless the chart is a table, which marks the category's row instead.
 */
export function getChartHighlightProps(
    chartKey: string,
    showsCategoriesAsRows: boolean
): { 'data-chat-highlight'?: string; 'data-chat-highlight-pinned'?: boolean } {
    const mark = markedBy(
        h =>
            (h.type === 'chart' && h.id === chartKey) ||
            (h.type === 'category' &&
                h.chartKey === chartKey &&
                !showsCategoriesAsRows)
    );
    if (!mark) return {};
    return {
        'data-chat-highlight': mark.highlight.role ?? 'context',
        ...(mark.pinned ? { 'data-chat-highlight-pinned': true } : {}),
    };
}

/** Runs once the highlight has rendered. */
export function scrollChatHighlightIntoView() {
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            document
                .querySelector(
                    '[data-chat-highlight]:not([data-chat-highlight-pinned]), .chat-highlight-row:not(.chat-highlight-pinned)'
                )
                ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        })
    );
}
