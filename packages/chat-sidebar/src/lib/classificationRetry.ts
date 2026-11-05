import { ThreadMessage } from '@assistant-ui/react';
import { UIMessage } from 'ai';
import { getSelectedModel } from './chatSession';
import { Classification, isClassification } from './classification';
import { buildGuidancePayload } from './guidanceRequest';
import { getLatestPageEvents } from './page-events';
import { syncPortalToClassification } from './portalSync';
import { applyClassification, getActiveResearch } from './researchQuestion';

// Classifies the latest message again when its classification failed during
// the chat turn (it timed out, or the model call failed), so the research
// question box catches up.

function textOf(message: ThreadMessage): string {
    return message.content
        .map(part => (part.type === 'text' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
}

// The classification streamed with the latest reply that has one.
function latestClassification(
    messages: readonly ThreadMessage[]
): Classification | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        for (const part of messages[i].content) {
            if (
                part.type === 'data' &&
                part.name === 'classification' &&
                isClassification(part.data)
            ) {
                return part.data;
            }
        }
    }
    return undefined;
}

export async function retryClassification(
    messages: readonly ThreadMessage[]
): Promise<void> {
    const research = getActiveResearch();
    const message = research.failedMessage;
    const localThreadId = research.localThreadId;
    if (!message || !localThreadId) return;
    const lastAsked = messages.map(m => m.role).lastIndexOf('user');
    const history = messages
        .slice(0, lastAsked)
        .filter(m => m.role === 'user')
        .map(textOf)
        .filter(Boolean)
        .slice(-6);
    const asMessage: UIMessage = {
        id: 'retry',
        role: 'user',
        parts: [{ type: 'text', text: message }],
    };
    const guidance = await buildGuidancePayload(
        [asMessage],
        research.threadId,
        localThreadId
    );
    if (!guidance) return;
    const pageHref = getLatestPageEvents().snapshot?.href;
    const response = await fetch('/api/chat/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            model: getSelectedModel(),
            pageHref,
            guidance: {
                ...guidance,
                history,
                previous: latestClassification(messages),
            },
        }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { classification } = await response.json();
    if (!isClassification(classification)) {
        throw new Error('malformed classification');
    }
    applyClassification(
        research.threadId,
        localThreadId,
        classification,
        getLatestPageEvents().settledSnapshot?.href
    );
    syncPortalToClassification(classification, localThreadId);
}
