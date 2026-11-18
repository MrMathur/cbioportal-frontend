import { UIMessage } from 'ai';
import { matchCatalogFor } from './catalog';
import {
    guidanceEnabled,
    guidanceParticipant,
    guidanceSessionId,
} from './guidanceFlags';
import { getFixedForRequest } from './researchQuestion';
import { getLatestPageEvents } from './page-events';
import { markableTargets, pageTypeOf } from './pageTargets';
import { pageUpdateFor } from './pageUpdates';

// What the guided assistant adds to each chat request: the portal catalog
// entries the message may refer to, and what the user or page has fixed, for
// the server's classification (its classification.ts).

function textOf(message: UIMessage | undefined): string {
    return (message?.parts ?? [])
        .map(part => (part.type === 'text' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
}

export async function buildGuidancePayload(
    messages: UIMessage[],
    threadId: string | undefined,
    localThreadId: string
): Promise<Record<string, unknown> | undefined> {
    if (!guidanceEnabled) return undefined;
    const last = messages.at(-1);
    // Continuations after a client-side tool call reuse the turn's
    // classification, so they need no catalog.
    const text = last?.role === 'user' ? textOf(last) : '';
    const fixed = getFixedForRequest(threadId, localThreadId);
    // The fixed slots join the message so a cohort or study set in the box
    // is matched against the catalog too.
    const matchText = [
        text,
        ...Object.values(fixed.fixedSlots).map(s => s?.value ?? ''),
    ].join(' ');
    return {
        sessionId: guidanceSessionId,
        participant: guidanceParticipant,
        threadId: threadId ?? localThreadId,
        catalog: text ? await matchCatalogFor(matchText) : undefined,
        ...fixed,
        // What the reply may mark on the open page (set_highlights).
        pageType: pageTypeOf(getLatestPageEvents().settledSnapshot),
        pageTargets: markableTargets(getLatestPageEvents().settledSnapshot),
        // Set when the message reports a filter change made on the page.
        pageAction: text ? pageUpdateFor(text) : undefined,
    };
}
