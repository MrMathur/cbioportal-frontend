// The data tools against cBioPortal's live API, checked with the reference
// answers of the cBioPortal MCP benchmark
// (https://cbioportal.github.io/cbioportal-mcp-qa/results/test-sets.html);
// "#n" is the benchmark's question number. Needs the network: run with
// `npm run test:live`. Reference answers were checked in late 2026, so a
// data release may shift a count slightly; tolerances allow for that where
// the benchmark does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clinicalValues,
    cohortOverview,
    compareGroups,
    compareSurvival,
    findStudies,
    geneCooccurrence,
    geneFrequency,
    geneMutations,
    molecularValues,
} from './tools.js';

const T = { timeout: 180_000 };

function near(actual: unknown, expected: number, tol: number, what = '') {
    assert.ok(
        typeof actual === 'number' && Math.abs(actual - expected) <= tol,
        `${what}: ${actual} not within ${tol} of ${expected}`
    );
}

type Row = {
    group?: string;
    altered: number;
    profiled: number;
    percent: number | null;
};
const group = (groups: unknown, name: string) => {
    const g = (groups as Row[]).find(x => x.group === name);
    assert.ok(g, `no group ${name}`);
    return g!;
};

// --- Tool 1: find_studies ---

test('#1 number of studies; #15 studies with mutation data', T, async () => {
    const all = await findStudies({});
    near(all.totalStudiesInPortal, 551, 15, 'studies');
    const mut = await findStudies({ requiresData: ['mutations'] });
    near(mut.matchingStudies, 542, 15, 'with mutations');
});

test('#1008 TARGET studies, without look-alikes', T, async () => {
    const r = await findStudies({ query: 'target', limit: 50 });
    const ids = r.studies.map(s => s.studyId);
    for (const id of [
        'alal_target_gdc',
        'aml_target_gdc',
        'nbl_target_gdc',
        'os_target_gdc',
        'wt_target_gdc',
        'nbl_target_2018_pub',
        'wt_target_2018_pub',
    ]) {
        assert.ok(ids.includes(id), `missing ${id}`);
    }
    assert.ok(!ids.includes('biliary_tract_adc_targets_msk_2026'));
});

test(
    '#128 lower grade glioma study with race; #106 renal with mRNA',
    T,
    async () => {
        const lgg = await findStudies({
            query: 'lower grade glioma',
            clinicalAttribute: 'race',
        });
        assert.ok(
            lgg.studies.some(s => s.studyId === 'lgg_tcga_pan_can_atlas_2018')
        );
        const renal = await findStudies({
            query: 'renal',
            requiresData: ['mrna'],
            limit: 50,
        });
        assert.ok(
            renal.studies.some(
                s => s.studyId === 'kirc_tcga_pan_can_atlas_2018'
            )
        );
    }
);

test('#72 no study has a polygenic risk score', T, async () => {
    const r = await findStudies({ clinicalAttribute: 'polygenic' });
    assert.equal(r.matchingStudies, 0);
});

// --- Tool 3: cohort_overview ---

test('#3 #4 #12 #11 #5 MSK-CHORD overview', T, async () => {
    const r = await cohortOverview({
        cohort: { studies: ['msk_chord_2024'] },
        top: 5,
        treatments: true,
    });
    assert.equal(r.patients, 24950);
    assert.equal(r.samples, 25040);
    const sampleType = r.clinical.find(c => c.attribute === 'SAMPLE_TYPE')!;
    assert.equal(
        sampleType.values.find(v => v.value === 'Primary')?.count,
        15928
    );
    const cancerType = r.clinical.find(c => c.attribute === 'CANCER_TYPE')!;
    assert.equal(cancerType.values[0].value, 'Non-Small Cell Lung Cancer');
    assert.equal(cancerType.values[0].count, 7809);
    assert.deepEqual(
        r.topMutatedGenes.map(g => g.gene),
        ['TP53', 'KRAS', 'APC', 'PIK3CA', 'EGFR']
    );
    near(r.topMutatedGenes[0].percent, 52.4, 0.1, 'TP53 %');
    const treatments = r.treatments as { topAgents: { agent: string }[] };
    assert.match(treatments.topAgents[0].agent, /fluorouracil/i);
});

test('#6 #7 TARGET osteosarcoma top mutated and CNA genes', T, async () => {
    const r = await cohortOverview({
        cohort: { studies: ['os_target_gdc'] },
        top: 5,
    });
    assert.equal(r.topMutatedGenes[0].gene, 'TP53');
    near(r.topMutatedGenes[0].percent, 22.4, 0.1, 'TP53 %');
    const cna = r.topCopyNumberAlteredGenes[0];
    assert.equal(cna.gene, 'LINC00901');
    assert.equal(cna.alteration, 'deep deletion');
    assert.equal(cna.altered, 32);
    assert.equal(cna.profiled, 81);
});

