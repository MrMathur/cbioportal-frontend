import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import {
    sameSlotValue,
    CatalogMatches,
    computeLevel,
    findLatestClassification,
    GuidanceContext,
    RawClassification,
    resolveClassification,
    separateCohorts,
    SLOT_NAMES,
    Slots,
} from './classification.js';
import { guidanceBlock, parseSections, sectionNamesFor } from './guidance.js';
import { logToCsv, CSV_COLUMNS } from './logCsv.js';
import { parseClientEvent } from './guidanceLog.js';

const LUNG = {
    id: 'lung',
    name: 'Lung',
    parent: 'tissue',
    ownStudies: 0,
    subtreeStudies: 40,
    children: [
        { id: 'nsclc', name: 'Non-Small Cell Lung Cancer', subtreeStudies: 30 },
        { id: 'sclc', name: 'Small Cell Lung Cancer', subtreeStudies: 10 },
    ],
};
const BREAST = {
    id: 'breast',
    name: 'Breast',
    parent: 'tissue',
    ownStudies: 0,
    subtreeStudies: 40,
    children: [
        { id: 'brca', name: 'Invasive Breast Carcinoma', subtreeStudies: 36 },
        { id: 'mbc', name: 'Metaplastic Breast Cancer', subtreeStudies: 4 },
    ],
};
const BRCA = {
    id: 'brca',
    name: 'Invasive Breast Carcinoma',
    parent: 'breast',
    ownStudies: 30,
    subtreeStudies: 36,
    children: [
        {
            id: 'idc',
            name: 'Breast Invasive Ductal Carcinoma',
            subtreeStudies: 6,
        },
    ],
};

const STUDIES = [
    {
        studyId: 'brca_tcga_pan_can_atlas_2018',
        name: 'Breast Invasive Carcinoma (TCGA, PanCancer Atlas)',
        cancerTypeId: 'brca',
        sampleCount: 1084,
    },
    {
        studyId: 'brca_tcga',
        name: 'Breast Invasive Carcinoma (TCGA, Firehose Legacy)',
        cancerTypeId: 'brca',
        sampleCount: 1108,
    },
    {
        studyId: 'brca_metabric',
        name: 'Breast Cancer (METABRIC)',
        cancerTypeId: 'brca',
        sampleCount: 2509,
    },
];

function catalog(overrides: Partial<CatalogMatches> = {}): CatalogMatches {
    return {
        cancerTypes: [LUNG, BREAST, BRCA],
        studies: STUDIES,
        selectedStudies: [],
        selectedStudyCancerTypes: [],
        clinicalAttributes: [],
        molecularProfiles: [],
        ...overrides,
    };
}

function slot(
    status: 'specified' | 'ambiguous' | 'missing',
    value: string | null = null,
    matched_ids: string[] = [],
    options: string[] = []
) {
    return { status, value, options, matched_ids };
}

function raw(overrides: Partial<RawClassification> = {}): RawClassification {
    return {
        request_type: 'data',
        oos_subtype: null,
        goal: 'describe',
        slots: {
            cohort: slot('missing'),
            study: slot('missing'),
            entity: slot('missing'),
            measure: slot('missing'),
            groups: slot('missing'),
            filter: slot('missing'),
        },
        needs_groups: false,
        study_is_collection: false,
        uses_open_page: false,
        multi_part: false,
        parts: [],
        part_answerability: [],
        answerability: 'ui',
        move: null,
        drafts: {
            broad_aim: 'aim',
            working_question: 'question',
            concrete_analysis: 'analysis',
        },
        question_suggestions: ['Is A linked to B?', 'Does C differ by D?'],
        rationale: 'because',
        ...overrides,
    };
}

function ctx(overrides: Partial<GuidanceContext> = {}): GuidanceContext {
    return { catalog: catalog(), fixedSlots: {}, history: [], ...overrides };
}

test('separateCohorts: tissue nodes split, a type with studies does not', () => {
    assert.deepEqual(separateCohorts(LUNG), [
        'Non-Small Cell Lung Cancer',
        'Small Cell Lung Cancer',
    ]);
    assert.deepEqual(separateCohorts(BREAST), [
        'Invasive Breast Carcinoma',
        'Metaplastic Breast Cancer',
    ]);
    assert.deepEqual(separateCohorts(BRCA), []);
});

test('"lung cancer" is ambiguous with portal subtypes as options', () => {
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('specified', 'lung cancer', ['lung']),
                entity: slot('specified', 'KRAS'),
                measure: slot('specified', 'mutation frequency'),
            },
        }),
        ctx(),
        'How often is KRAS mutated in lung cancer?'
    );
    assert.equal(c.slots.cohort.status, 'ambiguous');
    assert.deepEqual(c.slots.cohort.options, [
        'Non-Small Cell Lung Cancer',
        'Small Cell Lung Cancer',
    ]);
    assert.equal(c.level, 'L2');
    assert.equal(c.guidance_degree, 'directing');
});

