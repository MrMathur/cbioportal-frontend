import { FC, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { ArrowRightIcon, MapPinIcon } from 'lucide-react';
import { BadgePlan, PlanMark } from '@/lib/badgePlan';
import {
    getBadgeState,
    hoverChip,
    scrollToMark,
    subscribeToBadges,
} from '@/lib/badgeState';
import { cn } from '@/lib/utils';

// The chip a reply's sentence starts with, styled like its badge on the
// portal: a numbered blue circle for a result, a grey ring with a pin for the
// context, an amber arrow for the next step. Hovering it pulses the badge;
// clicking scrolls the portal to it. Hovering the badge on the portal marks
// the chip's sentence here.

export const CUE_NAMES = {
    result: 'Answer',
    context: 'Your cohort',
    next_step: 'Next step',
} as const;

export const MarkShape: FC<{
    mark: Pick<PlanMark, 'cue' | 'number'>;
    className?: string;
}> = ({ mark, className }) => (
    <span
        aria-hidden="true"
        className={cn(
            'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full align-[-3px] text-[10.5px] leading-none font-semibold tabular-nums',
            mark.cue === 'result' && 'bg-[#3786c2] text-white',
            mark.cue === 'context' &&
                'border-[1.5px] border-slate-500 bg-white text-slate-600 dark:bg-transparent dark:text-slate-300',
            mark.cue === 'next_step' &&
                'rounded-[5px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
            className
        )}
    >
        {mark.cue === 'result' ? (
            mark.number
        ) : mark.cue === 'context' ? (
            <MapPinIcon className="size-[11px]" />
        ) : (
            <ArrowRightIcon className="size-3" />
        )}
    </span>
);

export const MarkChip: FC<{ token: string; plan: BadgePlan | undefined }> = ({
    token,
    plan,
}) => {
    const messageId = useAuiState(s => s.message.id);
    const threadId = useAuiState(s => s.threadListItem.remoteId);
    const badges = useSyncExternalStore(subscribeToBadges, getBadgeState);
    const ref = useRef<HTMLButtonElement>(null);
    const mark = plan?.marks.find(m => m.token === token);
    const active =
        badges.active?.messageId === messageId && badges.active.linked;
    const hovered = badges.hovered === `${messageId} ${token}`;

    // A badge hovered on the portal marks this chip's sentence.
    useEffect(() => {
        const block = ref.current?.closest('p, li, h1, h2, h3, h4, blockquote');
        if (!block) return;
        block.classList.toggle('chat-mark-sentence-active', hovered);
        if (hovered) ref.current?.scrollIntoView({ block: 'nearest' });
    }, [hovered]);

    if (!mark) return null;
    const label = `${CUE_NAMES[mark.cue]}${
        mark.number ? ` ${mark.number}` : ''
    }: ${mark.tooltip}`;
    return (
        <button
            ref={ref}
            type="button"
            title={active ? `${label}. Click to show it on the page.` : label}
            aria-label={active ? `${label}. Show it on the page` : label}
            aria-disabled={!active}
            data-mark-part={mark.part}
            onMouseEnter={() => active && hoverChip(messageId, token)}
            onMouseLeave={() => active && hoverChip(messageId, null)}
            onFocus={() => active && hoverChip(messageId, token)}
            onBlur={() => active && hoverChip(messageId, null)}
            onClick={() => active && scrollToMark(messageId, token, threadId)}
            className={cn(
                'me-1 inline-flex rounded-full align-baseline outline-none focus-visible:ring-2 focus-visible:ring-[#3786c2]/60',
                active ? 'cursor-pointer' : 'cursor-default opacity-60',
                hovered && 'ring-2 ring-[#3786c2]/50 ring-offset-1'
            )}
        >
            <MarkShape mark={mark} />
        </button>
    );
};
