import { FC, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAui } from '@assistant-ui/react';
import { pageUpdatesEnabled } from '@/lib/guidanceFlags';
import { logGuidanceEvent } from '@/lib/guidanceLog';
import { rememberPageUpdate } from '@/lib/pageUpdates';
import {
    getActiveResearch,
    isFreshPageStep,
    subscribeToResearch,
} from '@/lib/researchQuestion';
import { pageUpdateMessage, QuestionEntry } from '@/lib/topics';

// Lets the chat answer what the user does on the page: filter changes, studies
// ticked, the gene form opened, another page opened. Once a page step
// (topics.ts) has settled, the sidebar sends a short message reporting it,
// and the assistant replies with an updated answer and badges. Renders
// nothing.

// Quiet time after the last filter click, so a burst of clicks is reported
// once.
const SETTLE_MS = 4000;
// While a reply is still running, how often to check again.
const RETRY_MS = 2000;

function stepKey(entry: QuestionEntry | undefined): string {
    return entry?.kind === 'page' ? `${entry.id}|${entry.at}` : '';
}

function latestStep(): QuestionEntry | undefined {
    return getActiveResearch().topics[0]?.questions.at(-1);
}

export const PageActionResponder: FC = () => {
    const aui = useAui();
    const research = useSyncExternalStore(
        subscribeToResearch,
        getActiveResearch
    );
    const key = stepKey(research.topics[0]?.questions.at(-1));
    const handled = useRef(new Set<string>());
    const thread = useRef<string | undefined>(undefined);

    // Steps already there when a chat opens (restored from an earlier visit)
    // were reported, or are past; only new ones get a message, including one
    // this tab recorded as the chat loaded (a page opened in a new tab).
    if (thread.current !== research.localThreadId) {
        thread.current = research.localThreadId;
        const latest = research.topics[0]?.questions.at(-1);
        if (key && !(latest && isFreshPageStep(latest.id))) {
            handled.current.add(key);
        }
    }

    useEffect(() => {
        if (!pageUpdatesEnabled || !key || handled.current.has(key)) return;
        let timer: ReturnType<typeof setTimeout>;
        const attempt = () => {
            const entry = latestStep();
            // A later click changed the step: its own timer reports it.
            if (stepKey(entry) !== key || !entry) return;
            if (aui.thread.getState().isRunning) {
                timer = setTimeout(attempt, RETRY_MS);
                return;
            }
            const text = pageUpdateMessage(entry);
            handled.current.add(key);
            // Only the tab the user is looking at reports its steps: after
            // the portal opens a page in a new tab, the chat follows that one.
            if (document.hidden) return;
            if (!text) return;
            if (entry.pageNavigation) {
                rememberPageUpdate(text, { navigation: entry.pageNavigation });
            } else if (
                entry.move === 'refine' ||
                entry.move === 'broaden' ||
                entry.move === 'sibling'
            ) {
                rememberPageUpdate(text, {
                    move: entry.move,
                    filters: entry.pageFilters ?? '',
                });
            } else {
                return;
            }
            aui.thread.append(text);
            const now = getActiveResearch();
            logGuidanceEvent(
                'page_update_sent',
                now.threadId ?? now.localThreadId,
                {
                    question_id: entry.id,
                    move: entry.pageNavigation ? 'navigation' : entry.move,
                    question: text,
                    href: entry.href ?? null,
                }
            );
        };
        timer = setTimeout(attempt, SETTLE_MS);
        return () => clearTimeout(timer);
    }, [aui, key]);

    return null;
};
