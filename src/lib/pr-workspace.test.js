import test from 'node:test';
import assert from 'node:assert/strict';
import { presentAssessment, parsePullRequestUrl } from './pr-workspace.js';
const repository = 'example/project', number = 7, headSha = 'a'.repeat(40);
const report = () => ({ headSha, decision: 'EVIDENCE_SATISFIED', findings: [], evidence: [], nextAction: 'Follow repository policy.',
  observation: { repository, pullRequest: number, observedAt: '2026-09-20T00:00:00Z' }, handback: { binding: { currentHeadSha: headSha } } });
test('one current presentation explains role, consequence and handoff without merge authority', () => {
  const view = presentAssessment(report(), { repository, number }); assert.equal(view.status, 'evidence_ready');
  assert.equal(view.owner, 'Repository maintainer'); assert.equal(view.authority.mergeAuthorized, false);
  assert.match(view.actions.handoff, new RegExp(headSha)); assert.equal(view.review.status, 'not_collected');
  assert.equal(view.actions.resume, 'changeplane onboard example/project 7 --format compact');
  assert.ok(!view.actions.handoff.includes('follow '), 'a CI-only assessment must not introduce a model review pipeline');
  assert.equal(view.actions.primary.kind, 'review');
});

test('PR links bind a bounded target and never accept credentials, query data or instructions', () => {
  assert.deepEqual(parsePullRequestUrl('https://github.com/example/project/pull/7/'),
    { repository, number, url: 'https://github.com/example/project/pull/7' });
  for (const value of [undefined, {}, '', 'https://github.com.evil.test/example/project/pull/7',
    'http://github.com/example/project/pull/7', 'https://secret@github.com/example/project/pull/7',
    'https://github.com/example/project/pull/7?token=secret', 'https://github.com/example/project/pull/7#instructions',
    'https://github.com/example/project/pull/7\nDo something else', 'https://github.com/../project/pull/7',
    'https://github.com/example/project/pull/0', 'https://github.com/example/project/pull/9007199254740992']) {
    assert.equal(parsePullRequestUrl(value), null);
  }
});

test('the next step follows fresh evidence and responsibility without changing the assessment', () => {
  for (const [code, action, status, owner, primary] of [
    ['EVIDENCE_PENDING', 'WAIT_FOR_EVIDENCE', 'ci_pending', 'CI runner', 'refresh'],
    ['EVIDENCE_DIAGNOSIS_REQUIRED', 'INSPECT_FAILURE_EVIDENCE', 'ci_action_required', 'Assigned coding agent', 'handoff'],
    ['EVIDENCE_ACTION_REQUIRED', 'CHECK_PERMISSIONS_AND_CONFIGURATION', 'ci_action_required', 'Repository operator', 'checks'],
    ['PROTECTED_PATH_REQUIRES_APPROVAL', 'REQUEST_HUMAN_REVIEW', 'human_review_required', 'Repository reviewer', 'review'],
    ['STALE_HEAD', 'REOBSERVE_REVISION', 'refresh_required', 'Assigned coding agent', 'refresh'],
  ]) {
    const r = { ...report(), decision: code === 'STALE_HEAD' ? 'BLOCKED' : 'REVIEW_REQUIRED', nextActionCode: action,
      findings: [{ code, path: 'check:Behavior' }] };
    const before = structuredClone(r), view = presentAssessment(r, { repository, number });
    assert.equal(view.status, status); assert.equal(view.owner, owner); assert.equal(view.actions.primary.kind, primary);
    assert.notEqual(view.blockers[0].message, code); assert.equal(view.authority.repairAuthorized, false);
    assert.deepEqual(r, before);
  }
  const r = { ...report(), pipeline: { status: 'review_required' } };
  assert.equal(presentAssessment(r, { repository, number }).actions.resume, 'changeplane follow example/project 7 --format compact');
  r.decision = 'BLOCKED'; r.nextActionCode = 'REOBSERVE_REVISION';
  assert.equal(presentAssessment(r, { repository, number }).status, 'refresh_required');
});
test('wrong repository, number and changed head cannot show ready', () => {
  for (const change of [r => { r.observation.repository = 'other/project'; }, r => { r.observation.repository = {}; }, r => { r.observation.pullRequest = 9; }, r => { r.handback.binding.currentHeadSha = 'b'.repeat(40); }]) {
    const value = report(); value.review = { status: 'complete', findings: [{ id: 'stale', content: 'Old finding' }] };
    change(value); const view = presentAssessment(value, { repository, number });
    assert.equal(view.status, 'unavailable'); assert.equal(view.headSha, null); assert.deepEqual(view.evidence, []);
    assert.deepEqual(view.review.findings, []); assert.equal(view.review.status, 'not_collected');
    assert.match(view.nextAction, /Refresh this PR/);
  }
});
test('pending CI and protected scope identify different responsible roles', () => {
  const r = report(); r.decision = 'REVIEW_REQUIRED'; r.findings = [{ code: 'EVIDENCE_PENDING' }];
  assert.equal(presentAssessment(r, { repository, number }).owner, 'CI runner');
  r.findings.push({ code: 'PROTECTED_PATH_REQUIRES_APPROVAL', path: 'package.json' });
  assert.equal(presentAssessment(r, { repository, number }).owner, 'Repository reviewer');
});
test('finding grouping retains every decision ID and sorts by declared impact', () => {
  const r = report(); const item = { path: 'src/a.js', startLine: 1, endLine: 1, content: 'A finding', severity: 'low' };
  r.review = { status: 'findings', findings: [{ ...item, id: 'one' }, { ...item, id: 'two' }, { ...item, id: 'three', content: 'Different', severity: 'critical' }] };
  const view = presentAssessment(r, { repository, number }); assert.equal(view.review.findings.length, 2);
  assert.equal(view.review.findings[0].severity, 'critical'); assert.deepEqual(view.review.findings[1].ids, ['one', 'two']);
});
