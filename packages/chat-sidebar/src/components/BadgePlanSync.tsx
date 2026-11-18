import { FC, useEffect } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { checkText } from '@/lib/badgePlan';
import { setActivePlan } from '@/lib/badgeState';
import { logGuidanceEvent } from '@/lib/guidanceLog';
import {
    classificationOfMessage,
    planOfMessage,
    textOfMessage,
} from '@/lib/messageParts';

// Keeps the portal's badges on the latest reply of the chat on screen: its
// set_highlights plan, linked to its text once the text is checked against
// it. Renders nothing.

// Replies whose mismatch has been logged, so a re-render doesn't log again.
const loggedMismatches = new Set<string>();

export const BadgePlanSync: FC = () => {
    const aui = useAui();
    const threadId = useAuiState(s => s.threadListItem.remoteId);
    // Changes when the latest reply changes, finishes, or gets its plan, and
    // when the thread stops running (which may come after the reply's own
    // status).
    const signature = useAuiState(s => {
        const messages = s.thread.messages;
        const running = s.thread.isRunning;
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role !== 'assistant') continue;
            const planned = m.content.some(
                p =>
                    p.type === 'tool-call' &&
                    p.toolName === 'set_highlights' &&
                    p.result !== undefined
            );
            return `${m.id}|${m.status?.type}|${planned}|${running}`;
        }
        return '';
    });

    useEffect(() => {
        const messages = aui.thread.getState().messages;
        const reply = [...messages].reverse().find(m => m.role === 'assistant');
        if (!reply) {
            setActivePlan(undefined);
            return;
        }
        const plan = planOfMessage(reply);
        // Between a tool call and the text that follows it the reply may not
        // be running yet still have no text: it is checked once written.
        const running =
            reply.status?.type === 'running' ||
            aui.thread.getState().isRunning ||
            !textOfMessage(reply).trim();
        if (plan) {
            const check = running
                ? undefined
                : checkText(textOfMessage(reply), plan);
            const linked = check ? check.linkable : true;
            setActivePlan({ messageId: reply.id, plan, linked });
            if (check && !check.ok && !loggedMismatches.has(reply.id)) {
                loggedMismatches.add(reply.id);
                logGuidanceEvent('badge_mismatch', threadId, {
                    message_id: reply.id,
                    missing: check.missing,
                    unknown: check.unknown,
                    misplaced: check.misplaced,
                    duplicated: check.duplicated,
                });
            }
            return;
        }
        const c = classificationOfMessage(reply);
        // A reply to a filter change on the page that placed no badges of its
        // own keeps the previous answer's: same panels, new cohort (the
        // context marker's tooltip follows the filters).
        if (c?.from_page && !c.page_navigation && !running) {
            const earlier = [...messages]
                .reverse()
                .find(
                    m =>
                        m.role === 'assistant' &&
                        m.id !== reply.id &&
                        planOfMessage(m)
                );
            const earlierPlan = earlier && planOfMessage(earlier);
            if (earlier && earlierPlan) {
                setActivePlan({
                    messageId: earlier.id,
                    plan: earlierPlan,
                    linked: checkText(textOfMessage(earlier), earlierPlan)
                        .linkable,
                });
                return;
            }
        }
        const none =
            running ||
            (c !== undefined &&
                (c.level === 'L2' ||
                    c.request_type === 'out_of_scope' ||
                    (c.request_type === 'data' && c.answerability !== 'ui')));
        setActivePlan(undefined, none);
    }, [aui, signature, threadId]);

    return null;
};
