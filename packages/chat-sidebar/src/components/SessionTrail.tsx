import { FC, useMemo, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { ChevronDownIcon } from 'lucide-react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { getSessionSteps, SessionStep, StepTrigger } from '@/lib/sessionSteps';

const TRIGGER_ICON: Record<StepTrigger, string> = {
    auto: '📍',
    click: '👆',
    clear: '↩️',
    term: '🔎',
    chat: '💬',
    tab: '📊',
    review: '🔍',
};

// Scrolls the thread to the first rendered message of the exchange starting at
// `messageIndex`. A landing step's own message is hidden, so its reply is used.
function scrollToStep(messageIndex: number): void {
    const wrappers = document.querySelectorAll<HTMLElement>(
        '[data-message-index]'
    );
    const target = Array.from(wrappers)
        .filter(el => Number(el.dataset.messageIndex) >= messageIndex)
        .map(el => el.firstElementChild)
        .find(el => el !== null);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const StepName: FC<{ step: SessionStep }> = ({ step }) => (
    <>
        <span aria-hidden>{TRIGGER_ICON[step.trigger]}</span>{' '}
        <span className="truncate">{step.label}</span>
    </>
);

// The session's steps, folded into one line that shows the latest step. The
// dropdown lists every step; picking one scrolls the thread to it.
export const SessionTrail: FC = () => {
    // Serialized because the selector must return a stable value.
    const serialized = useAuiState(s =>
        JSON.stringify(getSessionSteps(s.thread.messages))
    );
    const steps = useMemo<SessionStep[]>(() => JSON.parse(serialized), [
        serialized,
    ]);
    const [open, setOpen] = useState(false);

    if (steps.length === 0) return null;

    const current = steps[steps.length - 1];
    return (
        <nav
            aria-label="Session steps"
            className="bg-muted/40 border-border border-b px-4 py-1 text-xs"
        >
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    render={
                        <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground flex max-w-full cursor-pointer items-center gap-1.5 py-0.5"
                        >
                            <span className="whitespace-nowrap">
                                Step {steps.length}:
                            </span>
                            <span className="text-foreground flex min-w-0 items-center gap-1 font-semibold">
                                <StepName step={current} />
                            </span>
                            <ChevronDownIcon className="size-3.5 flex-shrink-0" />
                        </button>
                    }
                />
                <PopoverContent align="start" className="w-72 p-1">
                    <ol className="flex flex-col">
                        {steps.map((step, i) => (
                            <li key={step.messageIndex}>
                                <button
                                    type="button"
                                    aria-current={
                                        step === current ? 'step' : undefined
                                    }
                                    onClick={() => {
                                        setOpen(false);
                                        scrollToStep(step.messageIndex);
                                    }}
                                    className="hover:bg-muted aria-[current=step]:font-semibold flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs"
                                >
                                    <span className="text-muted-foreground w-4 flex-shrink-0 text-right">
                                        {i + 1}
                                    </span>
                                    <StepName step={step} />
                                </button>
                            </li>
                        ))}
                    </ol>
                </PopoverContent>
            </Popover>
        </nav>
    );
};
