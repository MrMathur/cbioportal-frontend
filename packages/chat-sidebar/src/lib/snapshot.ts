import { getSessionSteps, messageText, StepTrigger } from './sessionSteps';

// A Snapshot is a short report on findings the user picks from the session.
// Each finding is one step of the session: its message and the reply to it.

export interface SnapshotFinding {
    trigger: StepTrigger;
    title: string;
    // The first sentence of the reply's Analysis, as plain text.
    summary: string;
    // The step's messages in the thread, from start up to (not including) end.
    start: number;
    end: number;
}

interface ThreadMessageLike {
    role: string;
    content: readonly { type: string; text?: string }[];
}

const MAX_SUMMARY_LENGTH = 140;

function titleOf(trigger: StepTrigger, label: string): string {
    switch (trigger) {
        case 'auto':
            return 'Cohort overview';
        case 'review':
            return `Dashboard changes: ${label}`;
        case 'tab':
            return `${label} tab`;
        default:
            return label;
    }
}

function plainText(markdown: string): string {
    return markdown
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function analysisSummary(reply: string): string {
    const analysis =
        /##\s*Analysis\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(reply)?.[1] ?? reply;
    const text = plainText(analysis.replace(/<!--[\s\S]*?-->/g, ''));
    const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
    return sentence.length > MAX_SUMMARY_LENGTH
        ? `${sentence.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
        : sentence;
}

// Steps whose reply has been written; one still streaming is left out.
export function getSnapshotFindings(
    messages: readonly ThreadMessageLike[]
): SnapshotFinding[] {
    const steps = getSessionSteps(messages);
    return steps
        .map((step, i) => {
            const end = steps[i + 1]?.messageIndex ?? messages.length;
            const reply = messages
                .slice(step.messageIndex, end)
                .filter(m => m.role === 'assistant')
                .map(messageText)
                .join('\n');
            return {
                trigger: step.trigger,
                title: titleOf(step.trigger, step.label),
                summary: analysisSummary(reply),
                start: step.messageIndex,
                end,
                hasReply: reply.trim().length > 0,
            };
        })
        .filter(f => f.hasReply)
        .map(({ hasReply, ...finding }) => finding);
}

// A bar chart the snapshot model writes as a ```chart block of JSON.
export interface SnapshotChart {
    title: string;
    unit?: string;
    caption?: string;
    bars: {
        label: string;
        value: number;
        detail?: string;
        role?: string;
    }[];
}

export type SnapshotSegment =
    | { kind: 'markdown'; text: string }
    | { kind: 'chart'; chart: SnapshotChart }
    // A chart block still streaming, or one that isn't valid.
    | { kind: 'chart-pending' };

const CHART_BLOCK = /```chart[^\n]*\n([\s\S]*?)(```|$)/g;

function parseChart(json: string): SnapshotChart | undefined {
    try {
        const value = JSON.parse(json);
        const bars = Array.isArray(value?.bars)
            ? value.bars.filter(
                  (b: unknown): b is SnapshotChart['bars'][number] =>
                      typeof (b as { label?: unknown })?.label === 'string' &&
                      Number.isFinite((b as { value?: unknown })?.value)
              )
            : [];
        if (bars.length === 0) return undefined;
        return {
            title: String(value.title ?? ''),
            unit: typeof value.unit === 'string' ? value.unit : undefined,
            caption:
                typeof value.caption === 'string' ? value.caption : undefined,
            bars,
        };
    } catch {
        return undefined;
    }
}

export function splitSnapshot(text: string): SnapshotSegment[] {
    const segments: SnapshotSegment[] = [];
    let last = 0;
    for (const match of text.matchAll(CHART_BLOCK)) {
        const index = match.index ?? 0;
        if (index > last) {
            segments.push({ kind: 'markdown', text: text.slice(last, index) });
        }
        const chart = match[2] === '```' ? parseChart(match[1]) : undefined;
        segments.push(
            chart ? { kind: 'chart', chart } : { kind: 'chart-pending' }
        );
        last = index + match[0].length;
    }
    if (last < text.length) {
        segments.push({ kind: 'markdown', text: text.slice(last) });
    }
    return segments;
}
