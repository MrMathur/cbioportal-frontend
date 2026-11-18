// Request classification (codebook version 5): the model's raw reading of a
// message, checked against the portal's catalog and the slots fixed by the
// user or the page, and turned into a level and a degree of guidance. Pure,
// so it can be tested without a model.

import { z } from 'zod';

export const CODEBOOK_VERSION = 5;

export const SLOT_NAMES = [
    'cohort',
    'study',
    'entity',
    'measure',
    'groups',
    'filter',
] as const;
export type SlotName = typeof SLOT_NAMES[number];

export const REQUEST_TYPES = [
    'data',
    'interface',
    'catalog',
    'out_of_scope',
] as const;
export type RequestType = typeof REQUEST_TYPES[number];

export const GOALS = ['explore', 'describe', 'explain', 'confirm'] as const;
export type Goal = typeof GOALS[number];

export const MOVES = ['same', 'refine', 'broaden', 'sibling', 'new'] as const;
export type Move = typeof MOVES[number];

export type SlotStatus = 'specified' | 'ambiguous' | 'missing';
export type Level = 'L1' | 'L2' | 'L3' | 'L4';
export type GuidanceDegree =
    | 'orienting'
    | 'directing'
    | 'directing_then_prescribing'
    | 'light_prescribing_checking'
    | 'prescribing'
    | 'none';
export type Answerability = 'ui' | 'custom' | 'unavailable';
// Who set a slot's value: this turn's classification, an edit in the
// research question box, or the portal page (selected study, filters).
export type SlotSource = 'chat' | 'user' | 'page';

const RawSlotSchema = z.object({
    status: z.enum(['specified', 'ambiguous', 'missing']),
    value: z.string().nullable(),
    options: z.array(z.string()),
});

// Cohort and study are also matched against the portal's catalog. The other
// slots leave the field out: the provider compiles the schema into a grammar
// with a size limit, and six copies of it don't fit.
const RawCatalogSlotSchema = RawSlotSchema.extend({
    matched_ids: z
        .array(z.string())
        .describe(
            'cohort: cancer type ids from the candidate list; study: study ids from the candidate list'
        ),
});

export const RawClassificationSchema = z.object({
    request_type: z.enum(REQUEST_TYPES),
    oos_subtype: z
        .enum(['knowledge', 'software', 'coding', 'critique'])
        .nullable(),
    goal: z.enum(GOALS).nullable(),
    slots: z.object({
        cohort: RawCatalogSlotSchema,
        study: RawCatalogSlotSchema,
        entity: RawSlotSchema,
        measure: RawSlotSchema,
        groups: RawSlotSchema,
        filter: RawSlotSchema,
    }),
    needs_groups: z
        .boolean()
        .describe('True when results are needed per group (any goal)'),
    study_is_collection: z
        .boolean()
        .describe(
            'True when the user explicitly asks for a collection of studies (e.g. "all TCGA PanCancer studies")'
        ),
    uses_open_page: z
        .boolean()
        .describe(
            'True when the message explicitly refers to what is open in the portal ("this study", "these patients", "my selection", "the current filters")'
        ),
    multi_part: z.boolean(),
    parts: z
        .array(z.string())
        .describe(
            'When multi_part: a short name per separate answer, in the order asked (e.g. ["Sex", "Age", "Race"]); empty otherwise'
        ),
    part_answerability: z
        .array(z.enum(['ui', 'custom', 'unavailable']))
        .describe(
            'When multi_part: the answerability of each part on its own, in the same order as parts; empty otherwise'
        ),
    answerability: z.enum(['ui', 'custom', 'unavailable']),
    move: z.enum(MOVES).nullable(),
    drafts: z.object({
        broad_aim: z.string(),
        working_question: z.string(),
        concrete_analysis: z.string(),
    }),
    question_suggestions: z
        .array(z.string())
        .describe(
            'explore goal only: 2–3 specific working questions within the broad aim; empty otherwise'
        ),
    rationale: z
        .string()
        .describe('One sentence on the deciding cues, for the research log'),
});

export type RawClassification = z.infer<typeof RawClassificationSchema>;

export interface Slot {
    status: SlotStatus;
    value: string | null;
    options: string[];
    source: SlotSource;
}

export type Slots = Record<SlotName, Slot>;

