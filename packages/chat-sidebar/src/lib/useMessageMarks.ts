import { useAuiState } from '@assistant-ui/react';
import { useMemo } from 'react';
import { BadgePlan, checkText } from './badgePlan';
import { planOfMessage, textOfMessage } from './messageParts';

/**
 * The badge plan of the message this text belongs to, and whether its text
 * links to it: 'chips' while streaming or when the text refers to every mark,
 * 'strip' when they disagree (the answer then shows without numbers).
 */
export function useMessageMarks(): {
    plan: BadgePlan | undefined;
    mode: 'chips' | 'strip';
} {
    const planJson = useAuiState(s => {
        const plan = planOfMessage(s.message);
        return plan ? JSON.stringify(plan) : '';
    });
    const plan = useMemo<BadgePlan | undefined>(
        () => (planJson ? JSON.parse(planJson) : undefined),
        [planJson]
    );
    const matches = useAuiState(s => {
        if (!plan || s.message.status?.type === 'running') return true;
        return checkText(textOfMessage(s.message), plan).ok;
    });
    return { plan, mode: plan && matches ? 'chips' : 'strip' };
}
