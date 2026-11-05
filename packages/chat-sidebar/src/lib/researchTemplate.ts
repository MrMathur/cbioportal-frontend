import { Goal, Slot, Slots } from './classification';

// The working question rebuilt from the slots when the user edits one: a
// fixed template per goal, with gaps shown as bracketed prompts so the
// question says what is still open.

function val(slot: Slot): string | null {
    return slot.status !== 'missing' && slot.value ? slot.value : null;
}

function cohortPhrase(slots: Slots): string {
    const cohort = val(slots.cohort);
    const study = val(slots.study);
    const base =
        cohort === 'whole study'
            ? 'the selected study'
            : cohort ?? (study ? null : '[which cohort?]');
    if (base && study && cohort !== 'whole study') return `${base} (${study})`;
    return base ?? study!;
}

function groupsPhrase(slots: Slots): string {
    const groups = val(slots.groups);
    if (!groups) return '';
    return /^by\b/i.test(groups) ? ` ${groups}` : ` (${groups})`;
}

function filterPhrase(slots: Slots): string {
    const filter = val(slots.filter);
    return filter ? `, restricted to ${filter}` : '';
}

export function templateQuestion(goal: Goal | null, slots: Slots): string {
    const entity = val(slots.entity) ?? '[which gene or attribute?]';
    const measure = val(slots.measure) ?? '[what to learn?]';
    const where = `${cohortPhrase(slots)}${filterPhrase(slots)}`;
    const groups = groupsPhrase(slots);
    switch (goal) {
        case 'explain':
            return `How does ${measure} differ for ${entity}${groups} in ${where}?`;
        case 'confirm':
            return `Is ${entity} associated with ${measure}${groups} in ${where}?`;
        case 'explore':
            return `What does the portal hold on ${entity} in ${where}?`;
        case 'describe':
        default:
            return `What is the ${measure} of ${entity}${groups} in ${where}?`;
    }
}
