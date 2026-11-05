import * as React from 'react';
import { observer } from 'mobx-react';
import classnames from 'classnames';
import { ChatHighlightBadge } from './ChatHighlightBadge';
import { highlightTargetProps } from './highlightStore';
import {
    ControlId,
    registerControl,
    unregisterControl,
} from './controlRegistry';

interface IChatHighlightControlProps {
    controlId: ControlId;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

/**
 * Wraps a control the chat may point at: registers it as a highlight
 * candidate while mounted and shows its badge when highlighted.
 */
export const ChatHighlightControl: React.FunctionComponent<IChatHighlightControlProps> = observer(
    ({ controlId, className, style, children }) => {
        React.useEffect(() => {
            registerControl(controlId);
            return () => unregisterControl(controlId);
        }, [controlId]);
        return (
            <span
                className={classnames('chat-highlight-control', className)}
                style={style}
                {...highlightTargetProps('control', controlId)}
            >
                {children}
                <ChatHighlightBadge
                    targetType="control"
                    targetId={controlId}
                    className="chat-highlight-control-badge"
                />
            </span>
        );
    }
);
