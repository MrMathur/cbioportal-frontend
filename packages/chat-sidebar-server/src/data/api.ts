// Calls to the public cBioPortal API that the data tools are built on, with a
// short cache, and the catalogs they look things up in (studies, molecular
// profiles, clinical attributes, genes).

export const PORTAL_URL = (
    process.env.CBIOPORTAL_URL || 'https://www.cbioportal.org'
).replace(/\/$/, '');
const API_ROOT = `${PORTAL_URL}/api`;

const TIMEOUT_MS = 60_000;
const CACHE_MS = 30 * 60 * 1000;
const CACHE_MAX = 300;

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

export class ApiError extends Error {}

// The public API allows a client 3 connections at a time; more get 429.
const MAX_IN_FLIGHT = 3;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (inFlight >= MAX_IN_FLIGHT) {
        await new Promise<void>(resolve => waiting.push(resolve));
    }
    inFlight++;
    try {
        return await fn();
    } finally {
        inFlight--;
        waiting.shift()?.();
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function request<T>(path: string, body?: unknown): Promise<T> {
    const key = `${path}\n${body === undefined ? '' : JSON.stringify(body)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
    const value = (async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const res = await withSlot(() =>
                    fetch(`${API_ROOT}${path}`, {
                        method: body === undefined ? 'GET' : 'POST',
                        headers: {
                            Accept: 'application/json',
                            ...(body === undefined
                                ? {}
                                : { 'Content-Type': 'application/json' }),
                        },
                        body:
                            body === undefined
                                ? undefined
                                : JSON.stringify(body),
                        signal: AbortSignal.timeout(TIMEOUT_MS),
                    }).then(async r => ({
                        status: r.status,
                        ok: r.ok,
                        text: await r.text(),
                    }))
                );
                if (res.status === 429) {
                    lastError = new ApiError(
                        `cBioPortal API busy (429) for ${path}`
                    );
                    await sleep(500 * 2 ** attempt);
                    continue;
                }
                if (res.status >= 500) {
                    lastError = new ApiError(
                        `cBioPortal API ${res.status} for ${path}`
                    );
                    continue;
                }
                if (!res.ok) {
                    throw new ApiError(
                        `cBioPortal API ${
                            res.status
                        } for ${path}: ${res.text.slice(0, 300)}`
                    );
                }
                return JSON.parse(res.text) as T;
            } catch (err) {
                if (err instanceof ApiError) throw err;
                lastError = err;
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new ApiError(`cBioPortal API failed for ${path}`);
    })();
    cache.set(key, { at: Date.now(), value });
    value.catch(() => cache.delete(key));
    if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
}

export const apiGet = <T>(path: string) => request<T>(path);
export const apiPost = <T>(path: string, body: unknown) =>
    request<T>(path, body);

// --- Catalogs ---

export interface Study {
    studyId: string;
    name: string;
    description: string;
    citation?: string;
    pmid?: string;
    cancerTypeId: string;
    cancerType?: { name: string; parent?: string };
    allSampleCount: number;
    sequencedSampleCount: number;
    cnaSampleCount: number;
    mrnaRnaSeqV2SampleCount: number;
    mrnaRnaSeqSampleCount: number;
    mrnaMicroarraySampleCount: number;
    rppaSampleCount: number;
    massSpectrometrySampleCount: number;
    methylationHm27SampleCount: number;
    treatmentCount: number;
    structuralVariantCount: number;
    importDate?: string;
    groups?: string;
    resourceCounts?: { resourceId: string; count?: number }[] | null;
}

export interface MolecularProfile {
    molecularProfileId: string;
    studyId: string;
    molecularAlterationType: string;
    datatype: string;
    name: string;
    patientLevel?: boolean;
}

export interface ClinicalAttribute {
    clinicalAttributeId: string;
    displayName: string;
    description: string;
    datatype: string;
    patientAttribute: boolean;
    studyId: string;
}

export const getStudies = () =>
    apiGet<Study[]>('/studies?projection=DETAILED&pageSize=100000');

export const getMolecularProfiles = () =>
    apiGet<MolecularProfile[]>(
        '/molecular-profiles?projection=SUMMARY&pageSize=100000'
    );

export const getClinicalAttributes = () =>
    apiGet<ClinicalAttribute[]>(
        '/clinical-attributes?projection=SUMMARY&pageSize=1000000'
    );

// Named sets of studies the tools accept in place of a list of ids.
const STUDY_ALIASES: Record<string, (s: Study) => boolean> = {
    tcga_pancan: s => s.studyId.endsWith('_tcga_pan_can_atlas_2018'),
};

/**
 * Expands aliases and checks that every study exists; unknown ids are
 * reported with the closest names so the model can correct them.
 */
export async function resolveStudyIds(ids: string[]): Promise<string[]> {
    const studies = await getStudies();
    const known = new Set(studies.map(s => s.studyId));
    const out: string[] = [];
    for (const raw of ids) {
        const id = raw.trim();
        const alias = STUDY_ALIASES[id.toLowerCase()];
        if (alias) {
            out.push(...studies.filter(alias).map(s => s.studyId));
        } else if (known.has(id)) {
            out.push(id);
        } else {
            const words = id
                .toLowerCase()
                .split(/[_\s]+/)
                .filter(Boolean);
            const near = studies
                .filter(s => words.some(w => s.studyId.includes(w)))
                .slice(0, 5)
                .map(s => s.studyId);
            throw new ApiError(
                `Unknown study id "${id}". ${
                    near.length ? `Close: ${near.join(', ')}. ` : ''
                }Use find_studies to look ids up.`
            );
        }
    }
    return [...new Set(out)];
}

export interface Gene {
    entrezGeneId: number;
    hugoGeneSymbol: string;
}

/** Hugo symbol or alias (e.g. p14ARF) to the gene; throws if unknown. */
export async function resolveGene(symbol: string): Promise<Gene> {
    const wanted = symbol.trim();
    const exact = await apiPost<Gene[]>(
        '/genes/fetch?geneIdType=HUGO_GENE_SYMBOL',
        [wanted.toUpperCase()]
    );
    if (exact.length) return exact[0];
    const byAlias = await apiGet<Gene[]>(
        `/genes?alias=${encodeURIComponent(wanted)}`
    );
    if (byAlias.length === 1) return byAlias[0];
    if (byAlias.length > 1) {
        throw new ApiError(
            `"${wanted}" could mean ${byAlias
                .map(g => g.hugoGeneSymbol)
                .join(', ')}; name one.`
        );
    }
    throw new ApiError(
        `Unknown gene "${wanted}" (not a HUGO symbol or known alias).`
    );
}

export type ProfileKind =
    | 'mutations'
    | 'cna'
    | 'structural_variants'
    | 'mrna'
    | 'protein'
    | 'cna_log2'
    | 'methylation';

/** The study's profile of a kind, the one cBioPortal uses by default. */
export async function profileFor(
    studyId: string,
    kind: ProfileKind
): Promise<MolecularProfile | undefined> {
    const all = (await getMolecularProfiles()).filter(
        p => p.studyId === studyId
    );
    const pick = (
        test: (p: MolecularProfile) => boolean,
        prefer: RegExp[] = []
    ) => {
        const matching = all.filter(test);
        for (const re of prefer) {
            const hit = matching.find(p => re.test(p.molecularProfileId));
            if (hit) return hit;
        }
        return matching[0];
    };
    switch (kind) {
        case 'mutations':
            return pick(
                p =>
                    p.molecularAlterationType === 'MUTATION_EXTENDED' &&
                    p.datatype === 'MAF',
                [/_mutations$/]
            );
        case 'cna':
            return pick(
                p =>
                    p.molecularAlterationType === 'COPY_NUMBER_ALTERATION' &&
                    p.datatype === 'DISCRETE',
                [/_gistic$/, /_cna$/]
            );
        case 'cna_log2':
            return pick(
                p =>
                    p.molecularAlterationType === 'COPY_NUMBER_ALTERATION' &&
                    /LOG2|CONTINUOUS/.test(p.datatype)
            );
        case 'structural_variants':
            return pick(
                p => p.molecularAlterationType === 'STRUCTURAL_VARIANT',
                [/_structural_variants$/]
            );
        case 'mrna':
            return pick(
                p =>
                    p.molecularAlterationType === 'MRNA_EXPRESSION' &&
                    p.datatype === 'CONTINUOUS',
                [/rna_seq_v2_mrna$/, /rna_seq_mrna$/, /mrna$/]
            );
        case 'protein':
            return pick(
                p =>
                    p.molecularAlterationType === 'PROTEIN_LEVEL' &&
                    p.datatype !== 'Z-SCORE',
                [/_rppa$/]
            );
        case 'methylation':
            return pick(
                p =>
                    p.molecularAlterationType === 'METHYLATION' ||
                    /methylation/i.test(p.molecularProfileId),
                [/hm450$/, /methylation/]
            );
    }
}

/** A study's clinical attributes (sample and patient). */
export async function attributesOf(
    studyIds: string[]
): Promise<ClinicalAttribute[]> {
    const ids = new Set(studyIds);
    return (await getClinicalAttributes()).filter(a => ids.has(a.studyId));
}

/** Runs `fn` over items, `limit` at a time. */
export async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const i = next++;
                results[i] = await fn(items[i]);
            }
        })
    );
    return results;
}
