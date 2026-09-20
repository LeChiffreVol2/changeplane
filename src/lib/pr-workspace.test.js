import test from 'node:test';
import assert from 'node:assert/strict';
import { presentAssessment } from './pr-workspace.js';
const repository = 'example/project', number = 7, headSha = 'a'.repeat(40);
const report = () => ({ headSha, decision: 'EVIDENCE_SATISFIED', findings: [], evidence: [], nextAction: 'Follow repository policy.',
  observation: { repository, pullRequest: number, observedAt: '2026-09-20T00:00:00Z' }, handback: { binding: { currentHeadSha: headSha } } });
test('one current presentation explains role, consequence and handoff without merge authority', () => {
  const view = presentAssessment(report(), { repository, number }); assert.equal(view.status, 'evidence_ready');
  assert.equal(view.owner, 'Repository maintainer'); assert.equal(view.authority.mergeAuthorized, false);
  assert.match(view.actions.handoff, new RegExp(headSha)); assert.equal(view.review.status, 'not_collected');
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
