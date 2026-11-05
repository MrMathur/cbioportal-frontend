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
    // Changes when the latest reply changes, finishes, or gets its plan.
    const signature = useAuiState(s => {
        const messages = s.thread.messages;
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m.role !== 'assistant') continue;
            const planned = m.content.some(
                p =>
                    p.type === 'tool-call' &&
                    p.toolName === 'set_highlights' &&
                    p.result !== undefined
            );
            return `${m.id}|${m.status?.type}|${planned}`;
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
        const running = reply.status?.type === 'running';
        if (plan) {
            const check = running
                ? undefined
                : checkText(textOfMessage(reply), plan);
            const linked = check ? check.ok : true;
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
