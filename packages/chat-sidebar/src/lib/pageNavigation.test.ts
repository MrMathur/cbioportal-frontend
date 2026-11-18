import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeNavigation, pageViewOf, samePage } from './pageNavigation';

const name = (id: string) => ({ luad: 'Lung Adenocarcinoma' }[id] ?? id);
const home = (studies: string[], step: 'studies' | 'genes' = 'studies') =>
    pageViewOf('https://x.org/', {
        pageType: 'studySelection',
        selectedStudyIds: studies,
        step,
    })!;

test('page views: no view without details', () => {
    assert.equal(pageViewOf('https://x.org/', { available: false }), undefined);
    const study = pageViewOf('https://x.org/study/summary?id=luad', {
        pageType: 'study',
    })!;
    assert.deepEqual(study.studies, ['luad']);
    assert.equal(samePage(study, { ...study, step: undefined }), true);
});

test('ticking studies and opening the gene form are steps', () => {
    assert.equal(
        describeNavigation(home([]), home(['luad']), name),
        'selected the study Lung Adenocarcinoma in the study list'
    );
    assert.equal(
        describeNavigation(home(['luad']), home(['luad'], 'genes'), name),
        'clicked "Query By Gene" for Lung Adenocarcinoma, which opened the form for entering genes'
    );
    assert.equal(describeNavigation(home(['luad']), home([]), name), undefined);
    assert.equal(
        describeNavigation(home(['luad']), home(['luad']), name),
        undefined
    );
});

test('opening another page is a step; going back to the list is not', () => {
    const results = pageViewOf(
        'https://x.org/results/oncoprint?cancer_study_list=luad',
        { pageType: 'results', hugoGeneSymbols: ['KRAS', 'TP53'] }
    )!;
    assert.equal(
        describeNavigation(home(['luad'], 'genes'), results, name),
        'ran a query for KRAS; TP53 in Lung Adenocarcinoma'
    );
    const study = pageViewOf('https://x.org/study/summary?id=luad', {
        pageType: 'study',
    })!;
    assert.equal(
        describeNavigation(home([]), study, name),
        'opened the Study View of Lung Adenocarcinoma'
    );
    assert.equal(describeNavigation(study, home([]), name), undefined);
    assert.equal(describeNavigation(study, study, name), undefined);
});

test('Group Comparison is named by its groups once they load', () => {
    const study = pageViewOf('https://x.org/study/summary?id=luad', {
        pageType: 'study',
    })!;
    const loading = pageViewOf('https://x.org/comparison?comparisonId=1', {
        pageType: 'groupComparison',
        groups: [],
    })!;
    const loaded = pageViewOf('https://x.org/comparison?comparisonId=1', {
        pageType: 'groupComparison',
        groups: [{ name: 'Female' }, { name: 'Male' }],
    })!;
    assert.equal(
        describeNavigation(study, loading, name),
        'opened Group Comparison'
    );
    assert.equal(
        describeNavigation(loading, loaded, name),
        'opened Group Comparison with the groups Female; Male'
    );
});
