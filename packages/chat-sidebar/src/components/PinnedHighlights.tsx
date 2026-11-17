import { FC, useEffect, useSyncExternalStore } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { pinHighlights } from '@/lib/highlight';
import {
    clearPinnedTerms,
    getPinnedTerms,
    subscribeToPinnedTerms,
} from '@/lib/pinnedTerms';
import { formatDashboardMessage } from '@/lib/sessionSteps';
import { getSidebarMode, subscribeToSidebarMode } from '@/lib/sidebar-mode';

// Keeps the dashboard in step with the pinned terms. Pins belong to the reply
// on screen, so they clear when that reply is replaced.
export const PinnedHighlights: FC = () => {
    const pinned = useSyncExternalStore(subscribeToPinnedTerms, getPinnedTerms);
    const sidebarMode = useSyncExternalStore(
        subscribeToSidebarMode,
        getSidebarMode
    );
    const threadId = useAuiState(s => s.threads.mainThreadId);
    const exchangeCount = useAuiState(
        s => s.thread.messages.filter(m => m.role === 'user').length
    );

    useEffect(clearPinnedTerms, [threadId, exchangeCount]);

    useEffect(() => {
        pinHighlights(
            sidebarMode === 'expanded' ? pinned.map(t => t.entity) : []
        );
    }, [pinned, sidebarMode]);

    return null;
};

// The one way pinned terms reach the model: the user asks.
export const PinnedTermsBar: FC = () => {
    const aui = useAui();
    const pinned = useSyncExternalStore(subscribeToPinnedTerms, getPinnedTerms);
    const isRunning = useAuiState(s => s.thread.isRunning);

    if (pinned.length === 0) return null;

    const terms = pinned.map(t => t.term).join(', ');
    const ask = () =>
        aui
            .thread()
            .append(
                formatDashboardMessage(
                    'term',
                    terms,
                    `The user picked these from your analysis: ${terms}. Tell them more about ${
                        pinned.length > 1 ? 'how these relate' : 'this'
                    }, in the context of their exploration.`
                )
            );

    return (
        <div className="mb-2 flex items-center gap-2 rounded-sm bg-accent px-3 py-1.5 text-xs text-primary">
            <span className="min-w-0 flex-1 truncate" title={terms}>
                {pinned.length} highlighted
            </span>
            <button
                type="button"
                onClick={ask}
                disabled={isRunning}
                className="cursor-pointer font-semibold whitespace-nowrap underline underline-offset-2 disabled:opacity-50"
            >
                Ask about {pinned.length > 1 ? 'these' : 'this'}
            </button>
            <button
                type="button"
                onClick={clearPinnedTerms}
                className="cursor-pointer whitespace-nowrap"
            >
                Clear
            </button>
        </div>
    );
};
