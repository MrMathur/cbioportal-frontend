import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    HighlightCandidate,
    narrowCandidates,
    parseCandidates,
    validateAnnotations,
} from './highlights.js';

const candidates: HighlightCandidate[] = [
    {
        targetType: 'visualization',
        targetId: 'OS_SURVIVAL',
        label: 'Overall Survival',
    },
    { targetType: 'visualization', targetId: 'SEX', label: 'Sex' },
    { targetType: 'visualization', targetId: 'AGE', label: 'Diagnosis Age' },
    { targetType: 'results-tab', targetId: 'oncoprint', label: 'OncoPrint' },
    { targetType: 'results-tab', targetId: 'mutations', label: 'Mutations' },
    { targetType: 'results-tab', targetId: 'plots', label: 'Plots' },
];

test('validateAnnotations drops ids not in the candidates', () => {
    const result = validateAnnotations(
        [
            { targetType: 'visualization', targetId: 'MADE_UP', reason: 'x' },
            {
                targetType: 'visualization',
                targetId: 'SEX',
                reason: 'Sex split.',
            },
        ],
        candidates
    );
    assert.deepEqual(
        result.map(a => a.targetId),
        ['SEX']
    );
});

test('validateAnnotations requires the type to match too', () => {
    const result = validateAnnotations(
        [{ targetType: 'results-tab', targetId: 'SEX', reason: 'r' }],
        candidates
    );
    assert.equal(result.length, 0);
});

test('validateAnnotations dedupes, ranks 1..N, and takes labels from candidates', () => {
    const result = validateAnnotations(
        [
            { targetType: 'visualization', targetId: 'AGE', reason: ' Age. ' },
            { targetType: 'visualization', targetId: 'AGE', reason: 'Again.' },
            { targetType: 'visualization', targetId: 'SEX', reason: 'Sex.' },
        ],
        candidates
    );
    assert.deepEqual(result, [
        {
            targetType: 'visualization',
            targetId: 'AGE',
            label: 'Diagnosis Age',
            rank: 1,
            reason: 'Age.',
        },
        {
            targetType: 'visualization',
            targetId: 'SEX',
            label: 'Sex',
            rank: 2,
            reason: 'Sex.',
        },
    ]);
});

test('validateAnnotations drops empty reasons and keeps at most 5', () => {
    const result = validateAnnotations(
        [
            {
                targetType: 'visualization',
                targetId: 'OS_SURVIVAL',
                reason: '',
            },
            ...candidates.map(c => ({ ...c, reason: 'r' })),
        ],
        candidates
    );
    assert.equal(result.length, 5);
    assert.equal(result[0].targetId, 'OS_SURVIVAL');
});

test('parseCandidates drops malformed entries', () => {
    assert.deepEqual(
        parseCandidates([
            { targetType: 'study', targetId: 'brca', label: 'Breast' },
            { targetType: 'nope', targetId: 'x', label: 'x' },
            { targetType: 'study', label: 'no id' },
            null,
        ]),
        [
            {
                targetType: 'study',
                targetId: 'brca',
                label: 'Breast',
                description: undefined,
            },
        ]
    );
    assert.deepEqual(parseCandidates('nope'), []);
});

test('narrowCandidates keeps the best word matches in original order', () => {
    const studies: HighlightCandidate[] = [
        { targetType: 'study', targetId: 'a', label: 'Lung Adenocarcinoma' },
        { targetType: 'study', targetId: 'b', label: 'Breast Cancer' },
        {
            targetType: 'study',
            targetId: 'c',
            label: 'Breast Invasive Carcinoma',
        },
        { targetType: 'study', targetId: 'd', label: 'Glioma' },
    ];
    const result = narrowCandidates('TP53 in breast carcinoma', studies, 2);
    assert.deepEqual(
        result.map(c => c.targetId),
        ['b', 'c']
    );
    assert.equal(narrowCandidates('x', studies).length, 4);
});