test('#2016 top genes in metastatic prostate (MSK-CHORD)', T, async () => {
    const r = await cohortOverview({
        cohort: {
            studies: ['msk_chord_2024'],
            clinical: [
                { attribute: 'CANCER_TYPE', values: ['Prostate Cancer'] },
                { attribute: 'SAMPLE_TYPE', values: ['Metastasis'] },
            ],
        },
        top: 5,
    });
    assert.equal(r.samples, 1070);
    assert.deepEqual(
        r.topMutatedGenes.map(g => g.gene),
        ['TP53', 'FOXA1', 'SPOP', 'APC', 'PTEN']
    );
    assert.equal(r.topMutatedGenes[0].altered, 360);
});

test('#2017 top genes in never-smoker NSCLC (msk_impact_2017)', T, async () => {
    const r = await cohortOverview({
        cohort: {
            studies: ['msk_impact_2017'],
            clinical: [
                {
                    attribute: 'CANCER_TYPE',
                    values: ['Non-Small Cell Lung Cancer'],
                },
                { attribute: 'SMOKING_HISTORY', values: ['Never'] },
            ],
        },
        top: 5,
    });
    assert.equal(r.samples, 369);
    assert.deepEqual(
        r.topMutatedGenes.slice(0, 2).map(g => g.gene),
        ['EGFR', 'TP53']
    );
    assert.equal(r.topMutatedGenes[0].altered, 175);
});

test('#2018 top genes in MSS stage 4 colorectal (MSK-CHORD)', T, async () => {
    const r = await cohortOverview({
        cohort: {
            studies: ['msk_chord_2024'],
            clinical: [
                { attribute: 'CANCER_TYPE', values: ['Colorectal Cancer'] },
                { attribute: 'MSI_TYPE', values: ['Stable'] },
                { attribute: 'STAGE_HIGHEST_RECORDED', values: ['Stage 4'] },
            ],
        },
        top: 5,
    });
    assert.equal(r.samples, 2177);
    const tp53 = r.topMutatedGenes.find(g => g.gene === 'TP53')!;
    assert.equal(tp53.altered, 1714);
});

test(
    '#2024 metastatic samples from female patients (MSK-CHORD)',
    T,
    async () => {
        const r = await cohortOverview({
            cohort: {
                studies: ['msk_chord_2024'],
                clinical: [
                    { attribute: 'SAMPLE_TYPE', values: ['Metastasis'] },
                    { attribute: 'GENDER', values: ['Female'] },
                ],
            },
            top: 5,
        });
        assert.equal(r.samples, 5247);
        assert.deepEqual(
            r.topMutatedGenes.map(g => g.gene),
            ['TP53', 'KRAS', 'PIK3CA', 'APC', 'EGFR']
        );
        assert.equal(r.topMutatedGenes[0].altered, 2782);
    }
);

test('#40 top genes in KRAS wild-type lung adenocarcinoma', T, async () => {
    const r = await cohortOverview({
        cohort: {
            studies: ['luad_tcga_pan_can_atlas_2018'],
            genes: [{ gene: 'KRAS', status: 'unaltered' }],
        },
        top: 3,
    });
    assert.equal(r.samples, 398);
    assert.equal(r.topMutatedGenes[0].gene, 'TP53');
    near(r.topMutatedGenes[0].percent, 58.5, 0.2, 'TP53 %');
});

// --- Tool 2: gene_frequency ---

test('#13 TP53 in MSK-CHORD, samples and patients', T, async () => {
    const s = await geneFrequency({
        gene: 'TP53',
        cohort: { studies: ['msk_chord_2024'] },
    });
    assert.equal(s.overall.altered, 13124);
    assert.equal(s.overall.profiled, 25040);
    const p = await geneFrequency({
        gene: 'TP53',
        cohort: { studies: ['msk_chord_2024'] },
        level: 'patient',
    });
    assert.equal(p.overall.altered, 13105);
    assert.equal(p.overall.profiled, 24950);
});

test('#20 KRAS in MSK-CHORD colorectal', T, async () => {
    const r = await geneFrequency({
        gene: 'KRAS',
        cohort: {
            studies: ['msk_chord_2024'],
            clinical: [
                { attribute: 'CANCER_TYPE', values: ['Colorectal Cancer'] },
            ],
        },
    });
    assert.equal(r.overall.altered, 2355);
    assert.equal(r.overall.profiled, 5543);
});

