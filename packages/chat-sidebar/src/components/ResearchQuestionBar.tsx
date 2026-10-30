import {
    FC,
    KeyboardEvent,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import {
    CrosshairIcon,
    EyeIcon,
    FocusIcon,
    LoaderIcon,
    PencilIcon,
    RotateCwIcon,
    XIcon,
} from 'lucide-react';
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    getHighlightsState,
    HighlightsState,
    retryHighlights,
    subscribeToHighlights,
} from '@/lib/highlights';
import {
    ActiveResearch,
    getActiveResearch,
    setActiveResearchThread,
    setResearchDismissed,
    setResearchFocus,
    setResearchQuestion,
    subscribeToResearch,
} from '@/lib/researchQuestion';
import { cn } from '@/lib/utils';

const PLACEHOLDER =
    'Set a research question to highlight the most relevant studies, charts and tabs on the page.';

function statusText(
    research: ActiveResearch,
    highlights: HighlightsState
): string | null {
    if (research.dismissed) return 'Highlights hidden';
    switch (highlights.status) {
        case 'loading':
            return 'Finding what on this page fits your question…';
        case 'error':
            return 'Couldn’t pick highlights for this page.';
        case 'ready':
            return highlights.annotations.length
                ? `${highlights.annotations.length} highlighted on this page`
                : 'Nothing on this page stands out for this question.';
        default:
            return highlights.candidateCount === 0
                ? 'Open a study list, study, results or comparison page to see highlights.'
                : null;
    }
}

