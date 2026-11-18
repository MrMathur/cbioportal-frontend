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
    // Types anywhere below this one that have studies of their own, most
    // studies first: the cohorts a broad term ("lung cancer") may mean.
    subtypes: { id: string; name: string; ownStudies: number }[];
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
const MAX_SUBTYPES = 6;
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
        subtypes: [...subtreeIds(catalog, type.id)]
            .filter(id => id !== type.id)
            .map(id => ({
                id,
                name: index.byId.get(id)?.name ?? id,
                ownStudies: index.ownStudies.get(id) ?? 0,
            }))
            .filter(t => t.ownStudies > 0)
            .sort(
                (a, b) =>
                    b.ownStudies - a.ownStudies || a.name.localeCompare(b.name)
            )
            .slice(0, MAX_SUBTYPES),
    };
}

// Share of the name's own tokens found in the message, with an exact id
// ("luad", "brca") counting as a full match.
// Edit distance between two words, stopping early past `max`.
function withinEdits(a: string, b: string, max: number): boolean {
    if (Math.abs(a.length - b.length) > max) return false;
    let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            rowMin = Math.min(rowMin, current[j]);
        }
        if (rowMin > max) return false;
        previous = current;
    }
    return previous[b.length] <= max;
}

const FUZZY_MIN_LENGTH = 6;
const FUZZY_MAX_EDITS = 2;

/**
 * Whether the message has the word, or, for a long word, a typo of it:
 * "adecarcinoma" for "adenocarcinoma" (same first letter, two edits).
 */
export function hasWord(tokens: Set<string>, word: string): boolean {
    if (tokens.has(word)) return true;
    if (word.length < FUZZY_MIN_LENGTH) return false;
    for (const token of tokens) {
        if (
            token.length >= FUZZY_MIN_LENGTH &&
            token[0] === word[0] &&
            withinEdits(token, word, FUZZY_MAX_EDITS)
        ) {
            return true;
        }
    }
    return false;
}

function scoreCancerType(type: CatalogCancerType, tokens: Set<string>): number {
    if (tokens.has(type.id.toLowerCase())) return 2;
    const nameTokens = tokenize(type.name);
    if (nameTokens.length === 0) return 0;
    const hits = nameTokens.filter(t => hasWord(tokens, t)).length;
    return hits / nameTokens.length;
}

function scoreStudy(study: CatalogStudy, tokens: Set<string>): number {
    if (tokens.has(study.studyId.toLowerCase())) return 3;
    const nameTokens = new Set([
        ...tokenize(study.name),
        ...tokenize(study.studyId.replace(/_/g, ' ')),
    ]);
    let hits = 0;
    for (const token of nameTokens) if (hasWord(tokens, token)) hits++;
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

const MAX_STUDY_RESULTS = 6;

/** "Name [id]", the study slot's value for a catalog study. */
export function studyLabel(study: CatalogStudy): string {
    return `${study.name} [${study.studyId}]`;
}

// The cancer types a cohort value names and all types below them: the type
// with that exact name, or else every type whose name has all its words
// ("lung cancer": every lung type). Empty when it names none ("whole study").
function cohortTypeIds(
    catalog: Catalog,
    cohort: string | undefined
): Set<string> {
    const wanted = cohort?.trim().toLowerCase();
    const ids = new Set<string>();
    if (!wanted) return ids;
    let named = catalog.cancerTypes.filter(
        t => t.name.toLowerCase() === wanted
    );
    if (named.length === 0) {
        const words = tokenize(wanted);
        named = words.length
            ? catalog.cancerTypes.filter(t => {
                  const nameWords = new Set(tokenize(t.name));
                  return words.every(w => nameWords.has(w));
              })
            : [];
    }
    for (const type of named) {
        for (const id of subtreeIds(catalog, type.id)) ids.add(id);
    }
    return ids;
}

/**
 * Studies whose name or id contains every word typed, largest first: what the
 * study slot offers while the user types. Within the cohort chosen, when its
 * cancer type has any matching study.
 */
export function searchStudies(
    catalog: Catalog,
    text: string,
    cohort?: string
): CatalogStudy[] {
    const words = text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
    if (words.length === 0) return [];
    const matching = catalog.studies.filter(study => {
        const haystack = `${study.name} ${study.studyId}`.toLowerCase();
        return words.every(w => haystack.includes(w));
    });
    const inCohort = cohortTypeIds(catalog, cohort);
    const narrowed = matching.filter(s => inCohort.has(s.cancerTypeId));
    return (narrowed.length ? narrowed : matching)
        .sort((a, b) => b.sampleCount - a.sampleCount)
        .slice(0, MAX_STUDY_RESULTS);
}

/** The one study a typed value names, as its label; undefined otherwise. */
export function resolveStudyText(
    catalog: Catalog,
    text: string,
    cohort?: string
): string | undefined {
    const wanted = text.trim().toLowerCase();
    const exact = catalog.studies.find(
        s =>
            s.studyId.toLowerCase() === wanted ||
            s.name.toLowerCase() === wanted ||
            studyLabel(s).toLowerCase() === wanted
    );
    if (exact) return studyLabel(exact);
    const found = searchStudies(catalog, text, cohort);
    return found.length === 1 ? studyLabel(found[0]) : undefined;
}
