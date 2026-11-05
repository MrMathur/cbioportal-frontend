// Picks the parts of guidancePrompt.md that apply to a classified turn.

import { Classification, SLOT_NAMES } from './classification.js';

export function parseSections(text: string): Map<string, string> {
    const sections = new Map<string, string>();
    let name: string | undefined;
    let lines: string[] = [];
    const flush = () => {
        if (name) sections.set(name, lines.join('\n').trim());
    };
    for (const line of text.split('\n')) {
        const match = /^@@\s+(\S+)\s*$/.exec(line);
        if (match) {
            flush();
            name = match[1];
            lines = [];
        } else if (name) {
            lines.push(line);
        }
    }
    flush();
    return sections;
}

export function sectionNamesFor(c: Classification): string[] {
    const names = ['intro'];
    if (c.request_type !== 'data') {
        names.push(c.request_type);
    } else {
        if (c.level) names.push(c.level);
        const noUiPath = c.answerability !== 'ui';
        if (noUiPath) {
            names.push('no-ui-path');
        } else if (c.level !== 'L1' && c.level !== 'L2' && c.goal) {
            names.push(`route-${c.goal}`);
        }
    }
    if (c.multi_part) names.push('multi_part');
    return names;
}

// The classification as the reply model sees it: no log-only fields.
function forReply(c: Classification): object {
    return {
        request_type: c.request_type,
        oos_subtype: c.oos_subtype,
        goal: c.goal,
        slots: Object.fromEntries(
            SLOT_NAMES.map(n => [
                n,
                {
                    status: c.slots[n].status,
                    value: c.slots[n].value,
                    options: c.slots[n].options,
                },
            ])
        ),
        core_slots: c.core_slots,
        level: c.level,
        guidance_degree: c.guidance_degree,
        multi_part: c.multi_part,
        answerability: c.answerability,
        move: c.move,
    };
}

export function guidanceBlock(
    sections: Map<string, string>,
    c: Classification
): string {
    const parts = sectionNamesFor(c)
        .map(name => sections.get(name))
        .filter((s): s is string => Boolean(s));
    return `${parts.join(
        '\n\n'
    )}\n\n### Classification\n\n\`\`\`json\n${JSON.stringify(
        forReply(c),
        null,
        2
    )}\n\`\`\``;
}