export interface Classification {
    codebook_version: typeof CODEBOOK_VERSION;
    request_type: RequestType;
    oos_subtype: RawClassification['oos_subtype'];
    goal: Goal | null;
    slots: Slots;
    needs_groups: boolean;
    core_slots: SlotName[];
    level: Level | null;
    guidance_degree: GuidanceDegree;
    multi_part: boolean;
    // The separate answers a multi-part message asks for; empty otherwise.
    parts: string[];
    // Each part's answerability, in the order of parts.
    part_answerability: Answerability[];
    // For a multi-part message, derived from its parts: 'ui' when any part
    // has a view in the portal.
    answerability: Answerability;
    move: Move | null;
    // Whether the study open on the page fits the question, so its study and
    // filters count as fixed; false when none is open or it is about another
    // cohort.
    open_study_applies: boolean;
    // The message is the sidebar's report of a change the user made on the
    // page: a filter change (its move comes from that change) or, with
    // page_navigation, another step (studies ticked, a page opened).
    from_page: boolean;
    page_navigation: boolean;
    drafts: RawClassification['drafts'];
    // For an exploring question: specific working questions the user may
    // pick, within the broad aim.
    question_suggestions: string[];
    rationale: string;
    // Notes from the catalog check, e.g. why a cohort became ambiguous.
    checks: string[];
    // The classified message, for the earlier-questions box and the log.
    message: string;
}

// What the client sends with each message (its catalogMatch.ts).
export interface CancerTypeMatch {
    id: string;
    name: string;
    parent: string;
    ownStudies: number;
    subtreeStudies: number;
    children: { id: string; name: string; subtreeStudies: number }[];
    // Types anywhere below with studies of their own, most first (older
    // sidebars don't send it).
    subtypes?: { id: string; name: string; ownStudies: number }[];
}

export interface CatalogStudy {
    studyId: string;
    name: string;
    cancerTypeId: string;
    sampleCount: number;
}

export interface CatalogMatches {
    cancerTypes: CancerTypeMatch[];
    studies: CatalogStudy[];
    selectedStudies: CatalogStudy[];
    selectedStudyCancerTypes: { name: string; count: number }[];
    clinicalAttributes: { id: string; name: string }[];
    molecularProfiles: { name: string; alterationType: string }[];
}

export interface FixedSlot {
    status: SlotStatus;
    value: string | null;
    source: 'user' | 'page';
}

export interface GuidanceContext {
    catalog?: CatalogMatches;
    // Slots the user set in the research question box or the page fixes.
    fixedSlots: Partial<Record<SlotName, FixedSlot>>;
    // The aim and working question, when the user wrote them.
    userAim?: string;
    userQuestion?: string;
    previous?: Classification;
    // Earlier user messages in this chat, oldest first.
    history: string[];
    // The open page's type and the elements on it the reply may mark
    // (marks.ts); absent when the sidebar didn't send them.
    pageType?: string;
    // A change the user made on the page, which this message reports: a
    // filter change, or another step in words that follow "I".
    pageAction?:
        | { move: 'refine' | 'broaden' | 'sibling'; filters: string }
        | { navigation: string };
    pageTargets?: {
        targetType: string;
        targetId: string;
        label: string;
        description?: string;
    }[];
}

const MAX_OPTIONS = 8;

function emptySlot(): Slot {
    return { status: 'missing', value: null, options: [], source: 'chat' };
}

function hasSelectedStudy(context: GuidanceContext): boolean {
    return (context.catalog?.selectedStudies.length ?? 0) > 0;
}

/**
 * Whether what is open in the portal (study, filters, gene query) is part of
 * the question. A new question starts clean: the page counts only if the
 * message refers to it ("this study"). Otherwise, for the first question
 * and follow-ups, it counts when the open study is about the question's
 * cohort: the message names no cohort, or the open study's cancer type (or
 * one of the cancer types in it) matches the cohort named. A question about
 * another cohort ("glioblastoma" while a colorectal cohort is open) gets
 * nothing from the page.
 */
export function openStudyFits(
    raw: RawClassification,
    context: GuidanceContext
): boolean {
    const catalog = context.catalog;
    if (!catalog || catalog.selectedStudies.length === 0) return false;
    if (raw.uses_open_page) return true;
    if (isNewTopic(raw, context)) return false;
    const cohort = raw.slots.cohort;
    if (cohort.status === 'missing') return true;
    const ids = new Set(cohortTypeIds(cohort.matched_ids, catalog));
    if (catalog.selectedStudies.some(s => ids.has(s.cancerTypeId))) {
        return true;
    }
    const value = (cohort.value ?? '').trim().toLowerCase();
    if (!value) return false;
    return catalog.selectedStudyCancerTypes.some(t => {
        const name = t.name.toLowerCase();
        return name.includes(value) || value.includes(name);
    });
}

