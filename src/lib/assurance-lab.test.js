import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSURANCE_LAB_CASE,
  listAssuranceLabCases,
  runAssuranceLab,
  runAssuranceLabCase,
  runOriginBoundaryProof,
} from './assurance-lab.js';

test('lists the stable assurance case catalog in execution order', () => {
  assert.deepEqual(
    listAssuranceLabCases().map(({ id }) => id),
    [
      ASSURANCE_LAB_CASE.CLEAN_EXACT_HEAD,
      ASSURANCE_LAB_CASE.STALE_HEAD_APPROVAL,
      ASSURANCE_LAB_CASE.EXPANDED_SCOPE,
      ASSURANCE_LAB_CASE.PROTECTED_TEST_TAMPERING,
      ASSURANCE_LAB_CASE.BLOCKED_SECRET_PATH,
      ASSURANCE_LAB_CASE.WRONG_PUBLISHER,
      ASSURANCE_LAB_CASE.FAILED_EVIDENCE,
      ASSURANCE_LAB_CASE.MALFORMED_PATCH,
      ASSURANCE_LAB_CASE.PROVIDER_FAILURE,
      ASSURANCE_LAB_CASE.ORIGIN_MIRROR_EXACT_HEAD,
      ASSURANCE_LAB_CASE.ORIGIN_MIRROR_STALE_HEAD,
      ASSURANCE_LAB_CASE.ORIGIN_MIRROR_PROTECTED_CHANGE,
    ],
  );
});

test('passes a clean change only with exact-head trusted evidence', () => {
  const result = runAssuranceLabCase(ASSURANCE_LAB_CASE.CLEAN_EXACT_HEAD);

  assert.equal(result.revision.exactHead, true);
  assert.equal(result.observed.evaluationDecision, 'PASS');
  assert.equal(result.observed.outcome, 'PASS');
  assert.equal(result.observed.guardEligible, true);
  assert.equal(result.observed.repositoryMutation, false);
  assert.deepEqual(result.observed.reasonCodes, []);
  assert.equal(result.evidence[0].source, 'trusted-ci');
  assert.equal(result.assertion.passed, true);
});

test('rejects an approval bound to a stale head', () => {
  const result = runAssuranceLabCase(ASSURANCE_LAB_CASE.STALE_HEAD_APPROVAL);

  assert.equal(result.revision.exactHead, true);
  assert.equal(result.observed.approvalStatus, 'STALE');
  assert.deepEqual(result.observed.staleApprovalFields, ['headSha']);
  assert.deepEqual(result.observed.reasonCodes, ['PROTECTED_PATH_REQUIRES_APPROVAL']);
  assert.equal(result.observed.outcome, 'REVIEW_REQUIRED');
  assert.equal(result.observed.automationReason, 'PROTECTED_CAPABILITY');
  assert.equal(result.observed.guardEligible, false);
  assert.equal(result.assertion.passed, true);
});

test('routes expanded scope to bounded remediation without mutating during evaluation', () => {
  const result = runAssuranceLabCase(ASSURANCE_LAB_CASE.EXPANDED_SCOPE);

  assert.deepEqual(result.observed.reasonCodes, ['OUTSIDE_PLANNED_SCOPE']);
  assert.equal(result.observed.evaluationDecision, 'REVIEW_REQUIRED');
  assert.equal(result.observed.planDecision, 'REMEDIATION_REQUIRED');
  assert.equal(result.observed.outcome, 'REMEDIATION_REQUIRED');
  assert.equal(result.observed.automationReason, 'FIXABLE_SCOPE_DRIFT');
  assert.equal(result.observed.repositoryMutation, false);
  assert.equal(result.assertion.passed, true);
});

test('keeps protected test tampering on the human review path', () => {
  const result = runAssuranceLabCase(ASSURANCE_LAB_CASE.PROTECTED_TEST_TAMPERING);

  assert.deepEqual(result.observed.reasonCodes, ['PROTECTED_PATH_REQUIRES_APPROVAL']);
  assert.equal(result.observed.outcome, 'REVIEW_REQUIRED');
  assert.equal(result.observed.humanRequired, true);
  assert.equal(result.observed.automationReason, 'PROTECTED_CAPABILITY');
  assert.equal(result.observed.guardEligible, false);
  assert.equal(result.assertion.passed, true);
});

