import { readFileSync, statSync } from 'node:fs';
import { reviewQuality } from '../src/lib/review-quality.js';
try {
  const file = process.argv[2];
  if (process.argv.length > 3 || file && (!statSync(file).isFile() || statSync(file).size > 2000000)) throw new Error();
  const input = file ? JSON.parse(readFileSync(file, 'utf8')) : { schemaVersion: 1, cases: [] };
  process.stdout.write(JSON.stringify(reviewQuality(input), null, 2) + '\n');
} catch { process.stderr.write('Use a bounded, valid review-quality JSON dataset. No report was issued.\n'); process.exitCode = 2; }
