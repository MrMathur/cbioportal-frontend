import { Entity } from './entities';

// Terms the user clicked in the reply on screen, each kept highlighted on the
// dashboard. Pinning stays local to the sidebar: nothing goes to the model.

export interface PinnedTerm {
    entity: Entity;
    term: string;
}

let pinned: readonly PinnedTerm[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly PinnedTerm[]): void {
    pinned = next;
    for (const listener of listeners) listener();
}

function keyOf(entity: Entity): string {
    return [entity.type, entity.chartKey, entity.id].join('/');
}

export function subscribeToPinnedTerms(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getPinnedTerms(): readonly PinnedTerm[] {
    return pinned;
}

export function isPinned(
    terms: readonly PinnedTerm[],
    entity: Entity
): boolean {
    return terms.some(t => keyOf(t.entity) === keyOf(entity));
}

export function togglePinnedTerm(entity: Entity, term: string): void {
    publish(
        isPinned(pinned, entity)
            ? pinned.filter(t => keyOf(t.entity) !== keyOf(entity))
            : [...pinned, { entity, term }]
    );
}

export function clearPinnedTerms(): void {
    if (pinned.length > 0) publish([]);
}
