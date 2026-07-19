import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTONOMOUS_DECISION,
  DECISION,
  REMEDIATION_BUDGET_MS,
  buildRemediationRequest,
  detectFileOverlap,
  evaluateChange,
  evaluateEvidence,
  matchesPathRule,
  normalizeRepoPath,
  planAutonomousDecision,
} from './changeplane.js';

const revision = {
  baseSha: 'base-1',
  headSha: 'head-1',
  policyDigest: 'policy-1',
  inputDigest: 'input-1',
  contractDigest: 'contract-1',
  evaluatorVersion: '0.2.0',
};

const policy = {
  requireApproval: ['.github/workflows/**'],
  block: ['secrets/**'],
};

test('normalizes simple repository paths and matches exact or prefix rules', () => {
  assert.equal(normalizeRepoPath('./src//payments/service.js'), 'src/payments/service.js');
  assert.equal(matchesPathRule('src/payments/service.js', 'src/payments/**'), true);
  assert.equal(matchesPathRule('src/auth.js', 'src/payments/**'), false);
  assert.equal(matchesPathRule('README.md', 'README.md'), true);
  assert.throws(() => normalizeRepoPath('../secrets/key.txt'));
  assert.throws(() => matchesPathRule('src/a.js', 'src/**/a.js'));
});

test('passes a clean change inside planned scope', () => {
  const result = evaluateChange({
    ...revision,
    plannedPaths: ['src/payments/**'],
    actualFiles: ['src/payments/service.js'],
    protectedPaths: policy,
  });

  assert.equal(result.decision, DECISION.PASS);
  assert.deepEqual(result.reasons, []);
});

test('requires review for a workflow outside planned scope', () => {
  const result = evaluateChange({
    ...revision,
    plannedPaths: ['src/payments/**'],
    actualFiles: ['.github/workflows/deploy.yml'],
    protectedPaths: policy,
  });

  assert.equal(result.decision, DECISION.REVIEW_REQUIRED);
  assert.deepEqual(
    result.reasons.map(({ code }) => code),
    ['OUTSIDE_PLANNED_SCOPE', 'PROTECTED_PATH_REQUIRES_APPROVAL'],
  );
});

test('blocks a path that policy never allows approval to override', () => {
  const result = evaluateChange({
    ...revision,
    plannedPaths: ['secrets/**'],
    actualFiles: ['secrets/production.env'],
    protectedPaths: policy,
    approval: revision,
  });

  assert.equal(result.decision, DECISION.BLOCKED);
  assert.equal(result.reasons[0].code, 'BLOCKED_PATH');
  assert.equal(result.reasons[0].resolved, false);
});

test('a matching approval resolves review findings', () => {
  const result = evaluateChange({
    ...revision,
    plannedPaths: ['src/payments/**'],
    actualFiles: ['.github/workflows/deploy.yml'],
    protectedPaths: policy,
    approval: revision,
  });

  assert.equal(result.decision, DECISION.PASS);
  assert.equal(result.approval.status, 'VALID');
  assert.equal(result.reasons.every(({ resolved }) => resolved), true);
});

test('a stale approval cannot resolve current findings', () => {
  for (const field of ['headSha', 'policyDigest', 'inputDigest']) {
    const result = evaluateChange({
      ...revision,
      plannedPaths: ['src/payments/**'],
      actualFiles: ['.github/workflows/deploy.yml'],
      protectedPaths: policy,
      approval: { ...revision, [field]: 'stale-value' },
    });

    assert.equal(result.decision, DECISION.REVIEW_REQUIRED);
    assert.deepEqual(result.approval, {
      status: 'STALE',
      staleFields: [field],
    });
  }
});

test('checks both current and previous paths for a rename', () => {
  const result = evaluateChange({
    ...revision,
    plannedPaths: ['src/config/**'],
    actualFiles: [{
      filename: 'src/config/public.env',
      previous_filename: 'secrets/production.env',
    }],
    protectedPaths: policy,
  });

  assert.equal(result.decision, DECISION.BLOCKED);
  assert.equal(
    result.reasons.some((reason) => (
      reason.code === 'BLOCKED_PATH'
      && reason.path === 'secrets/production.env'
      && reason.pathKind === 'previous'
    )),
    true,
  );
});

test('requires every named evidence check to complete successfully', () => {
  const result = evaluateEvidence({
    requiredChecks: ['validate', 'security'],
    checks: [
      { name: 'validate', status: 'completed', conclusion: 'success', completedAt: '2026-07-18T00:00:00Z' },
      { name: 'security', status: 'in_progress', conclusion: null, startedAt: '2026-07-18T00:00:00Z' },
    ],
  });

  assert.equal(result.decision, DECISION.REVIEW_REQUIRED);
  assert.deepEqual(result.reasons.map(({ code }) => code), ['EVIDENCE_PENDING']);
  assert.equal(evaluateEvidence({
    requiredChecks: ['validate'],
    checks: [{ name: 'validate', status: 'completed', conclusion: 'success' }],
  }).decision, DECISION.PASS);
});