// The context with the page's part removed: no open study, no slots the
// page fixed.
function withoutPage(context: GuidanceContext): GuidanceContext {
    const fixedSlots: GuidanceContext['fixedSlots'] = {};
    for (const name of SLOT_NAMES) {
        const fixed = context.fixedSlots[name];
        if (fixed && fixed.source !== 'page') fixedSlots[name] = fixed;
    }
    return {
        ...context,
        fixedSlots,
        catalog: context.catalog && {
            ...context.catalog,
            selectedStudies: [],
            selectedStudyCancerTypes: [],
        },
    };
}

// Drops ids that sit below another matched id: "lung" and "luad" together
// mean "lung". A type counts as below another when the other's parent chain
// (within the matches) or its listed subtypes and children include it.
function topmostMatches(matches: CancerTypeMatch[]): CancerTypeMatch[] {
    const ids = new Set(matches.map(m => m.id));
    const byId = new Map(matches.map(m => [m.id, m]));
    const below = new Set<string>();
    for (const m of matches) {
        for (const t of m.subtypes ?? []) if (t.id !== m.id) below.add(t.id);
        for (const c of m.children) below.add(c.id);
    }
    return matches.filter(m => {
        if (below.has(m.id)) return false;
        let parent = m.parent;
        const seen = new Set<string>();
        while (parent && !seen.has(parent)) {
            if (ids.has(parent)) return false;
            seen.add(parent);
            parent = byId.get(parent)?.parent ?? '';
        }
        return true;
    });
}

/**
 * Whether a cancer type spans several cohorts the portal keeps apart, and if
 * so the subtypes to choose from ([] when it's one cohort). It is one cohort
 * when most of its studies are of the type itself: its subtypes then become
 * filters ("breast cancer", i.e. Invasive Breast Carcinoma). It spans several
 * when most of its studies belong to two or more subtypes with studies of
 * their own, at any depth ("lung cancer": lung adenocarcinoma, squamous cell
 * carcinoma, small cell lung cancer…), even if a few are tagged with the type
 * itself. Which type a common name means is the classifier's call, per the
 * codebook prompt.
 */
export function separateCohorts(type: CancerTypeMatch): string[] {
    const inSubtypes = type.subtreeStudies - type.ownStudies;
    if (type.ownStudies >= inSubtypes) return [];
    if (type.subtypes && type.subtypes.length >= 2) {
        return type.subtypes.map(t => t.name);
    }
    const withStudies = type.children.filter(c => c.subtreeStudies > 0);
    if (withStudies.length < 2) return [];
    return withStudies
        .sort((a, b) => b.subtreeStudies - a.subtreeStudies)
        .map(c => c.name);
}

function resolveCohort(
    raw: RawClassification['slots']['cohort'],
    context: GuidanceContext,
    checks: string[]
): Slot {
    const slot: Slot = {
        status: raw.status,
        value: raw.value,
        options: raw.options,
        source: 'chat',
    };
    const catalog = context.catalog;
    if (raw.status === 'missing') {
        if (hasSelectedStudy(context)) {
            checks.push('cohort: whole selected study');
            return {
                status: 'specified',
                value: 'whole study',
                options: [],
                source: 'page',
            };
        }
        return slot;
    }
    if (!catalog) return slot;

    // Inside a selected study the study's own cancer types decide.
    if (hasSelectedStudy(context)) {
        const studyTypes = catalog.selectedStudyCancerTypes;
        if (studyTypes.length <= 1) {
            if (slot.status === 'ambiguous') {
                checks.push(
                    'cohort: selected study has one cancer type, so specified'
                );
            }
            return { ...slot, status: 'specified', options: [] };
        }
        const allowed = new Set(studyTypes.map(t => t.name));
        const options = slot.options.filter(o => allowed.has(o));
        return slot.status === 'ambiguous' && options.length >= 2
            ? { ...slot, options: options.slice(0, MAX_OPTIONS) }
            : slot.status === 'ambiguous'
            ? { ...slot, status: 'specified', options: [] }
            : slot;
    }

    const known = new Map(catalog.cancerTypes.map(t => [t.id, t]));
    // The ids the classifier matched, or else the candidate named like its
    // value ("lung adenocarcinoma" for a typo it corrected).
    const value = raw.value?.trim().toLowerCase();
    const matchedIds = raw.matched_ids.length
        ? raw.matched_ids
        : catalog.cancerTypes
              .filter(t => value && t.name.toLowerCase() === value)
              .map(t => t.id);
    const matched = topmostMatches(
        matchedIds
            .map(id => known.get(id))
            .filter((t): t is CancerTypeMatch => Boolean(t))
    );
    if (matched.length === 0) {
        checks.push('cohort: no catalog match, kept the model status');
        return slot;
    }
    if (matched.length > 1) {
        checks.push(
            `cohort: matches ${matched.length} separate cancer types in the portal`
        );
        // Each match that itself spans several cohorts offers its subtypes,
        // so the options are the same however the classifier splits a
        // broad term ("lung cancer": NSCLC and SCLC, or lung).
        const options = [
            ...new Set(
                matched.flatMap(m => {
                    const subtypes = separateCohorts(m);
                    return subtypes.length ? subtypes : [m.name];
                })
            ),
        ];
        return {
            ...slot,
            status: 'ambiguous',
            options: options.slice(0, MAX_OPTIONS),
        };
    }
    const subtypes = separateCohorts(matched[0]);
    if (subtypes.length > 0) {
        checks.push(
            `cohort: ${matched[0].name} spans ${subtypes.length} cancer types with their own studies`
        );
        return {
            ...slot,
            status: 'ambiguous',
            options: subtypes.slice(0, MAX_OPTIONS),
        };
    }
    if (slot.status === 'ambiguous') {
        checks.push(
            `cohort: most ${matched[0].name} studies are of that type itself, so one cohort (specified)`
        );
    }
    // The portal's name for it, so searches and chips match it exactly.
    return {
        ...slot,
        status: 'specified',
        value: matched[0].name,
        options: [],
    };
}

