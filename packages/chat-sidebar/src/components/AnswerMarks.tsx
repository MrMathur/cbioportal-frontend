import { FC, useSyncExternalStore } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { getBadgeState, selectPart, subscribeToBadges } from '@/lib/badgeState';
import { guidanceEnabled } from '@/lib/guidanceFlags';
import { classificationOfMessage, planOfMessage } from '@/lib/messageParts';
import { MarkShape } from '@/components/MarkChip';
import { cn } from '@/lib/utils';

// Above a multi-part answer: one chip per part, plus All. Selecting a part
// shows only its badges (and the shared ones) on the portal and dims the
// other parts' sections here; numbers stay the same.
export const PartChips: FC = () => {
    const messageId = useAuiState(s => s.message.id);
    const threadId = useAuiState(s => s.threadListItem.remoteId);
    // Only when the portal can show the answer: with no view (custom or
    // unavailable) there are no badges or part sections to choose between.
    const parts = useAuiState(s => {
        const c = classificationOfMessage(s.message);
        return c?.answerability === 'ui' ? c.parts?.join('\u0001') ?? '' : '';
    });
    // Parts with no view in the portal are answered in the chat only.
    const chatOnly = useAuiState(s => {
        const c = classificationOfMessage(s.message);
        return (c?.parts ?? [])
            .filter((_, i) => (c?.part_answerability?.[i] ?? 'ui') !== 'ui')
            .join('\u0001');
    });
    const selected = useSyncExternalStore(
        subscribeToBadges,
        () => getBadgeState().selectedParts[messageId] ?? 'all'
    );
    if (!guidanceEnabled || !parts) return null;
    const names = [...parts.split('\u0001'), 'all'];
    return (
        <div
            role="group"
            aria-label="Show one part of the answer"
            className="mb-1.5 flex gap-1 overflow-x-auto whitespace-nowrap px-2 [scrollbar-width:none]"
        >
            {names.map(name => (
                <button
                    key={name}
                    type="button"
                    title={
                        chatOnly.split('\u0001').includes(name)
                            ? 'Answered in the chat only: no view in the portal for this part'
                            : undefined
                    }
                    aria-pressed={selected === name}
                    onClick={() => selectPart(messageId, name, threadId)}
                    className={cn(
                        'shrink-0 rounded-full border px-2 py-0.5 text-[11px] leading-4 transition-colors',
                        selected === name
                            ? 'border-[#3786c2] bg-[#3786c2] text-white'
                            : 'border-border text-muted-foreground hover:border-[#3786c2]/50 hover:text-foreground',
                        chatOnly.split('\u0001').includes(name) &&
                            'border-dashed'
                    )}
                >
                    {name === 'all' ? 'All' : name}
                </button>
            ))}
        </div>
    );
};

// Under an answer that placed badges: one line naming the three shapes,
// with a short explanation when opened.
export const MarksLegend: FC = () => {
    const hasMarks = useAuiState(
        s => (planOfMessage(s.message)?.marks.length ?? 0) > 0
    );
    if (!guidanceEnabled || !hasMarks) return null;
    return (
        <details className="group mt-1 px-2 text-[11px] text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                <span>Badges on the page:</span>
                <MarkShape mark={{ cue: 'result', number: 1 }} />
                answer
                <MarkShape mark={{ cue: 'context' }} />
                your cohort
                <MarkShape mark={{ cue: 'next_step' }} />
                next step
            </summary>
            <p className="mt-1 leading-snug">
                Numbers follow the order of the answer. Hover a number here or a
                badge on the page to find its match; click a number to scroll
                the page to it.
            </p>
        </details>
    );
};
