// The data tools: questions about cBioPortal's data answered from its public
// API, with the same counts and denominators the portal's own pages show.
// Every number the chat reports should come from one of these (or from the
// page), never from the model's memory.

import { tool, ToolSet } from 'ai';
import { z } from 'zod';
import {
    ApiError,
    apiPost,
    attributesOf,
    Gene,
    getClinicalAttributes,
    getMolecularProfiles,
    getStudies,
    mapLimit,
    PORTAL_URL,
    profileFor,
    ProfileKind,
    resolveGene,
    resolveStudyIds,
    Study,
} from './api.js';
import {
    Alteration,
    ALTERATIONS,
    discreteCnaSamples,
    wire,
    asFilter,
    attributeCounts,
    CohortSchema,
    CohortSpec,
    countPatients,
    fetchClinicalValues,
    fetchMutations,
    fetchSamples,
    Mutation,
    patientKey,
    profileIds,
    resolveCohort,
    ResolvedCohort,
    Sample,
    sampleKey,
    splitBy,
    StudyViewFilter,
    studyViewLink,
    variantMatcher,
} from './cohort.js';
import {
    benjaminiHochberg,
    chiSquareTest,
    fisherExact,
    kaplanMeier,
    kruskalWallis,
    logRank,
    pearson,
    spearman,
    summarize,
    Summary,
    SurvivalEvent,
    wilcoxon,
} from './stats.js';

const SOURCE =
    'cBioPortal public API (www.cbioportal.org): the same data and counts as the portal pages';

const pct = (n: number, d: number) =>
    d > 0 ? Math.round((1000 * n) / d) / 10 : null;
const round = (x: number | undefined, digits = 3) =>
    x === undefined || !isFinite(x) ? x : Number(x.toPrecision(digits));
const roundSummary = (s?: Summary) =>
    s && {
        n: s.n,
        mean: round(s.mean, 4),
        median: round(s.median, 4),
        q1: round(s.q1, 4),
        q3: round(s.q3, 4),
        min: round(s.min, 4),
        max: round(s.max, 4),
    };

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
    try {
        return await fn();
    } catch (err) {
        return {
            error:
                err instanceof ApiError
                    ? err.message
                    : `The cBioPortal API call failed: ${
                          err instanceof Error ? err.message : String(err)
                      }`,
        };
    }
}

// --- Gene frequencies ---

interface GeneTableRow {
    entrezGeneId: number;
    hugoGeneSymbol: string;
    numberOfAlteredCases: number;
    numberOfProfiledCases: number;
    alteration?: number;
    cytoband?: string;
}

const geneTable = (
    filter: StudyViewFilter,
    kind: 'mutations' | 'cna' | 'structural_variants'
) =>
    apiPost<GeneTableRow[]>(
        kind === 'mutations'
            ? '/mutated-genes/fetch'
            : kind === 'cna'
            ? '/cna-genes/fetch'
            : '/structuralvariant-genes/fetch',
        wire(filter)
    );

const CNA_CODES: Partial<Record<Alteration, string[]>> = {
    amplification: ['AMP'],
    gain: ['GAIN'],
    deep_deletion: ['HOMDEL'],
    shallow_deletion: ['HETLOSS'],
    cna: ['AMP', 'HOMDEL'],
};

const kindsOf = (alteration: Alteration): ProfileKind[] =>
    alteration === 'any'
        ? ['mutations', 'cna', 'structural_variants']
        : alteration === 'mutation'
        ? ['mutations']
        : alteration === 'structural_variant'
        ? ['structural_variants']
        : ['cna'];

async function profiledSamples(
    filter: StudyViewFilter,
    kinds: ProfileKind[]
): Promise<Sample[]> {
    const suffixes = new Set<string>();
    for (const kind of kinds) {
        for (const studyId of filter.studyIds) {
            const p = await profileFor(studyId, kind);
            if (p) suffixes.add(p.molecularProfileId.slice(studyId.length + 1));
        }
    }
    if (suffixes.size === 0) return [];
    return fetchSamples({
        ...filter,
        genomicProfiles: [...(filter.genomicProfiles ?? []), [...suffixes]],
    });
}

async function alteredSamples(
    filter: StudyViewFilter,
    gene: Gene,
    alteration: Alteration
): Promise<Sample[]> {
    if (alteration === 'gain' || alteration === 'shallow_deletion') {
        const cohort = await fetchSamples(filter);
        const hit = await discreteCnaSamples(
            cohort,
            gene,
            alteration === 'gain' ? 1 : -1
        );
        return cohort.filter(s => hit.has(sampleKey(s)));
    }
    const out = new Map<string, Sample>();
    for (const kind of kindsOf(alteration)) {
        const ids = await profileIds(filter.studyIds, kind);
        if (ids.length === 0) continue;
        const alterations =
            kind === 'cna'
                ? alteration === 'any'
                    ? ['AMP', 'HOMDEL']
                    : CNA_CODES[alteration] ?? []
                : [];
        const hit = await fetchSamples({
            ...filter,
            geneFilters: [
                ...(filter.geneFilters ?? []),
                {
                    molecularProfileIds: ids,
                    geneQueries: [
                        [
                            {
                                hugoGeneSymbol: gene.hugoGeneSymbol,
                                entrezGeneId: gene.entrezGeneId,
                                alterations,
                            },
                        ],
                    ],
                },
            ],
        });
        for (const s of hit) out.set(sampleKey(s), s);
    }
    return [...out.values()];
}

interface Frequency {
    altered: number;
    profiled: number;
    percent: number | null;
}

/**
 * A gene's alteration frequency in the samples a filter selects, out of the
 * samples profiled for it: from the Study View's gene tables when they hold
 * the alteration (gene-panel aware, as the page shows it), else counted from
 * sample sets.
 */
async function frequency(
    filter: StudyViewFilter,
    gene: Gene,
    alteration: Alteration,
    level: 'sample' | 'patient'
): Promise<Frequency> {
    const table =
        level === 'sample' &&
        [
            'mutation',
            'amplification',
            'deep_deletion',
            'cna',
            'structural_variant',
        ].includes(alteration);
    if (table) {
        const kind = kindsOf(alteration)[0] as
            | 'mutations'
            | 'cna'
            | 'structural_variants';
        const hasProfile = (await profileIds(filter.studyIds, kind)).length > 0;
        if (!hasProfile) return { altered: 0, profiled: 0, percent: null };
        const rows = (await geneTable(filter, kind)).filter(
            r => r.entrezGeneId === gene.entrezGeneId
        );
        const wanted =
            alteration === 'amplification'
                ? [2]
                : alteration === 'deep_deletion'
                ? [-2]
                : alteration === 'cna'
                ? [2, -2]
                : undefined;
        const used = wanted
            ? rows.filter(r => wanted.includes(r.alteration ?? NaN))
            : rows;
        const altered = used.reduce((s, r) => s + r.numberOfAlteredCases, 0);
        let profiled = rows[0]?.numberOfProfiledCases;
        if (profiled === undefined) {
            profiled = (await profiledSamples(filter, [kind])).length;
        }
        return { altered, profiled, percent: pct(altered, profiled) };
    }
    const kinds = kindsOf(alteration);
    const [altered, profiled] = await Promise.all([
        alteredSamples(filter, gene, alteration),
        profiledSamples(filter, kinds),
    ]);
    const count = (list: Sample[]) =>
        level === 'patient' ? countPatients(list) : list.length;
    const a = count(altered);
    const p = count(profiled);
    return { altered: a, profiled: p, percent: pct(a, p) };
}

/** The filter for one value of an attribute within a cohort. */
function groupFilter(
    cohort: ResolvedCohort,
    attribute: string,
    value: string,
    samples: Sample[]
): StudyViewFilter {
    if (!cohort.filter.sampleIdentifiers) {
        return {
            ...cohort.filter,
            clinicalDataFilters: [
                ...(cohort.filter.clinicalDataFilters ?? []),
                { attributeId: attribute, values: [{ value }] },
            ],
        };
    }
    return asFilter(cohort.studyIds, samples);
}

const groupBySchema = z
    .string()
    .optional()
    .describe(
        'A clinical attribute to break the result down by (e.g. CANCER_TYPE, CANCER_TYPE_DETAILED, SUBTYPE, SAMPLE_TYPE, SEX, SMOKING_HISTORY), each group with its own denominator'
    );