test('"breast cancer" is specified even if the model says ambiguous', () => {
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('ambiguous', 'breast cancer', ['brca'], ['x']),
                entity: slot('specified', 'TP53'),
                measure: slot('specified', 'mutation frequency'),
            },
        }),
        ctx(),
        'TP53 mutation frequency in breast cancer'
    );
    assert.equal(c.slots.cohort.status, 'specified');
    // No study named: L3, with the largest breast studies as suggestions.
    assert.equal(c.level, 'L3');
    assert.equal(c.slots.study.status, 'missing');
    assert.match(c.slots.study.options[0], /METABRIC/);
});

test('two named studies are ambiguous; one is specified (L4)', () => {
    const base = {
        ...raw().slots,
        cohort: slot('specified', 'breast cancer', ['brca']),
        entity: slot('specified', 'TP53'),
        measure: slot('specified', 'mutation frequency'),
    };
    const two = resolveClassification(
        raw({
            slots: {
                ...base,
                study: slot('ambiguous', 'TCGA breast', [
                    'brca_tcga_pan_can_atlas_2018',
                    'brca_tcga',
                ]),
            },
        }),
        ctx(),
        'TP53 in TCGA breast'
    );
    assert.equal(two.slots.study.status, 'ambiguous');
    assert.equal(two.slots.study.options.length, 2);
    assert.equal(two.level, 'L3');

    const one = resolveClassification(
        raw({
            slots: {
                ...base,
                study: slot('specified', 'METABRIC', ['brca_metabric']),
            },
        }),
        ctx(),
        'TP53 in METABRIC'
    );
    assert.equal(one.slots.study.status, 'specified');
    assert.equal(one.level, 'L4');
    assert.equal(one.guidance_degree, 'light_prescribing_checking');
});

test('an open study fills cohort as whole study and the study slot', () => {
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                entity: slot('specified', 'TP53'),
                measure: slot('specified', 'mutation frequency'),
            },
        }),
        ctx({ catalog: catalog({ selectedStudies: [STUDIES[2]] }) }),
        'How often is TP53 mutated?'
    );
    assert.equal(c.slots.cohort.value, 'whole study');
    assert.equal(c.slots.cohort.source, 'page');
    assert.equal(c.slots.study.status, 'specified');
    assert.equal(c.slots.study.source, 'page');
    assert.equal(c.level, 'L4');
});

test('a chosen study without a cancer type is its whole cohort', () => {
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('missing', null),
                study: slot('specified', 'METABRIC', ['brca_metabric']),
                entity: slot('specified', 'TP53'),
                measure: slot('specified', 'overall survival'),
            },
        }),
        ctx(),
        'm'
    );
    assert.equal(c.slots.cohort.status, 'specified');
    assert.equal(c.slots.cohort.value, 'whole study');
});

test('groups are core only when needed per group', () => {
    const slots = {
        ...raw().slots,
        cohort: slot('specified', 'breast cancer', ['brca']),
        study: slot('specified', 'METABRIC', ['brca_metabric']),
        entity: slot('specified', 'TP53'),
        measure: slot('specified', 'overall survival'),
        groups: slot('ambiguous', 'high expression'),
    };
    const without = resolveClassification(
        raw({ slots, needs_groups: false }),
        ctx(),
        'm'
    );
    assert.equal(without.level, 'L4');
    const withGroups = resolveClassification(
        raw({ slots, needs_groups: true, goal: 'explain' }),
        ctx(),
        'm'
    );
    assert.deepEqual(withGroups.core_slots, [
        'cohort',
        'entity',
        'measure',
        'groups',
    ]);
    assert.equal(withGroups.level, 'L2');
});

test('explore is L1 whatever the slots', () => {
    const c = resolveClassification(raw({ goal: 'explore' }), ctx(), 'm');
    assert.equal(c.level, 'L1');
    assert.equal(c.guidance_degree, 'orienting');
});

test('non-data types get no level and their own degree', () => {
    const interfaceC = resolveClassification(
        raw({ request_type: 'interface', goal: null }),
        ctx(),
        'where is the download button?'
    );
    assert.equal(interfaceC.level, null);
    assert.equal(interfaceC.guidance_degree, 'prescribing');
    const oos = resolveClassification(
        raw({
            request_type: 'out_of_scope',
            oos_subtype: 'software',
            goal: 'describe',
        }),
        ctx(),
        'how do I install cBioPortal?'
    );
    assert.equal(oos.goal, null);
    assert.equal(oos.oos_subtype, 'software');
    assert.equal(oos.guidance_degree, 'none');
    for (const n of SLOT_NAMES) assert.equal(oos.slots[n].status, 'missing');
});

test('a user-fixed slot holds unless the message names another value', () => {
    const fixed: GuidanceContext['fixedSlots'] = {
        entity: { status: 'specified', value: 'EGFR', source: 'user' },
    };
    const kept = resolveClassification(raw(), ctx({ fixedSlots: fixed }), 'm');
    assert.equal(kept.slots.entity.value, 'EGFR');
    assert.equal(kept.slots.entity.source, 'user');
    const replaced = resolveClassification(
        raw({
            slots: { ...raw().slots, entity: slot('specified', 'KRAS') },
        }),
        ctx({ fixedSlots: fixed }),
        'm'
    );
    assert.equal(replaced.slots.entity.value, 'KRAS');
    assert.equal(replaced.slots.entity.source, 'chat');
});

