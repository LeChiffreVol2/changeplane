import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeRequiredCheck, replayPublicResults, enumerateStates, validatePublicResults, PIN, SCENARIOS } from './experiment.mjs';

test('baseline honors current subject, configured App, strict base and newer execution', () => {
  const state = { head: 'a', currentHead: 'a', upToDate: true, expectedApp: 'trusted',
    checks: [{ name: 'QuixBugs', head: 'a', app: 'trusted', execution: 1, status: 'completed', conclusion: 'success' }] };
  assert.equal(nativeRequiredCheck(state), true);
  for (const change of [{ currentHead: 'b' }, { upToDate: false }, { expectedApp: 'other' }, { testMergeSha: 'merge' }]) {
    assert.equal(nativeRequiredCheck({ ...state, ...change }), false);
  }
  for (const conclusion of ['skipped', 'neutral']) assert.equal(nativeRequiredCheck({ ...state,
    checks: [{ ...state.checks[0], conclusion }] }), true);
  assert.equal(nativeRequiredCheck({ ...state, checks: [...state.checks, { ...state.checks[0], execution: 2, status: 'in_progress', conclusion: null }] }), false);
});

function input() {
  return { sourceCommit: PIN, rows: Array.from({ length: 40 }, (_, index) => ['buggy', 'reference'].map(variant => ({
    program: `program_${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + index % 26)}`,
    variant, sourceSha256: 'a'.repeat(64), testSha256: 'b'.repeat(64), outcome: variant === 'reference' ? 'success' : 'failure',
  }))).flat() };
}
test('public corpus validation rejects missing, duplicated, relabeled and unpinned rows', () => {
  for (const mutate of [value => { value.rows.pop(); }, value => { value.rows[1] = value.rows[0]; },
    value => { value.sourceCommit = 'a'.repeat(40); }, value => { value.rows[0].outcome = 'pass'; }]) {
    const value = input(); mutate(value); assert.throws(() => validatePublicResults(value));
  }
});
test('replay preserves measured failures and separates native policy differences from shared comparisons', async () => {
  const result = await replayPublicResults(input());
  assert.equal(result.rows.length, 80 * SCENARIOS.length);
  assert.equal(result.rows.filter(row => row.eligible).length, 40);
  assert.ok(result.rows.every(row => row.eligible === row.expectedEligible && !row.authorityGranted));
  assert.ok(result.rows.filter(row => row.comparison === 'shared').every(row => row.nativeEligible === row.eligible));
  assert.ok(result.rows.filter(row => row.comparison === 'policy_difference').every(row => row.nativeEligible && !row.eligible));
  assert.ok(result.rows.filter(row => row.scenario === 'head_changed_during_read').every(row => row.unavailable));
  assert.equal(result.transcripts.length, result.rows.length);
});
test('bounded enumeration finds a counterexample to every isolated ablation without granting authority', async () => {
  const result = await enumerateStates();
  assert.equal(result.summary.intact.states, 3584);
  assert.equal(result.summary.intact.falseEligible, 0); assert.equal(result.summary.intact.falseHold, 0);
  for (const [name, summary] of Object.entries(result.summary)) {
    assert.equal(summary.authorityGranted, 0);
    if (name !== 'intact') assert.ok(summary.falseEligible > 0 && summary.firstCounterexample, name);
  }
});