// --- Tool 1: find studies ---

const DATA_TYPES = [
    'mutations',
    'cna',
    'structural_variants',
    'mrna',
    'protein',
    'methylation',
    'treatment',
    'survival',
    'resources',
] as const;

function dataOf(
    s: Study,
    profiles: Set<string>,
    survival: Set<string>
): string[] {
    const has: string[] = [];
    if (s.sequencedSampleCount > 0)
        has.push(`mutations (${s.sequencedSampleCount})`);
    if (s.cnaSampleCount > 0) has.push(`cna (${s.cnaSampleCount})`);
    if (
        s.structuralVariantCount > 0 ||
        profiles.has(`${s.studyId}:STRUCTURAL_VARIANT`)
    )
        has.push('structural_variants');
    const mrna =
        s.mrnaRnaSeqV2SampleCount +
        s.mrnaRnaSeqSampleCount +
        s.mrnaMicroarraySampleCount;
    if (mrna > 0 || profiles.has(`${s.studyId}:MRNA_EXPRESSION`))
        has.push(`mrna${mrna ? ` (${mrna})` : ''}`);
    if (
        s.rppaSampleCount + s.massSpectrometrySampleCount > 0 ||
        profiles.has(`${s.studyId}:PROTEIN_LEVEL`)
    )
        has.push('protein');
    if (
        s.methylationHm27SampleCount > 0 ||
        profiles.has(`${s.studyId}:METHYLATION`)
    )
        has.push('methylation');
    if (s.treatmentCount > 0) has.push('treatment');
    if (survival.has(s.studyId)) has.push('survival');
    if ((s.resourceCounts ?? []).length > 0) has.push('resources');
    return has;
}

const publishedYear = (s: Study) => {
    const years = (s.citation ?? '').match(/\b(19|20)\d{2}\b/g);
    return years ? Number(years[years.length - 1]) : undefined;
};

export async function findStudies(input: {
    query?: string;
    requiresData?: typeof DATA_TYPES[number][];
    clinicalAttribute?: string;
    publishedSince?: number;
    limit?: number;
}) {
    const [studies, molecular, attributes] = await Promise.all([
        getStudies(),
        getMolecularProfiles(),
        getClinicalAttributes(),
    ]);
    const profiles = new Set(
        molecular.map(p =>
            /methylation/i.test(p.molecularProfileId)
                ? `${p.studyId}:METHYLATION`
                : `${p.studyId}:${p.molecularAlterationType}`
        )
    );
    const survival = new Set(
        attributes
            .filter(a => /_MONTHS$/.test(a.clinicalAttributeId))
            .map(a => a.studyId)
    );
    const words = (input.query ?? '')
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(w => w.length > 1);
    const text = (s: Study) =>
        [
            s.studyId,
            s.name,
            s.description,
            s.citation,
            s.cancerType?.name,
            s.cancerTypeId,
            s.groups,
        ]
            .join(' ')
            .toLowerCase();
    let matchedAttributes: Map<string, string[]> | undefined;
    if (input.clinicalAttribute) {
        const q = input.clinicalAttribute.toLowerCase();
        matchedAttributes = new Map();
        for (const a of attributes) {
            if (
                a.clinicalAttributeId.toLowerCase().includes(q) ||
                a.displayName.toLowerCase().includes(q)
            ) {
                const list = matchedAttributes.get(a.studyId) ?? [];
                list.push(`${a.clinicalAttributeId} (${a.displayName})`);
                matchedAttributes.set(a.studyId, list);
            }
        }
    }
    const matches = studies
        .filter(s => {
            const t = text(s);
            return words.every(w =>
                new RegExp(
                    `(^|[^a-z0-9])${w.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        '\\$&'
                    )}($|[^a-z0-9])`
                ).test(t)
            );
        })
        .filter(s => {
            const has = dataOf(s, profiles, survival).map(d => d.split(' ')[0]);
            return (input.requiresData ?? []).every(d => has.includes(d));
        })
        .filter(s => !matchedAttributes || matchedAttributes.has(s.studyId))
        .filter(s => {
            if (!input.publishedSince) return true;
            const y = publishedYear(s);
            return y !== undefined && y >= input.publishedSince;
        })
        .sort((a, b) => b.allSampleCount - a.allSampleCount);
    const cancerTypes = new Map<string, number>();
    for (const s of matches) {
        const name = s.cancerType?.name ?? s.cancerTypeId;
        cancerTypes.set(name, (cancerTypes.get(name) ?? 0) + 1);
    }
    const limit = input.limit ?? 25;
    return {
        totalStudiesInPortal: studies.length,
        matchingStudies: matches.length,
        cancerTypesOfMatches: [...cancerTypes.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 40)
            .map(([name, count]) => ({ name, studies: count })),
        distinctCancerTypes: cancerTypes.size,
        studies: matches.slice(0, limit).map(s => ({
            studyId: s.studyId,
            name: s.name,
            cancerType: s.cancerType?.name ?? s.cancerTypeId,
            samples: s.allSampleCount,
            data: dataOf(s, profiles, survival),
            citation: s.citation || undefined,
            pmid: s.pmid || undefined,
            ...(matchedAttributes
                ? {
                      matchingAttributes: matchedAttributes
                          .get(s.studyId)
                          ?.slice(0, 5),
                  }
                : {}),
            link: `${PORTAL_URL}/study/summary?id=${s.studyId}`,
        })),
        ...(matches.length > limit
            ? {
                  note: `Showing the ${limit} largest of ${matches.length}; narrow the query or raise limit.`,
              }
            : {}),
        source: SOURCE,
    };
}

// --- Tool 3: cohort overview ---

const DEFAULT_ATTRIBUTES = [
    'CANCER_TYPE',
    'CANCER_TYPE_DETAILED',
    'SAMPLE_TYPE',
    'SEX',
    'SUBTYPE',
];

export async function cohortOverview(input: {
    cohort: CohortSpec;
    top?: number;
    genes?: string[];
    attributes?: string[];
    treatments?: boolean;
}) {
    const cohort = await resolveCohort(input.cohort);
    const top = input.top ?? 10;
    const filter = cohort.filter;
    const kinds = ['mutations', 'cna', 'structural_variants'] as const;
    const has = Object.fromEntries(
        await Promise.all(
            kinds.map(
                async k =>
                    [
                        k,
                        (await profileIds(cohort.studyIds, k)).length > 0,
                    ] as const
            )
        )
    ) as Record<typeof kinds[number], boolean>;
    const [mutated, cna, sv, profileCounts] = await Promise.all([
        has.mutations ? geneTable(filter, 'mutations') : Promise.resolve([]),
        has.cna ? geneTable(filter, 'cna') : Promise.resolve([]),
        has.structural_variants
            ? geneTable(filter, 'structural_variants')
            : Promise.resolve([]),
        apiPost<{ label: string; value: string; count: number }[]>(
            '/molecular-profile-sample-counts/fetch',
            wire(filter)
        ),
    ]);
    const topOf = (rows: GeneTableRow[], label?: (r: GeneTableRow) => string) =>
        [...rows]
            .sort(
                (a, b) =>
                    b.numberOfAlteredCases - a.numberOfAlteredCases ||
                    b.numberOfAlteredCases /
                        Math.max(1, b.numberOfProfiledCases) -
                        a.numberOfAlteredCases /
                            Math.max(1, a.numberOfProfiledCases)
            )
            .slice(0, top)
            .map(r => ({
                gene: r.hugoGeneSymbol,
                ...(label ? { alteration: label(r) } : {}),
                ...(r.cytoband ? { cytoband: r.cytoband } : {}),
                altered: r.numberOfAlteredCases,
                profiled: r.numberOfProfiledCases,
                percent: pct(r.numberOfAlteredCases, r.numberOfProfiledCases),
            }));
    const available = new Set(
        cohort.attributes.map(a => a.clinicalAttributeId)
    );
    const wanted = [
        ...new Set([
            ...(input.attributes ?? []).map(a => a.toUpperCase()),
            ...DEFAULT_ATTRIBUTES,
        ]),
    ].filter(a => available.has(a));
    const clinical = await Promise.all(
        wanted.map(async attribute => {
            const counts = await attributeCounts(filter, attribute);
            const total = counts.reduce((s, c) => s + c.count, 0);
            return {
                attribute,
                values: counts.slice(0, 12).map(c => ({
                    value: c.value,
                    count: c.count,
                    percent: pct(c.count, total),
                })),
                ...(counts.length > 12
                    ? { moreValues: counts.length - 12 }
                    : {}),
            };
        })
    );
    const requested = await Promise.all(
        (input.genes ?? []).map(async symbol => {
            const gene = await resolveGene(symbol);
            const [mutation, amplification, deepDeletion] = await Promise.all([
                has.mutations
                    ? frequency(filter, gene, 'mutation', 'sample')
                    : undefined,
                has.cna
                    ? frequency(filter, gene, 'amplification', 'sample')
                    : undefined,
                has.cna
                    ? frequency(filter, gene, 'deep_deletion', 'sample')
                    : undefined,
            ]);
            return {
                gene: gene.hugoGeneSymbol,
                mutation,
                amplification,
                deepDeletion,
            };
        })
    );
    let treatments: unknown;
    if (input.treatments) {
        const report = await apiPost<{
            totalPatients: number;
            patientTreatments: { treatment: string; count: number }[];
        }>('/treatments/patient-counts/fetch?tier=Agent', wire(filter)).catch(
            () => undefined
        );
        treatments = report && {
            patientsWithTreatmentData: report.totalPatients,
            topAgents: [...report.patientTreatments]
                .sort((a, b) => b.count - a.count)
                .slice(0, 15)
                .map(t => ({ agent: t.treatment, patients: t.count })),
        };
    }
    const otherAttributes = cohort.attributes
        .filter(a => !wanted.includes(a.clinicalAttributeId))
        .map(
            a =>
                `${a.clinicalAttributeId}${
                    a.datatype === 'NUMBER' ? ' (number)' : ''
                }`
        );
    return {
        cohort: cohort.description,
        samples: cohort.samples.length,
        patients: countPatients(cohort.samples),
        profiledSamples: profileCounts
            .filter(p => p.count > 0)
            .map(p => ({ data: p.label, samples: p.count })),
        topMutatedGenes: topOf(mutated),
        topCopyNumberAlteredGenes: topOf(cna, r =>
            r.alteration === 2 ? 'amplification' : 'deep deletion'
        ),
        ...(sv.length ? { topStructuralVariantGenes: topOf(sv) } : {}),
        ...(requested.length ? { requestedGenes: requested } : {}),
        clinical,
        ...(treatments ? { treatments } : {}),
        otherClinicalAttributes: [...new Set(otherAttributes)].slice(0, 80),
        ...(cohort.linkFilter
            ? { link: studyViewLink(cohort.linkFilter) }
            : {}),
        source: SOURCE,
    };
}