test('a user-fixed slot holds when the message names it differently written', () => {
    const fixed: GuidanceContext['fixedSlots'] = {
        entity: { status: 'specified', value: 'egfr', source: 'user' },
    };
    const kept = resolveClassification(
        raw({ slots: { ...raw().slots, entity: slot('specified', 'EGFR') } }),
        ctx({ fixedSlots: fixed }),
        'm'
    );
    assert.equal(kept.slots.entity.source, 'user');
    assert.equal(kept.slots.entity.value, 'egfr');
});

test('slot values compare without case or a study’s [id]', () => {
    assert.ok(
        sameSlotValue(
            'Ovarian Serous Cystadenocarcinoma (TCGA, PanCancer Atlas) [ov_tcga_pan_can_atlas_2018]',
            'ovarian serous cystadenocarcinoma (TCGA, PanCancer Atlas)'
        )
    );
    assert.ok(!sameSlotValue('KRAS', 'EGFR'));
});

test('a new topic drops what the user fixed and what the page shows', () => {
    const previous = resolveClassification(raw(), ctx(), 'earlier');
    const c = resolveClassification(
        raw({ move: 'new' }),
        ctx({
            previous,
            userAim: 'Old aim',
            catalog: catalog({ selectedStudies: [STUDIES[2]] }),
            fixedSlots: {
                entity: { status: 'specified', value: 'EGFR', source: 'user' },
                filter: {
                    status: 'specified',
                    value: 'Sex: Female',
                    source: 'page',
                },
            },
        }),
        'Something else entirely'
    );
    assert.equal(c.move, 'new');
    assert.equal(c.slots.entity.status, 'missing');
    assert.equal(c.slots.filter.status, 'missing');
    assert.equal(c.open_study_applies, false);
    assert.equal(c.drafts.broad_aim, 'aim');
});

test('user-written aim and question are kept; move needs a previous turn', () => {
    const c = resolveClassification(
        raw({ move: 'refine' }),
        ctx({ userAim: 'My aim', userQuestion: 'My question?' }),
        'm'
    );
    assert.equal(c.drafts.broad_aim, 'My aim');
    assert.equal(c.drafts.working_question, 'My question?');
    assert.equal(c.move, null);
});

test('a refinement rewrites a user-written question; the same ask keeps it', () => {
    const previous = resolveClassification(raw(), ctx(), 'earlier');
    const fixed = { previous, userAim: 'My aim', userQuestion: 'Top 10?' };
    const refined = resolveClassification(
        raw({ move: 'refine' }),
        ctx(fixed),
        'now top 5'
    );
    assert.equal(
        refined.drafts.working_question,
        raw().drafts.working_question
    );
    assert.equal(refined.drafts.broad_aim, 'My aim');
    const same = resolveClassification(raw({ move: 'same' }), ctx(fixed), 'm');
    assert.equal(same.drafts.working_question, 'Top 10?');
});

test('computeLevel follows the codebook order', () => {
    const all = (status: 'specified' | 'missing'): Slots => {
        const slots = {} as Slots;
        for (const n of SLOT_NAMES) {
            slots[n] = { status, value: null, options: [], source: 'chat' };
        }
        return slots;
    };
    const core = ['cohort', 'entity', 'measure'] as const;
    assert.equal(
        computeLevel('data', 'describe', all('specified'), [...core]).level,
        'L4'
    );
    const noStudy = all('specified');
    noStudy.study = { ...noStudy.study, status: 'missing' };
    assert.equal(
        computeLevel('data', 'describe', noStudy, [...core]).level,
        'L3'
    );
    assert.equal(
        computeLevel('data', 'describe', all('missing'), [...core]).level,
        'L2'
    );
});

test('guidance sections exist for every name the picker can ask for', () => {
    const sections = parseSections(
        readFileSync(new URL('./guidancePrompt.md', import.meta.url), 'utf-8')
    );
    for (const name of [
        'intro',
        'L1',
        'L2',
        'L3',
        'L4',
        'route-describe',
        'route-explain',
        'route-confirm',
        'no-ui-path',
        'interface',
        'catalog',
        'out_of_scope',
        'multi_part',
    ]) {
        assert.ok(sections.get(name), `section ${name}`);
    }
    const c = resolveClassification(
        raw({ answerability: 'custom', multi_part: true }),
        ctx(),
        'm'
    );
    assert.deepEqual(sectionNamesFor(c), [
        'intro',
        'L2',
        'no-ui-path',
        'multi_part',
    ]);
    const block = guidanceBlock(sections, c);
    assert.match(block, /L2 With gaps/);
    assert.match(block, /"level": "L2"/);
    assert.doesNotMatch(block, /rationale/);
});

test('the classify prompt is tagged with codebook version 5', () => {
    for (const file of ['./classifyPrompt.md', './guidancePrompt.md']) {
        const text = readFileSync(new URL(file, import.meta.url), 'utf-8');
        assert.match(text, /codebook_version: 5/);
    }
});

