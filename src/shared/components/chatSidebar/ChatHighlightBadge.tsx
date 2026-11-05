import * as React from 'react';
import { observer } from 'mobx-react';
import classnames from 'classnames';
import { DefaultTooltip } from 'cbioportal-frontend-commons';
import {
    getHighlight,
    getHoveredHighlight,
    highlightKey,
    HighlightAnnotation,
    HighlightTargetType,
    notifyBadgeHover,
} from './highlightStore';
import './ChatHighlight.scss';

interface IChatHighlightBadgeProps {
    targetType: HighlightTargetType;
    targetId: string;
    className?: string;
}

const CUE_NAMES: Record<HighlightAnnotation['cue'], string> = {
    result: 'Answer',
    context: 'Your cohort',
    next_step: 'Next step',
};

// The badge's mark, also opening its tooltip so the two match the chat: the
// number for a result, a pin for the context, an arrow for a next step.
const BadgeMark: React.FunctionComponent<{
    annotation: HighlightAnnotation;
}> = ({ annotation }) =>
    annotation.cue === 'result' ? (
        <>{annotation.number}</>
    ) : (
        <i
            className={classnames(
                'fa',
                annotation.cue === 'context'
                    ? 'fa-map-marker'
                    : 'fa-arrow-right'
            )}
            aria-hidden="true"
        />
    );

/**
 * An element the chat points at, with the reason on hover or keyboard focus:
 * a numbered circle for a part of the answer, a ring for the cohort being
 * looked at, an arrow for a possible next step. Renders nothing unless the
 * element is currently highlighted.
 */
export const ChatHighlightBadge: React.FunctionComponent<IChatHighlightBadgeProps> = observer(
    ({ targetType, targetId, className }) => {
        const annotation = getHighlight(targetType, targetId);
        if (!annotation) return null;
        const hovered =
            getHoveredHighlight() === highlightKey(targetType, targetId);
        const name = `${CUE_NAMES[annotation.cue]}${
            annotation.number ? ` ${annotation.number}` : ''
        }`;
        return (
            <DefaultTooltip
                mouseEnterDelay={0}
                placement="top"
                trigger={['hover', 'focus']}
                destroyTooltipOnHide={true}
                overlay={
                    <div className="chat-highlight-tooltip">
                        <span
                            className={classnames(
                                'chat-highlight-tooltip-mark',
                                `chat-highlight-cue-${annotation.cue}`
                            )}
                        >
                            <BadgeMark annotation={annotation} />
                        </span>
                        {annotation.reason}
                    </div>
                }
            >
                <span
                    className={classnames(
                        'chat-highlight-badge',
                        `chat-highlight-cue-${annotation.cue}`,
                        hovered && 'chat-highlight-badge-hovered',
                        className
                    )}
                    data-test={`chat-highlight-badge-${targetType}-${targetId}`}
                    role="img"
                    tabIndex={0}
                    aria-label={`${name}: ${annotation.reason}`}
                    onMouseEnter={() => notifyBadgeHover(annotation)}
                    onMouseLeave={() => notifyBadgeHover(null)}
                    onFocus={() => notifyBadgeHover(annotation)}
                    onBlur={() => notifyBadgeHover(null)}
                >
                    <BadgeMark annotation={annotation} />
                </span>
            </DefaultTooltip>
        );
    }
);
