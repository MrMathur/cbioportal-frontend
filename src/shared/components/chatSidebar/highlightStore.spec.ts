import { assert } from 'chai';
import {
    clearHighlights,
    emphasizeHighlight,
    setHoveredHighlight,
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

    it('accepts controls as a target type', () => {
        setHighlights([annotation('study-view-compare', 1, 'control')], false);
        assert.equal(getHighlight('control', 'study-view-compare')?.rank, 1);
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
            'data-chat-cue': 'result',
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
    it('keeps one context, five results and one next step', () => {
        const cued = (id: string, rank: number, cue: string) => ({
            ...annotation(id, rank),
            cue,
            number: cue === 'result' ? rank : undefined,
            linked: true,
        });
        setHighlights(
            [
                cued('ctx1', 6, 'context'),
                cued('ctx2', 6, 'context'),
                ...[1, 2, 3, 4, 5, 6].map(n => cued(`r${n}`, n, 'result')),
                cued('n1', 7, 'next_step'),
                cued('n2', 7, 'next_step'),
            ],
            false
        );
        assert.deepEqual(
            getHighlights().map(a => a.targetId),
            ['r1', 'r2', 'r3', 'r4', 'r5', 'ctx1', 'n1']
        );
    });

    it('reads older payloads as numbered, unlinked results', () => {
        setHighlights([annotation('A', 2)], false);
        const a = getHighlight('visualization', 'A');
        assert.equal(a?.cue, 'result');
        assert.equal(a?.number, 2);
        assert.equal(a?.linked, false);
    });

    it('marks the hovered and emphasised element', () => {
        setHighlights([annotation('A', 1)], false);
        setHoveredHighlight('visualization:A');
        assert.equal(
            highlightTargetProps('visualization', 'A')['data-chat-hovered'],
            'true'
        );
        setHoveredHighlight(null);
        emphasizeHighlight('visualization:A');
        const props = highlightTargetProps('visualization', 'A');
        assert.equal(props['data-chat-emphasis'], 'true');
        assert.equal(props['data-chat-cue'], 'result');
        assert.isUndefined(props['data-chat-hovered']);
    });
});