test('findLatestClassification reads the newest data part', () => {
    const c = resolveClassification(raw(), ctx(), 'first');
    const later = resolveClassification(raw(), ctx(), 'second');
    const found = findLatestClassification([
        { role: 'user', parts: [{ type: 'text', text: 'first' }] },
        {
            role: 'assistant',
            parts: [{ type: 'data-classification', data: c }],
        },
        { role: 'user', parts: [{ type: 'text', text: 'second' }] },
        {
            role: 'assistant',
            parts: [
                { type: 'data-classification', data: later },
                { type: 'text', text: 'reply' },
            ],
        },
    ]);
    assert.equal(found?.message, 'second');
});

test('log CSV flattens classifications and client events', () => {
    const c = resolveClassification(raw(), ctx(), 'How, "quoted"?');
    const lines = [
        JSON.stringify({
            at: '2026-11-03T10:00:00Z',
            codebook_version: 5,
            event: 'classification',
            session_id: 's1',
            participant: 'P01',
            thread_id: 't1',
            payload: { classification: c, model: 'm', latency_ms: 812 },
        }),
        'not json',
        JSON.stringify({
            at: '2026-11-03T10:01:00Z',
            codebook_version: 5,
            event: 'slot_edit',
            session_id: 's1',
            participant: 'P01',
            thread_id: 't1',
            payload: {
                slot: 'cohort',
                old_value: null,
                new_value: 'Lung Adenocarcinoma',
                via: 'option',
            },
        }),
    ].join('\n');
    const csv = logToCsv(lines)
        .trim()
        .split('\n');
    assert.equal(csv.length, 3);
    assert.equal(csv[0], CSV_COLUMNS.join(','));
    assert.match(csv[1], /"How, ""quoted""\?"/);
    assert.match(csv[1], /,L2,directing,/);
    assert.match(csv[2], /slot_edit/);
    assert.match(csv[2], /Lung Adenocarcinoma/);
    assert.match(csv[2], /""via"":""option""/);
});

test('parseClientEvent accepts known events only', () => {
    assert.equal(parseClientEvent({ event: 'classification' }), null);
    assert.equal(parseClientEvent({ event: 'nope' }), null);
    const ok = parseClientEvent({
        event: 'restore',
        sessionId: 's',
        threadId: 't',
        payload: { question: 'q' },
    });
    assert.equal(ok?.event, 'restore');
    assert.equal(ok?.thread_id, 't');
});

test('a question about another cohort ignores the open study and its filters', () => {
    const gbm = {
        id: 'gbm',
        name: 'Glioblastoma',
        parent: 'difg',
        ownStudies: 12,
        subtreeStudies: 12,
        children: [],
    };
    const mskChord = {
        studyId: 'msk_chord_2024',
        name: 'MSK-CHORD (MSK, Nature 2024)',
        cancerTypeId: 'mixed',
        sampleCount: 25040,
    };
    const gbmTcga = {
        studyId: 'gbm_tcga_pan_can_atlas_2018',
        name: 'Glioblastoma Multiforme (TCGA, PanCancer Atlas)',
        cancerTypeId: 'gbm',
        sampleCount: 592,
    };
    const c = resolveClassification(
        raw({
            move: 'new',
            slots: {
                ...raw().slots,
                cohort: slot('specified', 'Glioblastoma', ['gbm']),
                entity: slot('specified', 'CDKN2A, CDK4, RB1'),
                measure: slot('specified', 'alteration frequency'),
            },
        }),
        ctx({
            previous: resolveClassification(raw(), ctx(), 'earlier'),
            catalog: catalog({
                cancerTypes: [gbm],
                studies: [gbmTcga, mskChord],
                selectedStudies: [mskChord],
                selectedStudyCancerTypes: [
                    { name: 'Colorectal Cancer', count: 5000 },
                    { name: 'Non-Small Cell Lung Cancer', count: 7000 },
                ],
            }),
            fixedSlots: {
                study: {
                    status: 'specified',
                    value: 'MSK-CHORD (MSK, Nature 2024)',
                    source: 'page',
                },
                filter: {
                    status: 'specified',
                    value: 'Mutation Count: 200–250',
                    source: 'page',
                },
            },
        }),
        'What percentage of glioblastoma patients have alterations in RB pathway genes (CDKN2A, CDK4, RB1)?'
    );
    assert.equal(c.open_study_applies, false);
    assert.equal(c.slots.study.status, 'missing');
    assert.match(c.slots.study.options[0], /Glioblastoma Multiforme/);
    assert.equal(c.slots.filter.status, 'missing');
    assert.equal(c.level, 'L3');
});

