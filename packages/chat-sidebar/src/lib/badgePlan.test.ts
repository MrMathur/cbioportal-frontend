import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPlan,
    checkText,
    cleanTooltip,
    contextTooltip,
    stripTokens,
    tokenFromHref,
    tokensToLinks,
    visibleForPart,
} from './badgePlan';
import { emptySlots } from './classification';

const candidates = [
    {
        targetType: 'visualization',
        targetId: 'GENOMIC_PROFILES_SAMPLE_COUNT',
        label: 'Data Types',
    },
    {
        targetType: 'visualization',
        targetId: 'mutated_genes',
        label: 'Mutated Genes',
    },
    { targetType: 'visualization', targetId: 'SEX', label: 'Sex' },
    { targetType: 'visualization', targetId: 'AGE', label: 'Diagnosis Age' },
    {
        targetType: 'control',
        targetId: 'study-view-compare',
        label: 'Groups button',
    },
    {
        targetType: 'control',
        targetId: 'cohort-summary',
        label: 'Selected cohort',
    },
];

test('cleanTooltip trims to ten words and drops leading numbers', () => {
    assert.equal(
        cleanTooltip('1. KRAS mutation frequency in this cohort'),
        'KRAS mutation frequency in this cohort'
    );
    assert.equal(
        cleanTooltip(
            'one two three four five six seven eight nine ten eleven twelve'
        ),
        'one two three four five six seven eight nine ten…'
    );
    assert.equal(
        cleanTooltip('[[2]] Survival split by KRAS status'),
        'Survival split by KRAS status'
    );
});

test('buildPlan numbers results in order and enforces the limits', () => {
    const { plan, rejected } = buildPlan(
        [
            { cue: 'context', target: 'context', tooltip: 'LUAD, female' },
            {
                cue: 'result',
                target: 'visualization:mutated_genes',
                tooltip: 'KRAS frequency here',
            },
            {
                cue: 'result',
                target: 'visualization:SEX',
                tooltip: 'Split by sex',
                part: 'sex',
            },
            { cue: 'result', target: 'visualization:nope', tooltip: 'x' },
            { cue: 'result', target: 'visualization:SEX', tooltip: 'again' },
            {
                cue: 'next_step',
                target: 'control:study-view-compare',
                tooltip: 'Compare the groups',
            },
            {
                cue: 'next_step',
                target: 'comparison-tab:survival',
                tooltip: 'second next',
            },
            { cue: 'context', target: 'context', tooltip: 'second context' },
        ],
        candidates,
        ['Sex', 'Age']
    );
    assert.deepEqual(
        plan.marks.map(m => m.token),
        ['[[context]]', '[[1]]', '[[2]]', '[[next]]']
    );
    assert.equal(plan.marks[2].part, 'Sex');
    assert.equal(plan.marks[1].part, 'shared');
    assert.deepEqual(
        rejected.map(r => r.reason),
        [
            'not an element you can mark',
            'already marked',
            'only one next-step mark',
            'only one context mark',
        ]
    );
});

test('buildPlan allows tabs of other pages and caps results at five', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
        targetType: 'study',
        targetId: `s${i}`,
        label: `Study ${i}`,
    }));
    const { plan, rejected } = buildPlan(
        [
            ...many.map(m => ({
                cue: 'result',
                target: `study:${m.targetId}`,
                tooltip: 't',
            })),
            {
                cue: 'next_step',
                target: 'comparison-tab:survival',
                tooltip: 'Compare survival next',
            },
        ],
        many,
        []
    );
    assert.equal(plan.marks.filter(m => m.cue === 'result').length, 5);
    assert.equal(rejected.length, 2);
    const next = plan.marks.find(m => m.cue === 'next_step');
    assert.equal(next?.elsewhere, true);
});

test('context needs the cohort summary on the page', () => {
    const { plan, rejected } = buildPlan(
        [{ cue: 'context', target: 'context', tooltip: 'x' }],
        candidates.filter(c => c.targetId !== 'cohort-summary'),
        []
    );
    assert.equal(plan.marks.length, 0);
    assert.match(rejected[0].reason, /no cohort/);
});

test('checkText matches every mark once, at a sentence start', () => {
    const { plan } = buildPlan(
        [
            {
                cue: 'result',
                target: 'visualization:mutated_genes',
                tooltip: 'a',
            },
            { cue: 'result', target: 'visualization:SEX', tooltip: 'b' },
            {
                cue: 'next_step',
                target: 'control:study-view-compare',
                tooltip: 'c',
            },
        ],
        candidates,
        []
    );
    const good =
        '[[1]] KRAS is mutated in 32%.\n\n- [[2]] **Sex:** no difference. [[next]] Compare the groups.';
    assert.equal(checkText(good, plan).ok, true);
    const missing = checkText('[[1]] Only one.', plan);
    assert.deepEqual(missing.missing, ['[[2]]', '[[next]]']);
    const misplaced = checkText('[[1]] A. See [[2]] here. [[next]] Go.', plan);
    assert.deepEqual(misplaced.misplaced, ['[[2]]']);
    const unknown = checkText('[[1]] A. [[2]] B. [[next]] C. [[3]] D.', plan);
    assert.deepEqual(unknown.unknown, ['[[3]]']);
});

test('tokens become chip links, or are stripped', () => {
    const { plan } = buildPlan(
        [{ cue: 'result', target: 'visualization:SEX', tooltip: 'b' }],
        candidates,
        []
    );
    assert.equal(
        tokensToLinks('[[1]] Sex. [[4]] Other.', plan),
        '[1](#chat-mark-1) Sex.  Other.'
    );
    assert.equal(stripTokens('[[1]] Sex. [[next]] Go.'), 'Sex. Go.');
    assert.equal(tokenFromHref('#chat-mark-next'), '[[next]]');
    assert.equal(tokenFromHref('https://x'), undefined);
});

test('part filter keeps shared marks', () => {
    const mark = {
        token: '[[1]]',
        cue: 'result' as const,
        targetType: 't',
        targetId: 'i',
        label: 'l',
        tooltip: 't',
        part: 'Sex',
    };
    assert.equal(visibleForPart(mark, 'all'), true);
    assert.equal(visibleForPart(mark, 'Sex'), true);
    assert.equal(visibleForPart(mark, 'Age'), false);
    assert.equal(visibleForPart({ ...mark, part: 'shared' }, 'Age'), true);
});

test('contextTooltip describes the cohort from the slots', () => {
    const slots = emptySlots();
    slots.cohort = {
        status: 'specified',
        value: 'Lung adenocarcinoma',
        options: [],
        source: 'chat',
    };
    slots.study = {
        status: 'specified',
        value: 'MSK-CHORD (MSK, Nature 2024) [msk_chord_2024]',
        options: [],
        source: 'page',
    };
    slots.filter = {
        status: 'specified',
        value: 'Sex: Female',
        options: [],
        source: 'page',
    };
    assert.equal(
        contextTooltip(slots),
        'Lung adenocarcinoma, MSK-CHORD (MSK, Nature 2024), Sex: Female'
    );
});
