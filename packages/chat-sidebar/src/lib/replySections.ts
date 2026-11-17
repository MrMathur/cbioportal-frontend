// Remark plugin that wraps each fixed section of an assistant reply in a
// <section data-reply-section="…">, so the sections can be styled as blocks.
// Works on the markdown as it streams, and leaves a reply without these
// headings untouched. Comments, which hold a reply's step label, are dropped.

interface MarkdownNode {
    type: string;
    depth?: number;
    value?: string;
    children?: MarkdownNode[];
    data?: { hName: string; hProperties: Record<string, string> };
}

export type ReplySectionId = 'analysis' | 'retrospective' | 'next-step';

const SECTION_BY_HEADING: Record<string, ReplySectionId> = {
    analysis: 'analysis',
    retrospective: 'retrospective',
    'suggested next step': 'next-step',
};

function textOf(node: MarkdownNode): string {
    return node.value ?? (node.children ?? []).map(textOf).join('');
}

function sectionIdOf(node: MarkdownNode): ReplySectionId | undefined {
    if (node.type !== 'heading' || node.depth !== 2) return undefined;
    return SECTION_BY_HEADING[
        textOf(node)
            .trim()
            .toLowerCase()
    ];
}

export function remarkReplySections() {
    return (tree: MarkdownNode) => {
        const grouped: MarkdownNode[] = [];
        let section: MarkdownNode | undefined;
        for (const node of tree.children ?? []) {
            if (node.type === 'html' && node.value?.startsWith('<!--')) {
                continue;
            }
            const id = sectionIdOf(node);
            if (id) {
                section = {
                    type: 'replySection',
                    children: [],
                    data: {
                        hName: 'section',
                        hProperties: { 'data-reply-section': id },
                    },
                };
                grouped.push(section);
            }
            (section?.children ?? grouped).push(node);
        }
        tree.children = grouped;
    };
}