// --- Tool 2: gene frequency ---

export async function geneFrequency(input: {
    gene: string;
    alteration?: Alteration;
    cohort: CohortSpec;
    groupBy?: string;
    level?: 'sample' | 'patient';
}) {
    const gene = await resolveGene(input.gene);
    const alteration = input.alteration ?? 'mutation';
    const level = input.level ?? 'sample';
    const cohort = await resolveCohort(input.cohort);
    const overall = await frequency(cohort.filter, gene, alteration, level);
    let groups: unknown;
    if (input.groupBy) {
        const attribute = input.groupBy.toUpperCase();
        const split = await splitBy(cohort, attribute);
        groups = (
            await mapLimit(split, 6, async g => ({
                group: g.value,
                samples: g.samples.length,
                ...(await frequency(
                    groupFilter(cohort, attribute, g.value, g.samples),
                    gene,
                    alteration,
                    level
                )),
            }))
        ).sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
    }
    return {
        gene: gene.hugoGeneSymbol,
        alteration,
        level,
        cohort: cohort.description,
        cohortSamples: cohort.samples.length,
        overall,
        ...(groups ? { groupBy: input.groupBy!.toUpperCase(), groups } : {}),
        note: `percent = altered / ${level}s profiled for ${
            alteration === 'any' ? 'mutations, CNA or SV' : alteration
        }`,
        ...(cohort.linkFilter
            ? { link: studyViewLink(cohort.linkFilter) }
            : {}),
        source: SOURCE,
    };
}

// --- Tool 6: mutations of a gene ---

function vafOf(m: Mutation): number | undefined {
    const alt = m.tumorAltCount ?? -1;
    const ref = m.tumorRefCount ?? -1;
    return alt >= 0 && ref >= 0 && alt + ref > 0
        ? alt / (alt + ref)
        : undefined;
}

function statusOf(m: Mutation): 'germline' | 'somatic' | 'unknown' {
    const s = (m.mutationStatus ?? '').toLowerCase();
    if (s === 'germline') return 'germline';
    if (s === 'somatic') return 'somatic';
    return 'unknown';
}

export async function geneMutations(input: {
    gene: string;
    cohort: CohortSpec;
    variant?: string;
    excludeVariant?: string;
    mutationStatus?: 'any' | 'somatic' | 'germline';
    groupBy?: string;
    top?: number;
    listSamples?: boolean;
}) {
    const gene = await resolveGene(input.gene);
    const cohort = await resolveCohort(input.cohort);
    const inCohort = new Map(cohort.samples.map(s => [sampleKey(s), s]));
    let mutations = (await fetchMutations(cohort.studyIds, gene)).filter(m =>
        inCohort.has(sampleKey(m))
    );
    if (input.mutationStatus && input.mutationStatus !== 'any') {
        mutations = mutations.filter(m => statusOf(m) === input.mutationStatus);
    }
    if (input.excludeVariant) {
        const exclude = variantMatcher(input.excludeVariant);
        mutations = mutations.filter(m => !exclude(m.proteinChange ?? ''));
    }
    const all = mutations;
    if (input.variant) {
        const matches = variantMatcher(input.variant);
        mutations = mutations.filter(m => matches(m.proteinChange ?? ''));
    }
    const profiled = await frequency(cohort.filter, gene, 'mutation', 'sample');
    const mutatedSamples = new Set(mutations.map(sampleKey));
    const mutatedPatients = new Set(mutations.map(patientKey));
    const anyMutated = new Set(all.map(sampleKey));
    const byChange = new Map<string, { samples: Set<string>; type: string }>();
    for (const m of mutations) {
        const key = m.proteinChange || '(none)';
        if (!byChange.has(key))
            byChange.set(key, { samples: new Set(), type: m.mutationType });
        byChange.get(key)!.samples.add(sampleKey(m));
    }
    const countBy = (f: (m: Mutation) => string) => {
        const out = new Map<string, number>();
        for (const m of mutations) out.set(f(m), (out.get(f(m)) ?? 0) + 1);
        return Object.fromEntries(
            [...out.entries()].sort((a, b) => b[1] - a[1])
        );
    };
    const vafs = mutations
        .map(vafOf)
        .filter((v): v is number => v !== undefined);
    let groups: unknown;
    if (input.groupBy) {
        const attribute = input.groupBy.toUpperCase();
        const split = await splitBy(cohort, attribute);
        groups = (
            await mapLimit(split, 6, async g => {
                const keys = new Set(g.samples.map(sampleKey));
                const altered = [...mutatedSamples].filter(k => keys.has(k))
                    .length;
                const f = await frequency(
                    groupFilter(cohort, attribute, g.value, g.samples),
                    gene,
                    'mutation',
                    'sample'
                );
                return {
                    group: g.value,
                    altered,
                    profiled: f.profiled,
                    percent: pct(altered, f.profiled),
                };
            })
        ).sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
    }
    const top = input.top ?? 15;
    const listed = mutations.slice(0, 60).map(m => ({
        study: m.studyId,
        patient: m.patientId,
        sample: m.sampleId,
        proteinChange: m.proteinChange,
        type: m.mutationType,
        status: statusOf(m),
        vaf: round(vafOf(m), 2),
        link: `${PORTAL_URL}/patient?studyId=${m.studyId}&caseId=${m.patientId}`,
    }));
    return {
        gene: gene.hugoGeneSymbol,
        cohort: cohort.description,
        ...(input.variant ? { variant: input.variant } : {}),
        profiledSamples: profiled.profiled,
        mutatedSamples: mutatedSamples.size,
        percentOfProfiled: pct(mutatedSamples.size, profiled.profiled),
        mutatedPatients: mutatedPatients.size,
        mutations: mutations.length,
        ...(input.variant
            ? {
                  samplesWithAnyMutationOfGene: anyMutated.size,
                  percentOfMutatedSamples: pct(
                      mutatedSamples.size,
                      anyMutated.size
                  ),
              }
            : {}),
        topProteinChanges: [...byChange.entries()]
            .sort((a, b) => b[1].samples.size - a[1].samples.size)
            .slice(0, top)
            .map(([change, v]) => ({
                proteinChange: change,
                type: v.type,
                samples: v.samples.size,
                percentOfProfiled: pct(v.samples.size, profiled.profiled),
            })),
        mutationTypes: countBy(m => m.mutationType || 'unknown'),
        mutationStatus: countBy(statusOf),
        ...(vafs.length
            ? { variantAlleleFrequency: roundSummary(summarize(vafs)) }
            : {}),
        ...(groups ? { groupBy: input.groupBy!.toUpperCase(), groups } : {}),
        ...(input.listSamples || mutations.length <= 10
            ? { samples: listed }
            : {}),
        ...(cohort.studyIds.length > 1
            ? {
                  note:
                      'Several studies: the same patient can appear in more than one study (e.g. MSK cohorts), so cross-study counts may include duplicates.',
              }
            : {}),
        source: SOURCE,
    };
}

