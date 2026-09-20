import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { digest, replayPublicResults, enumerateStates } from './experiment.mjs';

const directory = new URL('./results/2026-09-20/', import.meta.url);
const bytes = name => readFileSync(new URL(name, directory));
const json = name => JSON.parse(bytes(name));
const manifest = json('manifest.json'), recorded = json('summary.json');
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.match(name, /^[a-z0-9.-]+$/u); assert.equal(digest(bytes(name)), expected, `Artifact checksum: ${name}`);
}
assert.equal(recorded.driverSha256, digest(readFileSync(new URL('./experiment.mjs', import.meta.url))));
assert.equal(recorded.protocolSha256, digest(readFileSync(new URL('./PROTOCOL.md', import.meta.url))));
const input = json('public-execution.json');
const repeated = json('repeat-execution.json');
assert.equal(recorded.inputSha256, digest(bytes('public-execution.json')));
const fingerprint = value => value.rows.map(({ seconds, ...row }) => row);
assert.deepEqual(fingerprint(input), fingerprint(repeated), 'Repeated suite outcomes differ; report the disagreement.');
assert.equal(input.runnerSha256, digest(readFileSync(new URL('./collect-quixbugs.py', import.meta.url))));
assert.equal(repeated.runnerSha256, input.runnerSha256);
assert.deepEqual(input.packages, repeated.packages);
assert.deepEqual(recorded.publicExecution, Object.fromEntries(['buggy', 'reference'].map(variant => [variant, Object.fromEntries(
  ['success', 'failure', 'timed_out', 'unavailable'].map(outcome => [outcome, input.rows.filter(row => row.variant === variant && row.outcome === outcome).length]))])));
const replay = await replayPublicResults(input);
const stableRows = replay.rows.map(({ milliseconds, ...row }) => row);
assert.equal(digest(stableRows), recorded.replay.deterministicRowsSha256);
assert.equal(stableRows.length, recorded.replay.cases);
assert.deepEqual(stableRows, bytes('replay.jsonl').toString('utf8').trim().split('\n').map(JSON.parse));
assert.deepEqual(replay.transcripts, gunzipSync(bytes('transcripts.jsonl.gz')).toString('utf8').trim().split('\n').map(JSON.parse));
assert.ok(stableRows.every(row => row.eligible === row.expectedEligible && !row.authorityGranted));
const states = await enumerateStates();
assert.deepEqual(states.summary, recorded.finiteEnumeration.evaluators);
assert.equal(digest(states.rows), recorded.finiteEnumeration.deterministicRowsSha256);
assert.deepEqual(states.rows, gunzipSync(bytes('finite-states.jsonl.gz')).toString('utf8').trim().split('\n').map(JSON.parse));
console.log(JSON.stringify({ verified: true, publicPrograms: 40, measuredSuitesPerRun: 80,
  protocolReplays: replay.rows.length, boundedStatesPerEvaluator: states.summary.intact.states,
  ablations: Object.keys(states.summary).length - 1, networkRequests: 0 }));
