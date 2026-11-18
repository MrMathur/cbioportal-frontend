import { FC, FormEvent, useState } from 'react';
import { CircleHelpIcon, PlusIcon, SparklesIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Slot, SLOT_LABELS, SlotName } from '@/lib/classification';
import { getCatalog } from '@/lib/catalog';
import {
    resolveStudyText,
    searchStudies,
    studyLabel,
} from '@/lib/catalogMatch';
import { cn } from '@/lib/utils';

// One slot of the concrete analysis. Specified slots show their value;
// ambiguous ones are flagged and open their options; missing ones are empty
// and open the follow-up question. Every slot can be edited.

export const SLOT_PROMPTS: Record<SlotName, string> = {
    cohort: 'Which patients: which cancer type, or the whole study?',
    study: 'Which dataset (study) should the analysis use?',
    entity: 'Which gene, alteration or clinical attribute?',
    measure: 'What do you want to learn about it?',
    groups: 'Which groups should be compared?',
    filter: 'Should the patients be restricted (e.g. sex: female)?',
};

// Chip labels, short so the six chips fit on fewer lines; the full name is in
// the chip's tooltip and its popover.
const SHORT_LABELS: Record<SlotName, string> = {
    cohort: 'Cohort',
    study: 'Study',
    entity: 'Gene',
    measure: 'Measure',
    groups: 'Groups to compare',
    filter: 'Filter',
};

const SOURCE_LABELS: Record<Slot['source'], string> = {
    chat: 'from your message',
    user: 'set by you',
    page: 'from the page',
};

interface Props {
    name: SlotName;
    slot: Slot;
    core: boolean;
    // The chat is asking the user for this slot (askedSlotsOf).
    asked: boolean;
    // The cohort chosen, which the study search looks within first.
    cohort?: string;
    // Extra choices for an empty slot, e.g. the open study's attributes.
    suggestions: string[];
    onSet: (value: string | null, via: 'option' | 'typed' | 'cleared') => void;
    onAsk: () => void;
}

