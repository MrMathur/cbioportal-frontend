// A cohort as the tools describe it (studies, clinical filters, gene
// conditions) turned into the samples it holds and into the Study View
// filter that selects them, so the tools' numbers are the ones cBioPortal's
// own pages compute for the same selection.

import { z } from 'zod';
import {
    ApiError,
    apiPost,
    attributesOf,
    ClinicalAttribute,
    Gene,
    mapLimit,
    PORTAL_URL,
    profileFor,
    ProfileKind,
    resolveGene,
    resolveStudyIds,
} from './api.js';

export const ALTERATIONS = [
    'mutation',
    'amplification',
    'gain',
    'deep_deletion',
    'shallow_deletion',
    'cna',
    'structural_variant',
    'any',
] as const;
export type Alteration = typeof ALTERATIONS[number];

export const CohortSchema = z.object({
    studies: z
        .array(z.string())
        .min(1)
        .describe(
            'Study ids (from find_studies or the page), or "tcga_pancan" for the 32 TCGA PanCancer Atlas studies. Several studies are pooled.'
        ),
    clinical: z
        .array(
            z.object({
                attribute: z
                    .string()
                    .describe(
                        'Clinical attribute id, e.g. CANCER_TYPE, CANCER_TYPE_DETAILED, ONCOTREE_CODE, SAMPLE_TYPE, SEX, SMOKING_HISTORY'
                    ),
                values: z
                    .array(z.string())
                    .optional()
                    .describe(
                        'Keep samples with any of these values (case-insensitive)'
                    ),
                min: z
                    .number()
                    .optional()
                    .describe('Numeric attributes: keep values ≥ min'),
                max: z
                    .number()
                    .optional()
                    .describe('Numeric attributes: keep values ≤ max'),
            })
        )
        .optional()
        .describe('All conditions must hold'),
    genes: z
        .array(
            z.object({
                gene: z.string().describe('HUGO symbol'),
                alteration: z
                    .enum(ALTERATIONS)
                    .default('mutation')
                    .describe(
                        'cna = amplification or deep deletion; any = mutation, amplification, deep deletion or structural variant'
                    ),
                variant: z
                    .string()
                    .optional()
                    .describe(
                        'Mutations only: a protein change ("V600E") or a codon ("G12") the mutation must match'
                    ),
                status: z
                    .enum(['altered', 'unaltered'])
                    .default('altered')
                    .describe(
                        'unaltered: profiled for this alteration type and not altered (wild-type)'
                    ),
            })
        )
        .optional()
        .describe('All conditions must hold'),
});
export type CohortSpec = z.input<typeof CohortSchema>;

export interface Sample {
    sampleId: string;
    patientId: string;
    studyId: string;
}

export const sampleKey = (s: { studyId: string; sampleId: string }) =>
    `${s.studyId}:${s.sampleId}`;
export const patientKey = (s: { studyId: string; patientId: string }) =>
    `${s.studyId}:${s.patientId}`;

export interface StudyViewFilter {
    studyIds: string[];
    clinicalDataFilters?: {
        attributeId: string;
        values: { value?: string; start?: number; end?: number }[];
    }[];
    geneFilters?: {
        molecularProfileIds: string[];
        geneQueries: {
            hugoGeneSymbol: string;
            entrezGeneId: number;
            alterations: string[];
        }[][];
    }[];
    genomicProfiles?: string[][];
    sampleIdentifiers?: { studyId: string; sampleId: string }[];
}

const CNA_ALTERATIONS: Partial<Record<Alteration, string[]>> = {
    amplification: ['AMP'],
    gain: ['GAIN'],
    deep_deletion: ['HOMDEL'],
    shallow_deletion: ['HETLOSS'],
    cna: ['AMP', 'HOMDEL'],
};

function kindOf(alteration: Alteration): ProfileKind {
    if (alteration === 'mutation') return 'mutations';
    if (alteration === 'structural_variant') return 'structural_variants';
    return 'cna';
}

/**
 * The filter as the API takes it: a cohort given by sample ids carries no
 * study ids (some endpoints reject both).
 */
export function wire(filter: StudyViewFilter): StudyViewFilter {
    if (!filter.sampleIdentifiers) return filter;
    const { studyIds: _studyIds, ...rest } = filter;
    return rest as StudyViewFilter;
}

