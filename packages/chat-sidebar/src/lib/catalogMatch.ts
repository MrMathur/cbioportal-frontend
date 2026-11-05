// Narrows the portal's catalog (the host's catalog.ts) to the entries a
// message plausibly refers to, so the classification can check cancer types
// and studies against what the portal holds instead of guessing. Pure, so it
// can be tested without a host page.

export interface CatalogCancerType {
    id: string;
    name: string;
    // 'tissue' for top-level types.
    parent: string;
}

export interface CatalogStudy {
    studyId: string;
    name: string;
    cancerTypeId: string;
    sampleCount: number;
}

export interface Catalog {
    cancerTypes: CatalogCancerType[];
    studies: CatalogStudy[];
}

export interface StudyContext {
    studyIds: string[];
    clinicalAttributes: {
        id: string;
        name: string;
        patientAttribute: boolean;
        datatype: string;
    }[];
    molecularProfiles: {
        id: string;
        name: string;
        alterationType: string;
        studyId: string;
    }[];
    cancerTypes: { name: string; count: number }[];
}

export interface CancerTypeMatch {
    id: string;
    name: string;
    parent: string;
    // Studies whose cancer type is this one exactly.
    ownStudies: number;
    // Studies whose cancer type is this one or any type below it.
    subtreeStudies: number;
    // Direct subtypes that have studies of their own somewhere below them.
    children: { id: string; name: string; subtreeStudies: number }[];
}

export interface CatalogMatches {
    cancerTypes: CancerTypeMatch[];
    studies: CatalogStudy[];
    // The studies the user has open (Study View, Results View), whether or
    // not the message names them.
    selectedStudies: CatalogStudy[];
    // Cancer types present in the selected studies, by sample count.
    selectedStudyCancerTypes: { name: string; count: number }[];
    // Clinical attributes of the selected studies: those the message names
    // first, then others up to the cap.
    clinicalAttributes: { id: string; name: string }[];
    molecularProfiles: { name: string; alterationType: string }[];
}

const MAX_CANCER_TYPES = 25;
const MAX_STUDIES = 30;
const MAX_CLINICAL_ATTRIBUTES = 40;
const MAX_PROFILES = 20;

// Words that say nothing about which cancer type or study is meant.
const STOPWORDS = new Set([
    'the',
    'and',
    'for',
    'with',
    'without',
    'what',
    'which',
    'how',
    'are',
    'is',
    'in',
    'of',
    'by',
    'vs',
    'versus',
    'there',
    'any',
    'all',
    'from',
    'that',
    'this',
    'their',
    'patients',
    'patient',
    'samples',
    'sample',
    'cancer',
    'cancers',
    'carcinoma',
    'carcinomas',
    'tumor',
    'tumors',
    'tumour',
    'tumours',
    'neoplasm',
    'neoplasms',
    'disease',
    'type',
    'types',
    'other',
    'study',
    'studies',
    'data',
    'cell',
    'cells',
    'nos',
    'non',
    'not',
    'mutation',
    'mutations',
    'mutated',
    'survival',
    'expression',
    'gene',
    'genes',
    'high',
    'low',
]);

export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(t => t.length >= 3 && !STOPWORDS.has(t))
        .map(t => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));
}

interface CatalogIndex {
    byId: Map<string, CatalogCancerType>;
    children: Map<string, CatalogCancerType[]>;
    ownStudies: Map<string, number>;
    subtreeStudies: Map<string, number>;
}

const indexes = new WeakMap<Catalog, CatalogIndex>();

function indexCatalog(catalog: Catalog): CatalogIndex {
    const cached = indexes.get(catalog);
    if (cached) return cached;
    const byId = new Map(catalog.cancerTypes.map(t => [t.id, t]));
    const children = new Map<string, CatalogCancerType[]>();
    for (const type of catalog.cancerTypes) {
        const siblings = children.get(type.parent) ?? [];
        siblings.push(type);
        children.set(type.parent, siblings);
    }
    const ownStudies = new Map<string, number>();
    for (const study of catalog.studies) {
        ownStudies.set(
            study.cancerTypeId,
            (ownStudies.get(study.cancerTypeId) ?? 0) + 1
        );
    }
    const subtreeStudies = new Map<string, number>();
    const visiting = new Set<string>();
    const count = (id: string): number => {
        const known = subtreeStudies.get(id);
        if (known !== undefined) return known;
        // Guards against a cycle in malformed data.
        if (visiting.has(id)) return 0;
        visiting.add(id);
        let total = ownStudies.get(id) ?? 0;
        for (const child of children.get(id) ?? []) total += count(child.id);
        visiting.delete(id);
        subtreeStudies.set(id, total);
        return total;
    };
    for (const type of catalog.cancerTypes) count(type.id);
    const index = { byId, children, ownStudies, subtreeStudies };
    indexes.set(catalog, index);
    return index;
}

