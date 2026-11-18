import * as React from 'react';
import { observer } from 'mobx-react';
import classnames from 'classnames';
import {
    emphasizeHighlight,
    getHighlights,
    highlightKey,
    HighlightAnnotation,
} from './highlightStore';
import {
    directionOf,
    findHighlightElement,
    isElementVisible,
    scrollToHighlight,
} from './highlightScroll';

// Badged elements that are off screen, as small buttons at the page's top or
// bottom edge ("↓ 2"), so the user knows the answer continues there and can
// jump to it. Context markers are left out: the cohort is the page itself.

interface Hidden {
    annotation: HighlightAnnotation;
    key: string;
    direction: 'above' | 'below';
}

const CHECK_MS = 600;

function findHidden(annotations: readonly HighlightAnnotation[]): Hidden[] {
    const hidden: Hidden[] = [];
    for (const annotation of annotations) {
        if (annotation.cue === 'context') continue;
        const key = highlightKey(annotation.targetType, annotation.targetId);
        const element = findHighlightElement(key);
        if (!element || isElementVisible(element)) continue;
        hidden.push({ annotation, key, direction: directionOf(element) });
    }
    return hidden;
}

// One badge's button; with a count, the shared button of several, which
// scrolls to the nearest of them (each click brings the next into view).
const EdgeButton: React.FunctionComponent<{ item: Hidden; count?: number }> = ({
    item,
    count,
}) => {
    const { annotation, direction, key } = item;
    const name =
        annotation.cue === 'result'
            ? `Answer ${annotation.number}`
            : 'Next step';
    return (
        <button
            type="button"
            className="chat-highlight-edge-button"
            title={
                count
                    ? `${count} badges ${direction}: scroll to the nearest`
                    : `${name}: ${annotation.reason}`
            }
            aria-label={
                count
                    ? `${count} answer badges ${direction}: scroll to the nearest`
                    : `Scroll to ${name.toLowerCase()}: ${annotation.reason}`
            }
            onClick={() => {
                scrollToHighlight(key);
                emphasizeHighlight(key);
            }}
        >
            <span aria-hidden="true">{direction === 'above' ? '↑' : '↓'}</span>
            <span
                className={classnames(
                    'chat-highlight-badge',
                    `chat-highlight-cue-${annotation.cue}`
                )}
                aria-hidden="true"
            >
                {annotation.cue === 'result' ? (
                    annotation.number
                ) : (
                    <i className="fa fa-arrow-right" />
                )}
            </span>
            {count && count > 1 && <span>+{count - 1}</span>}
        </button>
    );
};

// Up to this many off-screen badges get a button each; more share one
// button that steps through them, so they don't cover the page's controls.
const MAX_SEPARATE = 2;

const EdgeGroup: React.FunctionComponent<{
    items: Hidden[];
    direction: 'above' | 'below';
}> = ({ items, direction }) => {
    if (items.length === 0) return null;
    const label =
        direction === 'above' ? 'Answer badges above' : 'Answer badges below';
    return (
        <div
            className={`chat-highlight-edge chat-highlight-edge-${direction}`}
            role="group"
            aria-label={label}
        >
            {items.length <= MAX_SEPARATE ? (
                items.map(item => <EdgeButton key={item.key} item={item} />)
            ) : (
                <EdgeButton
                    item={items[direction === 'above' ? items.length - 1 : 0]}
                    count={items.length}
                />
            )}
        </div>
    );
};

export const ChatHighlightEdges: React.FunctionComponent = observer(() => {
    const annotations = getHighlights();
    const [hidden, setHidden] = React.useState<Hidden[]>([]);

    React.useEffect(() => {
        if (annotations.length === 0) {
            setHidden([]);
            return;
        }
        // Elements mount and move as the page loads and scrolls; a light
        // periodic check keeps up without observing every change.
        const check = () => {
            const next = findHidden(annotations);
            setHidden(previous =>
                previous.length === next.length &&
                previous.every(
                    (p, i) =>
                        p.key === next[i].key &&
                        p.direction === next[i].direction
                )
                    ? previous
                    : next
            );
        };
        check();
        const timer = setInterval(check, CHECK_MS);
        window.addEventListener('scroll', check, { passive: true });
        return () => {
            clearInterval(timer);
            window.removeEventListener('scroll', check);
        };
    }, [annotations]);

    const above = hidden.filter(h => h.direction === 'above');
    const below = hidden.filter(h => h.direction === 'below');
    return (
        <>
            <EdgeGroup items={above} direction="above" />
            <EdgeGroup items={below} direction="below" />
        </>
    );
});