function studyLabel(study: CatalogStudy): string {
    return `${study.name} [${study.studyId}]`;
}

function resolveStudy(
    raw: RawClassification['slots']['study'],
    isCollection: boolean,
    cohort: Slot,
    cohortIds: string[],
    context: GuidanceContext,
    checks: string[]
): Slot {
    const slot: Slot = {
        status: raw.status,
        value: raw.value,
        options: raw.options,
        source: 'chat',
    };
    const catalog = context.catalog;
    if (raw.status === 'missing' && catalog && hasSelectedStudy(context)) {
        return {
            status: 'specified',
            value: catalog.selectedStudies.map(s => s.name).join('; '),
            options: [],
            source: 'page',
        };
    }
    if (!catalog) return slot;
    const known = new Map(catalog.studies.map(s => [s.studyId, s]));
    const named = raw.matched_ids
        .map(id => known.get(id))
        .filter((s): s is CatalogStudy => Boolean(s));
    // Several studies match ("TCGA PanCancer Atlas"), but once the cohort is
    // settled only those of its cancer type count.
    const inCohort =
        cohort.status === 'specified' && cohortIds.length
            ? named.filter(s => cohortIds.includes(s.cancerTypeId))
            : [];
    if (named.length > 1 && inCohort.length === 1) {
        checks.push(`study: only ${inCohort[0].studyId} is in the cohort`);
    }
    const matched = inCohort.length ? inCohort : named;
    if (matched.length === 1) {
        return {
            ...slot,
            status: 'specified',
            value: matched[0].name,
            options: [],
        };
    }
    if (matched.length > 1) {
        if (isCollection) return { ...slot, status: 'specified', options: [] };
        checks.push(`study: matches ${matched.length} datasets`);
        return {
            ...slot,
            status: 'ambiguous',
            options: matched.map(studyLabel).slice(0, MAX_OPTIONS),
        };
    }
    // Nothing named: offer the largest studies of the cohort, for L3.
    if (slot.status === 'missing' && cohort.status === 'specified') {
        const options = catalog.studies
            .filter(s => cohortIds.includes(s.cancerTypeId))
            .sort((a, b) => b.sampleCount - a.sampleCount)
            .slice(0, MAX_OPTIONS)
            .map(studyLabel);
        return { ...slot, options };
    }
    return slot;
}

// The cancer types the cohort means: those the classifier matched, or else
// the candidate named like the cohort's value (a cohort the user set in the
// box, which the message may not name).
function cohortMatchIds(
    raw: RawClassification,
    cohort: Slot,
    catalog: CatalogMatches | undefined
): string[] {
    if (raw.slots.cohort.matched_ids.length) {
        return raw.slots.cohort.matched_ids;
    }
    const value = cohort.value?.trim().toLowerCase();
    if (!value || !catalog) return [];
    return catalog.cancerTypes
        .filter(t => t.name.toLowerCase() === value)
        .map(t => t.id);
}

// The matched cancer types and their direct subtypes, whose studies count as
// the cohort's.
function cohortTypeIds(
    matchedIds: string[],
    catalog: CatalogMatches | undefined
): string[] {
    const ids = new Set(matchedIds);
    for (const type of catalog?.cancerTypes ?? []) {
        if (!matchedIds.includes(type.id)) continue;
        for (const child of type.children) ids.add(child.id);
    }
    return [...ids];
}

