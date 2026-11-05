import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    filterKeysFromHref,
    filtersFromHref,
    slotsFromPage,
} from './pageSlots';
import { CATALOG } from './testCatalog';

const filter = {
    clinicalDataFilters: [
        { attributeId: 'SEX', values: [{ value: 'Female' }] },
        { attributeId: 'AGE', values: [{ start: 40, end: 60 }] },
        {
            attributeId: 'CANCER_TYPE_DETAILED',
            values: [{ value: 'Lung Adenocarcinoma' }],
        },
    ],
    geneFilters: [
        {
            molecularProfileIds: ['x_mutations'],
            geneQueries: [[{ hugoGeneSymbol: 'KRAS', alterations: [] }]],
        },
    ],
};

const context = {
    studyIds: ['luad_broad'],
    clinicalAttributes: [
        { id: 'SEX', name: 'Sex', patientAttribute: true, datatype: 'STRING' },
        {
            id: 'AGE',
            name: 'Diagnosis Age',
            patientAttribute: true,
            datatype: 'NUMBER',
        },
    ],
    molecularProfiles: [],
    cancerTypes: [],
};

test('Study View: study, cohort, filters and genes from the href', () => {
    const href = `https://www.cbioportal.org/study/summary?id=luad_broad#filterJson=${JSON.stringify(
        filter
    )}`;
    assert.deepEqual(slotsFromPage(href, {}, CATALOG, context), {
        study: 'Lung Adenocarcinoma (Broad, Cell 2012)',
        cohort: 'Lung Adenocarcinoma',
        filter: 'Sex: Female; Diagnosis Age: 40–60',
        entity: 'KRAS',
    });
});

test('an encoded filterJson parses too', () => {
    const href = `https://x.org/study?id=a#filterJson=${encodeURIComponent(
        JSON.stringify(filter)
    )}`;
    assert.equal(filtersFromHref(href)?.clinicalDataFilters?.length, 3);
});

test('without filters only the study is set; ids stand in for names', () => {
    assert.deepEqual(
        slotsFromPage('https://x.org/study?id=unknown_study', {}),
        { study: 'unknown_study' }
    );
});

test('Results View: the gene query is the entity', () => {
    assert.deepEqual(
        slotsFromPage(
            'https://x.org/results/oncoprint?cancer_study_list=luad_broad&gene_list=KRAS',
            { hugoGeneSymbols: ['KRAS', 'EGFR', 'TP53', 'STK11'] },
            CATALOG
        ),
        {
            study: 'Lung Adenocarcinoma (Broad, Cell 2012)',
            entity: 'KRAS, EGFR, TP53 +1',
        }
    );
});

test('other pages set nothing', () => {
    assert.deepEqual(slotsFromPage('https://x.org/', {}), {});
});

test('filterKeysFromHref lists Study View filters by id', () => {
    const href = `https://x.org/study/summary?id=luad_broad#filterJson=${JSON.stringify(
        filter
    )}`;
    assert.deepEqual(filterKeysFromHref(href), [
        'clinical:AGE=40-60',
        'clinical:CANCER_TYPE_DETAILED=Lung Adenocarcinoma',
        'clinical:SEX=Female',
        'gene:KRAS',
    ]);
    assert.deepEqual(filterKeysFromHref('https://x.org/study?id=a'), []);
    assert.equal(
        filterKeysFromHref('https://x.org/results?cancer_study_list=a'),
        null
    );
});