/** The type and every type below it. */
export function subtreeIds(catalog: Catalog, id: string): Set<string> {
    const { children } = indexCatalog(catalog);
    const ids = new Set<string>();
    const stack = [id];
    while (stack.length) {
        const next = stack.pop()!;
        if (ids.has(next)) continue;
        ids.add(next);
        for (const child of children.get(next) ?? []) stack.push(child.id);
    }
    return ids;
}

function toMatch(catalog: Catalog, type: CatalogCancerType): CancerTypeMatch {
    const index = indexCatalog(catalog);
    return {
        id: type.id,
        name: type.name,
        parent: type.parent,
        ownStudies: index.ownStudies.get(type.id) ?? 0,
        subtreeStudies: index.subtreeStudies.get(type.id) ?? 0,
        children: (index.children.get(type.id) ?? [])
            .map(child => ({
                id: child.id,
                name: child.name,
                subtreeStudies: index.subtreeStudies.get(child.id) ?? 0,
            }))
            .filter(child => child.subtreeStudies > 0)
            .sort((a, b) => b.subtreeStudies - a.subtreeStudies),
    };
}

// Share of the name's own tokens found in the message, with an exact id
// ("luad", "brca") counting as a full match.
function scoreCancerType(type: CatalogCancerType, tokens: Set<string>): number {
    if (tokens.has(type.id.toLowerCase())) return 2;
    const nameTokens = tokenize(type.name);
    if (nameTokens.length === 0) return 0;
    const hits = nameTokens.filter(t => tokens.has(t)).length;
    return hits / nameTokens.length;
}

function scoreStudy(study: CatalogStudy, tokens: Set<string>): number {
    if (tokens.has(study.studyId.toLowerCase())) return 3;
    const nameTokens = new Set([
        ...tokenize(study.name),
        ...tokenize(study.studyId.replace(/_/g, ' ')),
    ]);
    let hits = 0;
    for (const token of nameTokens) if (tokens.has(token)) hits++;
    return hits;
}

export function matchCatalog(
    catalog: Catalog,
    text: string,
    selectedStudyIds: readonly string[] = [],
    studyContext?: StudyContext
): CatalogMatches {
    const tokens = new Set(tokenize(text));
    const index = indexCatalog(catalog);

    const scoredTypes = catalog.cancerTypes
        .map(type => ({ type, score: scoreCancerType(type, tokens) }))
        .filter(s => s.score >= 0.5)
        .sort(
            (a, b) =>
                b.score - a.score ||
                (index.subtreeStudies.get(b.type.id) ?? 0) -
                    (index.subtreeStudies.get(a.type.id) ?? 0)
        )
        .slice(0, MAX_CANCER_TYPES);
    // A broad term ("lung") should also offer the type above a narrow match,
    // so the model can choose the tissue-level node.
    const typeIds = new Set(scoredTypes.map(s => s.type.id));
    for (const { type } of scoredTypes) {
        if (typeIds.size >= MAX_CANCER_TYPES) break;
        if (type.parent !== 'tissue' && index.byId.has(type.parent)) {
            typeIds.add(type.parent);
        }
    }
    const cancerTypes = [...typeIds]
        .map(id => index.byId.get(id)!)
        .map(type => toMatch(catalog, type));

    const matchedSubtree = new Set<string>();
    for (const { type } of scoredTypes.slice(0, 5)) {
        for (const id of subtreeIds(catalog, type.id)) matchedSubtree.add(id);
    }
    const studies = catalog.studies
        .map(study => ({
            study,
            score:
                scoreStudy(study, tokens) +
                (matchedSubtree.has(study.cancerTypeId) ? 0.5 : 0),
        }))
        .filter(s => s.score > 0)
        .sort(
            (a, b) =>
                b.score - a.score || b.study.sampleCount - a.study.sampleCount
        )
        .slice(0, MAX_STUDIES)
        .map(s => s.study);

    const selected = new Set(selectedStudyIds);
    const selectedStudies = catalog.studies.filter(s =>
        selected.has(s.studyId)
    );

    const context =
        studyContext &&
        studyContext.studyIds.length === selected.size &&
        studyContext.studyIds.every(id => selected.has(id))
            ? studyContext
            : undefined;

    const attributes = (context?.clinicalAttributes ?? []).map(a => ({
        id: a.id,
        name: a.name,
        score: tokenize(`${a.name} ${a.id.replace(/_/g, ' ')}`).filter(t =>
            tokens.has(t)
        ).length,
    }));
    const clinicalAttributes = attributes
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, MAX_CLINICAL_ATTRIBUTES)
        .map(({ id, name }) => ({ id, name }));

    const molecularProfiles = (context?.molecularProfiles ?? [])
        .slice(0, MAX_PROFILES)
        .map(p => ({ name: p.name, alterationType: p.alterationType }));

    return {
        cancerTypes,
        studies,
        selectedStudies,
        selectedStudyCancerTypes: [...(context?.cancerTypes ?? [])].sort(
            (a, b) => b.count - a.count
        ),
        clinicalAttributes,
        molecularProfiles,
    };
}
