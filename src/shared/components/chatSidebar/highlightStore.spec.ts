import { assert } from 'chai';
import {
    clearHighlights,
    FOCUS_BODY_CLASS,
    getHighlight,
    getHighlights,
    highlightTargetProps,
    setHighlights,
} from './highlightStore';

function annotation(
    targetId: string,
    rank: number,
    targetType = 'visualization'
) {
    return { targetType, targetId, label: targetId, rank, reason: `r${rank}` };
}

describe('highlightStore', () => {
    afterEach(() => clearHighlights());

    it('keeps valid annotations sorted by rank, at most 5', () => {
        setHighlights(
            [
                annotation('C', 3),
                annotation('A', 1),
                annotation('B', 2),
                annotation('D', 4),
                annotation('E', 5),
                annotation('F', 6),
            ],
            false
        );
        assert.deepEqual(
            getHighlights().map(a => a.targetId),
            ['A', 'B', 'C', 'D', 'E']
        );
    });

    it('drops malformed entries and non-array payloads', () => {
        setHighlights(
            [
                annotation('A', 1, 'not-a-type'),
                { ...annotation('B', 2), reason: '  ' },
                { targetType: 'study', targetId: 'x' },
                null,
                annotation('ok', 1, 'study'),
            ],
            false
        );
        assert.deepEqual(
            getHighlights().map(a => a.targetId),
            ['ok']
        );
        setHighlights('nope', false);
        assert.equal(getHighlights().length, 0);
    });

    it('looks annotations up by type and id', () => {
        setHighlights([annotation('SEX', 1)], false);
        assert.equal(getHighlight('visualization', 'SEX')?.reason, 'r1');
        assert.isUndefined(getHighlight('study', 'SEX'));
    });

    it('marks highlighted targets for focus mode', () => {
        setHighlights([annotation('SEX', 1)], false);
        assert.deepEqual(highlightTargetProps('visualization', 'SEX'), {
            'data-chat-highlight-target': 'visualization:SEX',
            'data-chat-highlighted': 'true',
        });
        assert.deepEqual(highlightTargetProps('visualization', 'AGE'), {
            'data-chat-highlight-target': 'visualization:AGE',
        });
    });

    it('turns on focus mode only while something is highlighted', () => {
        setHighlights([annotation('SEX', 1)], true);
        assert.isTrue(document.body.classList.contains(FOCUS_BODY_CLASS));
        setHighlights([], true);
        assert.isFalse(document.body.classList.contains(FOCUS_BODY_CLASS));
        setHighlights([annotation('SEX', 1)], true);
        clearHighlights();
        assert.isFalse(document.body.classList.contains(FOCUS_BODY_CLASS));
    });
});