export const fetchSamples = (filter: StudyViewFilter) =>
    (filter.sampleIdentifiers && filter.sampleIdentifiers.length === 0
        ? Promise.resolve([] as Sample[])
        : apiPost<Sample[]>('/filtered-samples/fetch', wire(filter))
    ).then(list =>
        list.map(s => ({
            sampleId: s.sampleId,
            patientId: s.patientId,
            studyId: s.studyId,
        }))
    );

/** The study's profile ids of a kind, one per study that has one. */
export async function profileIds(
    studyIds: string[],
    kind: ProfileKind
): Promise<string[]> {
    const profiles = await Promise.all(studyIds.map(s => profileFor(s, kind)));
    return profiles
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map(p => p.molecularProfileId);
}

/** genomicProfiles entry selecting samples profiled for a kind. */
async function profiledClause(
    studyIds: string[],
    kinds: ProfileKind[]
): Promise<string[]> {
    const suffixes = new Set<string>();
    for (const kind of kinds) {
        for (const studyId of studyIds) {
            const p = await profileFor(studyId, kind);
            if (p) suffixes.add(p.molecularProfileId.slice(studyId.length + 1));
        }
    }
    return [...suffixes];
}

/**
 * Samples whose discrete copy-number call for the gene is `level` (1 gain,
 * -1 shallow deletion), among those given: the Study View filters only hold
 * amplifications and deep deletions.
 */
export async function discreteCnaSamples(
    samples: Sample[],
    gene: Gene,
    level: number
): Promise<Set<string>> {
    const byStudy = new Map<string, Sample[]>();
    for (const s of samples) {
        if (!byStudy.has(s.studyId)) byStudy.set(s.studyId, []);
        byStudy.get(s.studyId)!.push(s);
    }
    const out = new Set<string>();
    for (const [studyId, list] of byStudy) {
        const p = await profileFor(studyId, 'cna');
        if (!p) continue;
        const rows = await apiPost<
            { sampleId: string; value: number | string }[]
        >(
            `/molecular-profiles/${p.molecularProfileId}/molecular-data/fetch?projection=SUMMARY`,
            {
                entrezGeneIds: [gene.entrezGeneId],
                sampleIds: list.map(s => s.sampleId),
            }
        );
        for (const r of rows) {
            if (Number(r.value) === level) out.add(`${studyId}:${r.sampleId}`);
        }
    }
    return out;
}

/** Matches a protein change against "V600E" (exact) or "G12" (codon). */
export function variantMatcher(variant: string): (change: string) => boolean {
    const v = variant
        .trim()
        .replace(/^p\./i, '')
        .toUpperCase();
    if (/^[A-Z*]\d+$/.test(v)) {
        const re = new RegExp(`^${v.replace('*', '\\*')}(?![0-9])`);
        return change => re.test(change.toUpperCase());
    }
    return change => change.toUpperCase() === v;
}

export interface Mutation {
    sampleId: string;
    patientId: string;
    studyId: string;
    proteinChange: string;
    mutationType: string;
    mutationStatus?: string;
    tumorAltCount?: number;
    tumorRefCount?: number;
    variantType?: string;
    chr?: string;
    startPosition?: number;
    referenceAllele?: string;
    variantAllele?: string;
}

export async function fetchMutations(
    studyIds: string[],
    gene: Gene
): Promise<Mutation[]> {
    const ids = await profileIds(studyIds, 'mutations');
    if (ids.length === 0) return [];
    return apiPost<Mutation[]>('/mutations/fetch?projection=SUMMARY', {
        molecularProfileIds: ids,
        entrezGeneIds: [gene.entrezGeneId],
    });
}

