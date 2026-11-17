import {
    FC,
    ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { UIMessage } from 'ai';
import {
    getExternalStoreMessages,
    TextMessagePartProvider,
    useAui,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import {
    ArrowLeftIcon,
    CheckIcon,
    CopyIcon,
    FileDownIcon,
    RefreshCwIcon,
    TriangleAlertIcon,
} from 'lucide-react';
import { MarkdownText } from '@/components/assistant-ui/elements/markdown-text';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { cn } from '@/lib/utils';
import { cleanReport, streamReport } from '@/lib/report';
import { printHtml, reportHtml } from '@/lib/reportExport';
import {
    getSnapshotFindings,
    SnapshotChart,
    SnapshotFinding,
    splitSnapshot,
} from '@/lib/snapshot';

// Hex rather than the theme's variables, so the exported page keeps them.
const ROLE_COLORS: Record<string, string> = {
    subject: '#2196f3',
    compare: '#e91e63',
    filter: '#00897b',
    context: '#78909c',
};

const CHART_HEIGHT_PX = 140;

const SnapshotBarChart: FC<{ chart: SnapshotChart }> = ({ chart }) => {
    const max = Math.max(...chart.bars.map(b => b.value), 0) || 1;
    return (
        <figure
            style={{
                margin: '16px 0',
                padding: '12px 16px',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#fafafa',
            }}
        >
            <figcaption
                style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: '#555',
                    marginBottom: 12,
                }}
            >
                {chart.title}
            </figcaption>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-around',
                    gap: 12,
                }}
            >
                {chart.bars.map(bar => {
                    const color =
                        ROLE_COLORS[bar.role ?? ''] ?? ROLE_COLORS.context;
                    return (
                        <div
                            key={bar.label}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                flex: 1,
                                minWidth: 0,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color,
                                }}
                            >
                                {bar.value}
                                {chart.unit}
                            </span>
                            <div
                                style={{
                                    width: '60%',
                                    maxWidth: 56,
                                    height: Math.max(
                                        2,
                                        (bar.value / max) * CHART_HEIGHT_PX
                                    ),
                                    background: color,
                                    borderRadius: '3px 3px 0 0',
                                    marginTop: 4,
                                }}
                            />
                            <span
                                style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color,
                                    marginTop: 6,
                                    textAlign: 'center',
                                }}
                            >
                                {bar.label}
                            </span>
                            {bar.detail && (
                                <span
                                    style={{
                                        fontSize: 11,
                                        color: '#666',
                                        textAlign: 'center',
                                    }}
                                >
                                    {bar.detail}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
            {chart.caption && (
                <p
                    style={{
                        fontSize: 11,
                        fontStyle: 'italic',
                        color: '#666',
                        textAlign: 'center',
                        margin: '12px 0 0',
                    }}
                >
                    {chart.caption}
                </p>
            )}
        </figure>
    );
};

// The exported page has no dashboard to highlight, so entity links are text.
function ExportLink({
    href,
    children,
}: {
    href?: string;
    children?: ReactNode;
}) {
    return href?.startsWith('#entity/') ? (
        <span>{children}</span>
    ) : (
        <a href={href}>{children}</a>
    );
}

const EXPORT_COMPONENTS = { a: ExportLink };

// The snapshot's markdown with its charts drawn in place. `exported` renders
// the plain markup used for the PDF.
const SnapshotBody: FC<{
    text: string;
    streaming: boolean;
    exported?: boolean;
}> = ({ text, streaming, exported }) => {
    const segments = useMemo(
        () => splitSnapshot(cleanReport(text, () => undefined).markdown),
        [text]
    );
    return (
        <>
            {segments.map((segment, i) =>
                segment.kind === 'chart' ? (
                    <SnapshotBarChart key={i} chart={segment.chart} />
                ) : segment.kind === 'chart-pending' ? (
                    exported ? null : (
                        <Skeleton
                            key={i}
                            className="my-4 h-40 w-full motion-reduce:animate-none"
                        />
                    )
                ) : (
                    <TextMessagePartProvider
                        key={i}
                        text={segment.text}
                        isRunning={streaming && i === segments.length - 1}
                    >
                        {exported ? (
                            <MarkdownTextPrimitive
                                remarkPlugins={[remarkGfm]}
                                components={EXPORT_COMPONENTS}
                            />
                        ) : (
                            <MarkdownText />
                        )}
                    </TextMessagePartProvider>
                )
            )}
        </>
    );
};

