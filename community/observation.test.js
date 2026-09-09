import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessObservation } from './observation.js';
const base = JSON.parse(readFileSync(new URL('./fixtures/observation.json', import.meta.url)));
const corpus = JSON.parse(readFileSync(new URL('./fixtures/recovery-cases.json', import.meta.url)));
for (const fixture of corpus.cases) test(`conformance: ${fixture.id}`, () => {
  const input = structuredClone(base);
  for (const [path, value] of Object.entries(fixture.patches)) {
    const segments = path.split('.'); let target = input;
    for (const key of segments.slice(0, -1)) target = target[key];
    target[segments.at(-1)] = value;
  }
  const report = assessObservation(input);
  assert.equal(report.decision, fixture.expected.decision, fixture.oracle);
  assert.equal(report.nextAction, fixture.expected.nextAction, fixture.oracle);
  assert.equal(report.handback.nextAction, fixture.expected.nextAction, fixture.oracle);
  if (fixture.expected.finding) assert.ok(report.findings.some(item => item.code === fixture.expected.finding), fixture.oracle);
  else assert.deepEqual(report.findings, [], fixture.oracle);
  assert.equal(report.authority.repairAuthorized, false);
  assert.equal(report.handback.campaign.sourceAttemptsAuthorized, 0);
  assert.equal(report.authority.guardPublished, false);
  assert.equal(report.authority.authenticated, false);
  assert.equal(JSON.stringify(report).includes('PRIVATE_SYNTHETIC_MARKER'), false);
  assert.deepEqual(report.handback.binding, report.binding);
});
test('requirements for different tested subjects match separately, while unknown competing executions remain ambiguous', () => {
  const input = structuredClone(base);
  input.policy.evidence.required.push({ ...input.policy.evidence.required[0], subject: 'test_merge' });
  input.evidence.push({ ...input.evidence[0], execution: { id: '1/13/100', attempt: '100' },
    subject: { kind: 'test_merge', id: 'c'.repeat(40), head: input.revisions.head, target: input.revisions.target } });
  assert.equal(assessObservation(input).decision, 'OBSERVED_SUCCESS');
  input.evidence[1].subject.kind = 'unknown';
  assert.equal(assessObservation(input).decision, 'BLOCKED');
});
test('portable bindings cover project, policy, execution and mirror identities', () => {
  const original = assessObservation(base).binding.observationDigest;
  for (const mutate of [
    input => { input.identity.repositoryId = 'another-project'; },
    input => { input.revisions.policy = 'f'.repeat(40); input.revisions.currentPolicy = 'f'.repeat(40); },
    input => { input.evidence[0].execution.attempt = '100'; },
    input => { input.mirror = { repositoryId: 'mirror', mode: 'github_mirror', syncedHead: input.revisions.head }; },
  ]) {
    const input = structuredClone(base); mutate(input);
    assert.notEqual(assessObservation(input).binding.observationDigest, original);
  }
});
test('invalid schema, ambiguous policy, traversal and oversized identity fail before assessment', () => {
  for (const mutate of [
    input => { input.identity.origin = 'https://attacker.invalid'; },
    input => { input.identity.changeId = 'x'.repeat(301); },
    input => { input.files[0].path = '../policy'; },
    input => { input.policy.evidence.required.push(input.policy.evidence.required[0]); },
    input => { input.collection.generation = 2; },
    input => { input.evidence[0].status = 'unknown-provider-state'; },
  ]) {
    const input = structuredClone(base); mutate(input); assert.throws(() => assessObservation(input));
  }
});
