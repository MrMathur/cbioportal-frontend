// Picks the parts of guidancePrompt.md that apply to a classified turn.

import {
    Classification,
    GuidanceContext,
    SLOT_NAMES,
} from './classification.js';
import { formatMarkTargets, markTargetsFor } from './marks.js';

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
    if (c.from_page) {
        names.push(c.page_navigation ? 'page_navigation' : 'page_update');
    }
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
        parts: c.parts,
        part_answerability: c.part_answerability,
        answerability: c.answerability,
        move: c.move,
        open_study_applies: c.open_study_applies,
        from_page: c.from_page,
        page_navigation: c.page_navigation,
    };
}

export function guidanceBlock(
    sections: Map<string, string>,
    c: Classification,
    context?: GuidanceContext
): string {
    const names = sectionNamesFor(c);
    // The marks: how to call set_highlights for this kind of answer, and the
    // elements available. Not for questions with no path in the portal.
    const marked =
        context !== undefined &&
        c.request_type !== 'out_of_scope' &&
        !(c.request_type === 'data' && c.answerability !== 'ui');
    if (marked) names.push('marks', `marks-${markKind(c)}`);
    const parts = names
        .map(name => sections.get(name))
        .filter((s): s is string => Boolean(s));
    if (marked) {
        const { page, targets } = markTargetsFor(c, context);
        parts.push(formatMarkTargets(page, targets));
    }
    const json = JSON.stringify(forReply(c), null, 2);
    return `${parts.join(
        '\n\n'
    )}\n\n### Classification\n\n\`\`\`json\n${json}\n\`\`\``;
}

// Which per-level marks rule applies.
export function markKind(c: Classification): string {
    if (c.request_type !== 'data') return c.request_type;
    return c.level ?? 'L1';
}
