import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    Classification,
    CODEBOOK_VERSION,
    emptySlots,
    Slots,
} from './classification';
import {
    pathFor,
    studyIdFromValue,
    targetForClassification,
    targetForSlots,
} from './portalTarget';
import { CATALOG } from './testCatalog';

const STUDIES = CATALOG.studies;
const elsewhere = {
    href: 'https://x.org/study/summary?id=msk_chord_2024',
    pageType: 'study',
};
const home = { href: 'https://x.org/', pageType: 'studySelection' };

function slots(values: Partial<Record<keyof Slots, [string, string]>>): Slots {
    const s = emptySlots();
    for (const [name, [status, value]] of Object.entries(values)) {
        s[name as keyof Slots] = {
            status: status as Slots['study']['status'],
            value,
            options: [],
            source: 'chat',
        };
    }
    return s;
}

function c(overrides: Partial<Classification>): Classification {
    return {
        codebook_version: CODEBOOK_VERSION,
        request_type: 'data',
        oos_subtype: null,
        goal: 'describe',
        slots: emptySlots(),
        needs_groups: false,
        core_slots: [],
        level: 'L2',
        guidance_degree: 'directing',
        multi_part: false,
        answerability: 'ui',
        move: 'new',
        open_study_applies: false,
        drafts: { broad_aim: '', working_question: '', concrete_analysis: '' },
        rationale: '',
        checks: [],
        message: 'm',
        ...overrides,
    };
}

test('studyIdFromValue reads labels, names and ids', () => {
    assert.equal(
        studyIdFromValue('Breast Cancer (IGR, 2015) [brca_igr_2015]', STUDIES),
        'brca_igr_2015'
    );
    assert.equal(
        studyIdFromValue('Lung Adenocarcinoma (Broad, Cell 2012)', STUDIES),
        'luad_broad'
    );
    assert.equal(studyIdFromValue('luad_broad', STUDIES), 'luad_broad');
    assert.equal(studyIdFromValue('Some other study', STUDIES), undefined);
});

test('L1 to L3 without a settled study go home', () => {
    for (const level of ['L1', 'L2', 'L3'] as const) {
        assert.deepEqual(
            targetForClassification(c({ level }), STUDIES, elsewhere),
            { kind: 'home' }
        );
    }
    // Already home: stay.
    assert.equal(
        targetForClassification(c({ level: 'L3' }), STUDIES, home),
        null
    );
});

test('a settled study below L4 opens its summary', () => {
    const target = targetForClassification(
        c({
            level: 'L2',
            slots: slots({
                study: ['specified', 'Lung Adenocarcinoma (Broad, Cell 2012)'],
            }),
        }),
        STUDIES,
        elsewhere
    );
    assert.deepEqual(target, { kind: 'study', studyId: 'luad_broad' });
    assert.equal(pathFor(target!), '/study/summary?id=luad_broad');
    // Already on that study: stay.
    assert.equal(
        targetForClassification(
            c({ slots: slots({ study: ['specified', 'luad_broad'] }) }),
            STUDIES,
            {
                href: 'https://x.org/study/summary?id=luad_broad#filterJson={}',
                pageType: 'study',
            }
        ),
        null
    );
});

test('L4, a fitting page and non-data questions stay', () => {
    assert.equal(
        targetForClassification(c({ level: 'L4' }), STUDIES, elsewhere),
        null
    );
    assert.equal(
        targetForClassification(
            c({ open_study_applies: true }),
            STUDIES,
            elsewhere
        ),
        null
    );
    assert.equal(
        targetForClassification(
            c({ request_type: 'interface', level: null }),
            STUDIES,
            elsewhere
        ),
        null
    );
    assert.deepEqual(
        targetForClassification(
            c({ request_type: 'catalog', level: null }),
            STUDIES,
            elsewhere
        ),
        { kind: 'home' }
    );
});

test('slot edits: a chosen study opens it, an unsettled study goes home', () => {
    assert.deepEqual(
        targetForSlots(
            slots({
                study: [
                    'specified',
                    'Breast Cancer (IGR, 2015) [brca_igr_2015]',
                ],
            }),
            STUDIES,
            elsewhere
        ),
        { kind: 'study', studyId: 'brca_igr_2015' }
    );
    assert.deepEqual(
        targetForSlots(
            slots({ cohort: ['specified', 'breast cancer'] }),
            STUDIES,
            elsewhere
        ),
        { kind: 'home' }
    );
});

test('a loose study value opens the one study it matches in the cohort', () => {
    const s = slots({
        cohort: ['specified', 'Lung Adenocarcinoma'],
        study: ['specified', 'TCGA PanCancer Atlas'],
    });
    assert.deepEqual(targetForSlots(s, STUDIES, elsewhere, CATALOG), {
        kind: 'study',
        studyId: 'luad_tcga_pan_can_atlas_2018',
    });
    // Without the catalog it can't be resolved: stay.
    assert.equal(targetForSlots(s, STUDIES, elsewhere), null);
});
