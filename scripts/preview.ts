import { readFile } from 'node:fs/promises';
import { parseSnapshot, reconciliation, renderReports } from '../src/report.js';

const file = process.argv[2];
if (!file) throw new Error('Gunakan: npm run report:preview -- "lokasi/file.csv" ["csv-hari-sebelumnya.csv"]');
const snapshot = parseSnapshot(await readFile(file, 'utf8'));
const previous = process.argv[3] ? parseSnapshot(await readFile(process.argv[3], 'utf8')) : null;
for (const report of renderReports(snapshot, previous, Math.floor(Date.now() / 1000))) console.log(`${report}\n\n`);
const note = reconciliation(snapshot);
if (note) console.log(note);
