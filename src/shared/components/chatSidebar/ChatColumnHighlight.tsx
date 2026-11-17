import * as React from 'react';
import { observer } from 'mobx-react';
import { getChatHighlight, getPinnedChatHighlights } from './highlightStore';

interface ColumnBand {
    name: string;
    className: string;
    style: React.CSSProperties;
}

function findHeader(name: string): HTMLTableCellElement | null | undefined {
    return document
        .querySelector(
            `[data-test="clinical-data-tab-content"] th [data-test="${CSS.escape(
                name
            )}"]`
        )
        ?.closest('th');
}

function findScrollContainer(table: HTMLElement): HTMLElement {
    for (let el = table.parentElement; el; el = el.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(el).overflowX)) return el;
    }
    return document.documentElement;
}

// The part of a column that is on screen, inside the table's scroll area.
function measureColumn(name: string): React.CSSProperties | undefined {
    const header = findHeader(name);
    const table = header?.closest('table');
    if (!header || !table) return undefined;
    const headerRect = header.getBoundingClientRect();
    const container = findScrollContainer(table).getBoundingClientRect();
    const left = Math.max(headerRect.left, container.left);
    const right = Math.min(headerRect.right, container.right);
    const top = Math.max(headerRect.top, 0);
    const bottom = Math.min(
        table.getBoundingClientRect().bottom,
        window.innerHeight
    );
    if (right <= left || bottom <= top) return undefined;
    return { top, left, width: right - left, height: bottom - top };
}

// The Clinical Data table has no per-column styling, so a highlighted column
// gets a band measured from its header, kept in place as the page scrolls.
const ChatColumnHighlight: React.FunctionComponent = observer(() => {
    const hovered = getChatHighlight();
    const hoveredColumn = hovered?.type === 'column' ? hovered : undefined;
    const pinnedColumns = getPinnedChatHighlights().filter(
        h => h.type === 'column' && h.id !== hoveredColumn?.id
    );
    const [bands, setBands] = React.useState<ColumnBand[]>([]);

    React.useLayoutEffect(() => {
        const marks = [
            ...pinnedColumns.map(column => ({ column, pinned: true })),
            ...(hoveredColumn
                ? [{ column: hoveredColumn, pinned: false }]
                : []),
        ];
        if (hoveredColumn) {
            findHeader(hoveredColumn.id)?.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
            });
        }
        const measure = () =>
            setBands(
                marks.flatMap(({ column, pinned }) => {
                    const style = measureColumn(column.id);
                    if (!style) return [];
                    const role = column.role ?? 'context';
                    return [
                        {
                            name: column.id,
                            className: `chat-highlight-column chat-highlight-${role}${
                                pinned ? ' chat-highlight-pinned' : ''
                            }`,
                            style,
                        },
                    ];
                })
            );
        measure();
        if (marks.length === 0) return undefined;

        let frame = 0;
        const scheduleMeasure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };
        window.addEventListener('scroll', scheduleMeasure, true);
        window.addEventListener('resize', scheduleMeasure);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('scroll', scheduleMeasure, true);
            window.removeEventListener('resize', scheduleMeasure);
        };
    }, [hoveredColumn, getPinnedChatHighlights()]);

    return (
        <>
            {bands.map(band => (
                <div
                    key={band.name}
                    className={band.className}
                    style={band.style}
                />
            ))}
        </>
    );
});

export default ChatColumnHighlight;
