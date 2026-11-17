import {
    getCategoryRowHighlightClassName,
    getChartHighlightProps,
    getChatHighlight,
    getGeneRowHighlightClassName,
    isGeneRowHovered,
    setChatHighlight,
    setPinnedChatHighlights,
} from './highlightStore';

describe('highlightStore', () => {
    afterEach(() => {
        setChatHighlight(null);
        setPinnedChatHighlights([]);
    });

    it('marks pinned terms softly until one is hovered', () => {
        setPinnedChatHighlights([
            { type: 'gene', id: 'PIK3CA', role: 'subject' },
            { type: 'gene', id: 'TP53', role: 'compare' },
        ]);
        expect(getGeneRowHighlightClassName('PIK3CA')).toBe(
            'chat-highlight-row chat-highlight-subject chat-highlight-pinned'
        );
        expect(getGeneRowHighlightClassName('TP53')).toBe(
            'chat-highlight-row chat-highlight-compare chat-highlight-pinned'
        );
        expect(isGeneRowHovered('PIK3CA')).toBe(false);

        setChatHighlight({ type: 'gene', id: 'PIK3CA', role: 'subject' });
        expect(getGeneRowHighlightClassName('PIK3CA')).toBe(
            'chat-highlight-row chat-highlight-subject'
        );
        expect(isGeneRowHovered('PIK3CA')).toBe(true);
    });

    it('marks a pinned chart softly', () => {
        setPinnedChatHighlights([{ type: 'chart', id: 'A' }]);
        expect(getChartHighlightProps('A', false)).toEqual({
            'data-chat-highlight': 'context',
            'data-chat-highlight-pinned': true,
        });
    });

    it('drops malformed pinned terms', () => {
        setPinnedChatHighlights([{ type: 'nope', id: 'x' }]);
        expect(getGeneRowHighlightClassName('x')).toBeUndefined();
        setPinnedChatHighlights('nope');
        expect(getGeneRowHighlightClassName('x')).toBeUndefined();
    });

    it('marks only the highlighted gene', () => {
        setChatHighlight({ type: 'gene', id: 'PIK3CA', role: 'subject' });
        expect(getGeneRowHighlightClassName('PIK3CA')).toBe(
            'chat-highlight-row chat-highlight-subject'
        );
        expect(getGeneRowHighlightClassName('TP53')).toBeUndefined();
    });

    it('matches a category within its own chart', () => {
        setChatHighlight({ type: 'category', chartKey: 'A', id: 'x' });
        expect(getCategoryRowHighlightClassName('A', 'x')).toBeDefined();
        expect(getCategoryRowHighlightClassName('B', 'x')).toBeUndefined();
    });

    it('marks a chart for a category only when it has no rows', () => {
        setChatHighlight({ type: 'category', chartKey: 'A', id: 'x' });
        expect(getChartHighlightProps('A', false)).toEqual({
            'data-chat-highlight': 'context',
        });
        expect(getChartHighlightProps('A', true)).toEqual({});
    });

    it('clears on a malformed payload', () => {
        setChatHighlight({ type: 'gene', id: 'PIK3CA' });
        setChatHighlight({ type: 'script', id: 'x' });
        expect(getChatHighlight()).toBeUndefined();
        setChatHighlight({ type: 'gene', id: 'PIK3CA', role: 'highlight' });
        expect(getChatHighlight()).toBeUndefined();
        setChatHighlight({ type: 'category', id: 'x' });
        expect(getChatHighlight()).toBeUndefined();
    });
});
