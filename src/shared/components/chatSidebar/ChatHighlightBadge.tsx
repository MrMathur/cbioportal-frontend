import * as React from 'react';
import { observer } from 'mobx-react';
import classnames from 'classnames';
import { DefaultTooltip } from 'cbioportal-frontend-commons';
import {
    getHighlight,
    getHighlights,
    HighlightTargetType,
} from './highlightStore';
import './ChatHighlight.scss';

interface IChatHighlightBadgeProps {
    targetType: HighlightTargetType;
    targetId: string;
    className?: string;
}

/**
 * The rank the chat's research question gave this element, with the reason on
 * hover. Renders nothing unless the element is currently highlighted.
 */
export const ChatHighlightBadge: React.FunctionComponent<IChatHighlightBadgeProps> = observer(
    ({ targetType, targetId, className }) => {
        const annotation = getHighlight(targetType, targetId);
        if (!annotation) return null;
        const total = getHighlights().length;
        return (
            <DefaultTooltip
                mouseEnterDelay={0}
                placement="top"
                destroyTooltipOnHide={true}
                overlay={
                    <div className="chat-highlight-tooltip">
                        <div className="chat-highlight-tooltip-title">
                            Relevant to your research question ·{' '}
                            {annotation.rank} of {total}
                        </div>
                        <div>{annotation.reason}</div>
                    </div>
                }
            >
                <span
                    className={classnames('chat-highlight-badge', className)}
                    data-test={`chat-highlight-badge-${targetType}-${targetId}`}
                    role="img"
                    tabIndex={0}
                    aria-label={`Why ${annotation.label} is relevant: ${annotation.reason}`}
                >
                    {annotation.rank}
                </span>
            </DefaultTooltip>
        );
    }
);
