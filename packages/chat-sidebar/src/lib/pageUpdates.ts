// The messages the sidebar sends for changes the user made on the page, so
// the request that carries one can tell the server it is a page change
// rather than a typed question: a filter change (its move, the filters now
// applied) or another step (what the user did).

export type PageUpdate =
    | { move: 'refine' | 'broaden' | 'sibling'; filters: string }
    | { navigation: string };

const sent = new Map<string, PageUpdate>();
const MAX_REMEMBERED = 20;

export function rememberPageUpdate(text: string, update: PageUpdate): void {
    sent.set(text, update);
    if (sent.size > MAX_REMEMBERED) sent.delete(sent.keys().next().value!);
}

/** The page change a message reports, if the sidebar sent it. */
export function pageUpdateFor(text: string): PageUpdate | undefined {
    return sent.get(text.trim());
}
