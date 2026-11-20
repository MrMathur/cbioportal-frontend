import { FC, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useAui } from '@assistant-ui/react';
import {
    ChevronDownIcon,
    CompassIcon,
    LightbulbIcon,
    LucideIcon,
    MessageCircleQuestionIcon,
    SendIcon,
    SlidersHorizontalIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { SlotChip } from '@/components/SlotChip';
import { getStudyContext } from '@/lib/catalog';
import { SLOT_LABELS, SLOT_NAMES, SlotName } from '@/lib/classification';
import { logGuidanceEvent } from '@/lib/guidanceLog';
import { syncPortalToSlots } from '@/lib/portalSync';
import { slotAnswerMessage } from '@/lib/boxAnswers';
import { appendWhenIdle } from '@/lib/appendWhenIdle';
import { retryClassification } from '@/lib/classificationRetry';
import {
    ActiveResearch,
    setAimByUser,
    setQuestionByUser,
    setSlotByUser,
} from '@/lib/researchQuestion';
import { cn } from '@/lib/utils';

// The research question at three levels, for the guided assistant: the broad
// aim, the working question and the concrete analysis as slots. Filled from
// each message's classification, editable by the user. Gaps show as empty or
// flagged slots rather than as a level of their own. Kept compact: each level
// is one line marked by an icon, named in its tooltip, so the chat below
// keeps most of the sidebar's height.

const EXPANDED_KEY = 'chat-sidebar:researchExpanded';

function readExpanded(): boolean {
    try {
        return localStorage.getItem(EXPANDED_KEY) !== '0';
    } catch {
        return true;
    }
}

const MEASURE_PICKS = [
    'mutation frequency',
    'alteration frequency',
    'copy number',
    'mRNA expression',
    'overall survival',
    'progression-free survival',
    'disease-free survival',
    'TMB',
];

// Choices offered for an empty slot from what the open study holds.
function suggestionsFor(name: SlotName, research: ActiveResearch): string[] {
    const context = getStudyContext();
    switch (name) {
        case 'measure':
            return MEASURE_PICKS;
        case 'groups':
            return (context?.clinicalAttributes ?? [])
                .filter(a => a.datatype === 'STRING')
                .slice(0, 8)
                .map(a => `by ${a.name}`);
        case 'cohort': {
            const picks = (context?.cancerTypes ?? [])
                .slice(0, 6)
                .map(t => t.name);
            return research.slots.study.status === 'specified'
                ? ['whole study', ...picks]
                : picks;
        }
        default:
            return [];
    }
}

const EditableText: FC<{
    value: string;
    placeholder: string;
    label: string;
    emphasis?: boolean;
    // Lines shown before the text is cut; the full text is in the tooltip
    // and the editor.
    clamp: 1 | 3;
    onSave: (value: string) => void;
    onEditingChange?: (editing: boolean) => void;
}> = ({
    value,
    placeholder,
    label,
    emphasis,
    clamp,
    onSave,
    onEditingChange,
}) => {
    const [editing, setEditing] = useState(false);
    useEffect(() => onEditingChange?.(editing), [editing, onEditingChange]);
    const [draft, setDraft] = useState(value);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!editing) return;
        const el = ref.current;
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
    }, [editing]);

    const save = () => {
        setEditing(false);
        if (draft.trim() !== value) onSave(draft);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
        }
    };

    if (editing) {
        return (
            <Textarea
                ref={ref}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={save}
                aria-label={label}
                placeholder={placeholder}
                rows={2}
                className="min-h-10 resize-none bg-background text-sm"
            />
        );
    }
    return (
        <button
            type="button"
            title={
                value
                    ? `${value}\n\nClick to edit`
                    : `Edit ${label.toLowerCase()}`
            }
            onClick={() => {
                setDraft(value);
                setEditing(true);
            }}
            className={cn(
                'w-full cursor-text rounded-md text-left leading-snug',
                value && (clamp === 1 ? 'truncate' : 'line-clamp-3'),
                value
                    ? emphasis
                        ? 'text-sm text-foreground hover:text-foreground/80'
                        : 'text-xs text-foreground/80 hover:text-foreground'
                    : 'border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-[#3786c2]/50 hover:text-foreground'
            )}
        >
            {value || placeholder}
        </button>
    );
};

// Marks a level's line; its name is in the tooltip.
const LevelIcon: FC<{ icon: LucideIcon; label: string; hint: string }> = ({
    icon: Icon,
    label,
    hint,
}) => (
    <TooltipProvider>
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        tabIndex={0}
                        aria-label={label}
                        className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                }
            >
                <Icon className="size-3.5" aria-hidden />
            </TooltipTrigger>
            <TooltipContent
                side="left"
                className="max-w-56 flex-col items-start gap-0.5"
            >
                <span className="font-semibold">{label}</span>
                <span className="opacity-80">{hint}</span>
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
);