// --- Group definitions shared by the comparison tools ---

const GroupsSchema = z
    .array(
        z.object({
            name: z.string().describe('Short group name, e.g. "KRAS mutant"'),
            cohort: CohortSchema,
        })
    )
    .min(1)
    .max(6);

async function resolveGroups(groups: { name: string; cohort: CohortSpec }[]) {
    const resolved = await Promise.all(
        groups.map(async g => ({
            name: g.name,
            cohort: await resolveCohort(g.cohort),
        }))
    );
    // Samples in more than one group are left out of all, as cBioPortal's
    // group comparison does by default.
    const seen = new Map<string, number>();
    for (const g of resolved) {
        for (const s of g.cohort.samples) {
            seen.set(sampleKey(s), (seen.get(sampleKey(s)) ?? 0) + 1);
        }
    }
    const overlapping = [...seen.values()].filter(n => n > 1).length;
    return {
        groups: resolved.map(g => ({
            name: g.name,
            description: g.cohort.description,
            studyIds: g.cohort.studyIds,
            samples: g.cohort.samples.filter(s => seen.get(sampleKey(s)) === 1),
        })),
        overlapping,
    };
}

// --- Tool 4: compare groups ---

const MUTATION_EVENT_TYPES = [
    'missense_mutation',
    'missense',
    'missense_variant',
    'frame_shift_ins',
    'frame_shift_del',
    'frameshift',
    'frameshift_deletion',
    'frameshift_insertion',
    'de_novo_start_outofframe',
    'frameshift_variant',
    'nonsense_mutation',
    'nonsense',
    'stopgain_snv',
    'stop_gained',
    'splice_site',
    'splice',
    'splicing',
    'splice_site_snp',
    'splice_site_del',
    'splice_site_indel',
    'splice_region_variant',
    'splice_region',
    'translation_start_site',
    'initiator_codon_variant',
    'start_codon_snp',
    'start_codon_del',
    'nonstop_mutation',
    'stop_lost',
    'inframe_del',
    'inframe_deletion',
    'in_frame_del',
    'in_frame_deletion',
    'inframe_ins',
    'inframe_insertion',
    'in_frame_ins',
    'in_frame_insertion',
    'indel',
    'nonframeshift_deletion',
    'nonframeshift',
    'nonframeshift_insertion',
    'targeted_region',
    'inframe',
    'truncating',
    'feature_truncation',
    'silent',
    'synonymous_variant',
    'any',
    'other',
];

const ALL_ALTERATION_SETTINGS = {
    includeDriver: true,
    includeVUS: true,
    includeUnknownOncogenicity: true,
    tiersBooleanMap: {},
    includeUnknownTier: true,
    includeGermline: true,
    includeSomatic: true,
    includeUnknownStatus: true,
};

async function profileCases(
    groups: { name: string; samples: Sample[] }[],
    kind: ProfileKind
) {
    const out: {
        name: string;
        molecularProfileCaseIdentifiers: {
            caseId: string;
            molecularProfileId: string;
        }[];
    }[] = [];
    for (const g of groups) {
        const ids: { caseId: string; molecularProfileId: string }[] = [];
        for (const s of g.samples) {
            const p = await profileFor(s.studyId, kind);
            if (p)
                ids.push({
                    caseId: s.sampleId,
                    molecularProfileId: p.molecularProfileId,
                });
        }
        out.push({ name: g.name, molecularProfileCaseIdentifiers: ids });
    }
    return out;
}

const COMPARISONS = [
    'mutations',
    'amplifications',
    'deep_deletions',
    'clinical',
    'mrna',
    'protein',
] as const;

export async function compareGroups(input: {
    groups: { name: string; cohort: CohortSpec }[];
    analyses?: typeof COMPARISONS[number][];
    top?: number;
}) {
    if (input.groups.length < 2)
        throw new ApiError('Give at least two groups.');
    const { groups, overlapping } = await resolveGroups(input.groups);
    const top = input.top ?? 10;
    const analyses = input.analyses ?? [
        'mutations',
        'amplifications',
        'deep_deletions',
        'clinical',
    ];
    const result: Record<string, unknown> = {
        groups: groups.map(g => ({
            name: g.name,
            cohort: g.description,
            samples: g.samples.length,
            patients: countPatients(g.samples),
        })),
        ...(overlapping ? { overlappingSamplesExcluded: overlapping } : {}),
    };
    for (const analysis of analyses) {
        if (analysis === 'clinical') {
            const rows = await apiPost<
                {
                    clinicalAttribute: {
                        clinicalAttributeId: string;
                        displayName: string;
                    };
                    method: string;
                    pValue: number;
                    score: number;
                }[]
            >('/clinical-data-enrichments/fetch', {
                groups: groups.map(g => ({
                    name: g.name,
                    sampleIdentifiers: g.samples.map(s => ({
                        studyId: s.studyId,
                        sampleId: s.sampleId,
                    })),
                })),
            });
            const q = benjaminiHochberg(rows.map(r => r.pValue));
            result.clinical = rows
                .map((r, i) => ({
                    attribute: r.clinicalAttribute.clinicalAttributeId,
                    name: r.clinicalAttribute.displayName,
                    test: r.method,
                    pValue: round(r.pValue),
                    qValue: round(q[i]),
                }))
                .sort((a, b) => (a.pValue ?? 1) - (b.pValue ?? 1))
                .slice(0, top);
            continue;
        }
        if (analysis === 'mrna' || analysis === 'protein') {
            const cases = await profileCases(groups, analysis);
            if (
                cases.some(c => c.molecularProfileCaseIdentifiers.length === 0)
            ) {
                result[analysis] = {
                    error: `Not every group has ${analysis} data.`,
                };
                continue;
            }
            const rows = await apiPost<
                {
                    hugoGeneSymbol: string;
                    pValue: number;
                    groupsStatistics: {
                        name: string;
                        meanExpression: number;
                        standardDeviation: number;
                    }[];
                }[]
            >('/expression-enrichments/fetch?enrichmentType=SAMPLE', cases);
            const q = benjaminiHochberg(rows.map(r => r.pValue));
            const meanOf = (r: typeof rows[number], name: string) =>
                r.groupsStatistics.find(st => st.name === name)
                    ?.meanExpression ?? NaN;
            // Two groups: log2 ratio of the first group's mean to the
            // second's (the profile means are log2), as the portal shows.
            const rowsQ = rows.map((r, i) => ({
                r,
                q: q[i],
                logRatio:
                    groups.length === 2
                        ? meanOf(r, groups[0].name) - meanOf(r, groups[1].name)
                        : undefined,
            }));
            const fmt = (x: typeof rowsQ[number]) => ({
                gene: x.r.hugoGeneSymbol,
                meanByGroup: Object.fromEntries(
                    x.r.groupsStatistics.map(st => [
                        st.name,
                        round(st.meanExpression),
                    ])
                ),
                ...(x.logRatio !== undefined
                    ? { log2Ratio: round(x.logRatio) }
                    : {}),
                higherIn: [...x.r.groupsStatistics].sort(
                    (a, b) => b.meanExpression - a.meanExpression
                )[0]?.name,
                pValue: round(x.r.pValue),
                qValue: round(x.q),
            });
            const significant = rowsQ.filter(
                x =>
                    x.q < 0.05 &&
                    x.logRatio !== undefined &&
                    isFinite(x.logRatio)
            );
            result[analysis] = {
                note:
                    'Group means of log2 values (cBioPortal’s expression enrichment, t-test); q = Benjamini-Hochberg. The up/down lists hold genes with q < 0.05, ordered by log2 ratio of the first group vs the second.',
                mostSignificant: [...rowsQ]
                    .sort((a, b) => a.r.pValue - b.r.pValue)
                    .slice(0, top)
                    .map(fmt),
                ...(groups.length === 2
                    ? {
                          higherInFirstGroup: significant
                              .filter(x => x.logRatio! > 0)
                              .sort((a, b) => b.logRatio! - a.logRatio!)
                              .slice(0, top)
                              .map(fmt),
                          lowerInFirstGroup: significant
                              .filter(x => x.logRatio! < 0)
                              .sort((a, b) => a.logRatio! - b.logRatio!)
                              .slice(0, top)
                              .map(fmt),
                      }
                    : {}),
            };
            continue;
        }
        const kind: ProfileKind =
            analysis === 'mutations' ? 'mutations' : 'cna';
        const cases = await profileCases(groups, kind);
        if (cases.some(c => c.molecularProfileCaseIdentifiers.length === 0)) {
            result[analysis] = { error: `Not every group has ${kind} data.` };
            continue;
        }
        const alterationEventTypes =
            analysis === 'mutations'
                ? {
                      ...ALL_ALTERATION_SETTINGS,
                      mutationEventTypes: Object.fromEntries(
                          MUTATION_EVENT_TYPES.map(t => [t, true])
                      ),
                      copyNumberAlterationEventTypes: {},
                      structuralVariants: false,
                  }
                : {
                      ...ALL_ALTERATION_SETTINGS,
                      mutationEventTypes: {},
                      copyNumberAlterationEventTypes:
                          analysis === 'amplifications'
                              ? { AMP: true }
                              : { HOMDEL: true },
                      structuralVariants: false,
                  };
        const rows = await apiPost<
            {
                hugoGeneSymbol: string;
                cytoband?: string;
                pValue: number;
                counts: {
                    name: string;
                    alteredCount: number;
                    profiledCount: number;
                }[];
            }[]
        >('/alteration-enrichments/fetch?enrichmentType=SAMPLE', {
            molecularProfileCasesGroupFilter: cases,
            alterationEventTypes,
        });
        const tested = rows.filter(r => typeof r.pValue === 'number');
        const q = benjaminiHochberg(tested.map(r => r.pValue));
        result[analysis] = tested
            .map((r, i) => {
                const byGroup = r.counts.map(c => ({
                    group: c.name,
                    altered: c.alteredCount,
                    profiled: c.profiledCount,
                    percent: pct(c.alteredCount, c.profiledCount),
                }));
                const enriched = [...byGroup].sort(
                    (a, b) => (b.percent ?? 0) - (a.percent ?? 0)
                )[0]?.group;
                return {
                    gene: r.hugoGeneSymbol,
                    ...(r.cytoband ? { cytoband: r.cytoband } : {}),
                    byGroup,
                    enrichedIn: enriched,
                    pValue: round(r.pValue),
                    qValue: round(q[i]),
                };
            })
            .sort((a, b) => (a.pValue ?? 1) - (b.pValue ?? 1))
            .slice(0, top);
    }
    result.note =
        'Tests as cBioPortal group comparison: alterations Fisher exact (2 groups) or chi-squared, clinical chi-squared / Kruskal-Wallis; q = Benjamini-Hochberg over all genes or attributes tested. Samples in more than one group are excluded.';
    result.source = SOURCE;
    return result;
}