test('binds required evidence to the declared GitHub App identity', () => {
  const result = evaluateEvidence({
    requiredChecks: [{ name: 'validate', appSlug: 'trusted-ci' }],
    checks: [
      { name: 'validate', source: 'untrusted-ci', status: 'completed', conclusion: 'success' },
      { name: 'validate', source: 'trusted-ci', status: 'completed', conclusion: 'failure' },
    ],
  });

  assert.equal(result.decision, DECISION.REVIEW_REQUIRED);
  assert.deepEqual(result.reasons.map(({ code }) => code), ['EVIDENCE_FAILED']);
  assert.deepEqual(result.evidence[0], {
    name: 'validate',
    source: 'trusted-ci',
    expectedSource: 'trusted-ci',
    status: 'COMPLETED',
    conclusion: 'FAILURE',
  });

  const mismatch = evaluateEvidence({
    requiredChecks: [{ name: 'validate', appSlug: 'trusted-ci' }],
    checks: [{ name: 'validate', source: 'untrusted-ci', status: 'completed', conclusion: 'success' }],
  });
  assert.deepEqual(mismatch.reasons.map(({ code }) => code), ['EVIDENCE_SOURCE_MISMATCH']);
  assert.throws(() => evaluateEvidence({
    requiredChecks: [{ name: 'validate', appSlug: 'Trusted CI' }],
  }), /name, appSlug/u);
});

test('reports overlap with another open pull request as advisory only', () => {
  const advisory = detectFileOverlap(
    ['src/payments/service.js', 'src/payments/types.js'],
    {
      state: 'open',
      number: 42,
      title: 'Retry payments',
      url: 'https://github.com/acme/payments/pull/42',
      actualFiles: ['src/payments/service.js', 'src/retry.js'],
    },
  );

  assert.deepEqual(advisory, {
    code: 'OPEN_PR_FILE_OVERLAP',
    severity: 'ADVISORY',
    paths: ['src/payments/service.js'],
    pullRequest: {
      number: 42,
      title: 'Retry payments',
      url: 'https://github.com/acme/payments/pull/42',
    },
  });
});

test('routes fixable scope drift to an agent without involving a human', () => {
  const result = evaluateChange({
    ...revision,
    plannedPaths: ['src/payments/**'],
    actualFiles: ['src/payments/service.js', 'docs/release-note.md'],
    protectedPaths: policy,
  });
  const plan = planAutonomousDecision({
    result,
    agentConfigured: true,
    attempt: 0,
    maxAttempts: 2,
  });

  assert.equal(plan.decision, AUTONOMOUS_DECISION.REMEDIATION_REQUIRED);
  assert.equal(plan.humanRequired, false);
  assert.equal(plan.nextAttempt, 1);
  assert.deepEqual(plan.findings.map(({ path }) => path), ['docs/release-note.md']);
});

test('routes a completed failed check into a bounded in-scope repair contract', () => {
  const result = evaluateEvidence({
    requiredChecks: [{ name: 'checkout-race', appSlug: 'trusted-ci' }],
    checks: [{
      name: 'checkout-race',
      source: 'trusted-ci',
      status: 'completed',
      conclusion: 'failure',
      diagnostic: 'AssertionError: expected one charge but observed two',
    }],
  });
  const plan = planAutonomousDecision({ result, agentConfigured: true });

  assert.equal(plan.decision, AUTONOMOUS_DECISION.REMEDIATION_REQUIRED);
  assert.equal(plan.reason, 'FIXABLE_EVIDENCE_FAILURE');
  assert.equal(plan.humanRequired, false);

  const request = buildRemediationRequest({
    idempotencyKey: 'f'.repeat(64),
    repository: 'example-org/payments-api',
    pullRequestNumber: 421,
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    headRef: 'agent/payment-retry',
    headRepository: 'example-org/payments-api',
    plannedPaths: ['src/payments/**'],
    plan,
    now: new Date('2026-07-18T00:00:00Z'),
  });

  assert.equal(request.repairKind, 'evidence');
  assert.deepEqual(request.allowedPaths, ['src/payments/**']);
  assert.deepEqual(request.instructions, [{
    code: 'EVIDENCE_FAILED',
    path: 'check:checkout-race',
    pathKind: 'evidence',
    action: 'RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE',
    diagnostic: 'AssertionError: expected one charge but observed two',
  }]);
});

test('bounds and sanitizes failed evidence before returning it to a proposal model', () => {
  const result = evaluateEvidence({
    requiredChecks: ['checkout-race'],
    checks: [{
      name: 'checkout-race',
      status: 'completed',
      conclusion: 'failure',
      diagnostic: `\u0000duplicate charge\r\n${'x'.repeat(7_000)}`,
    }],
  });

  assert.equal(result.reasons[0].diagnostic.startsWith('duplicate charge\n'), true);
  assert.equal(result.reasons[0].diagnostic.length, 6_000);
  assert.equal(result.reasons[0].diagnostic.includes('\u0000'), false);
});

