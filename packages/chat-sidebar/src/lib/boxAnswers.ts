import { SLOT_LABELS, SlotName } from './classification';

// When the chat asks for a part of the question and the user fills it in the
// research question box instead of typing, the sidebar sends their answer to
// the chat as a message, so the conversation (and the portal) moves on.

export const BOX_ANSWER_PREFIX = 'In the research question box, I set ';

export function slotAnswerMessage(name: SlotName, value: string): string {
    // A study's "[id]" stays in the slot, which the server receives as fixed.
    const shown = value.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
    return `${BOX_ANSWER_PREFIX}the ${SLOT_LABELS[
        name
    ].toLowerCase()} to ${shown}.`;
}

export function isBoxAnswerMessage(text: string): boolean {
    return text.trimStart().startsWith(BOX_ANSWER_PREFIX);
}