/** Clinical values of the given attributes for samples (and their patients). */
export async function fetchClinicalValues(
    samples: Sample[],
    attributeIds: string[]
): Promise<Map<string, Map<string, string>>> {
    // key: sampleKey → attributeId → value
    const out = new Map<string, Map<string, string>>();
    if (samples.length === 0 || attributeIds.length === 0) return out;
    const studyIds = [...new Set(samples.map(s => s.studyId))];
    const attrs = await attributesOf(studyIds);
    const isPatient = (id: string) =>
        attrs.find(a => a.clinicalAttributeId === id)?.patientAttribute ??
        false;
    const sampleAttrs = attributeIds.filter(a => !isPatient(a));
    const patientAttrs = attributeIds.filter(a => isPatient(a));
    const chunks = <T>(list: T[], size: number) =>
        Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
            list.slice(i * size, i * size + size)
        );
    for (const s of samples) out.set(sampleKey(s), new Map());
    if (sampleAttrs.length) {
        const rows = (
            await mapLimit(chunks(samples, 5000), 4, chunk =>
                apiPost<
                    {
                        sampleId: string;
                        studyId: string;
                        clinicalAttributeId: string;
                        value: string;
                    }[]
                >('/clinical-data/fetch?clinicalDataType=SAMPLE', {
                    attributeIds: sampleAttrs,
                    identifiers: chunk.map(s => ({
                        entityId: s.sampleId,
                        studyId: s.studyId,
                    })),
                })
            )
        ).flat();
        for (const r of rows) {
            out.get(sampleKey(r))?.set(r.clinicalAttributeId, r.value);
        }
    }
    if (patientAttrs.length) {
        const patients = [
            ...new Map(samples.map(s => [patientKey(s), s])).values(),
        ];
        const rows = (
            await mapLimit(chunks(patients, 5000), 4, chunk =>
                apiPost<
                    {
                        patientId: string;
                        studyId: string;
                        clinicalAttributeId: string;
                        value: string;
                    }[]
                >('/clinical-data/fetch?clinicalDataType=PATIENT', {
                    attributeIds: patientAttrs,
                    identifiers: chunk.map(s => ({
                        entityId: s.patientId,
                        studyId: s.studyId,
                    })),
                })
            )
        ).flat();
        const byPatient = new Map<string, Map<string, string>>();
        for (const r of rows) {
            const k = patientKey(r);
            if (!byPatient.has(k)) byPatient.set(k, new Map());
            byPatient.get(k)!.set(r.clinicalAttributeId, r.value);
        }
        for (const s of samples) {
            const values = byPatient.get(patientKey(s));
            if (!values) continue;
            const target = out.get(sampleKey(s))!;
            for (const [k, v] of values) target.set(k, v);
        }
    }
    return out;
}

/** An attribute's values in the studies, with sample counts. */
export async function attributeCounts(
    filter: StudyViewFilter,
    attributeId: string
): Promise<{ value: string; count: number }[]> {
    const res = await apiPost<
        { attributeId: string; counts: { value: string; count: number }[] }[]
    >('/clinical-data-counts/fetch', {
        attributes: [{ attributeId }],
        studyViewFilter: wire(filter),
    });
    return (res[0]?.counts ?? []).sort((a, b) => b.count - a.count);
}

export interface ResolvedCohort {
    studyIds: string[];
    samples: Sample[];
    // Selects exactly these samples: the plain filter when it says it all,
    // else their sample ids.
    filter: StudyViewFilter;
    // The filter as cBioPortal shows it, for a Study View link; undefined
    // when it needs a list of sample ids too long for a link.
    linkFilter?: StudyViewFilter;
    description: string;
    attributes: ClinicalAttribute[];
}

const LINK_MAX_SAMPLES = 300;

export function studyViewLink(filter: StudyViewFilter): string {
    return `${PORTAL_URL}/study/summary?id=${filter.studyIds.join(
        ','
    )}#filterJson=${encodeURIComponent(JSON.stringify(filter))}`;
}

