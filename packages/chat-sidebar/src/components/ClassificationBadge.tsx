import { FC, useState } from 'react';
import { BugIcon } from 'lucide-react';
import {
    Classification,
    isClassification,
    SLOT_LABELS,
    SLOT_NAMES,
} from '@/lib/classification';
import { guidanceDebug } from '@/lib/guidanceFlags';
import { cn } from '@/lib/utils';

// The classification behind a guided reply, for checking the classifier.
// Shown only with the debug flag, never to study participants.

function summary(c: Classification): string {
    const parts: string[] = [c.request_type];
    if (c.level) parts.unshift(c.level);
    if (c.goal) parts.push(c.goal);
    const gaps = c.core_slots
        .filter(n => c.slots[n].status !== 'specified')
        .map(n => `${n} ${c.slots[n].status}`);
    if (gaps.length) parts.push(gaps.join(', '));
    if (c.move) parts.push(`move: ${c.move}`);
    if (c.answerability !== 'ui') parts.push(c.answerability);
    if (c.multi_part) parts.push('multi-part');
    return parts.join(' · ');
}

export const ClassificationBadge: FC<{ data: unknown; failed?: boolean }> = ({
    data,
    failed,
}) => {
    const [open, setOpen] = useState(false);
    if (!guidanceDebug) return null;
    if (failed) {
        return (
            <div className="my-1 inline-flex items-center gap-1 rounded-md border border-dashed border-red-500/60 bg-red-50 px-1.5 py-0.5 font-mono text-[11px] text-red-900 dark:bg-red-950/40 dark:text-red-200">
                <BugIcon className="size-3 shrink-0" aria-hidden />
                classification failed: reply unguided
            </div>
        );
    }
    if (!isClassification(data)) return null;
    return (
        <div className="my-1 text-[11px]">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-amber-500/60 bg-amber-50 px-1.5 py-0.5 text-left font-mono text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                title="Classification (debug)"
            >
                <BugIcon className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{summary(data)}</span>
            </button>
            {open && (
                <div className="mt-1 rounded-md border border-border bg-muted/40 p-2 font-mono leading-snug">
                    <div>degree: {data.guidance_degree}</div>
                    {data.open_study_applies === false && (
                        <div>
                            open page: not used (other cohort or none open)
                        </div>
                    )}
                    {SLOT_NAMES.map(n => (
                        <div
                            key={n}
                            className={cn(
                                data.core_slots.includes(n) && 'font-semibold'
                            )}
                        >
                            {SLOT_LABELS[n]}: {data.slots[n].status}
                            {data.slots[n].value
                                ? ` = ${data.slots[n].value}`
                                : ''}
                            {data.slots[n].source !== 'chat'
                                ? ` (${data.slots[n].source})`
                                : ''}
                            {data.slots[n].options.length
                                ? ` [${data.slots[n].options.join(' | ')}]`
                                : ''}
                        </div>
                    ))}
                    {data.checks.length > 0 && (
                        <div>checks: {data.checks.join('; ')}</div>
                    )}
                    <div className="mt-1 text-muted-foreground">
                        {data.rationale}
                    </div>
                </div>
            )}
        </div>
    );
};