test('blocks a secret path as non-overridable policy', () => {
  const result = runAssuranceLabCase(ASSURANCE_LAB_CASE.BLOCKED_SECRET_PATH);

  assert.deepEqual(result.observed.reasonCodes, ['BLOCKED_PATH']);
  assert.equal(result.observed.evaluationDecision, 'BLOCKED');
  assert.equal(result.observed.outcome, 'BLOCKED');
  assert.equal(result.observed.automationReason, 'NON_OVERRIDABLE_POLICY');
  assert.equal(result.observed.providerStatus, 'NOT_REQUESTED');
  assert.equal(result.observed.repositoryMutation, false);
  assert.equal(result.assertion.passed, true);
});

test('does not accept a successful check from the wrong publisher', () => {
  const result = runAssuranceLabCase(ASSURANCE_LAB_CASE.WRONG_PUBLISHER);

  assert.deepEqual(result.observed.reasonCodes, ['EVIDENCE_SOURCE_MISMATCH']);
  assert.equal(result.evidence[0].source, null);
  assert.equal(result.evidence[0].expectedSource, 'trusted-ci');
  assert.equal(result.observed.outcome, 'REVIEW_REQUIRED');
  assert.equal(result.observed.automationReason, 'EVIDENCE_SOURCE_MISMATCH');
  assert.equal(result.observed.guardEligible, false);
  assert.equal(result.assertion.passed, true);
});

test('routes trusted failed evidence to repair planning without publishing PASS', () => {
  const result = runAssuranceLabCase(ASSURANCE_LAB_CASE.FAILED_EVIDENCE);

  assert.deepEqual(result.observed.reasonCodes, ['EVIDENCE_FAILED']);
  assert.equal(result.evidence[0].source, 'trusted-ci');
  assert.equal(result.evidence[0].conclusion, 'FAILURE');
  assert.equal(result.observed.planDecision, 'REMEDIATION_REQUIRED');
  assert.equal(result.observed.automationReason, 'FIXABLE_EVIDENCE_FAILURE');
  assert.equal(result.observed.guardEligible, false);
  assert.equal(result.observed.repositoryMutation, false);
  assert.equal(result.assertion.passed, true);
});

test('rejects a malformed provider patch before repository mutation', () => {
  const result = runAssuranceLabCase(ASSURANCE_LAB_CASE.MALFORMED_PATCH);

  assert.equal(result.observed.planDecision, 'REMEDIATION_REQUIRED');
  assert.equal(result.observed.outcome, 'BLOCKED');
  assert.equal(result.observed.automationReason, 'MALFORMED_PATCH');
  assert.equal(result.observed.providerStatus, 'REJECTED');
  assert.deepEqual(result.observed.reasonCodes, ['EVIDENCE_FAILED', 'MALFORMED_PATCH']);
  assert.equal(result.observed.repositoryMutation, false);
  assert.equal(result.observed.guardEligible, false);
  assert.equal(result.assertion.passed, true);
});

test('fails closed when the proposal provider fails and permits no mutation', () => {
  const before = runAssuranceLabCase(ASSURANCE_LAB_CASE.PROVIDER_FAILURE);
  const snapshot = JSON.stringify(before);
  const after = runAssuranceLabCase(ASSURANCE_LAB_CASE.PROVIDER_FAILURE);

  assert.equal(before.observed.planDecision, 'REMEDIATION_REQUIRED');
  assert.equal(before.observed.outcome, 'BLOCKED');
  assert.equal(before.observed.automationReason, 'PROVIDER_FAILURE');
  assert.equal(before.observed.providerStatus, 'FAILED');
  assert.equal(before.observed.repositoryMutation, false);
  assert.equal(before.observed.guardEligible, false);
  assert.equal(before.assertion.passed, true);
  assert.equal(JSON.stringify(after), snapshot);
});

