import {
    FC,
    ReactNode,
    useEffect,
    useMemo,
    useState,
    useSyncExternalStore,
} from 'react';
import {
    ChevronDownIcon,
    ChevronRightIcon,
    HistoryIcon,
    RotateCcwIcon,
    SearchIcon,
} from 'lucide-react';
import { getLatestPageEvents } from '@/lib/page-events';
import { notifyNavigate, resolvePortalLink } from '@/lib/portal-link';
import {
    getActiveResearch,
    restoreQuestion,
    subscribeToResearch,
} from '@/lib/researchQuestion';
import {
    compactQuestions,
    matchesSearch,
    QuestionEntry,
    QuestionMove,
    RECENT_TOPICS,
    relativeTime,
    Topic,
} from '@/lib/topics';
import { cn } from '@/lib/utils';

// The chat's earlier questions, grouped into topics, newest first, for the
// guided assistant. Restoring one brings back its question, its slots and the
// page it was worked on (Study View filters included).

const OPEN_KEY = 'chat-sidebar:earlierOpen';

const MOVE_LABELS: Record<QuestionMove, string> = {
    start: 'start',
    same: 'again',
    refine: 'refine',
    broaden: 'broaden',
    sibling: 'sibling',
};

const MOVE_STYLES: Record<QuestionMove, string> = {
    start: 'bg-[#3786c2]/15 text-[#3786c2]',
    same: 'bg-muted text-muted-foreground',
    refine: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    broaden: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    sibling: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};

function readOpen(): boolean {
    try {
        return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
        return false;
    }
}

// Study View's snapshot hash carries the filters as raw JSON; re-encoded so
// the router and the page's hash parser read it intact.
export function restorePath(href: string): string | null {
    const path = resolvePortalLink(href)?.path;
    if (!path) return null;
    const hashAt = path.indexOf('#');
    if (hashAt < 0) return path;
    const hash = path.slice(hashAt + 1);
    const match = /^filterJson=(.*)$/s.exec(hash);
    if (!match) return path;
    let json = match[1];
    try {
        json = decodeURIComponent(json);
    } catch {
        /* already raw */
    }
    return `${path.slice(0, hashAt)}#filterJson=${encodeURIComponent(json)}`;
}

const QuestionRow: FC<{
    entry: QuestionEntry;
    onRestore: () => void;
}> = ({ entry, onRestore }) => (
    <li className="group flex items-start gap-1.5 py-1">
        <span
            className={cn(
                'mt-px shrink-0 rounded px-1 text-[9px] font-medium tracking-wide uppercase',
                MOVE_STYLES[entry.move]
            )}
        >
            {MOVE_LABELS[entry.move]}
        </span>
        <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-xs leading-snug text-foreground">
                {entry.text}
            </p>
            {entry.finding && (
                <p className="truncate text-[11px] leading-snug text-muted-foreground">
                    {entry.finding}
                </p>
            )}
        </div>
        <button
            type="button"
            onClick={onRestore}
            title="Restore this question, its slots and its page"
            aria-label={`Restore: ${entry.text}`}
            className="mt-px shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
        >
            <RotateCcwIcon className="size-3" />
        </button>
    </li>
);

const TopicRow: FC<{
    topic: Topic;
    open: boolean;
    current: boolean;
    onToggle: () => void;
    onRestore: (entry: QuestionEntry) => void;
}> = ({ topic, open, current, onToggle, onRestore }) => {
    const [showAll, setShowAll] = useState(false);
    const { shown, hiddenCount } = compactQuestions(topic.questions);
    const list = showAll ? topic.questions : shown;
    const count = topic.questions.length;
    return (
        <li>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex w-full min-w-0 items-center gap-1 rounded py-0.5 text-left hover:bg-accent/60"
            >
                <ChevronRightIcon
                    className={cn(
                        'size-3 shrink-0 text-muted-foreground transition-transform',
                        open && 'rotate-90'
                    )}
                    aria-hidden
                />
                <span
                    className={cn(
                        'min-w-0 truncate text-xs',
                        current ? 'font-semibold' : 'font-medium'
                    )}
                >
                    {topic.title}
                </span>
                <span className="ml-auto shrink-0 pl-1 text-[10px] text-muted-foreground">
                    {count} {count === 1 ? 'question' : 'questions'} ·{' '}
                    {relativeTime(topic.updatedAt)}
                </span>
            </button>
            {open && (
                <ul className="ml-4 border-l border-border pl-2">
                    {list.map((entry, i) => (
                        <FragmentWithGap
                            key={entry.id}
                            showGap={!showAll && hiddenCount > 0 && i === 1}
                            hiddenCount={hiddenCount}
                            onExpand={() => setShowAll(true)}
                        >
                            <QuestionRow
                                entry={entry}
                                onRestore={() => onRestore(entry)}
                            />
                        </FragmentWithGap>
                    ))}
                </ul>
            )}
        </li>
    );
};

