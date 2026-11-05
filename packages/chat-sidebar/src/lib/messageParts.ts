import { UIMessage } from 'ai';
import { ThreadMessage } from '@assistant-ui/react';
import { BadgePlan } from './badgePlan';
import { Classification, isClassification } from './classification';

// What a reply carries besides its text: the classification streamed before
// it and the badge plan its set_highlights call returned. In the AI SDK's
// messages (the runtime) and in assistant-ui's (the thread view).

/** The parts of the latest classified message's multi-part question. */
export function latestParts(messages: readonly UIMessage[]): string[] {
    for (let i = messages.length - 1; i >= 0; i--) {
        for (const part of messages[i].parts) {
            if (
                part.type === 'data-classification' &&
                isClassification((part as { data?: unknown }).data)
            ) {
                return (part as { data: Classification }).data.parts ?? [];
            }
        }
    }
    return [];
}

function isPlan(value: unknown): value is BadgePlan {
    const p = value as Partial<BadgePlan> | null;
    return !!p && Array.isArray(p.marks) && Array.isArray(p.parts);
}

/**
 * The badge plan a reply placed: its latest set_highlights result, since a
 * reply may call again to correct rejected marks.
 */
export function planOfMessage(message: ThreadMessage): BadgePlan | undefined {
    let plan: BadgePlan | undefined;
    for (const part of message.content) {
        if (part.type === 'tool-call' && part.toolName === 'set_highlights') {
            const result = part.result as { plan?: unknown } | undefined;
            if (isPlan(result?.plan)) plan = result.plan;
        }
    }
    return plan;
}

export function classificationOfMessage(
    message: ThreadMessage
): Classification | undefined {
    for (const part of message.content) {
        if (
            part.type === 'data' &&
            part.name === 'classification' &&
            isClassification(part.data)
        ) {
            return part.data;
        }
    }
    return undefined;
}

export function textOfMessage(message: ThreadMessage): string {
    return message.content
        .map(part => (part.type === 'text' ? part.text : ''))
        .filter(Boolean)
        .join('\n\n');
}