export async function resolveCohort(spec: CohortSpec): Promise<ResolvedCohort> {
    const studyIds = await resolveStudyIds(spec.studies);
    const attributes = await attributesOf(studyIds);
    const base: StudyViewFilter = { studyIds };
    const described: string[] = [];
    const numeric: { attribute: string; min?: number; max?: number }[] = [];

    for (const c of spec.clinical ?? []) {
        const attribute = c.attribute.trim().toUpperCase();
        const meta = attributes.find(a => a.clinicalAttributeId === attribute);
        if (!meta) {
            const similar = [
                ...new Set(
                    attributes
                        .filter(
                            a =>
                                a.clinicalAttributeId.includes(
                                    attribute.split('_')[0]
                                ) ||
                                a.displayName
                                    .toLowerCase()
                                    .includes(c.attribute.toLowerCase())
                        )
                        .map(a => a.clinicalAttributeId)
                ),
            ].slice(0, 8);
            throw new ApiError(
                `No clinical attribute "${c.attribute}" in ${studyIds.join(
                    ', '
                )}.${similar.length ? ` Similar: ${similar.join(', ')}.` : ''}`
            );
        }
        if (c.values?.length) {
            const counts = await attributeCounts({ studyIds }, attribute);
            const values: string[] = [];
            for (const v of c.values) {
                const hit = counts.find(
                    x => x.value.toLowerCase() === v.trim().toLowerCase()
                );
                if (!hit) {
                    throw new ApiError(
                        `${attribute} has no value "${v}". Values: ${counts
                            .slice(0, 25)
                            .map(x => `${x.value} (${x.count})`)
                            .join(', ')}.`
                    );
                }
                values.push(hit.value);
            }
            base.clinicalDataFilters = [
                ...(base.clinicalDataFilters ?? []),
                {
                    attributeId: attribute,
                    values: values.map(value => ({ value })),
                },
            ];
            described.push(`${attribute} = ${values.join(' or ')}`);
        }
        if (c.min !== undefined || c.max !== undefined) {
            numeric.push({ attribute, min: c.min, max: c.max });
            described.push(
                `${attribute} ${
                    c.min !== undefined && c.max !== undefined
                        ? `${c.min}–${c.max}`
                        : c.min !== undefined
                        ? `≥ ${c.min}`
                        : `≤ ${c.max}`
                }`
            );
        }
    }

    // Altered-gene conditions the Study View filter can hold.
    const post: {
        gene: Gene;
        alteration: Alteration;
        variant?: string;
        status: 'altered' | 'unaltered';
    }[] = [];
    for (const g of spec.genes ?? []) {
        const gene = await resolveGene(g.gene);
        const alteration = g.alteration ?? 'mutation';
        const status = g.status ?? 'altered';
        if (g.variant && alteration !== 'mutation') {
            throw new ApiError('A variant can only be given for mutations.');
        }
        described.push(
            `${gene.hugoGeneSymbol}${g.variant ? ` ${g.variant}` : ''} ${
                status === 'altered' ? alteration : `not ${alteration}`
            }`
                .replace(' mutation', ' mutated')
                .replace('not mutation', 'wild-type')
        );
        if (
            status === 'altered' &&
            !g.variant &&
            !['any', 'gain', 'shallow_deletion'].includes(alteration)
        ) {
            const ids = await profileIds(studyIds, kindOf(alteration));
            if (ids.length === 0) {
                throw new ApiError(
                    `${studyIds.join(', ')} has no ${kindOf(alteration)} data.`
                );
            }
            base.geneFilters = [
                ...(base.geneFilters ?? []),
                {
                    molecularProfileIds: ids,
                    geneQueries: [
                        [
                            {
                                hugoGeneSymbol: gene.hugoGeneSymbol,
                                entrezGeneId: gene.entrezGeneId,
                                alterations: CNA_ALTERATIONS[alteration] ?? [],
                            },
                        ],
                    ],
                },
            ];
        } else {
            post.push({ gene, alteration, variant: g.variant, status });
        }
    }

    let samples = await fetchSamples(base);
    let exact = true;

    for (const p of post) {
        const kinds: ProfileKind[] =
            p.alteration === 'any'
                ? ['mutations', 'cna', 'structural_variants']
                : [kindOf(p.alteration)];
        const altered = new Set<string>();
        if (p.variant) {
            const matches = variantMatcher(p.variant);
            for (const m of await fetchMutations(studyIds, p.gene)) {
                if (matches(m.proteinChange ?? '')) altered.add(sampleKey(m));
            }
        } else if (
            p.alteration === 'gain' ||
            p.alteration === 'shallow_deletion'
        ) {
            for (const k of await discreteCnaSamples(
                samples,
                p.gene,
                p.alteration === 'gain' ? 1 : -1
            )) {
                altered.add(k);
            }
        } else {
            for (const kind of kinds) {
                const ids = await profileIds(studyIds, kind);
                if (ids.length === 0) continue;
                const alterations =
                    kind === 'cna'
                        ? p.alteration === 'any'
                            ? ['AMP', 'HOMDEL']
                            : CNA_ALTERATIONS[p.alteration] ?? []
                        : [];
                const hit = await fetchSamples({
                    ...base,
                    geneFilters: [
                        ...(base.geneFilters ?? []),
                        {
                            molecularProfileIds: ids,
                            geneQueries: [
                                [
                                    {
                                        hugoGeneSymbol: p.gene.hugoGeneSymbol,
                                        entrezGeneId: p.gene.entrezGeneId,
                                        alterations,
                                    },
                                ],
                            ],
                        },
                    ],
                });
                for (const s of hit) altered.add(sampleKey(s));
            }
        }
        if (p.status === 'altered') {
            samples = samples.filter(s => altered.has(sampleKey(s)));
        } else {
            const clause = await profiledClause(studyIds, kinds);
            const profiled = new Set(
                (
                    await fetchSamples({
                        ...base,
                        genomicProfiles: [
                            ...(base.genomicProfiles ?? []),
                            clause,
                        ],
                    })
                ).map(sampleKey)
            );
            samples = samples.filter(
                s => profiled.has(sampleKey(s)) && !altered.has(sampleKey(s))
            );
        }
        exact = false;
    }

    if (numeric.length) {
        const values = await fetchClinicalValues(
            samples,
            numeric.map(n => n.attribute)
        );
        samples = samples.filter(s => {
            const v = values.get(sampleKey(s));
            return numeric.every(n => {
                const x = Number(v?.get(n.attribute));
                if (!isFinite(x)) return false;
                return (
                    (n.min === undefined || x >= n.min) &&
                    (n.max === undefined || x <= n.max)
                );
            });
        });
        exact = false;
    }

    if (samples.length === 0) {
        throw new ApiError(
            `No samples match this cohort (${[
                studyIds.join(', '),
                ...described,
            ].join('; ')}).`
        );
    }
    const filter: StudyViewFilter = exact
        ? base
        : {
              studyIds,
              sampleIdentifiers: samples.map(s => ({
                  studyId: s.studyId,
                  sampleId: s.sampleId,
              })),
          };
    return {
        studyIds,
        samples,
        filter,
        linkFilter:
            exact || samples.length <= LINK_MAX_SAMPLES ? filter : undefined,
        description: [
            studyIds.length > 3
                ? `${studyIds.length} studies`
                : studyIds.join(', '),
            ...described,
        ].join('; '),
        attributes,
    };
}

