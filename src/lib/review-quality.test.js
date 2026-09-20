import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewQuality } from './review-quality.js';
test('missing data is not a perfect score', () => {
  const result = reviewQuality({ schemaVersion: 1, cases: [] });
  assert.equal(result.status, 'not_started'); assert.equal(result.actionability, null); assert.equal(result.knownDefectRecall, null);
});
test('quality report keeps incomplete, unresolved and missing recall evidence visible', () => {
  const result = reviewQuality({ schemaVersion: 1, cases: [
    { id: 'case1', complete: false, findings: [{ id: '1', verdict: 'actionable' }, { id: '2', verdict: 'false_positive' }, { id: '3', verdict: 'unresolved' }], knownDefects: ['bug1', 'bug2'], detectedKnownDefects: ['bug1'] },
    { id: 'case2', complete: true, findings: [] },
  ] });
  assert.equal(result.actionability, 0.5); assert.equal(result.knownDefectRecall, 0.5);
  assert.equal(result.incompleteReviews, 1); assert.equal(result.unresolved, 1); assert.equal(result.unmeasuredRecallCases, 1);
  assert.equal(JSON.stringify(result).includes('case1'), false);
});
test('duplicate cases, duplicate labels and invented detected defects are rejected', () => {
  const item = { id: 'case1', complete: true, findings: [] };
  assert.throws(() => reviewQuality({ schemaVersion: 1, cases: [item, item] }));
  assert.throws(() => reviewQuality({ schemaVersion: 1, cases: [{ ...item, knownDefects: ['a'], detectedKnownDefects: ['b'] }] }));
  assert.throws(() => reviewQuality({ schemaVersion: 1, cases: [{ ...item, findings: [{ id: 'a', verdict: 'approved' }] }] }));
});
