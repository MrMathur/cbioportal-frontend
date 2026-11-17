import { FC, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import {
    getSettledPageDetails,
    subscribeToSettledPage,
} from '@/lib/page-events';
import {
    getPendingChanges,
    PendingChange,
    setPendingChanges,
    subscribeToPendingChanges,
} from '@/lib/pendingChanges';
import { formatDashboardMessage } from '@/lib/sessionSteps';
import { getSidebarMode } from '@/lib/sidebar-mode';

const SETTLE_MS = 1200;
const RETRY_MS = 1500;

const TAB_LABELS: Record<string, string> = {
    summary: 'Summary',
    clinicalData: 'Clinical Data',
    plots: 'Plots',
};

interface DashboardState {
    tab: string;
    genes: string[];
    filters: string[];
    sampleCount: number;
}

function readDashboardState(): DashboardState | undefined {
    const details = getSettledPageDetails();
    if (details?.pageType !== 'study') return undefined;
    return {
        tab: details.currentTab as string,
        genes: (details.selectedGenes as string[] | undefined) ?? [],
        filters: (details.activeFilters as string[] | undefined) ?? [],
        sampleCount: (details.selectedSampleCount as number | undefined) ?? 0,
    };
}

function without(items: string[], others: string[]): string[] {
    return items.filter(item => !others.includes(item));
}

// What differs between the dashboard now and when it was last analyzed. A gene
// selected and then removed again is no change.
function diffDashboard(
    now: DashboardState,
    before: DashboardState
): PendingChange[] {
    const tabLabel = TAB_LABELS[now.tab] ?? now.tab;
    return [
        ...without(now.genes, before.genes).map(gene => ({
            label: gene,
            description: `selected ${gene}`,
        })),
        ...without(now.filters, before.filters).map(filter => ({
            label: filter,
            description: `filtered by ${filter}`,
        })),
        ...without(before.genes, now.genes)
            .concat(without(before.filters, now.filters))
            .map(item => ({
                label: `−${item}`,
                description: `removed ${item} from the selection`,
            })),
        ...(now.tab !== before.tab
            ? [
                  {
                      label: tabLabel,
                      description: `opened the ${tabLabel} tab`,
                  },
              ]
            : []),
    ];
}

function reviewMessage(
    changes: readonly PendingChange[],
    sampleCount: number
): string {
    return formatDashboardMessage(
        'review',
        changes.map(c => c.label).join(', '),
        `The user asked for an analysis of what they changed on the dashboard since your last reply: ${changes
            .map(c => c.description)
            .join(
                '; '
            )}. ${sampleCount} samples are now selected. Analyze what these changes show together in this cohort.`
    );
}

// Overviews a study on landing. After that, dashboard changes wait in the
// pending list until the user asks for an analysis, so the sidebar never
// replies to an action on its own.
export const DashboardTriggers: FC = () => {
    const aui = useAui();
    const threadId = useAuiState(s => s.threads.mainThreadId);
    const userMessageCount = useAuiState(
        s => s.thread.messages.filter(m => m.role === 'user').length
    );
    // The dashboard as of the last message sent to the model.
    const baseline = useRef<DashboardState>();
    const timer = useRef<ReturnType<typeof setTimeout>>();

    const refreshPending = () => {
        const state = readDashboardState();
        setPendingChanges(
            state && baseline.current
                ? diffDashboard(state, baseline.current)
                : []
        );
    };

    // Every message the model answers reads the live dashboard, so whatever
    // the user changed before it is no longer pending.
    useEffect(() => {
        baseline.current = readDashboardState();
        refreshPending();
    }, [userMessageCount, threadId]);

    useEffect(() => {
        const sendLanding = () => {
            clearTimeout(timer.current);
            timer.current = setTimeout(function attempt() {
                const thread = aui.thread().getState();
                if (thread.isRunning || thread.isLoading) {
                    timer.current = setTimeout(attempt, RETRY_MS);
                    return;
                }
                if (thread.messages.length > 0) return;
                if (getSidebarMode() !== 'expanded') return;
                aui.thread().append(
                    formatDashboardMessage(
                        'auto',
                        'Landing',
                        'The user just opened this study. Give an overview of the cohort.'
                    )
                );
            }, SETTLE_MS);
        };

        const check = () => {
            const state = readDashboardState();
            if (!state) return;
            if (!baseline.current) {
                baseline.current = state;
                sendLanding();
            }
            refreshPending();
        };

        check();
        return subscribeToSettledPage(check);
    }, [threadId]);

    useEffect(() => () => clearTimeout(timer.current), []);

    return null;
};

// Lists the dashboard changes waiting for analysis and sends them on request.
export const PendingChangesBar: FC = () => {
    const aui = useAui();
    const changes = useSyncExternalStore(
        subscribeToPendingChanges,
        getPendingChanges
    );
    const isRunning = useAuiState(s => s.thread.isRunning);

    if (changes.length === 0) return null;

    const summary = changes.map(c => c.description).join('; ');
    const analyze = () => {
        const state = readDashboardState();
        aui.thread().append(reviewMessage(changes, state?.sampleCount ?? 0));
    };

    return (
        <div className="mb-2 flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-xs">
            <span
                className="text-muted-foreground min-w-0 flex-1 truncate"
                title={summary}
            >
                {changes.length === 1
                    ? `You ${changes[0].description}`
                    : `${changes.length} dashboard changes: ${changes
                          .map(c => c.label)
                          .join(', ')}`}
            </span>
            <button
                type="button"
                onClick={analyze}
                disabled={isRunning}
                className="bg-primary text-primary-foreground cursor-pointer rounded-sm px-2 py-1 font-semibold whitespace-nowrap disabled:opacity-50"
            >
                Analyze {changes.length === 1 ? 'this' : 'changes'}
            </button>
        </div>
    );
};