test('#31 EGFR by cancer type across TCGA PanCancer Atlas', T, async () => {
    const r = await geneFrequency({
        gene: 'EGFR',
        cohort: { studies: ['tcga_pancan'] },
        groupBy: 'CANCER_TYPE_DETAILED',
    });
    const top = (r.groups as Row[])[0];
    assert.equal(top.group, 'Glioblastoma Multiforme');
    assert.equal(top.altered, 94);
    assert.equal(top.profiled, 397);
});

test('#1006 TP53 by cancer type across TCGA PanCancer Atlas', T, async () => {
    const r = await geneFrequency({
        gene: 'TP53',
        cohort: { studies: ['tcga_pancan'] },
        groupBy: 'CANCER_TYPE',
    });
    const ov = group(r.groups, 'Ovarian Epithelial Tumor');
    assert.equal(ov.altered, 373);
    assert.equal(ov.profiled, 523);
    assert.equal((r.groups as Row[])[0].group, 'Ovarian Epithelial Tumor');
});

test('#53 EGFR amplification in TCGA LUAD', T, async () => {
    const r = await geneFrequency({
        gene: 'EGFR',
        alteration: 'amplification',
        cohort: { studies: ['luad_tcga_pan_can_atlas_2018'] },
    });
    assert.equal(r.overall.altered, 26);
    near(r.overall.percent, 5.1, 0.05, 'EGFR amp %');
});

test(
    '#126 CDKN2A shallow deletions in TCGA GBM; #75 SMARCA4 in POG',
    T,
    async () => {
        const gbm = await geneFrequency({
            gene: 'CDKN2A',
            alteration: 'shallow_deletion',
            cohort: { studies: ['gbm_tcga_pan_can_atlas_2018'] },
        });
        assert.equal(gbm.overall.altered, 114);
        assert.equal(gbm.overall.profiled, 575);
        const pog = await geneFrequency({
            gene: 'SMARCA4',
            alteration: 'shallow_deletion',
            cohort: { studies: ['pog570_bcgsc_2020'] },
            level: 'patient',
        });
        assert.equal(pog.overall.altered, 111);
        assert.equal(pog.overall.profiled, 570);
    }
);

test('#9 TP53 any alteration in TARGET osteosarcoma', T, async () => {
    const r = await geneFrequency({
        gene: 'TP53',
        alteration: 'any',
        cohort: { studies: ['os_target_gdc'] },
    });
    assert.equal(r.overall.altered, 38);
    assert.equal(r.overall.profiled, 158);
});

const subset = (
    clinical: { attribute: string; values: string[] }[],
    studies = ['msk_chord_2024']
) => ({ studies, clinical });

test('#2001–#2005 frequencies in clinical subsets', T, async () => {
    const cases: [string, ReturnType<typeof subset>, number, number][] = [
        [
            'EGFR',
            subset([
                {
                    attribute: 'CANCER_TYPE',
                    values: ['Non-Small Cell Lung Cancer'],
                },
                {
                    attribute: 'SMOKING_PREDICTIONS_3_CLASSES',
                    values: ['Never'],
                },
            ]),
            1003,
            2027,
        ],
        [
            'PIK3CA',
            subset([
                { attribute: 'CANCER_TYPE', values: ['Breast Cancer'] },
                { attribute: 'HR', values: ['Yes'] },
                { attribute: 'HER2', values: ['No'] },
            ]),
            1434,
            3515,
        ],
        [
            'KRAS',
            subset(
                [{ attribute: 'SAMPLE_TYPE', values: ['Metastasis'] }],
                ['msk_impact_2017']
            ),
            696,
            4732,
        ],
        [
            'BRAF',
            subset([
                { attribute: 'CANCER_TYPE', values: ['Colorectal Cancer'] },
                { attribute: 'MSI_TYPE', values: ['Instable'] },
            ]),
            247,
            586,
        ],
        [
            'SMAD4',
            subset([
                { attribute: 'CANCER_TYPE', values: ['Pancreatic Cancer'] },
                { attribute: 'SAMPLE_TYPE', values: ['Metastasis'] },
            ]),
            225,
            1124,
        ],
    ];
    for (const [gene, cohort, altered, profiled] of cases) {
        const r = await geneFrequency({ gene, cohort });
        assert.equal(r.overall.altered, altered, gene);
        assert.equal(r.overall.profiled, profiled, gene);
    }
});

