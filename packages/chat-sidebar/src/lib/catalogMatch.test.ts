import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCatalog, subtreeIds, tokenize } from './catalogMatch';
import { CATALOG } from './testCatalog';
import { studyIdsFromHref } from './pageStudies';

test('tokenize drops generic words and plurals', () => {
    assert.deepEqual(tokenize('KRAS mutations in lung cancers'), [
        'kras',
        'lung',
    ]);
});

test('subtreeIds includes every type below', () => {
    assert.deepEqual(
        [...subtreeIds(CATALOG, 'lung')].sort(),
        ['lung', 'luad', 'lusc', 'nsclc', 'sclc'].sort()
    );
});

test('"lung cancer" offers the tissue node with its subtypes', () => {
    const matches = matchCatalog(CATALOG, 'KRAS in lung cancer');
    const lung = matches.cancerTypes.find(t => t.id === 'lung');
    assert.ok(lung, 'lung offered');
    assert.equal(lung.ownStudies, 0);
    assert.equal(lung.subtreeStudies, 4);
    assert.deepEqual(
        lung.children.map(c => c.id),
        ['nsclc', 'sclc']
    );
    assert.ok(matches.studies.some(s => s.studyId.startsWith('luad')));
});

test('"breast cancer" offers invasive breast carcinoma', () => {
    const matches = matchCatalog(CATALOG, 'TP53 in breast cancer');
    const brca = matches.cancerTypes.find(t => t.id === 'brca');
    assert.ok(brca, 'brca offered');
    assert.equal(brca.ownStudies, 3);
});

test('a study id in the text ranks that study first', () => {
    const matches = matchCatalog(
        CATALOG,
        'survival in brca_metabric by subtype'
    );
    assert.equal(matches.studies[0].studyId, 'brca_metabric');
});

test('selected studies are reported and narrow the study context', () => {
    const matches = matchCatalog(CATALOG, 'age at diagnosis', ['luad_broad'], {
        studyIds: ['luad_broad'],
        clinicalAttributes: [
            {
                id: 'SEX',
                name: 'Sex',
                patientAttribute: true,
                datatype: 'STRING',
            },
            {
                id: 'AGE',
                name: 'Diagnosis Age',
                patientAttribute: true,
                datatype: 'NUMBER',
            },
        ],
        molecularProfiles: [],
        cancerTypes: [{ name: 'Non-Small Cell Lung Cancer', count: 183 }],
    });
    assert.deepEqual(
        matches.selectedStudies.map(s => s.studyId),
        ['luad_broad']
    );
    assert.equal(matches.clinicalAttributes[0].id, 'AGE');
    assert.equal(matches.selectedStudyCancerTypes.length, 1);
});

test('a study context for other studies is ignored', () => {
    const matches = matchCatalog(CATALOG, 'sex', ['luad_broad'], {
        studyIds: ['brca_metabric'],
        clinicalAttributes: [
            {
                id: 'SEX',
                name: 'Sex',
                patientAttribute: true,
                datatype: 'STRING',
            },
        ],
        molecularProfiles: [],
        cancerTypes: [],
    });
    assert.equal(matches.clinicalAttributes.length, 0);
});

test('studyIdsFromHref reads study, results and patient pages', () => {
    assert.deepEqual(
        studyIdsFromHref(
            'https://www.cbioportal.org/study/summary?id=a_study,b_study#filterJson={}'
        ),
        ['a_study', 'b_study']
    );
    assert.deepEqual(
        studyIdsFromHref(
            'https://www.cbioportal.org/results/oncoprint?cancer_study_list=luad_broad&gene_list=KRAS'
        ),
        ['luad_broad']
    );
    assert.deepEqual(studyIdsFromHref('https://www.cbioportal.org/'), []);
});
