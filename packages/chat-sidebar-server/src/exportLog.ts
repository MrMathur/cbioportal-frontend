// Exports the guidance log as CSV:
//   pnpm run export-log [log.jsonl] [out.csv]
// Defaults to GUIDANCE_LOG_PATH and stdout.

import './env.js';
import { readFileSync, writeFileSync } from 'fs';
import { GUIDANCE_LOG_PATH } from './guidanceLog.js';
import { logToCsv } from './logCsv.js';

const [input = GUIDANCE_LOG_PATH, output] = process.argv.slice(2);
const csv = logToCsv(readFileSync(input, 'utf-8'));
if (output) {
    writeFileSync(output, csv, 'utf-8');
    console.error(`wrote ${csv.split('\n').length - 2} rows to ${output}`);
} else {
    process.stdout.write(csv);
}