function coreSlots(goal: Goal | null, needsGroups: boolean): SlotName[] {
    if (!goal || goal === 'explore') return [];
    const core: SlotName[] = ['cohort', 'entity', 'measure'];
    if (needsGroups) core.push('groups');
    return core;
}

export function computeLevel(
    requestType: RequestType,
    goal: Goal | null,
    slots: Slots,
    core: SlotName[]
): { level: Level | null; guidance_degree: GuidanceDegree } {
    switch (requestType) {
        case 'interface':
            return { level: null, guidance_degree: 'prescribing' };
        case 'catalog':
            return { level: null, guidance_degree: 'directing' };
        case 'out_of_scope':
            return { level: null, guidance_degree: 'none' };
    }
    if (goal === 'explore' || goal === null) {
        return { level: 'L1', guidance_degree: 'orienting' };
    }
    if (core.some(name => slots[name].status !== 'specified')) {
        return { level: 'L2', guidance_degree: 'directing' };
    }
    if (slots.study.status !== 'specified') {
        return { level: 'L3', guidance_degree: 'directing_then_prescribing' };
    }
    return { level: 'L4', guidance_degree: 'light_prescribing_checking' };
}

// A slot the user or page fixed holds unless the message itself names a
// different value for it. What the user fixed belongs to their current
// topic, so it lapses when the message starts a new one; the page's values
// still hold.
function applyFixed(
    name: SlotName,
    slot: Slot,
    raw: RawClassification,
    context: GuidanceContext
): Slot {
    const fixed = context.fixedSlots[name];
    if (!fixed || !fixed.value) return slot;
    if (fixed.source === 'user' && isNewTopic(raw, context)) return slot;
    const rawSlot = raw.slots[name];
    // An ambiguous slot often has no single value, only options; it still
    // replaces the fixed one.
    if (rawSlot.status !== 'missing' && rawSlot.value !== fixed.value) {
        return slot;
    }
    return {
        status: fixed.status,
        value: fixed.value,
        options: fixed.status === 'ambiguous' ? slot.options : [],
        source: fixed.source,
    };
}

const MAX_PARTS = 5;
const MAX_SUGGESTIONS = 3;

// Parts only count for a multi-part message, at least two, named once each,
// each with its own answerability (the overall one where it's missing).
export function cleanParts(
    raw: RawClassification
): { name: string; answerability: Answerability }[] {
    if (!raw.multi_part) return [];
    const seen = new Set<string>();
    const parts: { name: string; answerability: Answerability }[] = [];
    raw.parts.forEach((part, index) => {
        const name = part.trim().slice(0, 40);
        const key = name.toLowerCase();
        if (!name || key === 'all' || key === 'shared' || seen.has(key)) {
            return;
        }
        seen.add(key);
        parts.push({
            name,
            answerability: raw.part_answerability[index] ?? raw.answerability,
        });
    });
    return parts.length >= 2 ? parts.slice(0, MAX_PARTS) : [];
}

/**
 * A multi-part message can't be answered by one view, but its parts may each
 * have one: it is answerable in the portal when any part is, and otherwise
 * takes the best of its parts' answers.
 */
export function overallAnswerability(
    parts: { answerability: Answerability }[],
    fallback: Answerability
): Answerability {
    if (parts.length === 0) return fallback;
    const kinds = parts.map(p => p.answerability);
    if (kinds.includes('ui')) return 'ui';
    return kinds.includes('custom') ? 'custom' : 'unavailable';
}

// The move of a message that reports the user's change on the page: a filter
// change's own move; another step continues the same question.
function pageMove(
    action: GuidanceContext['pageAction'],
    fallback: Move | null
): Move | null {
    if (!action) return fallback;
    return 'move' in action ? action.move : 'same';
}

// A change the user made on the page refines, broadens or varies the current
// question; it never starts a new one.
function isNewTopic(raw: RawClassification, context: GuidanceContext): boolean {
    if (context.pageAction) return false;
    return Boolean(context.previous) && raw.move === 'new';
}