test('#2006–#2008 pooled studies', T, async () => {
    const cases: [string, string[], number, number][] = [
        [
            'KRAS',
            [
                'coadread_tcga_pan_can_atlas_2018',
                'paad_tcga_pan_can_atlas_2018',
                'luad_tcga_pan_can_atlas_2018',
            ],
            503,
            1279,
        ],
        [
            'IDH1',
            ['lgg_tcga_pan_can_atlas_2018', 'gbm_tcga_pan_can_atlas_2018'],
            420,
            911,
        ],
        [
            'PIK3CA',
            [
                'brca_tcga_pan_can_atlas_2018',
                'ucec_tcga_pan_can_atlas_2018',
                'cesc_tcga_pan_can_atlas_2018',
            ],
            689,
            1874,
        ],
    ];
    for (const [gene, studies, altered, profiled] of cases) {
        const r = await geneFrequency({ gene, cohort: { studies } });
        assert.equal(r.overall.altered, altered, gene);
        assert.equal(r.overall.profiled, profiled, gene);
    }
});

test('#2009–#2012 #2025 subset comparisons by an attribute', T, async () => {
    const breast = await geneFrequency({
        gene: 'ESR1',
        cohort: subset([
            { attribute: 'CANCER_TYPE', values: ['Breast Cancer'] },
        ]),
        groupBy: 'SAMPLE_TYPE',
    });
    assert.deepEqual(
        [
            group(breast.groups, 'Metastasis').altered,
            group(breast.groups, 'Metastasis').profiled,
        ],
        [271, 2464]
    );
    assert.deepEqual(
        [
            group(breast.groups, 'Primary').altered,
            group(breast.groups, 'Primary').profiled,
        ],
        [47, 2859]
    );
    const nsclc = subset([
        { attribute: 'CANCER_TYPE', values: ['Non-Small Cell Lung Cancer'] },
    ]);
    const kras = await geneFrequency({
        gene: 'KRAS',
        cohort: nsclc,
        groupBy: 'SAMPLE_TYPE',
    });
    assert.deepEqual(
        [
            group(kras.groups, 'Primary').altered,
            group(kras.groups, 'Primary').profiled,
        ],
        [1424, 4908]
    );
    assert.deepEqual(
        [
            group(kras.groups, 'Metastasis').altered,
            group(kras.groups, 'Metastasis').profiled,
        ],
        [727, 2763]
    );
    const egfr = await geneFrequency({
        gene: 'EGFR',
        cohort: nsclc,
        groupBy: 'GENDER',
    });
    assert.deepEqual(
        [
            group(egfr.groups, 'Female').altered,
            group(egfr.groups, 'Female').profiled,
        ],
        [1281, 4567]
    );
    assert.deepEqual(
        [
            group(egfr.groups, 'Male').altered,
            group(egfr.groups, 'Male').profiled,
        ],
        [608, 3241]
    );
    const tp53 = await geneFrequency({
        gene: 'TP53',
        cohort: subset(
            [
                {
                    attribute: 'CANCER_TYPE',
                    values: ['Non-Small Cell Lung Cancer'],
                },
            ],
            ['msk_impact_2017']
        ),
        groupBy: 'SMOKING_HISTORY',
    });
    assert.deepEqual(
        [
            group(tp53.groups, 'Prev/Curr Smoker').altered,
            group(tp53.groups, 'Prev/Curr Smoker').profiled,
        ],
        [608, 1031]
    );
    assert.deepEqual(
        [
            group(tp53.groups, 'Never').altered,
            group(tp53.groups, 'Never').profiled,
        ],
        [165, 369]
    );
    const smoking = await geneFrequency({
        gene: 'KRAS',
        cohort: nsclc,
        groupBy: 'SMOKING_PREDICTIONS_3_CLASSES',
    });
    assert.deepEqual(
        [
            group(smoking.groups, 'Never').altered,
            group(smoking.groups, 'Never').profiled,
        ],
        [152, 2027]
    );
});

test('#2019 #2020 patient vs sample level', T, async () => {
    const cohort = subset(
        [{ attribute: 'CANCER_TYPE', values: ['Non-Small Cell Lung Cancer'] }],
        ['msk_impact_2017']
    );
    const s = await geneFrequency({ gene: 'EGFR', cohort });
    assert.deepEqual([s.overall.altered, s.overall.profiled], [408, 1668]);
    const p = await geneFrequency({ gene: 'EGFR', cohort, level: 'patient' });
    assert.deepEqual([p.overall.altered, p.overall.profiled], [370, 1567]);
    const breast = subset(
        [
            { attribute: 'CANCER_TYPE', values: ['Breast Cancer'] },
            { attribute: 'SAMPLE_TYPE', values: ['Metastasis'] },
        ],
        ['msk_impact_2017']
    );
    const bp = await geneFrequency({
        gene: 'TP53',
        cohort: breast,
        level: 'patient',
    });
    assert.deepEqual([bp.overall.altered, bp.overall.profiled], [333, 785]);
});

