// Pure helpers for the research-question highlights: narrowing the candidate
// list sent to the model, and validating what comes back against it. Kept apart
// from core.ts so they can be tested without a model or provider credentials.

export const TARGET_TYPES = [
    'study',
    'visualization',
    'results-tab',
    'comparison-tab',
] as const;

export type TargetType = typeof TARGET_TYPES[number];

export interface HighlightCandidate {
    targetType: TargetType;
    targetId: string;
    label: string;
    description?: string;
}

export interface RawAnnotation {
    targetType: string;
    targetId: string;
    reason: string;
}

export interface HighlightAnnotation {
    targetType: TargetType;
    targetId: string;
    label: string;
    rank: number;
    reason: string;
}

export const MAX_ANNOTATIONS = 5;
// Study lists run to hundreds of entries; the model only needs the plausible
// ones.
export const MAX_CANDIDATES = 150;

const MAX_LABEL_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 300;

function isTargetType(value: unknown): value is TargetType {
    return TARGET_TYPES.includes(value as TargetType);
}

/** Drops malformed entries from the client's candidate list. */
export function parseCandidates(value: unknown): HighlightCandidate[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
        const c = item as Partial<HighlightCandidate> | null;
        if (
            !c ||
            !isTargetType(c.targetType) ||
            typeof c.targetId !== 'string' ||
            !c.targetId ||
            typeof c.label !== 'string'
        ) {
            return [];
        }
        return [
            {
                targetType: c.targetType,
                targetId: c.targetId,
                label: c.label.slice(0, MAX_LABEL_CHARS),
                description:
                    typeof c.description === 'string'
                        ? c.description.slice(0, MAX_DESCRIPTION_CHARS)
                        : undefined,
            },
        ];
    });
}

function keyOf(targetType: string, targetId: string): string {
    return `${targetType}:${targetId}`;
}

function tokenize(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(token => token.length > 2)
    );
}

/**
 * Keeps the candidates sharing the most words with the question, in their
 * original order. A no-op for lists already under the cap.
 */
export function narrowCandidates(
    question: string,
    candidates: HighlightCandidate[],
    max = MAX_CANDIDATES
): HighlightCandidate[] {
    if (candidates.length <= max) return candidates;
    const questionTokens = tokenize(question);
    const scored = candidates.map((candidate, index) => {
        let score = 0;
        for (const token of tokenize(
            `${candidate.label} ${candidate.description ?? ''}`
        )) {
            if (questionTokens.has(token)) score++;
        }
        return { candidate, index, score };
    });
    return scored
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, max)
        .sort((a, b) => a.index - b.index)
        .map(s => s.candidate);
}

/**
 * Keeps only annotations naming a candidate, once each and in the model's
 * order, with the label taken from the candidate rather than the model.
 */
export function validateAnnotations(
    raw: readonly RawAnnotation[],
    candidates: readonly HighlightCandidate[]
): HighlightAnnotation[] {
    const byKey = new Map(
        candidates.map(c => [keyOf(c.targetType, c.targetId), c])
    );
    const seen = new Set<string>();
    const result: HighlightAnnotation[] = [];
    for (const annotation of raw) {
        const key = keyOf(annotation.targetType, annotation.targetId);
        const candidate = byKey.get(key);
        const reason = annotation.reason?.trim();
        if (!candidate || !reason || seen.has(key)) continue;
        seen.add(key);
        result.push({
            targetType: candidate.targetType,
            targetId: candidate.targetId,
            label: candidate.label,
            rank: result.length + 1,
            reason,
        });
        if (result.length === MAX_ANNOTATIONS) break;
    }
    return result;
}

export function formatCandidates(
    candidates: readonly HighlightCandidate[]
): string {
    return candidates
        .map(c =>
            [c.targetType, c.targetId, c.label, c.description ?? '']
                .map(field => field.replace(/[|\n]/g, ' '))
                .join(' | ')
        )
        .join('\n');
}