// --- Tool 4b: co-occurrence ---

export async function geneCooccurrence(input: {
    genes?: string[];
    topGenes?: number;
    alteration?: Alteration;
    cohort: CohortSpec;
}) {
    const cohort = await resolveCohort(input.cohort);
    const alteration = input.alteration ?? 'mutation';
    let genes: Gene[];
    if (input.genes?.length) {
        genes = await Promise.all(input.genes.map(resolveGene));
    } else {
        const n = Math.min(input.topGenes ?? 8, 12);
        const rows = await geneTable(cohort.filter, 'mutations');
        genes = rows
            .sort((a, b) => b.numberOfAlteredCases - a.numberOfAlteredCases)
            .slice(0, n)
            .map(r => ({
                entrezGeneId: r.entrezGeneId,
                hugoGeneSymbol: r.hugoGeneSymbol,
            }));
    }
    if (genes.length < 2) throw new ApiError('Give at least two genes.');
    const profiled = new Set(
        (await profiledSamples(cohort.filter, kindsOf(alteration))).map(
            sampleKey
        )
    );
    const altered = await mapLimit(
        genes,
        4,
        async g =>
            new Set(
                (await alteredSamples(cohort.filter, g, alteration))
                    .map(sampleKey)
                    .filter(k => profiled.has(k))
            )
    );
    const pairs: {
        genes: string;
        both: number;
        firstOnly: number;
        secondOnly: number;
        neither: number;
        oddsRatio: number | string;
        tendency: string;
        pValue: number;
    }[] = [];
    for (let i = 0; i < genes.length; i++) {
        for (let j = i + 1; j < genes.length; j++) {
            let both = 0;
            for (const k of altered[i]) if (altered[j].has(k)) both++;
            const firstOnly = altered[i].size - both;
            const secondOnly = altered[j].size - both;
            const neither = profiled.size - both - firstOnly - secondOnly;
            const f = fisherExact(both, firstOnly, secondOnly, neither);
            const cooccur = f.oddsRatio > 1;
            pairs.push({
                genes: `${genes[i].hugoGeneSymbol} + ${genes[j].hugoGeneSymbol}`,
                both,
                firstOnly,
                secondOnly,
                neither,
                oddsRatio: isFinite(f.oddsRatio)
                    ? round(f.oddsRatio)!
                    : 'infinite',
                tendency: cooccur ? 'co-occurrence' : 'mutual exclusivity',
                pValue: cooccur ? f.greater : f.less,
            });
        }
    }
    const q = benjaminiHochberg(pairs.map(p => p.pValue));
    return {
        cohort: cohort.description,
        alteration,
        profiledSamples: profiled.size,
        genes: genes.map((g, i) => ({
            gene: g.hugoGeneSymbol,
            altered: altered[i].size,
            percent: pct(altered[i].size, profiled.size),
        })),
        pairs: pairs
            .map((p, i) => ({
                ...p,
                pValue: round(p.pValue),
                qValue: round(q[i]),
            }))
            .sort((a, b) => b.both - a.both),
        note:
            'Counts over samples profiled for the alteration. p: one-sided Fisher exact test in the direction of the tendency, as cBioPortal’s Mutual Exclusivity tab; q: Benjamini-Hochberg.',
        source: SOURCE,
    };
}

// --- Tool 5: survival ---

function survivalEvent(status: string | undefined): boolean | undefined {
    if (!status) return undefined;
    const s = status.trim();
    if (
        /^1\s*:/.test(s) ||
        /^(deceased|dead|recurred|progressed|progression|yes)$/i.test(s)
    )
        return true;
    if (
        /^0\s*:/.test(s) ||
        /^(living|alive|diseasefree|disease free|censored|no)$/i.test(s)
    )
        return false;
    return undefined;
}