test('#1002 PIK3CA by PAM50 subtype in TCGA breast', T, async () => {
    const r = await geneFrequency({
        gene: 'PIK3CA',
        cohort: { studies: ['brca_tcga_pan_can_atlas_2018'] },
        groupBy: 'SUBTYPE',
    });
    const luma = group(r.groups, 'BRCA_LumA');
    assert.deepEqual([luma.altered, luma.profiled], [237, 499]);
    const basal = group(r.groups, 'BRCA_Basal');
    assert.deepEqual([basal.altered, basal.profiled], [12, 171]);
});

// --- Tool 6: gene_mutations ---

test('#32 EGFR variants in TCGA LUAD', T, async () => {
    const r = await geneMutations({
        gene: 'EGFR',
        cohort: { studies: ['luad_tcga_pan_can_atlas_2018'] },
    });
    assert.deepEqual(
        [r.mutatedSamples, r.profiledSamples, r.mutations],
        [70, 566, 86]
    );
    assert.equal(r.topProteinChanges[0].proteinChange, 'L858R');
    assert.equal(r.topProteinChanges[0].samples, 23);
});

test(
    '#52 TP53 R175H in TCGA breast; #54 KRAS variants in colorectal',
    T,
    async () => {
        const brca = await geneMutations({
            gene: 'TP53',
            cohort: { studies: ['brca_tcga_pan_can_atlas_2018'] },
            top: 3,
        });
        assert.equal(brca.topProteinChanges[0].proteinChange, 'R175H');
        assert.equal(brca.topProteinChanges[0].samples, 21);
        const crc = await geneMutations({
            gene: 'KRAS',
            cohort: { studies: ['coadread_tcga_pan_can_atlas_2018'] },
            top: 3,
        });
        assert.deepEqual(
            crc.topProteinChanges.map(c => [c.proteinChange, c.samples]),
            [
                ['G12D', 58],
                ['G12V', 49],
                ['G13D', 37],
            ]
        );
    }
);

test(
    '#46 BRAF V600E by cancer type across TCGA PanCancer Atlas',
    T,
    async () => {
        const r = await geneMutations({
            gene: 'BRAF',
            variant: 'V600E',
            cohort: { studies: ['tcga_pancan'] },
            groupBy: 'CANCER_TYPE',
        });
        const groups = r.groups as Row[];
        assert.equal(groups[0].group, 'Thyroid Cancer');
        near(groups[0].percent, 58.0, 0.3, 'thyroid V600E %');
        near(group(groups, 'Melanoma').percent, 35.9, 0.5, 'melanoma V600E %');
    }
);

test('#1001 KRAS G12C by cancer type in MSK-IMPACT 50K', T, async () => {
    const r = await geneMutations({
        gene: 'KRAS',
        variant: 'G12C',
        cohort: { studies: ['msk_impact_50k_2026'] },
        groupBy: 'CANCER_TYPE',
    });
    const nsclc = group(r.groups, 'Non-Small Cell Lung Cancer');
    assert.deepEqual([nsclc.altered, nsclc.profiled], [922, 7867]);
});

test('#1003 KRAS in TCGA lung squamous', T, async () => {
    const r = await geneMutations({
        gene: 'KRAS',
        cohort: { studies: ['lusc_tcga_pan_can_atlas_2018'] },
    });
    assert.deepEqual([r.mutatedSamples, r.profiledSamples], [7, 484]);
    assert.ok(!r.topProteinChanges.some(c => c.proteinChange === 'G12C'));
});

test('#2026 KRAS G12C in MSK-CHORD lung adenocarcinoma', T, async () => {
    const r = await geneMutations({
        gene: 'KRAS',
        variant: 'G12C',
        cohort: subset([{ attribute: 'ONCOTREE_CODE', values: ['LUAD'] }]),
    });
    assert.deepEqual([r.mutatedSamples, r.profiledSamples], [793, 5957]);
});

test('#70 BRAF in MSS colorectal (crc_msk_2017)', T, async () => {
    const cohort = subset(
        [{ attribute: 'MSI_STATUS', values: ['MSS'] }],
        ['crc_msk_2017']
    );
    const any = await geneMutations({ gene: 'BRAF', cohort });
    assert.deepEqual([any.mutatedSamples, any.profiledSamples], [78, 701]);
    const v600e = await geneMutations({
        gene: 'BRAF',
        variant: 'V600E',
        cohort,
    });
    assert.equal(v600e.mutatedSamples, 46);
});

