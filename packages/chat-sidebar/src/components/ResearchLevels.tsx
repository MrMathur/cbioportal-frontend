import { FC, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useAui } from '@assistant-ui/react';
import { ChevronDownIcon, SendIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SlotChip } from '@/components/SlotChip';
import { getStudyContext } from '@/lib/catalog';
import { SLOT_LABELS, SLOT_NAMES, SlotName } from '@/lib/classification';
import { logGuidanceEvent } from '@/lib/guidanceLog';
import {
    ActiveResearch,
    setAimByUser,
    setQuestionByUser,
    setSlotByUser,
} from '@/lib/researchQuestion';
import { cn } from '@/lib/utils';

// The research question at three levels, for the guided assistant: the broad
// aim (L1), the working question (L3) and the concrete analysis as slots
// (L4). Filled from each message's classification, editable by the user.
// Gaps show as empty or flagged slots rather than as a level of their own.

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
    onSave: (value: string) => void;
}> = ({ value, placeholder, label, emphasis, onSave }) => {
    const [editing, setEditing] = useState(false);
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
            title={`Edit ${label.toLowerCase()}`}
            onClick={() => {
                setDraft(value);
                setEditing(true);
            }}
            className={cn(
                'w-full cursor-text rounded-md text-left leading-snug',
                value
                    ? emphasis
                        ? 'text-sm text-foreground hover:text-foreground/80'
                        : 'text-xs text-foreground/80 hover:text-foreground'
                    : 'border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-[#3786c2]/50 hover:text-foreground'
            )}
        >
            {value || placeholder}
        </button>
    );
};

const LevelLabel: FC<{ children: string; level: string }> = ({
    children,
    level,
}) => (
    <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        <span>{children}</span>
        <span className="rounded bg-muted px-1 text-[9px]">{level}</span>
    </div>
);

export const ResearchLevels: FC<{ research: ActiveResearch }> = ({
    research,
}) => {
    const aui = useAui();
    const [expanded, setExpanded] = useState(readExpanded);
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
    const coreMissing = (['cohort', 'entity', 'measure'] as SlotName[]).filter(
        n => research.slots[n].status === 'missing'
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

    return (
        <div className="mt-1">
            <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                    {expanded && (
                        <LevelLabel level="L3">Working question</LevelLabel>
                    )}
                    <EditableText
                        value={research.question}
                        label="Working question"
                        placeholder={
                            hasAnything
                                ? 'Write your question'
                                : 'Ask in the chat below, or write your aim or question here; the rest is drafted for you.'
                        }
                        emphasis
                        onSave={text =>
                            setQuestionByUser(threadId, localId, text)
                        }
                    />
                </div>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-expanded={expanded}
                    aria-label={
                        expanded
                            ? 'Hide aim and analysis'
                            : 'Show aim and analysis'
                    }
                    title={expanded ? 'Collapse' : 'Expand'}
                    onClick={toggle}
                    className="mt-0.5 text-muted-foreground"
                >
                    <ChevronDownIcon
                        className={cn(
                            'transition-transform',
                            expanded && 'rotate-180'
                        )}
                    />
                </Button>
            </div>

            {!expanded && hasAnything && (gaps > 0 || coreMissing > 0) && (
                <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                    {[
                        gaps ? `${gaps} to clarify` : '',
                        coreMissing ? `${coreMissing} missing` : '',
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
            )}

            {expanded && (
                <div className="mt-2 space-y-2">
                    <div>
                        <LevelLabel level="L1">Broad aim</LevelLabel>
                        <EditableText
                            value={research.aim}
                            label="Broad aim"
                            placeholder="e.g. Understand KRAS in lung cancer"
                            onSave={text =>
                                setAimByUser(threadId, localId, text)
                            }
                        />
                    </div>
                    <div>
                        <LevelLabel level="L4">Concrete analysis</LevelLabel>
                        <div className="flex flex-wrap gap-1">
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
                                    suggestions={suggestionsFor(name, research)}
                                    onSet={(value, via) =>
                                        setSlotByUser(
                                            threadId,
                                            localId,
                                            name,
                                            value,
                                            via
                                        )
                                    }
                                    onAsk={() => askAboutSlot(name)}
                                />
                            ))}
                        </div>
                        {research.concrete && (
                            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                                {research.concrete}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {research.editedSinceMessage && research.question && (
                <Button
                    size="xs"
                    variant="outline"
                    className="mt-2"
                    onClick={() => ask(research.question, 'send_question')}
                >
                    <SendIcon />
                    Ask with this question
                </Button>
            )}
        </div>
    );
};