test('the open study applies when it covers the cohort named', () => {
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('specified', 'breast cancer', ['brca']),
                entity: slot('specified', 'TP53'),
                measure: slot('specified', 'mutation frequency'),
            },
        }),
        ctx({
            catalog: catalog({ selectedStudies: [STUDIES[2]] }),
            fixedSlots: {
                filter: {
                    status: 'specified',
                    value: 'Sex: Female',
                    source: 'page',
                },
            },
        }),
        'TP53 mutation frequency in breast cancer'
    );
    assert.equal(c.open_study_applies, true);
    assert.equal(c.slots.study.source, 'page');
    assert.equal(c.slots.filter.value, 'Sex: Female');
    assert.equal(c.level, 'L4');
});

test('an ambiguous slot without a single value beats the page value', () => {
    const c = resolveClassification(
        raw({
            goal: 'explore',
            slots: {
                ...raw().slots,
                entity: slot(
                    'ambiguous',
                    null,
                    [],
                    ['IDH1 R132H', 'any IDH1 mutation']
                ),
            },
        }),
        ctx({
            fixedSlots: {
                entity: { status: 'specified', value: 'KRAS', source: 'user' },
            },
        }),
        'm'
    );
    assert.equal(c.slots.entity.status, 'ambiguous');
});

test('a new question ignores the open page even when it covers the cohort', () => {
    const previous = resolveClassification(raw(), ctx(), 'earlier');
    const slots = {
        ...raw().slots,
        cohort: slot('specified', 'breast cancer', ['brca']),
        entity: slot('specified', 'TP53'),
        measure: slot('specified', 'mutation frequency'),
    };
    const pageCtx = ctx({
        previous,
        catalog: catalog({ selectedStudies: [STUDIES[2]] }),
        fixedSlots: {
            filter: {
                status: 'specified',
                value: 'Mutation Count: 200–250',
                source: 'page',
            },
        },
    });
    const fresh = resolveClassification(
        raw({ move: 'new', slots }),
        pageCtx,
        'm'
    );
    assert.equal(fresh.open_study_applies, false);
    assert.equal(fresh.slots.filter.status, 'missing');
    assert.equal(fresh.slots.study.status, 'missing');
    assert.equal(fresh.level, 'L3');

    const refers = resolveClassification(
        raw({ move: 'new', uses_open_page: true, slots }),
        pageCtx,
        'TP53 in this study'
    );
    assert.equal(refers.open_study_applies, true);
    assert.equal(refers.slots.filter.value, 'Mutation Count: 200–250');

    const refine = resolveClassification(
        raw({ move: 'refine', slots }),
        pageCtx,
        'm'
    );
    assert.equal(refine.open_study_applies, true);
});

test('log CSV puts a page step in the move column', () => {
    const line = JSON.stringify({
        at: '2026-11-05T10:00:00Z',
        codebook_version: 5,
        event: 'page_action',
        session_id: 's',
        participant: '',
        thread_id: 't',
        payload: {
            move: 'refine',
            question: 'Narrowed on the page: Sex: Female',
        },
    });
    const [header, row] = logToCsv(line)
        .trim()
        .split('\n');
    const moveIndex = header.split(',').indexOf('move');
    assert.equal(row.split(',')[moveIndex], 'refine');
});

test('an exploring question keeps only the broad aim', () => {
    const c = resolveClassification(
        raw({ goal: 'explore' }),
        ctx(),
        'Tell me about IDH1 in LGG'
    );
    assert.equal(c.level, 'L1');
    assert.equal(c.drafts.broad_aim, 'aim');
    assert.equal(c.drafts.working_question, '');
    assert.equal(c.drafts.concrete_analysis, '');
});

test('parts count only for a multi-part message with two or more', () => {
    const multi = resolveClassification(
        raw({
            multi_part: true,
            parts: ['Sex', 'Age', 'age', ' ', 'All', 'Race'],
        }),
        ctx(),
        'm'
    );
    assert.deepEqual(multi.parts, ['Sex', 'Age', 'Race']);
    const single = resolveClassification(
        raw({ multi_part: false, parts: ['Sex'] }),
        ctx(),
        'm'
    );
    assert.deepEqual(single.parts, []);
    const one = resolveClassification(
        raw({ multi_part: true, parts: ['Sex'] }),
        ctx(),
        'm'
    );
    assert.deepEqual(one.parts, []);
});

test('marks: the reply marks where the portal will be', async () => {
    const { markPage, markTargetsFor } = await import('./marks.js');
    const l3 = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('specified', 'breast cancer', ['brca']),
                entity: slot('specified', 'TP53'),
                measure: slot('specified', 'mutation frequency'),
            },
        }),
        ctx(),
        'TP53 in breast cancer'
    );
    assert.equal(l3.level, 'L3');
    assert.equal(markPage(l3, 'study'), 'home');
    const home = markTargetsFor(
        l3,
        ctx({ pageType: 'study', pageTargets: [] })
    );
    // The classification's study options come first, then the home controls.
    assert.equal(home.targets[0].targetType, 'study');
    assert.match(home.targets[0].label, /METABRIC/);
    assert.ok(home.targets.some(t => t.targetId === 'study-search'));

    const l4 = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('specified', 'breast cancer', ['brca']),
                study: slot('specified', 'METABRIC', ['brca_metabric']),
                entity: slot('specified', 'TP53'),
                measure: slot('specified', 'mutation frequency'),
            },
        }),
        ctx(),
        'm'
    );
    const pageTargets = [
        {
            targetType: 'visualization',
            targetId: 'chart1',
            label: 'Mutated Genes',
        },
    ];
    const current = markTargetsFor(l4, ctx({ pageType: 'study', pageTargets }));
    assert.equal(current.page, 'current');
    assert.deepEqual(current.targets, pageTargets);
});