test('#137 IDH1 R132H and wild-type patients in TCGA GBM', T, async () => {
    const r132h = await geneMutations({
        gene: 'IDH1',
        variant: 'R132H',
        cohort: { studies: ['gbm_tcga_pan_can_atlas_2018'] },
    });
    assert.equal(r132h.mutatedPatients, 22);
    const wt = await geneFrequency({
        gene: 'IDH1',
        cohort: {
            studies: ['gbm_tcga_pan_can_atlas_2018'],
            genes: [{ gene: 'IDH1', status: 'unaltered' }],
        },
        level: 'patient',
    });
    assert.equal(wt.overall.profiled, 366);
});

// --- Tool 4: compare_groups, gene_cooccurrence ---

test('#2013 #2014 #2015 co-occurrence counts in subsets', T, async () => {
    const nsclc = subset([
        { attribute: 'CANCER_TYPE', values: ['Non-Small Cell Lung Cancer'] },
    ]);
    const a = await geneCooccurrence({
        genes: ['KRAS', 'STK11'],
        cohort: nsclc,
    });
    assert.deepEqual(
        [
            a.pairs[0].both,
            a.pairs[0].firstOnly,
            a.pairs[0].secondOnly,
            a.pairs[0].neither,
        ],
        [529, 1654, 484, 5142]
    );
    assert.equal(a.pairs[0].tendency, 'co-occurrence');
    const b = await geneCooccurrence({
        genes: ['KRAS', 'EGFR'],
        cohort: subset(
            [
                {
                    attribute: 'CANCER_TYPE',
                    values: ['Non-Small Cell Lung Cancer'],
                },
                { attribute: 'SAMPLE_TYPE', values: ['Metastasis'] },
            ],
            ['msk_impact_2017']
        ),
    });
    assert.deepEqual(
        [
            b.pairs[0].both,
            b.pairs[0].firstOnly,
            b.pairs[0].secondOnly,
            b.pairs[0].neither,
        ],
        [11, 149, 156, 356]
    );
    assert.equal(b.pairs[0].tendency, 'mutual exclusivity');
    const c = await geneCooccurrence({
        genes: ['TP53', 'PIK3CA'],
        cohort: subset([
            { attribute: 'CANCER_TYPE', values: ['Breast Cancer'] },
            { attribute: 'HR', values: ['Yes'] },
            { attribute: 'HER2', values: ['No'] },
        ]),
    });
    assert.deepEqual(
        [
            c.pairs[0].both,
            c.pairs[0].firstOnly,
            c.pairs[0].secondOnly,
            c.pairs[0].neither,
        ],
        [307, 609, 1127, 1472]
    );
});

test('#21 most common co-mutated pair in MSK-CHORD breast', T, async () => {
    const r = await geneCooccurrence({
        topGenes: 8,
        cohort: subset([
            { attribute: 'CANCER_TYPE', values: ['Breast Cancer'] },
        ]),
    });
    assert.equal(
        r.pairs[0].genes
            .split(' + ')
            .sort()
            .join('+'),
        'PIK3CA+TP53'
    );
    assert.equal(r.pairs[0].both, 597);
});

test('#45 copy-number-high vs other endometrial subtypes', T, async () => {
    const study = ['ucec_tcga_pan_can_atlas_2018'];
    const r = await compareGroups({
        groups: [
            {
                name: 'CN high',
                cohort: {
                    studies: study,
                    clinical: [
                        { attribute: 'SUBTYPE', values: ['UCEC_CN_HIGH'] },
                    ],
                },
            },
            {
                name: 'Other',
                cohort: {
                    studies: study,
                    clinical: [
                        {
                            attribute: 'SUBTYPE',
                            values: ['UCEC_CN_LOW', 'UCEC_MSI', 'UCEC_POLE'],
                        },
                    ],
                },
            },
        ],
        analyses: ['mutations'],
        top: 20,
    });
    const rows = r.mutations as {
        gene: string;
        byGroup: { group: string; percent: number }[];
        enrichedIn: string;
    }[];
    const tp53 = rows.find(x => x.gene === 'TP53')!;
    near(
        tp53.byGroup.find(g => g.group === 'CN high')!.percent,
        87,
        3,
        'TP53 CN high %'
    );
    near(
        tp53.byGroup.find(g => g.group === 'Other')!.percent,
        15,
        3,
        'TP53 other %'
    );
    assert.equal(rows.find(x => x.gene === 'PTEN')?.enrichedIn, 'Other');
});

