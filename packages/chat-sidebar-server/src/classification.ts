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
    value: z
        .string()
        .nullable()
        .describe('The slot value in the codebook format, or null if missing'),
    options: z
        .array(z.string())
        .describe('Choices for an ambiguous slot; empty otherwise'),
    matched_ids: z
        .array(z.string())
        .describe(
            'cohort: cancer type ids from the candidate list; study: study ids from the candidate list; empty for other slots'
        ),
});

export const RawClassificationSchema = z.object({
    request_type: z.enum(REQUEST_TYPES),
    oos_subtype: z
        .enum(['knowledge', 'software', 'coding', 'critique'])
        .nullable(),
    goal: z.enum(GOALS).nullable(),
    slots: z.object({
        cohort: RawSlotSchema,
        study: RawSlotSchema,
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
    answerability: z.enum(['ui', 'custom', 'unavailable']),
    move: z.enum(MOVES).nullable(),
    drafts: z.object({
        broad_aim: z.string(),
        working_question: z.string(),
        concrete_analysis: z.string(),
    }),
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
    answerability: Answerability;
    move: Move | null;
    // Whether the study open on the page fits the question, so its study and
    // filters count as fixed; false when none is open or it is about another
    // cohort.
    open_study_applies: boolean;
    drafts: RawClassification['drafts'];
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
// mean "lung".
function topmostMatches(matches: CancerTypeMatch[]): CancerTypeMatch[] {
    const ids = new Set(matches.map(m => m.id));
    const byId = new Map(matches.map(m => [m.id, m]));
    return matches.filter(m => {
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
 * Whether a cancer type spans several cohorts the portal keeps apart: no
 * studies of its own and at least two subtypes with studies. Returns the
 * subtypes to choose from, or [] when it's one cohort. A type with studies of
 * its own is one cohort: its subtypes become filters. Which type a common
 * name means ("breast cancer" is Invasive Breast Carcinoma, not the Breast
 * tissue) is the classifier's call, per the codebook prompt.
 */
export function separateCohorts(type: CancerTypeMatch): string[] {
    if (type.ownStudies > 0) return [];
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
    const matched = topmostMatches(
        raw.matched_ids
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
        return {
            ...slot,
            status: 'ambiguous',
            options: matched.map(m => m.name).slice(0, MAX_OPTIONS),
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
            `cohort: ${matched[0].name} is one cohort in the portal, so specified`
        );
    }
    return { ...slot, status: 'specified', options: [] };
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
    const matched = raw.matched_ids
        .map(id => known.get(id))
        .filter((s): s is CatalogStudy => Boolean(s));
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

function isNewTopic(raw: RawClassification, context: GuidanceContext): boolean {
    return Boolean(context.previous) && raw.move === 'new';
}

export function resolveClassification(
    raw: RawClassification,
    fullContext: GuidanceContext,
    message: string
): Classification {
    const checks: string[] = [];
    const openStudyApplies = openStudyFits(raw, fullContext);
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
            raw.slots.cohort.matched_ids,
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
    }

    const goal = isData ? raw.goal : null;
    const exploring = goal === 'explore';
    const newTopic = isNewTopic(raw, context);
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
        answerability: raw.answerability,
        move: context.previous ? raw.move : null,
        open_study_applies: openStudyApplies,
        drafts: {
            broad_aim: (!newTopic && context.userAim) || raw.drafts.broad_aim,
            // An exploring question has no specific question yet: only the
            // aim, unless the user wrote a question themselves.
            working_question:
                (!newTopic && context.userQuestion) ||
                (exploring ? '' : raw.drafts.working_question),
            concrete_analysis: exploring ? '' : raw.drafts.concrete_analysis,
        },
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
                `- working question written by the user: "${context.userQuestion}"`
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
                        t.children.length
                            ? ` | subtypes with studies: ${t.children
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
        },
        sessionId: str(v.sessionId, 100),
        participant: str(v.participant, 100),
        threadId: str(v.threadId, 100),
    };
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
