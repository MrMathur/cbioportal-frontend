import { Entity } from './entities';
import { embedded, parentOrigin } from './parent-origin';

function post(entity: Entity | null): void {
    if (!embedded) return;
    window.parent.postMessage(
        { type: 'chat-sidebar:highlight', entity },
        parentOrigin()
    );
}

export function showHighlight(entity: Entity): void {
    post(entity);
}

export function clearHighlight(): void {
    post(null);
}

export function pinHighlights(entities: Entity[]): void {
    if (!embedded) return;
    window.parent.postMessage(
        { type: 'chat-sidebar:pinHighlights', entities },
        parentOrigin()
    );
}

// A term's own mouseleave can be missed when the pointer leaves the iframe
// quickly.
export function clearHighlightWhenPointerLeaves(): () => void {
    const root = document.documentElement;
    root.addEventListener('mouseleave', clearHighlight);
    window.addEventListener('blur', clearHighlight);
    return () => {
        root.removeEventListener('mouseleave', clearHighlight);
        window.removeEventListener('blur', clearHighlight);
    };
}