test('#60 genes down in TP53-mutant TCGA breast tumors', T, async () => {
    const study = ['brca_tcga_pan_can_atlas_2018'];
    const r = await compareGroups({
        groups: [
            {
                name: 'TP53 mutant',
                cohort: { studies: study, genes: [{ gene: 'TP53' }] },
            },
            {
                name: 'TP53 wild-type',
                cohort: {
                    studies: study,
                    genes: [{ gene: 'TP53', status: 'unaltered' }],
                },
            },
        ],
        analyses: ['mrna'],
        top: 10,
    });
    const lower = (r.mrna as {
        lowerInFirstGroup: { gene: string }[];
    }).lowerInFirstGroup.map(x => x.gene);
    const expected = ['AGR3', 'TFF1', 'SRARP', 'CYP2B7P', 'CPB1'];
    const hits = expected.filter(g => lower.includes(g)).length;
    assert.ok(hits >= 3, `only ${hits} of ${expected} in ${lower}`);
});

// --- Tool 5: compare_survival ---

test('#55 neuroblastoma median survival not reached', T, async () => {
    const r = await compareSurvival({
        groups: [{ name: 'All', cohort: { studies: ['nbl_target_2018_pub'] } }],
    });
    const g = r.groups[0];
    assert.equal(g.medianMonths, 'not reached');
    near(g.patientsWithData, 1072, 5, 'patients with OS');
    near(g.events, 397, 5, 'deaths');
});

test(
    '#61 neuroblastoma survival by age at diagnosis (>4 vs ≤4)',
    T,
    async () => {
        const study = ['nbl_target_2018_pub'];
        const r = await compareSurvival({
            groups: [
                {
                    name: '≤4',
                    cohort: {
                        studies: study,
                        clinical: [{ attribute: 'AGE', max: 4 }],
                    },
                },
                {
                    name: '>4',
                    cohort: {
                        studies: study,
                        clinical: [{ attribute: 'AGE', min: 4.0000001 }],
                    },
                },
            ],
        });
        assert.ok((r.logRankPValue as number) < 0.002, `p ${r.logRankPValue}`);
        near((r.hazardRatio as { ratio: number }).ratio, 1.47, 0.15, 'HR');
        assert.equal(r.groups[0].medianMonths, 'not reached');
    }
);

test(
    '#39 EGFR amplified vs unaltered lung adenocarcinoma survival',
    T,
    async () => {
        const study = ['luad_tcga_pan_can_atlas_2018'];
        const r = await compareSurvival({
            groups: [
                {
                    name: 'Unaltered',
                    cohort: {
                        studies: study,
                        genes: [
                            {
                                gene: 'EGFR',
                                alteration: 'mutation',
                                status: 'unaltered',
                            },
                            {
                                gene: 'EGFR',
                                alteration: 'amplification',
                                status: 'unaltered',
                            },
                        ],
                    },
                },
                {
                    name: 'EGFR amplified',
                    cohort: {
                        studies: study,
                        genes: [{ gene: 'EGFR', alteration: 'amplification' }],
                    },
                },
            ],
        });
        // Reference: AMP n=25, median 36.7 months; AMP vs unaltered log-rank p = 0.0032.
        near(r.groups[1].patientsWithData, 25, 1, 'AMP n');
        near(r.groups[1].medianMonths as number, 36.7, 0.5, 'AMP median');
        near(r.logRankPValue as number, 0.0032, 0.001, 'log-rank p');
    }
);

// --- Tool 7: clinical_values ---

test(
    '#16 patients with both a primary and a metastatic sample (MSK-CHORD)',
    T,
    async () => {
        const r = (await clinicalValues({
            cohort: { studies: ['msk_chord_2024'] },
            attribute: 'SAMPLE_TYPE',
            perPatient: true,
        })) as {
            patientsByValueCombination: Record<string, number>;
        };
        assert.equal(r.patientsByValueCombination['Metastasis + Primary'], 26);
    }
);

test('#23 TMB vs MSI score in MSK-CHORD colorectal', T, async () => {
    const r = (await clinicalValues({
        cohort: subset([
            { attribute: 'CANCER_TYPE', values: ['Colorectal Cancer'] },
        ]),
        attribute: 'TMB_NONSYNONYMOUS',
        versus: 'MSI_SCORE',
    })) as { spearman: { rho: number }; pearson: { r: number } };
    near(r.spearman.rho, 0.37, 0.03, 'spearman');
    near(r.pearson.r, 0.58, 0.03, 'pearson');
});

test('#62 age at diagnosis, IDH1 R132H vs wild-type GBM', T, async () => {
    const study = ['gbm_tcga_pan_can_atlas_2018'];
    const r = (await clinicalValues({
        attribute: 'AGE',
        groups: [
            {
                name: 'R132H',
                cohort: {
                    studies: study,
                    genes: [{ gene: 'IDH1', variant: 'R132H' }],
                },
            },
            {
                name: 'Wild-type',
                cohort: {
                    studies: study,
                    genes: [{ gene: 'IDH1', status: 'unaltered' }],
                },
            },
        ],
    })) as {
        groups: { group: string; median: number }[];
        comparison: { pValue: number };
    };
    near(r.groups[0].median, 40, 6, 'R132H median age');
    near(r.groups[1].median, 60, 4, 'WT median age');
    assert.ok(r.comparison.pValue < 1e-5);
});