test('guidance block: marks rules per level, none out of scope', () => {
    const sections = parseSections(
        readFileSync(new URL('./guidancePrompt.md', import.meta.url), 'utf-8')
    );
    for (const name of [
        'marks',
        'marks-L1',
        'marks-L2',
        'marks-L3',
        'marks-L4',
        'marks-interface',
        'marks-catalog',
    ]) {
        assert.ok(sections.get(name), `section ${name}`);
    }
    const explore = resolveClassification(raw({ goal: 'explore' }), ctx(), 'm');
    const block = guidanceBlock(sections, explore, ctx({ pageType: 'study' }));
    assert.match(block, /Marking the portal/);
    assert.match(block, /a result mark on every study you list/);
    assert.match(block, /Elements you can mark/);
    const oos = resolveClassification(
        raw({ request_type: 'out_of_scope', oos_subtype: 'knowledge' }),
        ctx(),
        'm'
    );
    assert.doesNotMatch(
        guidanceBlock(sections, oos, ctx()),
        /Marking the portal/
    );
    // Without a context (unguided path), no marks.
    assert.doesNotMatch(guidanceBlock(sections, explore), /Marking the portal/);
});

test('a multi-part message is answerable when any part is', () => {
    const c = resolveClassification(
        raw({
            multi_part: true,
            parts: ['Sex', 'Age', 'Race'],
            part_answerability: ['ui', 'ui', 'custom'],
            answerability: 'custom',
        }),
        ctx(),
        'm'
    );
    assert.deepEqual(c.parts, ['Sex', 'Age', 'Race']);
    assert.deepEqual(c.part_answerability, ['ui', 'ui', 'custom']);
    assert.equal(c.answerability, 'ui');
    const none = resolveClassification(
        raw({
            multi_part: true,
            parts: ['A', 'B'],
            part_answerability: ['custom', 'unavailable'],
            answerability: 'ui',
        }),
        ctx(),
        'm'
    );
    assert.equal(none.answerability, 'custom');
    // A missing per-part value takes the overall one; dropped parts keep
    // their answerability aligned.
    const short = resolveClassification(
        raw({
            multi_part: true,
            parts: ['Sex', 'sex', 'Age'],
            part_answerability: ['unavailable', 'ui'],
            answerability: 'ui',
        }),
        ctx(),
        'm'
    );
    assert.deepEqual(short.parts, ['Sex', 'Age']);
    assert.deepEqual(short.part_answerability, ['unavailable', 'ui']);
});

test('a page update takes its move from the page and keeps the open study', () => {
    const previous = resolveClassification(raw(), ctx(), 'earlier');
    const c = resolveClassification(
        raw({
            move: 'new',
            slots: {
                ...raw().slots,
                cohort: slot('specified', 'lung adenocarcinoma', ['luad']),
                entity: slot('specified', 'KRAS'),
                measure: slot('specified', 'mutation frequency'),
            },
        }),
        ctx({
            previous,
            pageAction: { move: 'refine', filters: 'Sex: Female' },
            catalog: catalog({ selectedStudies: [STUDIES[2]] }),
            fixedSlots: {
                filter: {
                    status: 'specified',
                    value: 'Sex: Female',
                    source: 'page',
                },
            },
        }),
        'On the page, I narrowed the cohort to Sex: Female. What does this change for my question?'
    );
    assert.equal(c.from_page, true);
    assert.equal(c.move, 'refine');
    assert.equal(c.open_study_applies, true);
    assert.equal(c.slots.filter.value, 'Sex: Female');
    const sections = parseSections(
        readFileSync(new URL('./guidancePrompt.md', import.meta.url), 'utf-8')
    );
    assert.match(
        guidanceBlock(sections, c, ctx()),
        /The user changed the page/
    );
    const typed = resolveClassification(raw(), ctx(), 'm');
    assert.equal(typed.from_page, false);
});

test('a step on the page continues the question and gets its own section', () => {
    const previous = resolveClassification(raw(), ctx(), 'earlier');
    const c = resolveClassification(
        raw({ move: 'new' }),
        ctx({
            previous,
            pageAction: {
                navigation:
                    'clicked "Query By Gene" for Lung Adenocarcinoma (TCGA, PanCancer Atlas)',
            },
        }),
        'On the page, I clicked "Query By Gene". What does this mean for my question, and what should I do here?'
    );
    assert.equal(c.from_page, true);
    assert.equal(c.page_navigation, true);
    assert.equal(c.move, 'same');
    const sections = parseSections(
        readFileSync(new URL('./guidancePrompt.md', import.meta.url), 'utf-8')
    );
    const block = guidanceBlock(sections, c, ctx());
    assert.match(block, /The user took a step on the page/);
    assert.doesNotMatch(block, /The user changed the page/);
});