export async function compareSurvival(input: {
    groups: { name: string; cohort: CohortSpec }[];
    endpoint?: string;
}) {
    const prefix = (input.endpoint ?? 'OS').toUpperCase();
    const { groups, overlapping } = await resolveGroups(input.groups);
    const months = `${prefix}_MONTHS`;
    const status = `${prefix}_STATUS`;
    const studyIds = [...new Set(groups.flatMap(g => g.studyIds))];
    const attrs = await attributesOf(studyIds);
    if (!attrs.some(a => a.clinicalAttributeId === months)) {
        const available = [
            ...new Set(
                attrs
                    .filter(a => /_MONTHS$/.test(a.clinicalAttributeId))
                    .map(a => a.clinicalAttributeId.replace(/_MONTHS$/, ''))
            ),
        ];
        throw new ApiError(
            `No ${months} in ${studyIds.join(
                ', '
            )}. Survival endpoints there: ${available.join(', ') || 'none'}.`
        );
    }
    // Patients, once each; a patient in more than one group is left out.
    const patientGroups = new Map<string, number>();
    groups.forEach((g, i) => {
        for (const s of g.samples) {
            const k = patientKey(s);
            const prev = patientGroups.get(k);
            patientGroups.set(k, prev === undefined || prev === i ? i : -1);
        }
    });
    const overlappingPatients = [...patientGroups.values()].filter(
        v => v === -1
    ).length;
    const representative = new Map<string, Sample>();
    for (const g of groups)
        for (const s of g.samples)
            if (!representative.has(patientKey(s)))
                representative.set(patientKey(s), s);
    const values = await fetchClinicalValues(
        [...representative.values()],
        [months, status]
    );
    const data: SurvivalEvent[][] = groups.map(() => []);
    for (const [k, gi] of patientGroups) {
        if (gi < 0) continue;
        const s = representative.get(k)!;
        const v = values.get(sampleKey(s));
        const m = Number(v?.get(months));
        const e = survivalEvent(v?.get(status));
        if (!isFinite(m) || e === undefined) continue;
        data[gi].push({ months: m, event: e });
    }
    const curves = data.map(d => kaplanMeier(d));
    const test = groups.length > 1 ? logRank(data) : undefined;
    return {
        endpoint: prefix,
        groups: groups.map((g, i) => ({
            name: g.name,
            cohort: g.description,
            patientsWithData: curves[i].n,
            events: curves[i].events,
            medianMonths: curves[i].medianMonths ?? 'not reached',
            survivalAt: curves[i].at.map(a => ({
                months: a.months,
                percent: Math.round(a.survival * 1000) / 10,
            })),
        })),
        ...(test
            ? {
                  logRankPValue: round(test.pValue),
                  ...(test.hazardRatio
                      ? {
                            hazardRatio: {
                                of: groups[1].name,
                                versus: groups[0].name,
                                ratio: round(test.hazardRatio.ratio),
                                ci95: [
                                    round(test.hazardRatio.low),
                                    round(test.hazardRatio.high),
                                ],
                            },
                        }
                      : {}),
              }
            : {}),
        ...(overlapping ? { overlappingSamplesExcluded: overlapping } : {}),
        ...(overlappingPatients
            ? { overlappingPatientsExcluded: overlappingPatients }
            : {}),
        note:
            'Kaplan-Meier medians and the log-rank test, computed as cBioPortal’s survival tab does; the hazard ratio is the log-rank (O/E) estimate.',
        source: SOURCE,
    };
}

function bySampleStudy(samples: Sample[]) {
    const byStudy = new Map<string, Sample[]>();
    for (const s of samples) {
        if (!byStudy.has(s.studyId)) byStudy.set(s.studyId, []);
        byStudy.get(s.studyId)!.push(s);
    }
    return [...byStudy.entries()].map(([name, list]) => ({
        name,
        samples: list,
    }));
}

// --- Tool 7: clinical values ---