// Lives inside the runtime provider: the question belongs to the chat the user
// is looking at.
export const ResearchQuestionBar: FC = () => {
    const aui = useAui();
    const remoteId = useAuiState(s => s.threadListItem.remoteId);
    const localThreadId = useAuiState(s => s.threadListItem.id);
    const research = useSyncExternalStore(
        subscribeToResearch,
        getActiveResearch
    );
    const highlights = useSyncExternalStore(
        subscribeToHighlights,
        getHighlightsState
    );

    useEffect(() => {
        setActiveResearchThread(remoteId, localThreadId);
    }, [remoteId, localThreadId]);

    const [editing, setEditing] = useState(false);
    // Briefly marks a question the chat just set, which would otherwise
    // change with nothing to draw the eye to it.
    const [chatFlash, setChatFlash] = useState(false);
    const lastChatUpdate = useRef(research.chatUpdate);
    useEffect(() => {
        if (research.chatUpdate === lastChatUpdate.current) return;
        lastChatUpdate.current = research.chatUpdate;
        setEditing(false);
        setChatFlash(true);
        const timeout = setTimeout(() => setChatFlash(false), 2500);
        return () => clearTimeout(timeout);
    }, [research.chatUpdate]);
    const [draft, setDraft] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (!editing) return;
        const el = textareaRef.current;
        el?.focus();
        el?.setSelectionRange(el.value.length, el.value.length);
    }, [editing]);

    // A different chat drops an unsaved edit.
    useEffect(() => setEditing(false), [remoteId]);

    const startEditing = () => {
        setDraft(research.question);
        setEditing(true);
    };

    const save = async () => {
        setEditing(false);
        const question = draft.trim();
        if (question === research.question && !research.dismissed) return;
        // A new chat has no id until it's saved; setting a question saves it.
        const threadId =
            research.threadId ??
            (await aui.threadListItem.initialize()).remoteId;
        setActiveResearchThread(threadId, localThreadId);
        setResearchQuestion(threadId, question);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
        }
    };

    const threadId = research.threadId;
    const hasQuestion = Boolean(research.question);
    const active =
        hasQuestion &&
        !research.dismissed &&
        highlights.status === 'ready' &&
        highlights.annotations.length > 0;
    const status = hasQuestion ? statusText(research, highlights) : null;

    return (
        <section
            aria-label="Research question"
            className={cn(
                'border-b border-border bg-gradient-to-b to-transparent px-4 pt-2.5 pb-2 transition-[background-color,box-shadow] duration-700',
                chatFlash
                    ? 'bg-[#3786c2]/10 from-[#3786c2]/15 shadow-[inset_3px_0_0_#3786c2]'
                    : 'from-sky-50/80 dark:from-sky-950/30'
            )}
        >
            <div className="flex items-center gap-1.5">
                <CrosshairIcon
                    aria-hidden="true"
                    className={cn(
                        'size-3.5 shrink-0 transition-colors',
                        active ? 'text-[#3786c2]' : 'text-muted-foreground'
                    )}
                />
                <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Research question
                </span>
                {chatFlash && (
                    <span
                        role="status"
                        className="fade-in slide-in-from-left-1 animate-in rounded-full bg-[#3786c2]/15 px-1.5 text-[10px] font-medium text-[#3786c2] duration-200"
                    >
                        Updated from chat
                    </span>
                )}
                {hasQuestion && !editing && threadId && (
                    <div className="ml-auto flex items-center gap-0.5">
                        <TooltipIconButton
                            tooltip={
                                research.focus
                                    ? 'Stop fading other elements'
                                    : 'Fade everything not highlighted'
                            }
                            size="icon-xs"
                            aria-pressed={research.focus}
                            disabled={research.dismissed}
                            onClick={() =>
                                setResearchFocus(threadId, !research.focus)
                            }
                            className={cn(
                                research.focus &&
                                    !research.dismissed &&
                                    'bg-[#3786c2]/15 text-[#3786c2] hover:bg-[#3786c2]/20 hover:text-[#3786c2]'
                            )}
                        >
                            <FocusIcon />
                        </TooltipIconButton>
                        <TooltipIconButton
                            tooltip="Edit question"
                            size="icon-xs"
                            onClick={startEditing}
                        >
                            <PencilIcon />
                        </TooltipIconButton>
                        {research.dismissed ? (
                            <TooltipIconButton
                                tooltip="Show highlights"
                                size="icon-xs"
                                onClick={() =>
                                    setResearchDismissed(threadId, false)
                                }
                            >
                                <EyeIcon />
                            </TooltipIconButton>
                        ) : (
                            <TooltipIconButton
                                tooltip="Dismiss highlights"
                                size="icon-xs"
                                onClick={() =>
                                    setResearchDismissed(threadId, true)
                                }
                            >
                                <XIcon />
                            </TooltipIconButton>
                        )}
                    </div>
                )}
            </div>

            {editing ? (
                <div className="mt-1.5">
                    <Textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="e.g. Does TP53 mutation status affect survival in breast cancer?"
                        aria-label="Research question"
                        rows={2}
                        className="min-h-12 resize-none bg-background text-sm"
                    />
                    <div className="mt-1.5 flex items-center justify-end gap-1.5">
                        <span className="mr-auto text-[11px] text-muted-foreground">
                            Enter to save · Esc to cancel
                        </span>
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setEditing(false)}
                        >
                            Cancel
                        </Button>
                        <Button size="xs" onClick={() => void save()}>
                            Save
                        </Button>
                    </div>
                </div>
            ) : hasQuestion ? (
                <button
                    type="button"
                    onClick={startEditing}
                    title="Edit question"
                    className="mt-1 line-clamp-3 w-full cursor-text rounded-md text-left text-sm leading-snug text-foreground hover:text-foreground/80"
                >
                    {research.question}
                </button>
            ) : (
                <button
                    type="button"
                    onClick={startEditing}
                    className="mt-1 w-full cursor-text rounded-md border border-dashed border-border px-2.5 py-1.5 text-left text-xs leading-snug text-muted-foreground transition-colors hover:border-[#3786c2]/50 hover:text-foreground"
                >
                    {PLACEHOLDER}
                </button>
            )}

            {!editing && status && (
                <div
                    role="status"
                    className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                    {highlights.status === 'loading' && !research.dismissed && (
                        <LoaderIcon className="size-3 animate-spin" />
                    )}
                    {active && (
                        <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full bg-[#3786c2]"
                        />
                    )}
                    <span className="min-w-0">{status}</span>
                    {highlights.status === 'error' && !research.dismissed && (
                        <Button
                            variant="link"
                            size="xs"
                            className="h-auto px-0 text-[11px]"
                            onClick={retryHighlights}
                        >
                            <RotateCwIcon />
                            Retry
                        </Button>
                    )}
                </div>
            )}

            {!editing && active && highlights.insight && (
                <p className="mt-1 text-xs leading-snug text-foreground/80">
                    {highlights.insight}
                </p>
            )}
        </section>
    );
};