test('question suggestions only for an exploring question', () => {
    const explore = resolveClassification(raw({ goal: 'explore' }), ctx(), 'm');
    assert.deepEqual(explore.question_suggestions, [
        'Is A linked to B?',
        'Does C differ by D?',
    ]);
    const describe = resolveClassification(
        raw({ goal: 'describe' }),
        ctx(),
        'm'
    );
    assert.deepEqual(describe.question_suggestions, []);
});

test('a broad type offers its subtypes with studies, at any depth', () => {
    const lung = {
        ...LUNG,
        subtypes: [
            { id: 'luad', name: 'Lung Adenocarcinoma', ownStudies: 14 },
            { id: 'nsclc', name: 'Non-Small Cell Lung Cancer', ownStudies: 9 },
            { id: 'lusc', name: 'Lung Squamous Cell Carcinoma', ownStudies: 6 },
            { id: 'sclc', name: 'Small Cell Lung Cancer', ownStudies: 4 },
        ],
    };
    assert.deepEqual(separateCohorts(lung), [
        'Lung Adenocarcinoma',
        'Non-Small Cell Lung Cancer',
        'Lung Squamous Cell Carcinoma',
        'Small Cell Lung Cancer',
    ]);
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('ambiguous', 'lung cancer', ['lung']),
                entity: slot('specified', 'all genes'),
                measure: slot('specified', 'top 5'),
            },
        }),
        ctx({ catalog: catalog({ cancerTypes: [lung, BREAST, BRCA] }) }),
        'top 5 mutated genes in lung cancer'
    );
    assert.equal(c.slots.cohort.status, 'ambiguous');
    assert.equal(c.slots.cohort.options[0], 'Lung Adenocarcinoma');
});

test('a matched type inside another matched type is dropped', () => {
    const lung = {
        ...LUNG,
        subtypes: [
            { id: 'luad', name: 'Lung Adenocarcinoma', ownStudies: 14 },
            { id: 'sclc', name: 'Small Cell Lung Cancer', ownStudies: 4 },
        ],
    };
    // SCLC's parent (lung neuroendocrine) isn't among the matches; it is
    // still below "lung".
    const sclc = {
        id: 'sclc',
        name: 'Small Cell Lung Cancer',
        parent: 'lnet',
        ownStudies: 4,
        subtreeStudies: 4,
        children: [],
    };
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('ambiguous', 'lung cancer', ['lung', 'sclc']),
                entity: slot('specified', 'all genes'),
                measure: slot('specified', 'top 5'),
            },
        }),
        ctx({ catalog: catalog({ cancerTypes: [lung, sclc] }) }),
        'top 5 mutated genes in lung cancer'
    );
    assert.deepEqual(c.slots.cohort.options, [
        'Lung Adenocarcinoma',
        'Small Cell Lung Cancer',
    ]);
});

test('a type with a few studies of its own but most in subtypes is ambiguous', () => {
    const lung = {
        ...LUNG,
        ownStudies: 2,
        subtreeStudies: 42,
        subtypes: [
            { id: 'luad', name: 'Lung Adenocarcinoma', ownStudies: 20 },
            { id: 'lusc', name: 'Lung Squamous Cell Carcinoma', ownStudies: 8 },
            { id: 'lung', name: 'Lung', ownStudies: 2 },
        ].filter(t => t.id !== 'lung'),
    };
    assert.deepEqual(separateCohorts(lung), [
        'Lung Adenocarcinoma',
        'Lung Squamous Cell Carcinoma',
    ]);
    // Most of the studies are of the type itself: one cohort.
    assert.deepEqual(
        separateCohorts({
            ...BRCA,
            subtypes: [
                {
                    id: 'idc',
                    name: 'Breast Invasive Ductal Carcinoma',
                    ownStudies: 4,
                },
                {
                    id: 'ilc',
                    name: 'Breast Invasive Lobular Carcinoma',
                    ownStudies: 2,
                },
            ],
        }),
        []
    );
});

test('once the cohort is settled, only its studies count', () => {
    const luad = {
        id: 'luad',
        name: 'Lung Adenocarcinoma',
        parent: 'nsclc',
        ownStudies: 20,
        subtreeStudies: 20,
        children: [],
    };
    const studies = [
        {
            studyId: 'luad_tcga_pan_can_atlas_2018',
            name: 'Lung Adenocarcinoma (TCGA, PanCancer Atlas)',
            cancerTypeId: 'luad',
            sampleCount: 566,
        },
        {
            studyId: 'lusc_tcga_pan_can_atlas_2018',
            name: 'Lung Squamous Cell Carcinoma (TCGA, PanCancer Atlas)',
            cancerTypeId: 'lusc',
            sampleCount: 487,
        },
    ];
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                // The user set the cohort in the box: the message doesn't
                // name it, so the classifier matched no cancer type.
                cohort: slot('missing'),
                study: slot('ambiguous', 'TCGA PanCancer Atlas', [
                    'luad_tcga_pan_can_atlas_2018',
                    'lusc_tcga_pan_can_atlas_2018',
                ]),
                entity: slot('specified', 'all genes'),
                measure: slot('specified', 'top 5'),
            },
        }),
        ctx({
            catalog: catalog({ cancerTypes: [luad], studies }),
            fixedSlots: {
                cohort: {
                    status: 'specified',
                    value: 'Lung Adenocarcinoma',
                    source: 'user',
                },
            },
        }),
        'In the research question box, I set the cohort to Lung Adenocarcinoma.'
    );
    assert.equal(c.slots.study.status, 'specified');
    assert.equal(
        c.slots.study.value,
        'Lung Adenocarcinoma (TCGA, PanCancer Atlas)'
    );
    assert.equal(c.level, 'L4');
});