export function resolveClassification(
    raw: RawClassification,
    fullContext: GuidanceContext,
    message: string
): Classification {
    const checks: string[] = [];
    // A change the user made on the page is about the open study.
    const fromPage = fullContext.pageAction !== undefined;
    const openStudyApplies =
        (fromPage && hasSelectedStudy(fullContext)) ||
        openStudyFits(raw, fullContext);
    if (!openStudyApplies && hasSelectedStudy(fullContext)) {
        checks.push(
            isNewTopic(raw, fullContext)
                ? 'page: new question that does not refer to the open page, so its study and filters do not apply'
                : 'page: the open study is about another cohort, so its study and filters do not apply'
        );
    }
    const context = openStudyApplies ? fullContext : withoutPage(fullContext);
    const isData = raw.request_type === 'data';
    // Catalog questions name cohorts and studies too ("which lung studies
    // have CNA data?"), which the research question box shows.
    const fillSlots = isData || raw.request_type === 'catalog';
    const slots = {} as Slots;
    for (const name of SLOT_NAMES) slots[name] = emptySlot();

    if (fillSlots) {
        for (const name of SLOT_NAMES) {
            const r = raw.slots[name];
            slots[name] = {
                status: r.status,
                value: r.status === 'missing' ? null : r.value,
                options: r.status === 'ambiguous' ? r.options : [],
                source: 'chat',
            };
        }
        slots.cohort = resolveCohort(raw.slots.cohort, context, checks);
        slots.cohort = applyFixed('cohort', slots.cohort, raw, context);
        const cohortIds = cohortTypeIds(
            cohortMatchIds(raw, slots.cohort, context.catalog),
            context.catalog
        );
        slots.study = resolveStudy(
            raw.slots.study,
            raw.study_is_collection,
            slots.cohort,
            cohortIds,
            context,
            checks
        );
        for (const name of SLOT_NAMES) {
            if (name === 'cohort') continue;
            slots[name] = applyFixed(name, slots[name], raw, context);
        }
        // One study chosen and no cancer type named: its whole cohort.
        if (
            slots.cohort.status === 'missing' &&
            slots.study.status === 'specified' &&
            !raw.study_is_collection
        ) {
            checks.push('cohort: whole study of the chosen study');
            slots.cohort = {
                status: 'specified',
                value: 'whole study',
                options: [],
                source: 'chat',
            };
        }
    }

    // A choice of one is no choice: an ambiguous slot with a single option
    // ("lung adenocarcinoma" → "Lung Adenocarcinoma") is that option.
    for (const name of SLOT_NAMES) {
        const slot = slots[name];
        if (slot.status === 'ambiguous' && slot.options.length === 1) {
            checks.push(`${name}: one option only, so specified`);
            slots[name] = {
                ...slot,
                status: 'specified',
                value: slot.options[0],
                options: [],
            };
        }
    }

    const goal = isData ? raw.goal : null;
    const parts = cleanParts(raw);
    const exploring = goal === 'explore';
    const newTopic = isNewTopic(raw, context);
    const move = context.previous
        ? pageMove(fullContext.pageAction, raw.move)
        : null;
    // A working question the user wrote stays while they ask about the same
    // thing; a refinement or a sibling question rewrites it.
    const keepUserQuestion = !newTopic && (move === null || move === 'same');
    const needsGroups =
        isData &&
        (raw.needs_groups ||
            (!newTopic && context.fixedSlots.groups?.source === 'user'));
    const core = coreSlots(goal, needsGroups);
    const { level, guidance_degree } = isData
        ? computeLevel('data', goal, slots, core)
        : computeLevel(raw.request_type, null, slots, core);

    return {
        codebook_version: CODEBOOK_VERSION,
        request_type: raw.request_type,
        oos_subtype:
            raw.request_type === 'out_of_scope' ? raw.oos_subtype : null,
        goal,
        slots,
        needs_groups: needsGroups,
        core_slots: core,
        level,
        guidance_degree,
        multi_part: raw.multi_part,
        parts: parts.map(p => p.name),
        part_answerability: parts.map(p => p.answerability),
        answerability: overallAnswerability(parts, raw.answerability),
        move,
        open_study_applies: openStudyApplies,
        from_page: fromPage,
        page_navigation:
            fullContext.pageAction !== undefined &&
            'navigation' in fullContext.pageAction,
        drafts: {
            broad_aim: (!newTopic && context.userAim) || raw.drafts.broad_aim,
            // An exploring question has no specific question yet: only the
            // aim, unless the user wrote a question themselves.
            working_question:
                (keepUserQuestion && context.userQuestion) ||
                (exploring ? '' : raw.drafts.working_question),
            concrete_analysis: exploring ? '' : raw.drafts.concrete_analysis,
        },
        question_suggestions: exploring
            ? raw.question_suggestions
                  .map(q => q.trim())
                  .filter(Boolean)
                  .slice(0, MAX_SUGGESTIONS)
            : [],
        rationale: raw.rationale,
        checks,
        message,
    };
}