export const SlotChip: FC<Props> = ({
    name,
    slot,
    core,
    asked,
    cohort,
    suggestions,
    onSet,
    onAsk,
}) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const label = SLOT_LABELS[name];
    // Yellow with a question mark: ambiguous, or missing while the chat asks
    // for it.
    const needsAnswer =
        slot.status === 'ambiguous' || (slot.status === 'missing' && asked);
    const hasValue = slot.status !== 'missing' && Boolean(slot.value);

    const choose = (
        value: string | null,
        via: 'option' | 'typed' | 'cleared'
    ) => {
        onSet(value, via);
        setOpen(false);
        setDraft('');
    };

    // The study slot searches the portal's studies as the user types, and a
    // typed name that matches one study stores that study, so the portal can
    // open it.
    const catalog = name === 'study' ? getCatalog() : undefined;
    const typed = draft.trim();
    const searching =
        catalog !== undefined && typed.length >= 2 && typed !== slot.value;
    const studyResults = searching
        ? searchStudies(catalog, typed, cohort).map(studyLabel)
        : [];

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!typed) return;
        const resolved = catalog
            ? resolveStudyText(catalog, typed, cohort)
            : undefined;
        choose(resolved ?? typed, resolved ? 'option' : 'typed');
    };

    const options = slot.status === 'ambiguous' ? slot.options : [];
    const picks = (searching
        ? studyResults
        : [...(slot.status === 'missing' ? slot.options : []), ...suggestions]
    ).filter((v, i, all) => v && all.indexOf(v) === i && v !== slot.value);

    return (
        <Popover
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (next) setDraft(hasValue ? slot.value ?? '' : '');
            }}
        >
            <PopoverTrigger
                render={
                    <button
                        type="button"
                        title={`${label}${hasValue ? `: ${slot.value}` : ''}${
                            hasValue ? ` (${SOURCE_LABELS[slot.source]})` : ''
                        }${
                            needsAnswer
                                ? ' · Needs your answer: click to choose'
                                : ''
                        }`}
                        className={cn(
                            'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-left text-[11px] leading-4 transition-colors',
                            slot.status === 'specified' &&
                                'border-[#3786c2]/30 bg-[#3786c2]/10 text-foreground hover:bg-[#3786c2]/15',
                            needsAnswer &&
                                'border-yellow-500 bg-yellow-100 font-medium text-yellow-950 hover:bg-yellow-200 dark:bg-yellow-900/50 dark:text-yellow-100',
                            slot.status === 'missing' &&
                                !needsAnswer &&
                                cn(
                                    'border-dashed bg-transparent text-muted-foreground hover:border-[#3786c2]/50 hover:text-foreground',
                                    core
                                        ? 'border-muted-foreground/60'
                                        : 'border-border'
                                )
                        )}
                    />
                }
            >
                {needsAnswer ? (
                    <CircleHelpIcon
                        className="size-3 shrink-0 text-yellow-700 dark:text-yellow-300"
                        aria-hidden
                    />
                ) : slot.status === 'missing' ? (
                    <PlusIcon className="size-3 shrink-0" aria-hidden />
                ) : null}
                {needsAnswer && (
                    <span className="sr-only">Needs your answer: </span>
                )}
                <span className="shrink-0 font-medium">
                    {SHORT_LABELS[name]}
                </span>
                {hasValue && (
                    <span className="min-w-0 truncate">: {slot.value}</span>
                )}
                {slot.source === 'page' && hasValue && (
                    <span className="sr-only"> (from the page)</span>
                )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2.5 text-xs">
                <p className="mb-1.5 font-medium text-foreground">
                    {slot.status === 'ambiguous'
                        ? `“${slot.value}” could mean several things. Which one?`
                        : SLOT_PROMPTS[name]}
                </p>
                {hasValue && (
                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                        Now: {slot.value} · {SOURCE_LABELS[slot.source]}
                    </p>
                )}
                {options.length > 0 && (
                    <div className="mb-2 flex flex-col gap-1">
                        {options.map(option => (
                            <Button
                                key={option}
                                variant="outline"
                                size="xs"
                                className="h-auto justify-start py-1 text-left whitespace-normal"
                                onClick={() => choose(option, 'option')}
                            >
                                {option}
                            </Button>
                        ))}
                    </div>
                )}
                {searching && (
                    <p className="mb-1 text-[11px] text-muted-foreground">
                        {studyResults.length
                            ? 'Matching studies:'
                            : 'No study matches these words.'}
                    </p>
                )}
                {picks.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                        {picks.slice(0, 10).map(pick => (
                            <button
                                key={pick}
                                type="button"
                                title={pick}
                                onClick={() => choose(pick, 'option')}
                                className="max-w-full truncate rounded-full border border-border px-1.5 py-0.5 text-[11px] hover:border-[#3786c2]/50 hover:bg-accent"
                            >
                                {pick}
                            </button>
                        ))}
                    </div>
                )}
                <form onSubmit={submit} className="flex items-center gap-1">
                    <input
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        placeholder={`Type a ${label.toLowerCase()}`}
                        aria-label={label}
                        className="h-6 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    />
                    <Button type="submit" size="xs" disabled={!draft.trim()}>
                        Set
                    </Button>
                </form>
                <div className="mt-2 flex items-center justify-between gap-1">
                    <Button
                        variant="link"
                        size="xs"
                        className="h-auto px-0 text-[11px]"
                        onClick={() => {
                            setOpen(false);
                            onAsk();
                        }}
                    >
                        <SparklesIcon />
                        Ask the assistant
                    </Button>
                    {hasValue && (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="h-auto px-1 text-[11px]"
                            onClick={() => choose(null, 'cleared')}
                        >
                            <XIcon />
                            Clear
                        </Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};