test('returns a stable JSON-friendly full-lab summary', () => {
  const first = runAssuranceLab();
  const roundTripped = JSON.parse(JSON.stringify(first));
  const second = runAssuranceLab();

  assert.deepEqual(roundTripped, first);
  assert.deepEqual(second, first);
  assert.deepEqual(first.summary, {
    total: 12,
    passed: 12,
    failed: 0,
    allPassed: true,
    exactHeadCases: 11,
    guardEligible: 2,
    guardIneligible: 10,
    repositoryMutations: 0,
    decisions: {
      PASS: 2,
      REMEDIATION_REQUIRED: 2,
      REVIEW_REQUIRED: 5,
      BLOCKED: 3,
    },
  });
});

test('proves the GitHub-mirrored Cursor Origin boundary without claiming native Origin support', () => {
  const proof = runOriginBoundaryProof();

  assert.equal(proof.type, 'changeplane.cursor-origin-boundary-proof');
  assert.deepEqual(proof.summary, {
    total: 6,
    passed: 6,
    failed: 0,
    allPassed: true,
    executableCases: 12,
    executableCasesPassed: 12,
    originBoundaryCases: 3,
  });
  assert.equal(proof.compatibility.githubMirroredOrigin, 'CANDIDATE_THROUGH_GITHUB');
  assert.equal(proof.compatibility.standaloneOrigin, 'UNSUPPORTED_NOT_TESTED');
  assert.equal(proof.execution.externalRequests, 0);
  assert.equal(proof.documentedContext.sources.length, 3);
  assert.equal(proof.assertions.every(({ passed }) => passed), true);
  assert.match(
    proof.assertions.find(({ id }) => id === 'origin-exact-head').observed,
    /eligible \(not published\)/u,
  );
  assert.match(proof.limits.join(' '), /does not call the Origin API/u);
  assert.match(proof.limits.join(' '), /does not prove.*faster/u);
});

test('keeps stale and protected Origin-mirror fixtures fail closed', () => {
  const stale = runAssuranceLabCase(ASSURANCE_LAB_CASE.ORIGIN_MIRROR_STALE_HEAD);
  const protectedChange = runAssuranceLabCase(ASSURANCE_LAB_CASE.ORIGIN_MIRROR_PROTECTED_CHANGE);

  assert.equal(stale.revision.exactHead, false);
  assert.deepEqual(stale.observed.reasonCodes, ['STALE_HEAD']);
  assert.equal(stale.observed.guardEligible, false);
  assert.equal(stale.observed.repositoryMutation, false);
  assert.equal(protectedChange.observed.outcome, 'REVIEW_REQUIRED');
  assert.deepEqual(protectedChange.observed.reasonCodes, ['PROTECTED_PATH_REQUIRES_APPROVAL']);
  assert.equal(protectedChange.observed.guardEligible, false);
  assert.equal(protectedChange.boundary.sourceOfTruth, 'github');
});

test('supports deterministic subsets and rejects invalid selections', () => {
  const subset = runAssuranceLab({
    caseIds: [ASSURANCE_LAB_CASE.WRONG_PUBLISHER, ASSURANCE_LAB_CASE.PROVIDER_FAILURE],
  });

  assert.deepEqual(subset.cases.map(({ id }) => id), [
    ASSURANCE_LAB_CASE.WRONG_PUBLISHER,
    ASSURANCE_LAB_CASE.PROVIDER_FAILURE,
  ]);
  assert.equal(subset.summary.total, 2);
  assert.equal(subset.summary.guardIneligible, 2);
  assert.throws(() => runAssuranceLab({ caseIds: 'provider-failure' }), /array/u);
  assert.throws(() => runAssuranceLab({
    caseIds: [ASSURANCE_LAB_CASE.PROVIDER_FAILURE, ASSURANCE_LAB_CASE.PROVIDER_FAILURE],
  }), /duplicates/u);
  assert.throws(() => runAssuranceLabCase('unknown-case'), /Unknown assurance lab case/u);
});
