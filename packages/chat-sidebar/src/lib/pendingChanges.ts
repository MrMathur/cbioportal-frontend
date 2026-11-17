// Dashboard changes the user made since the sidebar last analyzed the
// dashboard. They wait here until the user asks for an analysis.

export interface PendingChange {
    // Short name for the step trail, e.g. "PIK3CA".
    label: string;
    // What the user did, as a phrase for the model, e.g. "selected PIK3CA".
    description: string;
}

let pending: readonly PendingChange[] = [];
const listeners = new Set<() => void>();

export function subscribeToPendingChanges(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getPendingChanges(): readonly PendingChange[] {
    return pending;
}

export function setPendingChanges(next: readonly PendingChange[]): void {
    const same =
        next.length === pending.length &&
        next.every((c, i) => c.description === pending[i].description);
    if (same) return;
    pending = next;
    for (const listener of listeners) listener();
}