const FragmentWithGap: FC<{
    showGap: boolean;
    hiddenCount: number;
    onExpand: () => void;
    children: ReactNode;
}> = ({ showGap, hiddenCount, onExpand, children }) => (
    <>
        {showGap && (
            <li>
                <button
                    type="button"
                    onClick={onExpand}
                    className="py-0.5 text-[11px] text-[#3786c2] hover:underline"
                >
                    + {hiddenCount} earlier
                </button>
            </li>
        )}
        {children}
    </>
);

export const EarlierQuestions: FC = () => {
    const research = useSyncExternalStore(
        subscribeToResearch,
        getActiveResearch
    );
    const [open, setOpen] = useState(readOpen);
    const [query, setQuery] = useState('');
    const [showOlder, setShowOlder] = useState(false);
    // Topics the user opened or closed; the rest follow the default (only
    // the current topic open).
    const [toggled, setToggled] = useState<Record<string, boolean>>({});

    const topics = research.topics;
    const currentId = topics[0]?.id;

    // Another chat starts from the defaults.
    useEffect(() => {
        setToggled({});
        setShowOlder(false);
        setQuery('');
    }, [research.localThreadId]);

    const filtered = useMemo(
        () => topics.filter(t => matchesSearch(t, query)),
        [topics, query]
    );
    if (topics.length === 0) return null;

    const searching = query.trim().length > 0;
    const visible =
        showOlder || searching ? filtered : filtered.slice(0, RECENT_TOPICS);
    const olderCount = filtered.length - visible.length;

    const toggleBox = () => {
        const next = !open;
        setOpen(next);
        try {
            localStorage.setItem(OPEN_KEY, next ? '1' : '0');
        } catch {
            /* stays for this session */
        }
    };

    const isTopicOpen = (topic: Topic) =>
        toggled[topic.id] ?? (searching || topic.id === currentId);

    const restore = (topic: Topic, entry: QuestionEntry) => {
        restoreQuestion(
            research.threadId,
            research.localThreadId,
            entry,
            topic
        );
        if (!entry.href) return;
        const current = getLatestPageEvents().settledSnapshot?.href;
        if (current === entry.href) return;
        const path = restorePath(entry.href);
        if (path) notifyNavigate(path);
    };

    return (
        <section
            aria-label="Earlier questions"
            className="border-b border-border px-4 py-1.5"
        >
            <button
                type="button"
                onClick={toggleBox}
                aria-expanded={open}
                className="flex w-full items-center gap-1.5 text-left"
            >
                <HistoryIcon
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                />
                <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Earlier questions
                </span>
                <span className="text-[11px] text-muted-foreground">
                    ({topics.length} {topics.length === 1 ? 'topic' : 'topics'})
                </span>
                <ChevronDownIcon
                    className={cn(
                        'ml-auto size-3.5 text-muted-foreground transition-transform',
                        open && 'rotate-180'
                    )}
                    aria-hidden
                />
            </button>
            {open && (
                <div className="mt-1.5 max-h-64 overflow-y-auto pb-1">
                    <label className="mb-1.5 flex items-center gap-1 rounded-md border border-input bg-background px-1.5">
                        <SearchIcon
                            className="size-3 shrink-0 text-muted-foreground"
                            aria-hidden
                        />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search earlier questions"
                            aria-label="Search earlier questions"
                            className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none"
                        />
                    </label>
                    {visible.length === 0 ? (
                        <p className="py-1 text-xs text-muted-foreground">
                            No questions match.
                        </p>
                    ) : (
                        <ul className="space-y-0.5">
                            {visible.map(topic => (
                                <TopicRow
                                    key={topic.id}
                                    topic={topic}
                                    current={topic.id === currentId}
                                    open={isTopicOpen(topic)}
                                    onToggle={() =>
                                        setToggled(t => ({
                                            ...t,
                                            [topic.id]: !isTopicOpen(topic),
                                        }))
                                    }
                                    onRestore={entry => restore(topic, entry)}
                                />
                            ))}
                        </ul>
                    )}
                    {olderCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowOlder(true)}
                            className="mt-1 text-[11px] text-[#3786c2] hover:underline"
                        >
                            Show {olderCount} older{' '}
                            {olderCount === 1 ? 'topic' : 'topics'}
                        </button>
                    )}
                </div>
            )}
        </section>
    );
};