const OptionCard: FC<{
    checked: boolean;
    onToggle: () => void;
    title: string;
    description?: string;
}> = ({ checked, onToggle, title, description }) => (
    <label
        className={cn(
            'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
            checked
                ? 'border-primary/50 bg-accent'
                : 'border-border hover:bg-muted/50'
        )}
    >
        <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="accent-primary mt-0.5 size-4 flex-shrink-0 cursor-pointer"
        />
        <span className="min-w-0">
            <span className="block text-sm font-semibold">{title}</span>
            {description && (
                <span className="text-muted-foreground block text-xs leading-snug">
                    {description}
                </span>
            )}
        </span>
    </label>
);

const SectionLabel: FC<{ children: ReactNode }> = ({ children }) => (
    <div className="text-primary mt-2 text-[11px] font-semibold tracking-wider uppercase">
        {children}
    </div>
);

type ReportState = {
    status: 'streaming' | 'done' | 'error';
    text: string;
};

const SKELETON_WIDTHS = ['w-2/3', 'w-full', 'w-5/6', 'w-full', 'w-3/4'];

// Picks findings from the session, then writes a short report on them.
export const SnapshotDialog: FC<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    model: string | undefined;
}> = ({ open, onOpenChange, model }) => {
    const aui = useAui();
    const [findings, setFindings] = useState<SnapshotFinding[]>([]);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const [frequencyChart, setFrequencyChart] = useState(true);
    const [comparisonTable, setComparisonTable] = useState(true);
    const [phase, setPhase] = useState<'select' | 'report'>('select');
    const [report, setReport] = useState<ReportState>({
        status: 'streaming',
        text: '',
    });
    const [generatedAt, setGeneratedAt] = useState<Date>();
    const controllerRef = useRef<AbortController>();
    const exportRef = useRef<HTMLDivElement>(null);
    const { isCopied, copyToClipboard } = useCopyToClipboard();

    // Each opening starts from the selection, with every finding picked.
    useEffect(() => {
        if (!open) {
            controllerRef.current?.abort();
            return;
        }
        const next = getSnapshotFindings(aui.thread.getState().messages);
        setFindings(next);
        setPicked(new Set(next.map(f => f.start)));
        setPhase('select');
    }, [open, aui]);

    const toggle = (start: number) =>
        setPicked(prev => {
            const next = new Set(prev);
            if (next.has(start)) next.delete(start);
            else next.add(start);
            return next;
        });

    const chosen = findings.filter(f => picked.has(f.start));

    const generate = useCallback(() => {
        controllerRef.current?.abort();
        const thread = aui.thread.getState().messages;
        const messages = chosen.flatMap(f =>
            thread
                .slice(f.start, f.end)
                .flatMap(m => getExternalStoreMessages<UIMessage>(m))
        );
        const controller = new AbortController();
        controllerRef.current = controller;
        setPhase('report');
        setGeneratedAt(new Date());
        setReport({ status: 'streaming', text: '' });
        streamReport(
            messages,
            model,
            controller.signal,
            text => setReport({ status: 'streaming', text }),
            {
                findings: chosen.map(f => f.title),
                frequencyChart,
                comparisonTable,
            }
        )
            .then(text => setReport({ status: 'done', text }))
            .catch(err => {
                if (controller.signal.aborted) return;
                console.warn('[chat-sidebar] snapshot failed', err);
                setReport(prev => ({ status: 'error', text: prev.text }));
            });
    }, [aui, chosen, model, frequencyChart, comparisonTable]);

    const exportPdf = () => {
        if (exportRef.current) printHtml(reportHtml(exportRef.current));
    };

    const { status, text } = report;
    const streaming = status === 'streaming';
    const done = status === 'done';
    const sessionLine = `Generated from ${chosen.length} of ${
        findings.length
    } session steps · ${generatedAt?.toLocaleDateString(undefined, {
        dateStyle: 'medium',
    }) ?? ''}`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[calc(100%-2rem)] flex-col gap-3 sm:max-w-[calc(100%-2rem)]">
                {phase === 'select' ? (
                    <>
                        <DialogHeader className="pr-8">
                            <DialogTitle>Generate Snapshot</DialogTitle>
                            <DialogDescription>
                                Select findings from your session to include in
                                a short scientific report.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4">
                            <SectionLabel>Include in report</SectionLabel>
                            {findings.length === 0 ? (
                                <p className="text-muted-foreground text-sm">
                                    No findings yet. Explore the dashboard or
                                    ask a question first.
                                </p>
                            ) : (
                                findings.map(f => (
                                    <OptionCard
                                        key={f.start}
                                        checked={picked.has(f.start)}
                                        onToggle={() => toggle(f.start)}
                                        title={f.title}
                                        description={f.summary}
                                    />
                                ))
                            )}
                            <SectionLabel>Include charts</SectionLabel>
                            <OptionCard
                                checked={frequencyChart}
                                onToggle={() => setFrequencyChart(v => !v)}
                                title="Frequency chart"
                                description="Bar chart of the frequencies these findings compare"
                            />
                            <OptionCard
                                checked={comparisonTable}
                                onToggle={() => setComparisonTable(v => !v)}
                                title="Comparison table"
                                description="Side-by-side table of the main genes or groups"
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                className="w-full"
                                onClick={generate}
                                disabled={chosen.length === 0}
                            >
                                Generate Snapshot Report
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader className="pr-8">
                            <div className="text-primary text-[11px] font-semibold tracking-wider uppercase">
                                Exploration snapshot
                            </div>
                            <DialogTitle className="sr-only">
                                Exploration snapshot
                            </DialogTitle>
                            <DialogDescription
                                className={
                                    status === 'error'
                                        ? 'text-destructive flex items-center gap-1.5'
                                        : undefined
                                }
                            >
                                {status === 'error' ? (
                                    <>
                                        <TriangleAlertIcon className="size-3.5 shrink-0" />
                                        {text
                                            ? 'Stopped before the snapshot was finished.'
                                            : 'Failed to generate the snapshot.'}
                                    </>
                                ) : streaming ? (
                                    <span className="shimmer motion-reduce:animate-none">
                                        {text
                                            ? 'Writing the snapshot…'
                                            : 'Reading the findings…'}
                                    </span>
                                ) : (
                                    sessionLine
                                )}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto border-t px-4 pt-2">
                            {text ? (
                                <SnapshotBody
                                    text={text}
                                    streaming={streaming}
                                />
                            ) : (
                                streaming && (
                                    <div className="flex flex-col gap-2.5 pt-1">
                                        {SKELETON_WIDTHS.map((width, i) => (
                                            <Skeleton
                                                key={i}
                                                className={`h-3.5 motion-reduce:animate-none ${width}`}
                                            />
                                        ))}
                                    </div>
                                )
                            )}
                        </div>
                        {done && (
                            <div ref={exportRef} hidden>
                                <p
                                    style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        letterSpacing: '0.05em',
                                        textTransform: 'uppercase',
                                        color: '#3786c2',
                                        margin: 0,
                                    }}
                                >
                                    Exploration snapshot
                                </p>
                                <SnapshotBody
                                    text={text}
                                    streaming={false}
                                    exported
                                />
                                <p style={{ fontSize: 12, color: '#666' }}>
                                    {sessionLine}
                                </p>
                            </div>
                        )}
                        <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 sm:justify-end">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="mr-auto"
                                onClick={() => setPhase('select')}
                            >
                                <ArrowLeftIcon />
                                Back
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={generate}
                                disabled={streaming}
                            >
                                <RefreshCwIcon />
                                {status === 'error' ? 'Retry' : 'Regenerate'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    copyToClipboard(
                                        cleanReport(text, () => undefined)
                                            .markdown
                                    )
                                }
                                disabled={!done}
                            >
                                {isCopied ? <CheckIcon /> : <CopyIcon />}
                                Copy
                            </Button>
                            <Button
                                size="sm"
                                onClick={exportPdf}
                                disabled={!done}
                            >
                                <FileDownIcon />
                                Export PDF
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};
