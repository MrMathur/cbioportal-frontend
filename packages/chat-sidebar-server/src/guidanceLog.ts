// The guided assistant's research log: one JSON object per line, appended to
// GUIDANCE_LOG_PATH. Classifications are written by the server; slot edits,
// restores and topic changes are posted by the sidebar (/api/chat/log).
// exportLog.ts turns it into CSV.

import { appendFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CODEBOOK_VERSION } from './classification.js';

export const GUIDANCE_LOG_PATH =
    process.env.GUIDANCE_LOG_PATH ||
    join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'logs',
        'guidance-log.jsonl'
    );

export const CLIENT_EVENTS = [
    'slot_edit',
    'aim_edit',
    'question_edit',
    'restore',
    'topic_change',
    'option_pick',
    'send_question',
    // A Study View filter change the user made, recorded as a step of the
    // current topic (refine, broaden or sibling).
    'page_action',
    // The sidebar moved the portal to follow the research question.
    'portal_navigation',
    // The marks a reply placed (set_highlights), a reply whose text didn't
    // match them, and the user following a mark from the chat or a part chip.
    'badge_plan',
    'badge_mismatch',
    'badge_click',
    'part_select',
] as const;

export type ClientEvent = typeof CLIENT_EVENTS[number];

export type LogEvent = 'classification' | 'classification_error' | ClientEvent;

export interface LogEntry {
    at: string;
    codebook_version: number;
    event: LogEvent;
    session_id: string;
    participant: string;
    thread_id: string;
    payload: Record<string, unknown>;
}

let ready: Promise<unknown> | undefined;

// Writes are queued so lines never interleave.
let queue: Promise<void> = Promise.resolve();

export function logGuidanceEvent(
    entry: Omit<LogEntry, 'at' | 'codebook_version'>
): Promise<void> {
    const line = `${JSON.stringify({
        at: new Date().toISOString(),
        codebook_version: CODEBOOK_VERSION,
        ...entry,
    })}\n`;
    if (!ready) {
        ready = mkdir(dirname(GUIDANCE_LOG_PATH), { recursive: true });
    }
    queue = queue
        .then(() => ready)
        .then(() => appendFile(GUIDANCE_LOG_PATH, line, 'utf-8'))
        .catch(err => {
            console.error('guidance log write failed:', err);
        });
    return queue;
}

const MAX_PAYLOAD_CHARS = 20_000;

/** Validates an event posted by the sidebar; null when malformed. */
export function parseClientEvent(
    body: unknown
): Omit<LogEntry, 'at' | 'codebook_version'> | null {
    const b = (body ?? {}) as Record<string, unknown>;
    if (!CLIENT_EVENTS.includes(b.event as ClientEvent)) return null;
    const payload =
        b.payload && typeof b.payload === 'object' && !Array.isArray(b.payload)
            ? (b.payload as Record<string, unknown>)
            : {};
    if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) return null;
    const str = (x: unknown) => (typeof x === 'string' ? x.slice(0, 100) : '');
    return {
        event: b.event as ClientEvent,
        session_id: str(b.sessionId),
        participant: str(b.participant),
        thread_id: str(b.threadId),
        payload,
    };
}
