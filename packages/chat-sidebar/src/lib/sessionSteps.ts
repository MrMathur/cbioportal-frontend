// The steps of a session, read back from the thread's messages. A dashboard
// action reaches the model as a user message with a marker naming the action;
// a chat reply opens with a comment holding a short label for its step.

export type StepTrigger =
    | 'auto'
    | 'click'
    | 'clear'
    | 'term'
    | 'tab'
    | 'review'
    | 'chat';
export type ActionTrigger = Exclude<StepTrigger, 'chat'>;

export interface SessionStep {
    trigger: StepTrigger;
    label: string;
    // Where the step's exchange starts in the thread.
    messageIndex: number;
}

interface ThreadMessageLike {
    role: string;
    content: readonly { type: string; text?: string }[];
}

const DASHBOARD_MESSAGE = /^\[dashboard:(auto|click|clear|term|tab|review):([^\]]*)\]/;
const STEP_COMMENT = /^\s*<!--\s*step:\s*(.*?)\s*-->/;
const MAX_FALLBACK_LABEL_LENGTH = 20;

export function formatDashboardMessage(
    trigger: ActionTrigger,
    label: string,
    instruction: string
): string {
    return `[dashboard:${trigger}:${label.replace(/\]/g, ')')}] ${instruction}`;
}

export function parseDashboardMessage(
    text: string
): { trigger: ActionTrigger; label: string } | undefined {
    const match = DASHBOARD_MESSAGE.exec(text);
    if (!match) return undefined;
    return {
        trigger: match[1] as ActionTrigger,
        label: match[2],
    };
}

export function messageText(message: ThreadMessageLike): string {
    return message.content
        .map(part => (part.type === 'text' ? part.text ?? '' : ''))
        .join('');
}

function fallbackLabel(question: string): string {
    const text = question.trim();
    return text.length > MAX_FALLBACK_LABEL_LENGTH
        ? `${text.slice(0, MAX_FALLBACK_LABEL_LENGTH - 1)}…`
        : text;
}

export function getSessionSteps(
    messages: readonly ThreadMessageLike[]
): SessionStep[] {
    const steps: SessionStep[] = [];
    messages.forEach((message, messageIndex) => {
        if (message.role !== 'user') return;
        const text = messageText(message);
        const dashboard = parseDashboardMessage(text);
        if (dashboard) {
            steps.push({ ...dashboard, messageIndex });
            return;
        }
        const reply = messages[messageIndex + 1];
        const comment =
            reply?.role === 'assistant'
                ? STEP_COMMENT.exec(messageText(reply))
                : null;
        steps.push({
            trigger: 'chat',
            label: comment?.[1] || fallbackLabel(text),
            messageIndex,
        });
    });
    return steps;
}
