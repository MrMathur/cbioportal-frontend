// Flattens the guidance log (guidanceLog.ts) to CSV: one row per event, the
// classification spread over columns, client events' fields alongside.

import { SLOT_NAMES } from './classification.js';

const BASE_COLUMNS = [
    'at',
    'event',
    'codebook_version',
    'session_id',
    'participant',
    'thread_id',
    'message',
    'request_type',
    'oos_subtype',
    'goal',
    'level',
    'guidance_degree',
    'multi_part',
    'answerability',
    'move',
    'open_study_applies',
    'needs_groups',
    'core_slots',
];

const SLOT_COLUMNS = SLOT_NAMES.flatMap(n => [
    `${n}_status`,
    `${n}_value`,
    `${n}_source`,
    `${n}_options`,
]);

const TAIL_COLUMNS = [
    'broad_aim',
    'working_question',
    'concrete_analysis',
    'rationale',
    'checks',
    'model',
    'latency_ms',
    'error',
    // Client events.
    'slot',
    'old_value',
    'new_value',
    'topic_id',
    'topic_title',
    'question',
    'href',
    'details',
];

export const CSV_COLUMNS = [...BASE_COLUMNS, ...SLOT_COLUMNS, ...TAIL_COLUMNS];

function cell(value: unknown): string {
    if (value === undefined || value === null) return '';
    const text =
        typeof value === 'string'
            ? value
            : Array.isArray(value) && value.every(v => typeof v === 'string')
            ? value.join(' | ')
            : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

type Json = Record<string, any>;

// Payload fields with their own column; the rest go in `details`.
const CLIENT_FIELDS = [
    'slot',
    'old_value',
    'new_value',
    'topic_id',
    'topic_title',
    'question',
    'href',
];

export function entryToRow(entry: Json): Record<string, unknown> {
    const payload: Json = entry.payload ?? {};
    const row: Record<string, unknown> = {
        at: entry.at,
        event: entry.event,
        codebook_version: entry.codebook_version,
        session_id: entry.session_id,
        participant: entry.participant,
        thread_id: entry.thread_id,
    };
    const c: Json | undefined = payload.classification;
    if (c) {
        Object.assign(row, {
            message: c.message,
            request_type: c.request_type,
            oos_subtype: c.oos_subtype,
            goal: c.goal,
            level: c.level,
            guidance_degree: c.guidance_degree,
            multi_part: c.multi_part,
            answerability: c.answerability,
            move: c.move,
            open_study_applies: c.open_study_applies,
            needs_groups: c.needs_groups,
            core_slots: c.core_slots,
            broad_aim: c.drafts?.broad_aim,
            working_question: c.drafts?.working_question,
            concrete_analysis: c.drafts?.concrete_analysis,
            rationale: c.rationale,
            checks: c.checks,
        });
        for (const n of SLOT_NAMES) {
            const s = c.slots?.[n] ?? {};
            row[`${n}_status`] = s.status;
            row[`${n}_value`] = s.value;
            row[`${n}_source`] = s.source;
            row[`${n}_options`] = s.options;
        }
    } else {
        if (typeof payload.message === 'string') row.message = payload.message;
        // Page changes carry their own move (refine, broaden, sibling).
        if (typeof payload.move === 'string') row.move = payload.move;
    }
    row.model = payload.model;
    row.latency_ms = payload.latency_ms;
    row.error = payload.error;
    const details: Json = {};
    for (const [key, value] of Object.entries(payload)) {
        if (CLIENT_FIELDS.includes(key)) {
            row[key] = value;
        } else if (
            ![
                'classification',
                'model',
                'latency_ms',
                'error',
                'message',
                'move',
            ].includes(key)
        ) {
            details[key] = value;
        }
    }
    if (Object.keys(details).length) row.details = details;
    return row;
}

/** CSV text for the log's lines; malformed lines are skipped. */
export function logToCsv(jsonl: string): string {
    const rows = [CSV_COLUMNS.join(',')];
    for (const line of jsonl.split('\n')) {
        if (!line.trim()) continue;
        let entry: Json;
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }
        const row = entryToRow(entry);
        rows.push(CSV_COLUMNS.map(col => cell(row[col])).join(','));
    }
    return `${rows.join('\n')}\n`;
}
