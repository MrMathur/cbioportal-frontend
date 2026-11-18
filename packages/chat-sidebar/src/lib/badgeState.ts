import { BadgePlan, markKey, PlanMark } from './badgePlan';
import { guidanceEnabled } from './guidanceFlags';
import { logGuidanceEvent } from './guidanceLog';
import { embedded, parentOrigin } from './parent-origin';

// The badges of the latest reply that placed some (its set_highlights call),
// the part chip selected for each reply, and which mark is hovered: the
// shared state of the chat's number chips, the portal's badges (via
// highlights.ts) and the part chips.

export interface ActivePlan {
    messageId: string;
    plan: BadgePlan;
    // Whether the text links to the marks (badgePlan.checkText); while the
    // reply streams it is assumed. Unlinked marks show without chat links.
    linked: boolean;
}

export interface BadgeState {
    active: ActivePlan | undefined;
    // The latest reply wants no badges at all (it asks for a missing part,
    // or there is no path in the portal).
    none: boolean;
    selectedParts: Readonly<Record<string, string>>;
    // The mark hovered, in the chat or on the portal: '<messageId> <token>'.
    hovered: string | undefined;
}

let state: BadgeState = {
    active: undefined,
    none: false,
    selectedParts: {},
    hovered: undefined,
};

const listeners = new Set<() => void>();

export function subscribeToBadges(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getBadgeState(): BadgeState {
    return state;
}

function publish(next: BadgeState): void {
    state = next;
    for (const listener of listeners) listener();
}

function samePlan(a: ActivePlan | undefined, b: ActivePlan | undefined) {
    return (
        a?.messageId === b?.messageId &&
        a?.linked === b?.linked &&
        JSON.stringify(a?.plan) === JSON.stringify(b?.plan)
    );
}

export function setActivePlan(
    active: ActivePlan | undefined,
    none = false
): void {
    if (samePlan(active, state.active) && none === state.none) return;
    publish({ ...state, active, none });
}

export function getSelectedPart(messageId: string): string {
    return state.selectedParts[messageId] ?? 'all';
}

export function selectPart(
    messageId: string,
    part: string,
    threadId: string | undefined
): void {
    if (getSelectedPart(messageId) === part) return;
    publish({
        ...state,
        selectedParts: { ...state.selectedParts, [messageId]: part },
    });
    logGuidanceEvent('part_select', threadId, { part, message_id: messageId });
}

function activeMark(token: string): PlanMark | undefined {
    return state.active?.plan.marks.find(m => m.token === token);
}

function post(message: object): void {
    if (embedded) window.parent.postMessage(message, parentOrigin());
}

/** A chip in the chat is hovered (null when it no longer is). */
export function hoverChip(messageId: string, token: string | null): void {
    if (!guidanceEnabled) return;
    const isActive =
        state.active?.messageId === messageId && state.active.linked;
    const mark = token && isActive ? activeMark(token) : undefined;
    post({
        type: 'chat-sidebar:badgeHover',
        key: mark ? markKey(mark) : null,
    });
    const hovered = mark ? `${messageId} ${token}` : undefined;
    if (hovered !== state.hovered) publish({ ...state, hovered });
}

/** A chip in the chat is clicked: the portal scrolls to its badge. */
export function scrollToMark(
    messageId: string,
    token: string,
    threadId: string | undefined
): void {
    if (state.active?.messageId !== messageId || !state.active.linked) return;
    const mark = activeMark(token);
    if (!mark) return;
    post({ type: 'chat-sidebar:badgeScroll', key: markKey(mark) });
    logGuidanceEvent('badge_click', threadId, {
        message_id: messageId,
        question: token,
        target: markKey(mark),
        elsewhere: mark.elsewhere ?? false,
    });
}

/** A badge on the portal is hovered: the chat marks its sentence. */
export function setHoveredFromPortal(key: string | null): void {
    const active = state.active;
    const mark =
        key && active?.linked
            ? active.plan.marks.find(m => markKey(m) === key)
            : undefined;
    const hovered =
        mark && active ? `${active.messageId} ${mark.token}` : undefined;
    if (hovered !== state.hovered) publish({ ...state, hovered });
}
