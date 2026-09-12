import { readFileSync, statSync } from 'node:fs';
import { buildAdoptionScorecard } from '../src/lib/adoption-scorecard.js';

try {
  if (process.argv.length > 3) throw new Error('Unexpected arguments.');
  const file = process.argv[2] ?? new URL('../examples/adoption-evidence.template.json', import.meta.url);
  if (statSync(file).size > 5_000_000) throw new Error('Evidence is too large.');
  const scorecard = buildAdoptionScorecard(JSON.parse(readFileSync(file, 'utf8')));
  process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
  process.exitCode = scorecard.state === 'pilot_targets_met' ? 0 : 2;
} catch {
  process.stderr.write('Adoption report rejected invalid evidence. Check the documented schema and private input path.\n');
  process.exitCode = 1;
}
