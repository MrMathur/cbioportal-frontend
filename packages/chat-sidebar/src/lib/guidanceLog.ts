import {
    guidanceEnabled,
    guidanceParticipant,
    guidanceSessionId,
} from './guidanceFlags';

// Client-side events for the guided assistant's research log (the server's
// guidanceLog.ts), next to the classifications the server writes itself.
export type GuidanceEvent =
    | 'slot_edit'
    | 'aim_edit'
    | 'question_edit'
    | 'restore'
    | 'topic_change'
    | 'option_pick'
    | 'send_question'
    | 'page_action'
    | 'portal_navigation'
    | 'badge_plan'
    | 'badge_mismatch'
    | 'badge_click'
    | 'part_select'
    | 'page_update_sent'
    | 'slot_answer_sent';

export function logGuidanceEvent(
    event: GuidanceEvent,
    threadId: string | undefined,
    payload: Record<string, unknown>
): void {
    if (!guidanceEnabled) return;
    fetch('/api/chat/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            event,
            sessionId: guidanceSessionId,
            participant: guidanceParticipant,
            threadId: threadId ?? '',
            payload,
        }),
        keepalive: true,
    }).catch(err => {
        console.warn('[chat-sidebar] guidance log failed', err);
    });
}