test(
    '#2021 #2022 clinical counts in mutation-defined NSCLC subsets',
    T,
    async () => {
        const g12c = (await clinicalValues({
            cohort: {
                studies: ['msk_chord_2024'],
                clinical: [
                    {
                        attribute: 'CANCER_TYPE',
                        values: ['Non-Small Cell Lung Cancer'],
                    },
                ],
                genes: [{ gene: 'KRAS', variant: 'G12C' }],
            },
            attribute: 'OS_STATUS',
        })) as {
            groups: {
                withValue: number;
                values: { value: string; count: number }[];
            }[];
        };
        assert.equal(g12c.groups[0].withValue, 916);
        assert.equal(
            g12c.groups[0].values.find(v => /DECEASED/.test(v.value))?.count,
            494
        );
        const stk11 = (await clinicalValues({
            cohort: {
                studies: ['msk_chord_2024'],
                clinical: [
                    {
                        attribute: 'CANCER_TYPE',
                        values: ['Non-Small Cell Lung Cancer'],
                    },
                ],
                genes: [{ gene: 'STK11' }],
            },
            attribute: 'STAGE_HIGHEST_RECORDED',
        })) as {
            groups: {
                withValue: number;
                values: { value: string; count: number }[];
            }[];
        };
        assert.equal(
            stk11.groups[0].values.find(v => v.value === 'Stage 4')?.count,
            426
        );
    }
);

test('#51 neuroblastoma patients older than five at diagnosis', T, async () => {
    const study = ['nbl_target_2018_pub'];
    const older = await cohortOverview({
        cohort: {
            studies: study,
            clinical: [{ attribute: 'AGE', min: 5.0000001 }],
        },
        top: 1,
    });
    const all = await cohortOverview({
        cohort: { studies: study, clinical: [{ attribute: 'AGE', min: -1 }] },
        top: 1,
    });
    near((100 * older.patients) / all.patients, 11.62, 0.3, '% older than 5');
});

// --- Tool 8: molecular_values ---

test(
    '#33 #34 EGFR copy number, mRNA and protein in TCGA ovarian',
    T,
    async () => {
        const cohort = { studies: ['ov_tcga_pan_can_atlas_2018'] };
        const cn = (await molecularValues({
            gene: 'EGFR',
            dataType: 'cna_log2',
            cohort,
            versus: { dataType: 'mrna' },
        })) as {
            spearman: { rho: number };
            samplesWithBoth: number;
        };
        near(cn.spearman.rho, 0.36, 0.04, 'CN vs mRNA spearman');
        const protein = (await molecularValues({
            gene: 'EGFR',
            dataType: 'mrna',
            cohort,
            versus: { dataType: 'protein' },
        })) as {
            spearman: { rho: number };
            pearson: { r: number };
        };
        near(protein.spearman.rho, 0.45, 0.04, 'mRNA vs protein spearman');
    }
);

test('#30 CDK4 mRNA higher in amplified than diploid GBM', T, async () => {
    const study = ['gbm_tcga_pan_can_atlas_2018'];
    const r = (await molecularValues({
        gene: 'CDK4',
        dataType: 'mrna',
        groups: [
            {
                name: 'Amplified',
                cohort: {
                    studies: study,
                    genes: [{ gene: 'CDK4', alteration: 'amplification' }],
                },
            },
            {
                name: 'Not amplified',
                cohort: {
                    studies: study,
                    genes: [
                        {
                            gene: 'CDK4',
                            alteration: 'cna',
                            status: 'unaltered',
                        },
                    ],
                },
            },
        ],
    })) as { groups: { group: string; median: number }[] };
    assert.equal(r.groups[0].group, 'Amplified');
});

test('#126 CDKN2A copy-number levels in TCGA GBM', T, async () => {
    const r = (await molecularValues({
        gene: 'CDKN2A',
        dataType: 'cna_discrete',
        cohort: { studies: ['gbm_tcga_pan_can_atlas_2018'] },
    })) as {
        groups: {
            profiledSamples: number;
            levels: Record<string, { samples: number }>;
        }[];
    };
    assert.equal(r.groups[0].profiledSamples, 575);
    assert.equal(r.groups[0].levels['shallow deletion'].samples, 114);
    assert.equal(r.groups[0].levels['deep deletion'].samples, 322);
});