/** The classifier's user turn: everything it needs to read the message. */
export function formatClassifierInput(
    message: string,
    context: GuidanceContext,
    pageHref: string | undefined
): string {
    const sections: string[] = [];
    if (context.history.length) {
        sections.push(
            `## Earlier user messages in this chat (oldest first)\n\n${context.history
                .map(h => `- ${h}`)
                .join('\n')}`
        );
    }
    if (context.previous) {
        const p = context.previous;
        sections.push(
            `## Previous classification\n\n${JSON.stringify({
                request_type: p.request_type,
                goal: p.goal,
                slots: Object.fromEntries(
                    SLOT_NAMES.map(n => [
                        n,
                        { status: p.slots[n].status, value: p.slots[n].value },
                    ])
                ),
                level: p.level,
                drafts: p.drafts,
            })}`
        );
    }
    const fixed = SLOT_NAMES.filter(n => context.fixedSlots[n]?.value);
    if (fixed.length || context.userAim || context.userQuestion) {
        const lines = fixed.map(n => {
            const f = context.fixedSlots[n]!;
            return `- ${n}: "${f.value}" (${
                f.source === 'user'
                    ? 'fixed by the user'
                    : 'fixed in the portal page'
            })`;
        });
        if (context.userAim) {
            lines.push(`- broad aim written by the user: "${context.userAim}"`);
        }
        if (context.userQuestion) {
            lines.push(
                `- working question written by the user: "${context.userQuestion}" (keep it if this message asks the same thing; if it refines or changes the question, draft a new one in the same style)`
            );
        }
        sections.push(`## Fixed outside this message\n\n${lines.join('\n')}`);
    }
    if (pageHref) sections.push(`## Current page\n\n${pageHref}`);
    const c = context.catalog;
    if (c) {
        const types = c.cancerTypes
            .map(
                t =>
                    `${t.id} | ${t.name} | parent: ${t.parent} | own studies: ${
                        t.ownStudies
                    } | studies incl. subtypes: ${t.subtreeStudies}${
                        (t.subtypes ?? t.children).length
                            ? ` | subtypes with studies: ${(
                                  t.subtypes ?? t.children
                              )
                                  .map(ch => ch.name)
                                  .join(', ')}`
                            : ''
                    }`
            )
            .join('\n');
        const studies = c.studies
            .map(
                s =>
                    `${s.studyId} | ${s.name} | ${s.cancerTypeId} | ${s.sampleCount} samples`
            )
            .join('\n');
        const parts = [
            `### Cancer types (id | name | ...)\n\n${types || '(no match)'}`,
            `### Studies (id | name | cancer type | samples)\n\n${studies ||
                '(no match)'}`,
        ];
        if (c.selectedStudies.length) {
            parts.push(
                `### Studies open on the page\n\n${c.selectedStudies
                    .map(s => `${s.studyId} | ${s.name}`)
                    .join('\n')}`
            );
        }
        if (c.selectedStudyCancerTypes.length) {
            parts.push(
                `### Cancer types in the open studies\n\n${c.selectedStudyCancerTypes
                    .map(t => `${t.name} (${t.count})`)
                    .join('\n')}`
            );
        }
        if (c.clinicalAttributes.length) {
            parts.push(
                `### Clinical attributes in the open studies\n\n${c.clinicalAttributes
                    .map(a => a.name)
                    .join('; ')}`
            );
        }
        if (c.molecularProfiles.length) {
            parts.push(
                `### Molecular profiles in the open studies\n\n${c.molecularProfiles
                    .map(p => p.name)
                    .join('; ')}`
            );
        }
        sections.push(`## Portal catalog candidates\n\n${parts.join('\n\n')}`);
    } else {
        sections.push(
            '## Portal catalog candidates\n\nUnavailable for this message: judge cancer types and studies from the message, and use empty matched_ids.'
        );
    }
    sections.push(`## Message to classify\n\n${message}`);
    return sections.join('\n\n');
}