export function countPatients(samples: Sample[]): number {
    return new Set(samples.map(patientKey)).size;
}

/** Splits a cohort into the groups of an attribute's values. */
export async function splitBy(
    cohort: ResolvedCohort,
    attributeId: string,
    maxGroups = 30
): Promise<{ value: string; samples: Sample[] }[]> {
    const attribute = attributeId.trim().toUpperCase();
    if (!cohort.attributes.some(a => a.clinicalAttributeId === attribute)) {
        throw new ApiError(
            `No clinical attribute "${attributeId}" in ${cohort.studyIds.join(
                ', '
            )}.`
        );
    }
    const values = await fetchClinicalValues(cohort.samples, [attribute]);
    const groups = new Map<string, Sample[]>();
    for (const s of cohort.samples) {
        const v = values.get(sampleKey(s))?.get(attribute);
        if (v === undefined || v === '' || /^(NA|N\/A)$/i.test(v)) continue;
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v)!.push(s);
    }
    return [...groups.entries()]
        .map(([value, samples]) => ({ value, samples }))
        .sort((a, b) => b.samples.length - a.samples.length)
        .slice(0, maxGroups);
}

export const asFilter = (
    studyIds: string[],
    samples: Sample[]
): StudyViewFilter => ({
    studyIds: [...new Set(samples.map(s => s.studyId))].length
        ? [...new Set(samples.map(s => s.studyId))]
        : studyIds,
    sampleIdentifiers: samples.map(s => ({
        studyId: s.studyId,
        sampleId: s.sampleId,
    })),
});