test('several matches offer the subtypes of those that span several cohorts', () => {
    const nsclc = {
        id: 'nsclc',
        name: 'Non-Small Cell Lung Cancer',
        parent: 'lung',
        ownStudies: 3,
        subtreeStudies: 30,
        children: [],
        subtypes: [
            { id: 'luad', name: 'Lung Adenocarcinoma', ownStudies: 20 },
            { id: 'lusc', name: 'Lung Squamous Cell Carcinoma', ownStudies: 7 },
        ],
    };
    const sclc = {
        id: 'sclc',
        name: 'Small Cell Lung Cancer',
        parent: 'lnet',
        ownStudies: 4,
        subtreeStudies: 4,
        children: [],
    };
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot('ambiguous', 'lung cancer', ['nsclc', 'sclc']),
                entity: slot('specified', 'all genes'),
                measure: slot('specified', 'top 5'),
            },
        }),
        ctx({ catalog: catalog({ cancerTypes: [nsclc, sclc] }) }),
        'top 5 mutated genes in lung cancer'
    );
    assert.deepEqual(c.slots.cohort.options, [
        'Lung Adenocarcinoma',
        'Lung Squamous Cell Carcinoma',
        'Small Cell Lung Cancer',
    ]);
});

test('a cancer type named exactly within a named study is specified', () => {
    const nsclc = {
        id: 'nsclc',
        name: 'Non-Small Cell Lung Cancer',
        parent: 'lung',
        ownStudies: 3,
        subtreeStudies: 30,
        children: [],
        subtypes: [
            { id: 'luad', name: 'Lung Adenocarcinoma', ownStudies: 20 },
            { id: 'lusc', name: 'Lung Squamous Cell Carcinoma', ownStudies: 7 },
        ],
    };
    const slots = (study: ReturnType<typeof slot>) => ({
        ...raw().slots,
        cohort: slot('ambiguous', 'Non-Small Cell Lung Cancer', ['nsclc']),
        study,
        entity: slot('specified', 'KRAS, STK11'),
        measure: slot('specified', 'co-occurrence'),
    });
    const withStudy = resolveClassification(
        raw({
            slots: slots(slot('specified', 'MSK-CHORD (MSK, Nature 2024)')),
        }),
        ctx({ catalog: catalog({ cancerTypes: [nsclc] }) }),
        'In MSK-CHORD non-small cell lung cancer, do KRAS and STK11 co-occur?'
    );
    assert.equal(withStudy.slots.cohort.status, 'specified');
    assert.equal(withStudy.slots.cohort.value, 'Non-Small Cell Lung Cancer');
    // Without a study, the subtypes are still offered.
    const withoutStudy = resolveClassification(
        raw({ slots: slots(slot('missing', null)) }),
        ctx({ catalog: catalog({ cancerTypes: [nsclc] }) }),
        'do KRAS and STK11 co-occur in non-small cell lung cancer?'
    );
    assert.equal(withoutStudy.slots.cohort.status, 'ambiguous');
});

test('an ambiguous slot with one option is that option', () => {
    const luad = {
        id: 'luad',
        name: 'Lung Adenocarcinoma',
        parent: 'nsclc',
        ownStudies: 20,
        subtreeStudies: 20,
        children: [],
    };
    // The classifier corrected a typo, matched no id, and called the slot
    // ambiguous with the one option.
    const c = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                cohort: slot(
                    'ambiguous',
                    'lung adenocarcinoma',
                    [],
                    ['Lung Adenocarcinoma']
                ),
                entity: slot('specified', 'all genes'),
                measure: slot('specified', 'top 5'),
            },
        }),
        ctx({ catalog: catalog({ cancerTypes: [luad] }) }),
        'what about adecarcinoma?'
    );
    assert.equal(c.slots.cohort.status, 'specified');
    assert.equal(c.slots.cohort.value, 'Lung Adenocarcinoma');
    // A study with one option too.
    const s = resolveClassification(
        raw({
            slots: {
                ...raw().slots,
                study: slot(
                    'ambiguous',
                    'TCGA',
                    [],
                    [
                        'Lung Adenocarcinoma (TCGA, PanCancer Atlas) [luad_tcga_pan_can_atlas_2018]',
                    ]
                ),
            },
        }),
        ctx(),
        'm'
    );
    assert.equal(s.slots.study.status, 'specified');
});
