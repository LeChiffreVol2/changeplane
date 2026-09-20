import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { digest, replayPublicResults, enumerateStates, DIMENSIONS, OUTCOMES } from './experiment.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath || process.argv.length !== 4) throw new Error('Usage: node benchmarks/assurance/run.mjs INPUT.json NEW_OUTPUT_DIRECTORY');
const output = resolve(outputPath);
if (existsSync(output)) throw new Error('Use a new result directory; recorded experiments are immutable.');
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const replay = await replayPublicResults(input), enumeration = await enumerateStates();
mkdirSync(output, { recursive: true });
const write = (name, value) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2) + '\n');
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const stableRows = replay.rows.map(({ milliseconds, ...row }) => row);
const times = replay.rows.map(row => row.milliseconds).sort((a, b) => a - b);
const byScenario = Object.fromEntries([...new Set(replay.rows.map(row => row.scenario))].map(name => {
  const rows = replay.rows.filter(row => row.scenario === name);
  return [name, { cases: rows.length, expectedEligible: rows.filter(row => row.expectedEligible).length,
    eligible: rows.filter(row => row.eligible).length, falseEligible: rows.filter(row => row.eligible && !row.expectedEligible).length,
    falseHold: rows.filter(row => !row.eligible && row.expectedEligible).length,
    unavailable: rows.filter(row => row.unavailable).length, comparison: rows[0].comparison,
    nativeEligible: rows[0].nativeEligible == null ? null : rows.filter(row => row.nativeEligible).length,
    disagreements: rows[0].nativeEligible == null ? null : rows.filter(row => row.eligible !== row.nativeEligible).length }];
}));
const summary = { schemaVersion: 1, kind: 'maintainer-run-public-oracle-and-synthetic-protocol-experiment',
  productCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), node: process.version,
  inputSha256: digest(readFileSync(inputPath, 'utf8')), protocolSha256: digest(readFileSync(new URL('./PROTOCOL.md', import.meta.url), 'utf8')),
  driverSha256: digest(readFileSync(new URL('./experiment.mjs', import.meta.url), 'utf8')),
  publicExecution: Object.fromEntries(['buggy', 'reference'].map(variant => [variant, Object.fromEntries(
    ['success', 'failure', 'timed_out', 'unavailable'].map(outcome => [outcome, input.rows.filter(row => row.variant === variant && row.outcome === outcome).length]))])),
  replay: { cases: replay.rows.length, byScenario, authorityGrants: replay.rows.filter(row => row.authorityGranted).length,
    deterministicRowsSha256: digest(stableRows), overheadMs: { p50: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)] } },
  finiteEnumeration: { dimensions: DIMENSIONS, outcomes: OUTCOMES, evaluators: enumeration.summary,
    deterministicRowsSha256: digest(enumeration.rows) },
  limitations: ['Native baseline and API transcripts are simulated, not live GitHub.', 'No model repair, bug-repair leaderboard score, customer data, independent replication or universal proof.',
    'Generated cases are dependent; counts are not statistical sample sizes.', 'Observed success is advisory, never approval, Guard or merge authority.'] };
write('summary.json', summary);
write('public-execution.json', input);
writeFileSync(resolve(output, 'replay.jsonl'), jsonl(stableRows));
writeFileSync(resolve(output, 'transcripts.jsonl.gz'), gzipSync(jsonl(replay.transcripts), { level: 9 }));
writeFileSync(resolve(output, 'finite-states.jsonl.gz'), gzipSync(jsonl(enumeration.rows), { level: 9 }));
const files = ['summary.json', 'public-execution.json', 'replay.jsonl', 'transcripts.jsonl.gz', 'finite-states.jsonl.gz'];
write('manifest.json', { files: Object.fromEntries(files.map(name => [name, createDigest(resolve(output, name))])) });
function createDigest(path) { return digest(readFileSync(path)); }
console.log(JSON.stringify({ publicExecution: summary.publicExecution, replay: summary.replay, enumeration: Object.fromEntries(
  Object.entries(enumeration.summary).map(([name, value]) => [name, { states: value.states, falseEligible: value.falseEligible, falseHold: value.falseHold }])) }, null, 2));
if (replay.rows.some(row => row.eligible !== row.expectedEligible || row.authorityGranted)
  || enumeration.summary.intact.falseEligible || enumeration.summary.intact.falseHold || enumeration.summary.intact.authorityGranted) process.exitCode = 1;