export async function clinicalValues(input: {
    cohort?: CohortSpec;
    attribute: string;
    groupBy?: string;
    groups?: { name: string; cohort: CohortSpec }[];
    versus?: string;
    perPatient?: boolean;
}) {
    const attribute = input.attribute.toUpperCase();
    let groups: { name: string; samples: Sample[]; description?: string }[];
    let studyIds: string[];
    if (input.groups?.length) {
        const r = await resolveGroups(input.groups);
        groups = r.groups.map(g => ({
            name: g.name,
            samples: g.samples,
            description: g.description,
        }));
        studyIds = [...new Set(r.groups.flatMap(g => g.studyIds))];
    } else {
        if (!input.cohort) throw new ApiError('Give a cohort or groups.');
        const cohort = await resolveCohort(input.cohort);
        studyIds = cohort.studyIds;
        groups =
            input.groupBy?.toLowerCase() === 'study'
                ? bySampleStudy(cohort.samples)
                : input.groupBy
                ? (await splitBy(cohort, input.groupBy)).map(g => ({
                      name: g.value,
                      samples: g.samples,
                  }))
                : [
                      {
                          name: 'cohort',
                          samples: cohort.samples,
                          description: cohort.description,
                      },
                  ];
    }
    const attrs = await attributesOf(studyIds);
    const meta = attrs.find(a => a.clinicalAttributeId === attribute);
    if (!meta) {
        throw new ApiError(
            `No clinical attribute "${input.attribute}" in ${studyIds.join(
                ', '
            )}. Some there: ${[
                ...new Set(attrs.map(a => a.clinicalAttributeId)),
            ]
                .slice(0, 60)
                .join(', ')}.`
        );
    }
    const allSamples = groups.flatMap(g => g.samples);
    const wanted = [
        attribute,
        ...(input.versus ? [input.versus.toUpperCase()] : []),
    ];
    const values = await fetchClinicalValues(allSamples, wanted);
    const patientLevel = meta.patientAttribute;
    const unitOf = (samples: Sample[]) => {
        if (!patientLevel) return samples;
        const seen = new Map<string, Sample>();
        for (const s of samples)
            if (!seen.has(patientKey(s))) seen.set(patientKey(s), s);
        return [...seen.values()];
    };
    if (input.perPatient && !patientLevel) {
        // Patients by the set of values their samples have (e.g. Primary +
        // Metastasis).
        const combos = new Map<string, number>();
        const perPatient = new Map<string, Set<string>>();
        for (const s of allSamples) {
            const v = values.get(sampleKey(s))?.get(attribute);
            if (!v) continue;
            if (!perPatient.has(patientKey(s)))
                perPatient.set(patientKey(s), new Set());
            perPatient.get(patientKey(s))!.add(v);
        }
        const samplesPerPatient = new Map<number, number>();
        const counts = new Map<string, number>();
        for (const s of allSamples)
            counts.set(patientKey(s), (counts.get(patientKey(s)) ?? 0) + 1);
        for (const n of counts.values())
            samplesPerPatient.set(n, (samplesPerPatient.get(n) ?? 0) + 1);
        for (const set of perPatient.values()) {
            const key = [...set].sort().join(' + ');
            combos.set(key, (combos.get(key) ?? 0) + 1);
        }
        return {
            attribute,
            patients: counts.size,
            samples: allSamples.length,
            patientsBySampleCount: Object.fromEntries(
                [...samplesPerPatient.entries()].sort((a, b) => a[0] - b[0])
            ),
            patientsByValueCombination: Object.fromEntries(
                [...combos.entries()].sort((a, b) => b[1] - a[1])
            ),
            source: SOURCE,
        };
    }
    const numeric = meta.datatype === 'NUMBER';
    const header = {
        attribute,
        name: meta.displayName,
        level: patientLevel ? 'patient' : 'sample',
    };
    if (input.versus) {
        const other = input.versus.toUpperCase();
        const units = unitOf(allSamples);
        const x: number[] = [];
        const y: number[] = [];
        for (const s of units) {
            const v = values.get(sampleKey(s));
            const a = Number(v?.get(attribute));
            const b = Number(v?.get(other));
            if (
                isFinite(a) &&
                isFinite(b) &&
                v?.get(attribute) !== '' &&
                v?.get(other) !== ''
            ) {
                x.push(a);
                y.push(b);
            }
        }
        const p = pearson(x, y);
        const s = spearman(x, y);
        return {
            ...header,
            versus: other,
            pairs: x.length,
            pearson: p && { r: round(p.r), p: round(p.p) },
            spearman: s && { rho: round(s.r), p: round(s.p) },
            source: SOURCE,
        };
    }
    if (numeric) {
        const perGroup = groups.map(g => {
            const nums = unitOf(g.samples)
                .map(s => values.get(sampleKey(s))?.get(attribute))
                .filter(
                    (v): v is string =>
                        v !== undefined && v !== '' && isFinite(Number(v))
                )
                .map(Number);
            return { name: g.name, nums };
        });
        const test =
            perGroup.length === 2
                ? {
                      test: 'Wilcoxon rank-sum',
                      pValue: round(
                          wilcoxon(perGroup[0].nums, perGroup[1].nums)
                      ),
                  }
                : perGroup.length > 2
                ? {
                      test: 'Kruskal-Wallis',
                      pValue: round(kruskalWallis(perGroup.map(g => g.nums))),
                  }
                : undefined;
        return {
            ...header,
            groups: perGroup.map(g => ({
                group: g.name,
                ...roundSummary(summarize(g.nums)),
            })),
            ...(test ? { comparison: test } : {}),
            source: SOURCE,
        };
    }
    const categories = new Set<string>();
    const perGroup = groups.map(g => {
        const counts = new Map<string, number>();
        for (const s of unitOf(g.samples)) {
            const v = values.get(sampleKey(s))?.get(attribute);
            if (v === undefined || v === '') continue;
            categories.add(v);
            counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        return { name: g.name, counts };
    });
    const cats = [...categories];
    const table = perGroup.map(g => cats.map(c => g.counts.get(c) ?? 0));
    return {
        ...header,
        groups: perGroup.map(g => {
            const total = [...g.counts.values()].reduce((s, v) => s + v, 0);
            return {
                group: g.name,
                withValue: total,
                values: [...g.counts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([value, count]) => ({
                        value,
                        count,
                        percent: pct(count, total),
                    })),
            };
        }),
        ...(perGroup.length > 1
            ? {
                  comparison: {
                      test: 'chi-squared',
                      pValue: round(chiSquareTest(table)),
                  },
              }
            : {}),
        source: SOURCE,
    };
}

// --- Tool 8: molecular values ---

const MOLECULAR = ['mrna', 'protein', 'cna_log2', 'cna_discrete'] as const;
type Molecular = typeof MOLECULAR[number];

async function molecularData(samples: Sample[], gene: Gene, kind: Molecular) {
    const byStudy = new Map<string, Sample[]>();
    for (const s of samples) {
        if (!byStudy.has(s.studyId)) byStudy.set(s.studyId, []);
        byStudy.get(s.studyId)!.push(s);
    }
    const out = new Map<string, number>();
    const profiles: string[] = [];
    await mapLimit([...byStudy.entries()], 6, async ([studyId, list]) => {
        const p = await profileFor(
            studyId,
            kind === 'cna_discrete' ? 'cna' : (kind as ProfileKind)
        );
        if (!p) return;
        profiles.push(p.molecularProfileId);
        const rows = await apiPost<
            { sampleId: string; studyId: string; value: number | string }[]
        >(
            `/molecular-profiles/${p.molecularProfileId}/molecular-data/fetch?projection=SUMMARY`,
            {
                entrezGeneIds: [gene.entrezGeneId],
                sampleIds: list.map(s => s.sampleId),
            }
        );
        for (const r of rows) {
            const v = Number(r.value);
            if (isFinite(v))
                out.set(sampleKey({ studyId, sampleId: r.sampleId }), v);
        }
    });
    return { values: out, profiles };
}

const CNA_LEVELS: Record<string, string> = {
    '-2': 'deep deletion',
    '-1': 'shallow deletion',
    '0': 'diploid',
    '1': 'gain',
    '2': 'amplification',
};

export async function molecularValues(input: {
    gene: string;
    dataType: Molecular;
    cohort?: CohortSpec;
    groupBy?: string;
    groups?: { name: string; cohort: CohortSpec }[];
    versus?: { gene?: string; dataType?: Molecular; attribute?: string };
    log2?: boolean;
}) {
    const gene = await resolveGene(input.gene);
    let groups: { name: string; samples: Sample[] }[];
    if (input.groups?.length) {
        groups = (await resolveGroups(input.groups)).groups.map(g => ({
            name: g.name,
            samples: g.samples,
        }));
    } else {
        if (!input.cohort) throw new ApiError('Give a cohort or groups.');
        const cohort = await resolveCohort(input.cohort);
        if (input.groupBy?.toLowerCase() === 'study') {
            groups = bySampleStudy(cohort.samples);
        } else {
            groups = input.groupBy
                ? (await splitBy(cohort, input.groupBy)).map(g => ({
                      name: g.value,
                      samples: g.samples,
                  }))
                : [{ name: 'cohort', samples: cohort.samples }];
        }
    }
    const all = groups.flatMap(g => g.samples);
    const { values, profiles } = await molecularData(all, gene, input.dataType);
    if (profiles.length === 0) {
        throw new ApiError(`No ${input.dataType} profile in these studies.`);
    }
    const log = input.log2 ?? input.dataType === 'mrna';
    const transform = (v: number) =>
        log && input.dataType === 'mrna' ? Math.log2(v + 1) : v;
    const header = {
        gene: gene.hugoGeneSymbol,
        dataType: input.dataType,
        profiles: profiles.slice(0, 10),
        ...(log && input.dataType === 'mrna'
            ? { scale: 'log2(value + 1)' }
            : {}),
    };
    if (input.versus) {
        let other: Map<string, number>;
        let label: string;
        if (input.versus.attribute) {
            const attribute = input.versus.attribute.toUpperCase();
            const clinical = await fetchClinicalValues(all, [attribute]);
            other = new Map();
            for (const [k, m] of clinical) {
                const v = Number(m.get(attribute));
                if (
                    m.get(attribute) !== undefined &&
                    m.get(attribute) !== '' &&
                    isFinite(v)
                )
                    other.set(k, v);
            }
            label = attribute;
        } else {
            const g2 = input.versus.gene
                ? await resolveGene(input.versus.gene)
                : gene;
            const kind = input.versus.dataType ?? input.dataType;
            const res = await molecularData(all, g2, kind);
            other = new Map(
                [...res.values].map(([k, v]) => [
                    k,
                    kind === 'mrna' && log ? Math.log2(v + 1) : v,
                ])
            );
            label = `${g2.hugoGeneSymbol} ${kind}`;
        }
        const x: number[] = [];
        const y: number[] = [];
        for (const s of all) {
            const a = values.get(sampleKey(s));
            const b = other.get(sampleKey(s));
            if (a !== undefined && b !== undefined) {
                x.push(transform(a));
                y.push(b);
            }
        }
        const p = pearson(x, y);
        const sp = spearman(x, y);
        return {
            ...header,
            versus: label,
            samplesWithBoth: x.length,
            pearson: p && { r: round(p.r), p: round(p.p) },
            spearman: sp && { rho: round(sp.r), p: round(sp.p) },
            source: SOURCE,
        };
    }
    if (input.dataType === 'cna_discrete') {
        return {
            ...header,
            groups: groups.map(g => {
                const counts = new Map<string, number>();
                let profiled = 0;
                for (const s of g.samples) {
                    const v = values.get(sampleKey(s));
                    if (v === undefined) continue;
                    profiled++;
                    const level =
                        CNA_LEVELS[String(Math.round(v))] ?? String(v);
                    counts.set(level, (counts.get(level) ?? 0) + 1);
                }
                return {
                    group: g.name,
                    profiledSamples: profiled,
                    patients: countPatients(
                        g.samples.filter(s => values.has(sampleKey(s)))
                    ),
                    levels: Object.fromEntries(
                        Object.values(CNA_LEVELS).map(l => [
                            l,
                            {
                                samples: counts.get(l) ?? 0,
                                percent: pct(counts.get(l) ?? 0, profiled),
                            },
                        ])
                    ),
                };
            }),
            source: SOURCE,
        };
    }
    const perGroup = groups.map(g => ({
        name: g.name,
        nums: g.samples
            .map(s => values.get(sampleKey(s)))
            .filter((v): v is number => v !== undefined)
            .map(transform),
    }));
    const test =
        perGroup.length === 2
            ? {
                  test: 'Wilcoxon rank-sum',
                  pValue: round(wilcoxon(perGroup[0].nums, perGroup[1].nums)),
              }
            : perGroup.length > 2
            ? {
                  test: 'Kruskal-Wallis',
                  pValue: round(kruskalWallis(perGroup.map(g => g.nums))),
              }
            : undefined;
    return {
        ...header,
        groups: perGroup
            .map(g => ({ group: g.name, ...roundSummary(summarize(g.nums)) }))
            .sort((a, b) => (b.median ?? -Infinity) - (a.median ?? -Infinity)),
        ...(test ? { comparison: test } : {}),
        source: SOURCE,
    };
}

// --- The tool set ---

const levelSchema = z
    .enum(['sample', 'patient'])
    .optional()
    .describe('Count samples (default, as the portal’s tables) or patients');

export const dataTools: ToolSet = {
    find_studies: tool({
        description:
            'Searches cBioPortal’s studies: by keywords (cancer type, name, consortium such as TCGA, TARGET, MSK; "pediatric"), by data they have, by a clinical attribute, by publication year. Returns how many match, their cancer types, and each study’s id, sample count, data types, citation and link. Use it for "which studies…", "how many studies…", and to find study ids before the other data tools.',
        inputSchema: z.object({
            query: z
                .string()
                .optional()
                .describe(
                    'Keywords that must all appear, e.g. "lung adenocarcinoma", "tcga pancan", "target"'
                ),
            requiresData: z
                .array(z.enum(DATA_TYPES))
                .optional()
                .describe('Data every returned study must have'),
            clinicalAttribute: z
                .string()
                .optional()
                .describe(
                    'Keep studies with a clinical attribute whose id or name contains this, e.g. "race", "smoking", "MSI"'
                ),
            publishedSince: z
                .number()
                .optional()
                .describe('Citation year at least this'),
            limit: z
                .number()
                .optional()
                .describe('Studies to list (default 25)'),
        }),
        execute: input => run(() => findStudies(input)),
    }),
    cohort_overview: tool({
        description:
            'Summarizes a cohort (one or more studies, optionally filtered by clinical values or gene status): sample and patient counts, data available, most frequently mutated, copy-number-altered and structurally rearranged genes with altered/profiled counts, clinical makeup, optionally treatments, and the frequencies of genes you name. The numbers match the Study View’s tables for the same filters. Use it for overviews ("what characterizes…", "top mutated genes in…").',
        inputSchema: z.object({
            cohort: CohortSchema,
            top: z
                .number()
                .optional()
                .describe('Genes per table (default 10)'),
            genes: z
                .array(z.string())
                .optional()
                .describe(
                    'Genes to report mutation, amplification and deep-deletion frequencies for'
                ),
            attributes: z
                .array(z.string())
                .optional()
                .describe(
                    'Clinical attributes to count, besides cancer type, sample type, sex and subtype'
                ),
            treatments: z
                .boolean()
                .optional()
                .describe('Also list the most common treatment agents'),
        }),
        execute: input => run(() => cohortOverview(input)),
    }),
    gene_frequency: tool({
        description:
            'How often a gene is altered (mutated, amplified, deleted, rearranged, or any) in a cohort, out of the samples profiled for it, optionally broken down by a clinical attribute such as cancer type, subtype, sample type, sex or smoking history, each group with its own denominator. Pools several studies by counts. Use it for "how often is X altered in Y", "which cancer types have the most X alterations".',
        inputSchema: z.object({
            gene: z.string(),
            alteration: z
                .enum(ALTERATIONS)
                .optional()
                .describe('Default mutation'),
            cohort: CohortSchema,
            groupBy: groupBySchema,
            level: levelSchema,
        }),
        execute: input => run(() => geneFrequency(input)),
    }),
    gene_mutations: tool({
        description:
            'The mutations of one gene in a cohort: how many samples are mutated out of those profiled, the most frequent protein changes (hotspots), mutation types, somatic/germline status, variant allele frequencies, a specific variant’s frequency ("V600E", or a codon like "G12") overall or by a clinical attribute, and optionally the samples with links to their patient pages. Use it for variant-level questions.',
        inputSchema: z.object({
            gene: z.string(),
            cohort: CohortSchema,
            variant: z
                .string()
                .optional()
                .describe('Only this protein change or codon'),
            excludeVariant: z
                .string()
                .optional()
                .describe(
                    'Leave out this protein change or codon (e.g. "G12")'
                ),
            mutationStatus: z.enum(['any', 'somatic', 'germline']).optional(),
            groupBy: groupBySchema,
            top: z
                .number()
                .optional()
                .describe('Protein changes to list (default 15)'),
            listSamples: z
                .boolean()
                .optional()
                .describe('List the mutated samples (up to 60)'),
        }),
        execute: input => run(() => geneMutations(input)),
    }),
    compare_groups: tool({
        description:
            'Compares two or more groups of samples as cBioPortal’s Group Comparison does: genes whose mutation, amplification or deep-deletion frequency differs (with each group’s altered/profiled counts, p and q values), clinical attributes that differ, and genes whose mRNA or protein levels differ. Define each group as a cohort (e.g. KRAS mutant vs KRAS unaltered in a study, or two cancer types). Use it for "what differs between…", "what else is altered in X-mutant tumors".',
        inputSchema: z.object({
            groups: GroupsSchema,
            analyses: z
                .array(z.enum(COMPARISONS))
                .optional()
                .describe(
                    'Default: mutations, amplifications, deep_deletions, clinical'
                ),
            top: z
                .number()
                .optional()
                .describe('Rows per analysis (default 10)'),
        }),
        execute: input => run(() => compareGroups(input)),
    }),
    gene_cooccurrence: tool({
        description:
            'Whether genes’ alterations co-occur or are mutually exclusive in a cohort: for each pair, the 2×2 counts over samples profiled for them (both, only one, neither), the odds ratio, and one-sided Fisher p and q values as cBioPortal’s Mutual Exclusivity tab. Give genes, or topGenes to use the cohort’s most frequently mutated genes (pairs sorted by how often they occur together).',
        inputSchema: z.object({
            genes: z.array(z.string()).optional(),
            topGenes: z
                .number()
                .optional()
                .describe(
                    'Use the N most frequently mutated genes (max 12) instead of naming genes'
                ),
            alteration: z
                .enum(ALTERATIONS)
                .optional()
                .describe('Default mutation'),
            cohort: CohortSchema,
        }),
        execute: input => run(() => geneCooccurrence(input)),
    }),
    compare_survival: tool({
        description:
            'Survival of one or more groups of patients: per group the patients with data, events, Kaplan-Meier median (or "not reached") and survival at 1, 3 and 5 years; for two or more groups the log-rank p-value, and for two the hazard ratio of the second group vs the first. Endpoint OS by default (also DFS, PFS, DSS when the study has them). Use it for any survival question instead of estimating.',
        inputSchema: z.object({
            groups: GroupsSchema,
            endpoint: z
                .string()
                .optional()
                .describe('OS (default), DFS, PFS, DSS…'),
        }),
        execute: input => run(() => compareSurvival(input)),
    }),
    clinical_values: tool({
        description:
            'One clinical attribute’s values in a cohort: for numbers (age, TMB, aneuploidy score…) the median, mean and quartiles, for categories the counts and percentages; per group (groupBy an attribute, or groups defined as cohorts, e.g. IDH1 mutant vs wild-type) with a Wilcoxon, Kruskal-Wallis or chi-squared test; or its correlation (Pearson and Spearman) with another numeric attribute (versus). perPatient: patients by the combination of their samples’ values (e.g. how many have both a primary and a metastasis sample).',
        inputSchema: z.object({
            cohort: CohortSchema.optional().describe(
                'The cohort (omit when giving groups)'
            ),
            attribute: z.string(),
            groupBy: z
                .string()
                .optional()
                .describe('A categorical attribute, or "study" for each study'),
            groups: GroupsSchema.optional().describe(
                'Instead of groupBy: groups defined as cohorts; cohort is then ignored'
            ),
            versus: z
                .string()
                .optional()
                .describe('A numeric attribute to correlate with'),
            perPatient: z.boolean().optional(),
        }),
        execute: input => run(() => clinicalValues(input)),
    }),
    molecular_values: tool({
        description:
            'A gene’s mRNA expression, protein level (RPPA), log2 copy number or discrete copy-number calls (deep deletion, shallow deletion, diploid, gain, amplification) in a cohort: summaries per group (groupBy an attribute, "study" for each study, or groups defined as cohorts) with a Wilcoxon or Kruskal-Wallis test, counts per copy-number level, or the correlation with another gene’s or data type’s values or a numeric clinical attribute (versus).',
        inputSchema: z.object({
            gene: z.string(),
            dataType: z.enum(MOLECULAR),
            cohort: CohortSchema.optional().describe(
                'The cohort (omit when giving groups)'
            ),
            groupBy: z.string().optional(),
            groups: GroupsSchema.optional().describe(
                'Instead of groupBy: groups defined as cohorts; cohort is then ignored'
            ),
            versus: z
                .object({
                    gene: z.string().optional(),
                    dataType: z.enum(MOLECULAR).optional(),
                    attribute: z.string().optional(),
                })
                .optional(),
            log2: z
                .boolean()
                .optional()
                .describe('mRNA: use log2(value + 1) (default true)'),
        }),
        execute: input => run(() => molecularValues(input)),
    }),
};

export const DATA_TOOL_NAMES = Object.keys(dataTools);