test('keeps protected paths and exhausted remediation budgets on the human exception path', () => {
  const protectedResult = evaluateChange({
    ...revision,
    plannedPaths: ['src/payments/**'],
    actualFiles: ['.github/workflows/deploy.yml'],
    protectedPaths: policy,
  });
  const protectedPlan = planAutonomousDecision({
    result: protectedResult,
    agentConfigured: true,
  });
  assert.equal(protectedPlan.decision, AUTONOMOUS_DECISION.REVIEW_REQUIRED);
  assert.equal(protectedPlan.reason, 'PROTECTED_CAPABILITY');

  const fixableResult = evaluateChange({
    ...revision,
    plannedPaths: ['src/payments/**'],
    actualFiles: ['docs/release-note.md'],
    protectedPaths: policy,
  });
  const exhaustedPlan = planAutonomousDecision({
    result: fixableResult,
    agentConfigured: true,
    attempt: 2,
    maxAttempts: 2,
  });
  assert.equal(exhaustedPlan.decision, AUTONOMOUS_DECISION.REVIEW_REQUIRED);
  assert.equal(exhaustedPlan.reason, 'REMEDIATION_BUDGET_EXHAUSTED');
});

test('builds a bounded and idempotent remediation contract', () => {
  const result = evaluateChange({
    ...revision,
    plannedPaths: ['src/payments/**'],
    actualFiles: ['docs/release-note.md'],
    protectedPaths: policy,
  });
  const plan = planAutonomousDecision({ result, agentConfigured: true });
  const request = buildRemediationRequest({
    idempotencyKey: 'f'.repeat(64),
    repository: 'example-org/payments-api',
    pullRequestNumber: 421,
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    headRef: 'agent/payment-retry',
    headRepository: 'example-org/payments-api',
    plannedPaths: ['src/payments/**'],
    plan,
    now: new Date('2026-07-18T00:00:00Z'),
  });

  assert.equal(request.schemaVersion, 2);
  assert.equal(request.issuer, 'changeplane-guard');
  assert.equal(request.attempt, 1);
  assert.equal(request.budget.attempt, 1);
  assert.equal(request.budget.maxAttempts, 2);
  assert.equal(request.budget.startedAt, '2026-07-18T00:00:00.000Z');
  assert.equal(request.budget.expiresAt, '2026-07-18T00:15:00.000Z');
  assert.equal(request.limits.totalDeadlineSeconds, 900);
  assert.equal(request.limits.mayEditOutsideDeclaredScope, false);
  assert.equal(request.expiresAt, '2026-07-18T00:15:00.000Z');
  assert.equal(request.change.headRef, 'agent/payment-retry');
  assert.equal(request.repairKind, 'scope');
  assert.deepEqual(request.allowedPaths, ['docs/release-note.md']);
  assert.deepEqual(request.instructions, [{
    code: 'OUTSIDE_PLANNED_SCOPE',
    path: 'docs/release-note.md',
    pathKind: 'current',
    action: 'REVERT_OR_MOVE_INTO_DECLARED_SCOPE',
  }]);
});

test('keeps attempt two inside the first attempt shared deadline', () => {
  const result = evaluateChange({
    ...revision,
    plannedPaths: ['src/payments/**'],
    actualFiles: ['docs/release-note.md'],
    protectedPaths: policy,
  });
  const plan = planAutonomousDecision({ result, agentConfigured: true, attempt: 1, maxAttempts: 2 });
  const startedAt = new Date('2026-07-18T00:00:00Z');
  const expiresAt = new Date(startedAt.getTime() + REMEDIATION_BUDGET_MS);
  const request = buildRemediationRequest({
    idempotencyKey: 'e'.repeat(64),
    repository: 'example-org/payments-api',
    pullRequestNumber: 421,
    baseSha: 'a'.repeat(40),
    headSha: 'c'.repeat(40),
    headRef: 'agent/payment-retry',
    headRepository: 'example-org/payments-api',
    plannedPaths: ['src/payments/**'],
    plan,
    budgetStartedAt: startedAt,
    budgetExpiresAt: expiresAt,
    now: new Date('2026-07-18T00:14:00Z'),
  });

  assert.equal(request.budget.attempt, 2);
  assert.equal(request.budget.startedAt, startedAt.toISOString());
  assert.equal(request.expiresAt, expiresAt.toISOString());
  assert.throws(() => buildRemediationRequest({
    idempotencyKey: 'c'.repeat(64),
    repository: 'example-org/payments-api',
    pullRequestNumber: 421,
    baseSha: 'a'.repeat(40),
    headSha: 'c'.repeat(40),
    headRef: 'agent/payment-retry',
    headRepository: 'example-org/payments-api',
    plannedPaths: ['src/payments/**'],
    plan,
    now: new Date('2026-07-18T00:14:00Z'),
  }), /requires the original shared budget/u);
  assert.throws(() => buildRemediationRequest({
    ...request.change,
    idempotencyKey: 'd'.repeat(64),
    repository: request.change.repository,
    pullRequestNumber: request.change.pullRequestNumber,
    plannedPaths: request.declaredScope,
    plan,
    budgetStartedAt: startedAt,
    budgetExpiresAt: expiresAt,
    now: expiresAt,
  }), /budget is not active/u);
});
