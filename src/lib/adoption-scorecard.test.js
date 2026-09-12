import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildAdoptionScorecard } from './adoption-scorecard.js';

const start = Date.parse('2026-08-01T00:00:00.000Z'), DAY = 86_400_000;
const at = (day, minutes = 0) => new Date(start + day * DAY + minutes * 60_000).toISOString();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const report = (input, day = 30) => buildAdoptionScorecard(input, { now: new Date(at(day)) });
const empty = () => JSON.parse(readFileSync(new URL('../../examples/adoption-evidence.template.json', import.meta.url)));
function cohort() {
  const input = empty(); input.startedAt = at(0);
  input.coverage = { through: at(30), complete: true, evidenceId: id(999) };
  for (let n = 1; n <= 5; n++) {
    input.installations.push({ id: id(n), accountId: id(100 + n), accountType: n % 2 ? 'User' : 'Organization',
      cohort: 'external', channel: 'founder', startedAt: at(0), evidenceId: id(200 + n) });
    for (const [offset, day] of [[0, 0], [10, 22]]) {
      input.assessments.push({ id: id(300 + offset + n), installationId: id(n), occurredAt: at(day, 5),
        source: 'github-api', outcome: 'REVIEW_REQUIRED', feedback: 'useful', correctness: 'confirmed', evidenceId: id(400 + offset + n) });
    }
  }
  return input;
}
test('empty evidence reports not started with unknown quality, retention and savings', () => {
  const result = report(empty());
  assert.equal(result.state, 'not_started');
  assert.equal(result.adoption.installations, 0);
  assert.equal(result.adoption.week4RetentionRate, null);
  assert.equal(result.quality.reviewedIncorrectRate, null);
  assert.equal(result.intervention.medianHumanMinutesSaved, null);
});
test('confirmed live use can meet pilot targets without establishing PMF or assurance', () => {
  const result = report(cohort());
  assert.equal(result.state, 'pilot_targets_met');
  assert.equal(result.adoption.activations, 5);
  assert.equal(result.adoption.medianActivationMinutes, 5);
  assert.equal(result.adoption.week4RetentionRate, 1);
  assert.equal(result.quality.confirmedUseful, 10);
  assert.deepEqual(Object.values(result.authority), [false, false, false, false]);
});
test('owner and synthetic installations cannot become external adoption', () => {
  const input = cohort(); input.installations[0].cohort = 'owner'; input.installations[1].cohort = 'synthetic';
  const result = report(input);
  assert.equal(result.adoption.installations, 3);
  assert.equal(result.adoption.activations, 3);
  assert.equal(result.quality.observed, 6);
  assert.equal(result.excluded.internalInstallations, 2);
  assert.equal(result.state, 'pilot_targets_unmet');
});
test('offline fixtures cannot activate a real installation', () => {
  const input = cohort(); input.assessments.forEach(row => { row.source = 'fixture'; });
  const result = report(input);
  assert.equal(result.adoption.activations, 0);
  assert.equal(result.excluded.fixtureAssessments, 10);
  assert.equal(result.quality.observed, 0);
  assert.equal(result.state, 'evidence_required');
});
test('unavailable outcomes and failed setup attempts remain visible', () => {
  const input = cohort(); input.assessments.forEach(row => { row.outcome = 'UNAVAILABLE'; row.feedback = 'not_useful'; });
  const result = report(input);
  assert.equal(result.adoption.activations, 0);
  assert.equal(result.adoption.setupAttemptsWithoutActivation, 5);
  assert.equal(result.quality.unavailable, 10);
  assert.equal(result.state, 'pilot_targets_unmet');
});
test('unreviewed assessments do not count as verified activation or complete evidence', () => {
  const input = cohort(); input.assessments.forEach(row => { row.correctness = 'unreviewed'; row.feedback = 'unreviewed'; });
  const result = report(input);
  assert.equal(result.adoption.activations, 0);
  assert.equal(result.quality.unreviewed, 10);
  assert.equal(result.state, 'evidence_required');
});
test('an incorrect assessment requires review even before the window ends', () => {
  const input = cohort(); input.assessments = input.assessments.filter(row => instantDay(row.occurredAt) < 1);
  input.coverage = { through: at(1), complete: true, evidenceId: id(999) };
  input.assessments[0].correctness = 'incorrect'; input.assessments[0].feedback = 'not_useful';
  const result = report(input, 1);
  assert.equal(result.state, 'review_required');
  assert.equal(result.quality.incorrect, 1);
  assert.equal(result.quality.reviewedIncorrectRate, 0.2);
});
function instantDay(value) { return (Date.parse(value) - start) / DAY; }
test('late installations are excluded from the week-four denominator until mature', () => {
  const input = cohort(); input.installations[0].startedAt = at(10);
  input.assessments = input.assessments.filter(row => row.installationId !== id(1));
  const result = report(input);
  assert.equal(result.adoption.week4Eligible, 4);
  assert.equal(result.adoption.week4RetentionRate, 1);
  assert.equal(result.adoption.setupAttemptsWithoutActivation, 1);
});
test('week-four interval includes day 21 and excludes day 28', () => {
  const input = cohort();
  input.assessments.filter(row => instantDay(row.occurredAt) > 1).forEach(row => { row.occurredAt = at(28); });
  input.assessments.at(-1).occurredAt = at(21);
  const result = report(input);
  assert.equal(result.adoption.week4Retained, 1);
  assert.equal(result.adoption.week4RetentionRate, 0.2);
});
test('end-exclusive experiment boundary cannot inflate activation or retention', () => {
  const input = cohort(); input.installations[0].startedAt = at(30);
  input.assessments = input.assessments.filter(row => row.installationId !== id(1));
  input.assessments[0].occurredAt = at(30);
  const result = report(input);
  assert.equal(result.adoption.installations, 4);
  assert.equal(result.quality.observed, 7);
});
test('partial coverage never reports a known retention rate or completed pilot', () => {
  for (const coverage of [{ through: at(29), complete: true, evidenceId: id(999) },
    { through: at(30), complete: false, evidenceId: id(999) }]) {
    const input = cohort(); input.coverage = coverage;
    assert.equal(report(input).adoption.week4RetentionRate, null);
    assert.equal(report(input).state, 'evidence_required');
  }
});
test('multiple repositories in one account do not fabricate independent customer demand', () => {
  const input = cohort(); input.installations.forEach(row => { row.accountId = id(100); row.accountType = 'User'; });
  assert.equal(report(input).adoption.accounts, 1);
  assert.equal(report(input).state, 'pilot_targets_unmet');
});
test('individual, organization and acquisition cohorts remain separate aggregates', () => {
  const input = cohort(); input.installations[0].channel = 'agent';
  const result = report(input);
  assert.equal(result.cohorts.User.installations, 3);
  assert.equal(result.cohorts.Organization.installations, 2);
  assert.equal(result.channels.agent.installations, 1);
  assert.equal(result.channels.founder.installations, 4);
});
test('observed intervention regressions remain negative and estimates are excluded', () => {
  const input = cohort();
  input.comparisons = [
    { id: id(700), installationId: id(1), occurredAt: at(2), kind: 'ci_recovery', basis: 'observed', baselineMinutes: 10, assistedMinutes: 20, evidenceId: id(800) },
    { id: id(701), installationId: id(2), occurredAt: at(2), kind: 'coordination', basis: 'estimate', baselineMinutes: 100, assistedMinutes: 0, evidenceId: id(801) },
  ];
  const result = report(input);
  assert.equal(result.intervention.observedPairs, 1);
  assert.equal(result.intervention.estimatesExcluded, 1);
  assert.equal(result.intervention.medianHumanMinutesSaved, -10);
  assert.equal(result.intervention.pairsWithMoreHumanTime, 1);
});
test('output contains no account, repository, event or evidence identifiers', () => {
  const input = cohort(), output = JSON.stringify(report(input));
  for (const row of [...input.installations, ...input.assessments]) {
    assert.ok(!output.includes(row.id)); assert.ok(!output.includes(row.evidenceId));
  }
  assert.ok(!output.includes(input.coverage.evidenceId));
  assert.ok(!output.includes(input.installations[0].accountId));
});
test('malformed, duplicated and inconsistent evidence is rejected', () => {
  const cases = [
    input => { input.email = 'private@example.invalid'; },
    input => { delete input.coverage; },
    input => { input.installations.push(input.installations[0]); },
    input => { input.assessments.push(input.assessments[0]); },
    input => { input.assessments[0].installationId = id(9999); },
    input => { input.assessments[0].occurredAt = at(-1); },
    input => { input.assessments[0].occurredAt = at(31); },
    input => { input.assessments[0].occurredAt = '2026-08-01'; },
    input => { input.assessments[0].correctness = 'incorrect'; },
    input => { input.assessments[0].outcome = 'PASS'; },
    input => { input.coverage.through = at(31); },
    input => { input.coverage.evidenceId = null; },
    input => { input.coverage.through = null; },
    input => { input.installations[0].id = 'real-repository-name'; },
    input => { input.installations[1].accountId = input.installations[0].accountId; },
    input => { input.startedAt = null; },
  ];
  for (const mutate of cases) { const input = cohort(); mutate(input); assert.throws(() => report(input), TypeError); }
});
test('CLI reports empty evidence and redacts private paths or malformed contents', () => {
  const script = fileURLToPath(new URL('../../scripts/report-adoption.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).state, 'not_started');
  const directory = mkdtempSync(join(tmpdir(), 'changeplane-adoption-'));
  try {
    const file = join(directory, 'private-customer-name.json'); writeFileSync(file, '{"providerKey":"sensitive-marker"');
    const invalid = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.equal(invalid.status, 1); assert.equal(invalid.stdout, '');
    assert.ok(!invalid.stderr.includes('sensitive-marker')); assert.ok(!invalid.stderr.includes(file));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
