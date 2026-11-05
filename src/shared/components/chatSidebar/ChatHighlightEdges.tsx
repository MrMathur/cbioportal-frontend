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

const EdgeButton: React.FunctionComponent<{ item: Hidden }> = ({ item }) => {
    const { annotation, direction, key } = item;
    const name =
        annotation.cue === 'result'
            ? `Answer ${annotation.number}`
            : 'Next step';
    return (
        <button
            type="button"
            className="chat-highlight-edge-button"
            title={`${name}: ${annotation.reason}`}
            aria-label={`Scroll to ${name.toLowerCase()}: ${annotation.reason}`}
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
        </button>
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
            {above.length > 0 && (
                <div
                    className="chat-highlight-edge chat-highlight-edge-above"
                    role="group"
                    aria-label="Answer badges above"
                >
                    {above.map(item => (
                        <EdgeButton key={item.key} item={item} />
                    ))}
                </div>
            )}
            {below.length > 0 && (
                <div
                    className="chat-highlight-edge chat-highlight-edge-below"
                    role="group"
                    aria-label="Answer badges below"
                >
                    {below.map(item => (
                        <EdgeButton key={item.key} item={item} />
                    ))}
                </div>
            )}
        </>
    );
});