const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 300;

// The broad aim, and for an exploring question the working questions the
// user could pick: shown when hovering the aim (or from its lightbulb).
const AimLine: FC<{ research: ActiveResearch }> = ({ research }) => {
    const suggestions = research.questionSuggestions;
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);

    const later = (next: boolean, ms: number) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(next), ms);
    };
    const hoverable = suggestions.length > 0 && !editing;

    const pick = (question: string) => {
        setOpen(false);
        setQuestionByUser(research.threadId, research.localThreadId, question);
    };

    return (
        <Popover open={open && hoverable} onOpenChange={setOpen}>
            <div
                className="flex min-w-0 flex-1 items-start gap-1"
                onMouseEnter={() => hoverable && later(true, HOVER_OPEN_MS)}
                onMouseLeave={() => later(false, HOVER_CLOSE_MS)}
            >
                <div className="min-w-0 flex-1">
                    <EditableText
                        value={research.aim}
                        label="Broad aim"
                        placeholder="Broad aim, e.g. Understand KRAS in lung cancer"
                        clamp={1}
                        onEditingChange={setEditing}
                        onSave={text =>
                            setAimByUser(
                                research.threadId,
                                research.localThreadId,
                                text
                            )
                        }
                    />
                </div>
                {suggestions.length > 0 && (
                    <PopoverTrigger
                        render={
                            <button
                                type="button"
                                aria-label={`${suggestions.length} questions you could ask`}
                                title="Questions you could ask"
                                className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#3786c2]/10 px-1.5 text-[10px] leading-4 font-medium text-[#3786c2] hover:bg-[#3786c2]/20"
                            />
                        }
                    >
                        <LightbulbIcon className="size-3" aria-hidden />
                        {suggestions.length}
                    </PopoverTrigger>
                )}
            </div>
            <PopoverContent
                align="start"
                className="w-72 p-2 text-xs"
                onMouseEnter={() => clearTimeout(timer.current)}
                onMouseLeave={() => later(false, HOVER_CLOSE_MS)}
            >
                <p className="mb-1 font-medium text-foreground">
                    Questions you could ask
                </p>
                <div className="flex flex-col gap-1">
                    {suggestions.map(question => (
                        <button
                            key={question}
                            type="button"
                            onClick={() => pick(question)}
                            className="rounded-md border border-border px-2 py-1 text-left leading-snug hover:border-[#3786c2]/50 hover:bg-accent"
                        >
                            {question}
                        </button>
                    ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Pick one to make it your working question, then send it with
                    the arrow.
                </p>
            </PopoverContent>
        </Popover>
    );
};

export const ResearchLevels: FC<{ research: ActiveResearch }> = ({
    research,
}) => {
    const aui = useAui();
    const [expanded, setExpanded] = useState(readExpanded);
    const [retry, setRetry] = useState<'idle' | 'running' | 'failed'>('idle');

    // A new failure (or none) starts from the plain notice.
    useEffect(() => setRetry('idle'), [research.failedMessage]);

    const onRetry = async () => {
        setRetry('running');
        try {
            await retryClassification(aui.thread.getState().messages);
            setRetry('idle');
        } catch (err) {
            console.warn('[chat-sidebar] classification retry failed', err);
            setRetry('failed');
        }
    };
    const threadId = research.threadId;
    const localId = research.localThreadId;
    const logThread = threadId ?? localId;

    const toggle = () => {
        const next = !expanded;
        setExpanded(next);
        try {
            localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
        } catch {
            /* stays for this session */
        }
    };

    const gaps = SLOT_NAMES.filter(
        n => research.slots[n].status === 'ambiguous'
    ).length;
    const coreMissing = SLOT_NAMES.filter(
        n =>
            research.slots[n].status === 'missing' &&
            research.askedSlots.includes(n)
    ).length;
    const hasAnything =
        Boolean(research.question || research.aim) ||
        SLOT_NAMES.some(n => research.slots[n].status !== 'missing');

    const ask = (text: string, event: 'send_question' | 'ask_slot') => {
        if (!text.trim()) return;
        if (event === 'send_question') {
            logGuidanceEvent('send_question', logThread, {
                question: text,
            });
        }
        aui.thread.append(text);
    };

    const askAboutSlot = (name: SlotName) => {
        const question = research.question || research.aim;
        ask(
            `Help me choose the ${SLOT_LABELS[
                name
            ].toLowerCase()} for my question${
                question ? `: ${question}` : '.'
            }`,
            'ask_slot'
        );
    };

    const toggleButton = (
        <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={expanded}
            aria-label={
                expanded ? 'Hide aim and analysis' : 'Show aim and analysis'
            }
            title={expanded ? 'Collapse' : 'Expand'}
            onClick={toggle}
            className="text-muted-foreground"
        >
            <ChevronDownIcon
                className={cn('transition-transform', expanded && 'rotate-180')}
            />
        </Button>
    );

    const gapNote = [
        gaps ? `${gaps} to clarify` : '',
        coreMissing ? `${coreMissing} missing` : '',
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="mt-1 space-y-1">
            {research.failedMessage && (
                <div
                    role="status"
                    className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-200"
                >
                    <span className="min-w-0 flex-1 truncate">
                        {retry === 'failed'
                            ? 'Still couldn’t read your last message.'
                            : 'Not updated from your last message.'}
                    </span>
                    <Button
                        variant="link"
                        size="xs"
                        className="h-auto shrink-0 px-0 text-[11px]"
                        disabled={retry === 'running'}
                        onClick={() => void onRetry()}
                    >
                        {retry === 'running' ? 'Updating…' : 'Retry'}
                    </Button>
                </div>
            )}
            {(expanded || (!research.question && research.aim)) && (
                <div className="flex items-start gap-1.5">
                    <LevelIcon
                        icon={CompassIcon}
                        label="Broad aim"
                        hint="What you want to understand overall. Hover it for questions you could ask."
                    />
                    <AimLine research={research} />
                    {!expanded && toggleButton}
                </div>
            )}
            {(expanded || research.question || !research.aim) && (
                <div className="flex items-start gap-1.5">
                    <LevelIcon
                        icon={MessageCircleQuestionIcon}
                        label="Working question"
                        hint="The question you are answering now. Click it to edit."
                    />
                    <div className="min-w-0 flex-1">
                        <EditableText
                            value={research.question}
                            label="Working question"
                            placeholder={
                                research.questionSuggestions.length
                                    ? 'Pick a question from the aim, or write one'
                                    : hasAnything
                                    ? 'Write your question'
                                    : 'Ask in the chat, or write your question here'
                            }
                            emphasis
                            clamp={3}
                            onSave={text =>
                                setQuestionByUser(threadId, localId, text)
                            }
                        />
                    </div>
                    {!expanded && hasAnything && gapNote && (
                        <button
                            type="button"
                            onClick={toggle}
                            title="Show the analysis parts"
                            className="mt-0.5 shrink-0 rounded-full bg-yellow-100 px-1.5 text-[10px] leading-4 text-yellow-900 dark:bg-yellow-900/50 dark:text-yellow-100"
                        >
                            {gapNote}
                        </button>
                    )}
                    {research.editedSinceMessage && research.question && (
                        <TooltipIconButton
                            tooltip="Ask with this question"
                            size="icon-xs"
                            className="text-[#3786c2]"
                            onClick={() =>
                                ask(research.question, 'send_question')
                            }
                        >
                            <SendIcon />
                        </TooltipIconButton>
                    )}
                    {(expanded || !research.aim || research.question) &&
                        toggleButton}
                </div>
            )}

            {expanded && (
                <div className="flex items-start gap-1.5">
                    <LevelIcon
                        icon={SlidersHorizontalIcon}
                        label="Concrete analysis"
                        hint="The parts of the analysis. Yellow parts with ? need your answer; dashed ones are optional. An icon shows where each part came from: a speech bubble for the chat, a pointer for your clicks on the page, a pencil for your edits here. Click one to set it."
                    />
                    <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                        {SLOT_NAMES.map(name => (
                            <SlotChip
                                key={name}
                                name={name}
                                slot={research.slots[name]}
                                core={
                                    name === 'cohort' ||
                                    name === 'entity' ||
                                    name === 'measure'
                                }
                                asked={research.askedSlots.includes(name)}
                                cohort={
                                    research.slots.cohort.status === 'specified'
                                        ? research.slots.cohort.value ??
                                          undefined
                                        : undefined
                                }
                                suggestions={suggestionsFor(name, research)}
                                onSet={(value, via) => {
                                    const answersChat =
                                        Boolean(value) &&
                                        research.askedSlots.includes(name);
                                    setSlotByUser(
                                        threadId,
                                        localId,
                                        name,
                                        value,
                                        via
                                    );
                                    syncPortalToSlots();
                                    // The chat asked for this slot: filling it
                                    // here answers the chat.
                                    if (answersChat && value) {
                                        const text = slotAnswerMessage(
                                            name,
                                            value
                                        );
                                        appendWhenIdle(aui.thread, text, () =>
                                            logGuidanceEvent(
                                                'slot_answer_sent',
                                                logThread,
                                                {
                                                    slot: name,
                                                    new_value: value,
                                                    question: text,
                                                }
                                            )
                                        );
                                    }
                                }}
                                onAsk={() => askAboutSlot(name)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
