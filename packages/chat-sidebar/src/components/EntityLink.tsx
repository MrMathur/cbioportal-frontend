import {
    FC,
    KeyboardEvent,
    MouseEvent,
    ReactNode,
    useEffect,
    useRef,
    useSyncExternalStore,
} from 'react';
import { Entity, isEntityOnPage } from '@/lib/entities';
import { clearHighlight, showHighlight } from '@/lib/highlight';
import {
    getPinnedTerms,
    isPinned,
    subscribeToPinnedTerms,
    togglePinnedTerm,
} from '@/lib/pinnedTerms';
import {
    getSettledPageDetails,
    subscribeToSettledPage,
} from '@/lib/page-events';

// A term in a reply that highlights its dashboard element on hover or focus,
// and keeps it highlighted when clicked. Clicking never messages the model. A
// term with nothing on the current page keeps its styling but isn't
// interactive.
export const EntityLink: FC<{ entity: Entity; children?: ReactNode }> = ({
    entity,
    children,
}) => {
    const details = useSyncExternalStore(
        subscribeToSettledPage,
        getSettledPageDetails
    );
    const linked = isEntityOnPage(entity, details);
    const showing = useRef(false);
    const pinnedTerms = useSyncExternalStore(
        subscribeToPinnedTerms,
        getPinnedTerms
    );
    const pinned = linked && isPinned(pinnedTerms, entity);

    const show = () => {
        showing.current = true;
        showHighlight(entity);
    };
    const hide = () => {
        showing.current = false;
        clearHighlight();
    };

    const togglePin = (e: MouseEvent | KeyboardEvent) => {
        e.stopPropagation();
        togglePinnedTerm(entity, e.currentTarget.textContent ?? entity.id);
    };

    useEffect(
        () => () => {
            if (showing.current) clearHighlight();
        },
        []
    );

    return (
        <span
            className="entity"
            data-entity-type={entity.type}
            data-entity-role={entity.role}
            data-linked={linked}
            role={linked ? 'button' : undefined}
            tabIndex={linked ? 0 : undefined}
            aria-pressed={linked ? pinned : undefined}
            data-pinned={pinned}
            onClick={linked ? togglePin : undefined}
            onKeyDown={
                linked
                    ? e => {
                          if (e.key === 'Enter') togglePin(e);
                      }
                    : undefined
            }
            onMouseEnter={linked ? show : undefined}
            onMouseLeave={linked ? hide : undefined}
            onFocus={linked ? show : undefined}
            onBlur={linked ? hide : undefined}
        >
            {children}
        </span>
    );
};