/** Keeps the parsed context within what the client is allowed to send. */
export function parseGuidanceContext(
    value: unknown
): {
    context: GuidanceContext;
    sessionId: string;
    participant: string;
    threadId: string;
} {
    const v = (value ?? {}) as Record<string, unknown>;
    const str = (x: unknown, max = 500) =>
        typeof x === 'string' ? x.slice(0, max) : '';
    const fixedSlots: GuidanceContext['fixedSlots'] = {};
    const rawFixed = (v.fixedSlots ?? {}) as Record<string, unknown>;
    for (const name of SLOT_NAMES) {
        const f = rawFixed[name] as Partial<FixedSlot> | undefined;
        if (
            f &&
            typeof f.value === 'string' &&
            f.value.trim() &&
            (f.source === 'user' || f.source === 'page') &&
            (f.status === 'specified' || f.status === 'ambiguous')
        ) {
            fixedSlots[name] = {
                status: f.status,
                value: f.value.slice(0, 300),
                source: f.source,
            };
        }
    }
    const history = Array.isArray(v.history)
        ? v.history
              .filter((h): h is string => typeof h === 'string')
              .slice(-6)
              .map(h => h.slice(0, 600))
        : [];
    return {
        context: {
            catalog: isCatalogMatches(v.catalog) ? v.catalog : undefined,
            fixedSlots,
            userAim: str(v.userAim, 300) || undefined,
            userQuestion: str(v.userQuestion, 500) || undefined,
            history,
            previous: isPreviousClassification(v.previous)
                ? v.previous
                : undefined,
            pageType: str(v.pageType, 40) || undefined,
            pageAction: parsePageAction(v.pageAction),
            pageTargets: parsePageTargets(v.pageTargets),
        },
        sessionId: str(v.sessionId, 100),
        participant: str(v.participant, 100),
        threadId: str(v.threadId, 100),
    };
}

function parsePageAction(value: unknown): GuidanceContext['pageAction'] {
    const a = value as {
        move?: unknown;
        filters?: unknown;
        navigation?: unknown;
    } | null;
    if (a && typeof a.navigation === 'string' && a.navigation.trim()) {
        return { navigation: a.navigation.trim().slice(0, 300) };
    }
    if (
        !a ||
        (a.move !== 'refine' && a.move !== 'broaden' && a.move !== 'sibling')
    ) {
        return undefined;
    }
    return {
        move: a.move,
        filters: typeof a.filters === 'string' ? a.filters.slice(0, 300) : '',
    };
}

const MAX_PAGE_TARGETS = 80;

function parsePageTargets(value: unknown): GuidanceContext['pageTargets'] {
    if (!Array.isArray(value)) return undefined;
    const targets: NonNullable<GuidanceContext['pageTargets']> = [];
    for (const item of value.slice(0, MAX_PAGE_TARGETS)) {
        const t = item as Record<string, unknown> | null;
        if (
            t &&
            typeof t.targetType === 'string' &&
            typeof t.targetId === 'string' &&
            typeof t.label === 'string'
        ) {
            targets.push({
                targetType: t.targetType.slice(0, 40),
                targetId: t.targetId.slice(0, 200),
                label: t.label.slice(0, 200),
                description:
                    typeof t.description === 'string'
                        ? t.description.slice(0, 200)
                        : undefined,
            });
        }
    }
    return targets;
}

// A classification the sidebar sends back for a retry, as the previous turn.
function isPreviousClassification(value: unknown): value is Classification {
    const c = value as Partial<Classification> | null;
    return (
        !!c &&
        c.codebook_version === CODEBOOK_VERSION &&
        typeof c.request_type === 'string' &&
        !!c.slots &&
        SLOT_NAMES.every(n => typeof c.slots?.[n]?.status === 'string') &&
        !!c.drafts
    );
}

function isCatalogMatches(value: unknown): value is CatalogMatches {
    const c = value as Partial<CatalogMatches> | null;
    return (
        !!c &&
        Array.isArray(c.cancerTypes) &&
        Array.isArray(c.studies) &&
        Array.isArray(c.selectedStudies) &&
        Array.isArray(c.selectedStudyCancerTypes) &&
        Array.isArray(c.clinicalAttributes) &&
        Array.isArray(c.molecularProfiles)
    );
}

/** The latest classification streamed into the history, if any. */
export function findLatestClassification(
    messages: readonly { role: string; parts?: readonly unknown[] }[]
): Classification | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const parts = messages[i].parts ?? [];
        for (let j = parts.length - 1; j >= 0; j--) {
            const part = parts[j] as { type?: string; data?: unknown };
            if (part?.type === 'data-classification' && part.data) {
                const data = part.data as Partial<Classification>;
                if (data.codebook_version === CODEBOOK_VERSION) {
                    return data as Classification;
                }
            }
        }
    }
    return undefined;
}

/** The text of a UI message's text parts. */
export function textOfMessage(message: { parts?: readonly unknown[] }): string {
    return (message.parts ?? [])
        .map(p => {
            const part = p as { type?: string; text?: unknown };
            return part?.type === 'text' && typeof part.text === 'string'
                ? part.text
                : '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
}
