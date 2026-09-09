import {
  AUTONOMOUS_DECISION,
  DECISION,
  evaluateChange,
  evaluateEvidence,
  planAutonomousDecision,
} from './changeplane.js';
import { validateBoundedPatchProposal } from './runtime.js';

export const ASSURANCE_LAB_CASE = Object.freeze({
  CLEAN_EXACT_HEAD: 'clean-exact-head',
  STALE_HEAD_APPROVAL: 'stale-head-approval',
  EXPANDED_SCOPE: 'expanded-scope',
  PROTECTED_TEST_TAMPERING: 'protected-test-tampering',
  BLOCKED_SECRET_PATH: 'blocked-secret-path',
  WRONG_PUBLISHER: 'wrong-publisher',
  FAILED_EVIDENCE: 'failed-evidence',
  MALFORMED_PATCH: 'malformed-patch',
  PROVIDER_FAILURE: 'provider-failure',
  ORIGIN_MIRROR_EXACT_HEAD: 'origin-mirror-exact-head',
  ORIGIN_MIRROR_STALE_HEAD: 'origin-mirror-stale-head',
  ORIGIN_MIRROR_PROTECTED_CHANGE: 'origin-mirror-protected-change',
});

const SCHEMA_VERSION = 1;
const PROVIDER_STATUS = Object.freeze({
  NOT_REQUESTED: 'NOT_REQUESTED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
});
const CURRENT_HEAD_SHA = '2'.repeat(40);
const STALE_HEAD_SHA = '3'.repeat(40);
const REVISION = Object.freeze({
  baseSha: '1'.repeat(40),
  headSha: CURRENT_HEAD_SHA,
  policyDigest: '4'.repeat(64),
  inputDigest: '5'.repeat(64),
  contractDigest: '6'.repeat(64),
  evaluatorVersion: 'assurance-lab-1',
});
const PROTECTED_PATHS = Object.freeze({
  requireApproval: Object.freeze([
    'tests/**',
    '.github/workflows/**',
    '.changeplane.json',
    'package.json',
    'package-lock.json',
  ]),
  block: Object.freeze(['secrets/**']),
});
const REQUIRED_EVIDENCE = Object.freeze([
  Object.freeze({ name: 'CI / verify', appSlug: 'trusted-ci' }),
]);
const PASSING_EVIDENCE = Object.freeze([
  Object.freeze({
    name: 'CI / verify',
    source: 'trusted-ci',
    status: 'completed',
    conclusion: 'success',
    checkRunId: 8042,
    publisherAppId: 15368,
    completedAt: '2026-08-31T00:00:00.000Z',
  }),
]);
const ORIGIN_BOUNDARY_CASES = Object.freeze([
  ASSURANCE_LAB_CASE.ORIGIN_MIRROR_EXACT_HEAD,
  ASSURANCE_LAB_CASE.ORIGIN_MIRROR_STALE_HEAD,
  ASSURANCE_LAB_CASE.ORIGIN_MIRROR_PROTECTED_CHANGE,
]);
const ORIGIN_CONTEXT = Object.freeze({
  documentedAsOf: '2026-08-31',
  originStatus: 'EARLY_BETA',
  mirroredPath: 'CANDIDATE_THROUGH_GITHUB',
  standaloneOrigin: 'UNSUPPORTED_NOT_TESTED',
  externalRequests: 0,
  sources: Object.freeze([
    Object.freeze({ label: 'Cursor Origin', url: 'https://cursor.com/docs/origin' }),
    Object.freeze({ label: 'GitHub mirroring', url: 'https://cursor.com/docs/origin/mirror-github' }),
    Object.freeze({ label: 'Origin API', url: 'https://cursor.com/docs/api/origin' }),
  ]),
  limits: Object.freeze([
    'This executes ChangePlane behavior on synthetic GitHub-mirrored fixtures; it does not call the Origin API.',
    'It does not prove that ChangePlane is faster or that Origin lacks equivalent exact-head, Check, or ruleset controls.',
    'Standalone Origin repositories remain unsupported and are not counted as a passing fixture.',
  ]),
});

function scenario({
  id,
  label,
  category,
  description,
  plannedPaths = ['src/payments/**'],
  actualFiles = ['src/payments/retry.js'],
  approval = null,
  checks = PASSING_EVIDENCE,
  providerFailure = false,
  patchProposal = null,
  authoringSurface = 'github_pull_request',
  integrationPath = 'github_native',
  evaluatedHeadSha = CURRENT_HEAD_SHA,
  expected,
}) {
  return {
    id,
    label,
    category,
    description,
    change: {
      ...REVISION,
      plannedPaths,
      actualFiles,
      protectedPaths: PROTECTED_PATHS,
      approval,
    },
    evidence: {
      requiredChecks: REQUIRED_EVIDENCE,
      checks,
    },
    evaluatedHeadSha,
    providerFailure,
    patchProposal,
    boundary: {
      authoringSurface,
      integrationPath,
      sourceOfTruth: 'github',
      mergeAuthority: 'github',
    },
    expected,
  };
}

const CASE_DEFINITIONS = Object.freeze([
  scenario({
    id: ASSURANCE_LAB_CASE.CLEAN_EXACT_HEAD,
    label: 'Clean exact-head pass',
    category: 'exact-head',
    description: 'The declared source change and trusted evidence both bind to the current head.',
    expected: {
      outcome: AUTONOMOUS_DECISION.PASS,
      reasonCodes: [],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: true,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.STALE_HEAD_APPROVAL,
    label: 'Stale-head approval rejection',
    category: 'exact-head',
    description: 'An approval for an older head cannot authorize a protected change on the current head.',
    plannedPaths: ['src/payments/**', 'tests/**'],
    actualFiles: ['tests/payment-retry.test.js'],
    approval: { ...REVISION, headSha: STALE_HEAD_SHA },
    expected: {
      outcome: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
      reasonCodes: ['PROTECTED_PATH_REQUIRES_APPROVAL'],
      approvalStatus: 'STALE',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.EXPANDED_SCOPE,
    label: 'Expanded scope',
    category: 'scope',
    description: 'A file outside the declared contract is routed to bounded remediation.',
    actualFiles: ['src/payments/retry.js', 'docs/unplanned-release-note.md'],
    expected: {
      outcome: AUTONOMOUS_DECISION.REMEDIATION_REQUIRED,
      reasonCodes: ['OUTSIDE_PLANNED_SCOPE'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.PROTECTED_TEST_TAMPERING,
    label: 'Protected test tampering',
    category: 'protected-path',
    description: 'A changed test remains a human-reviewed capability even when it was declared in scope.',
    plannedPaths: ['src/payments/**', 'tests/**'],
    actualFiles: ['tests/payment-retry.test.js'],
    expected: {
      outcome: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
      reasonCodes: ['PROTECTED_PATH_REQUIRES_APPROVAL'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.BLOCKED_SECRET_PATH,
    label: 'Blocked secret path',
    category: 'blocked-path',
    description: 'A non-overridable secret path stops before proposal or mutation.',
    plannedPaths: ['secrets/**'],
    actualFiles: ['secrets/production.env'],
    expected: {
      outcome: AUTONOMOUS_DECISION.BLOCKED,
      reasonCodes: ['BLOCKED_PATH'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.WRONG_PUBLISHER,
    label: 'Wrong evidence publisher',
    category: 'evidence',
    description: 'A successful check from a lookalike publisher does not satisfy trusted evidence.',
    checks: [{
      name: 'CI / verify',
      source: 'lookalike-ci',
      status: 'completed',
      conclusion: 'success',
      completedAt: '2026-08-31T00:00:00.000Z',
    }],
    expected: {
      outcome: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
      reasonCodes: ['EVIDENCE_SOURCE_MISMATCH'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.FAILED_EVIDENCE,
    label: 'Failed behavioral evidence',
    category: 'evidence',
    description: 'A trusted failed check is eligible for bounded remediation but cannot publish the guard.',
    checks: [{
      name: 'CI / verify',
      source: 'trusted-ci',
      status: 'completed',
      conclusion: 'failure',
      failureKind: 'behavioral', // Synthetic harness classification; live metadata alone does not supply this.
      diagnostic: 'AssertionError: expected one charge but observed two',
      completedAt: '2026-08-31T00:00:00.000Z',
    }],
    expected: {
      outcome: AUTONOMOUS_DECISION.REMEDIATION_REQUIRED,
      reasonCodes: ['EVIDENCE_FAILED'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.MALFORMED_PATCH,
    label: 'Malformed proposal patch',
    category: 'proposal-boundary',
    description: 'Provider prose is rejected before the trusted controller can apply repository bytes.',
    checks: [{
      name: 'CI / verify',
      source: 'trusted-ci',
      status: 'completed',
      conclusion: 'failure',
      failureKind: 'behavioral', // Synthetic harness classification; live metadata alone does not supply this.
      diagnostic: 'AssertionError: retry was not idempotent',
      completedAt: '2026-08-31T00:00:00.000Z',
    }],
    patchProposal: 'I fixed the retry race and the tests should pass now.',
    expected: {
      outcome: AUTONOMOUS_DECISION.BLOCKED,
      reasonCodes: ['EVIDENCE_FAILED', 'MALFORMED_PATCH'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.REJECTED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.PROVIDER_FAILURE,
    label: 'Provider failure before mutation',
    category: 'provider',
    description: 'A proposal-provider failure converts a repair plan into a fail-closed result with no mutation.',
    checks: [{
      name: 'CI / verify',
      source: 'trusted-ci',
      status: 'completed',
      conclusion: 'failure',
      failureKind: 'behavioral', // Synthetic harness classification; live metadata alone does not supply this.
      diagnostic: 'AssertionError: retry was not idempotent',
      completedAt: '2026-08-31T00:00:00.000Z',
    }],
    providerFailure: true,
    expected: {
      outcome: AUTONOMOUS_DECISION.BLOCKED,
      reasonCodes: ['EVIDENCE_FAILED'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.FAILED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.ORIGIN_MIRROR_EXACT_HEAD,
    label: 'Origin mirror · exact GitHub head',
    category: 'origin-boundary',
    description: 'Cursor may be the authoring and mirror surface; the GitHub exact head and trusted evidence still decide.',
    authoringSurface: 'cursor_origin_github_mirror',
    integrationPath: 'origin_mirror_via_github',
    expected: {
      outcome: AUTONOMOUS_DECISION.PASS,
      reasonCodes: [],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: true,
    },
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.ORIGIN_MIRROR_STALE_HEAD,
    label: 'Origin mirror · stale visible head',
    category: 'origin-boundary',
    description: 'An Origin-visible revision that is not the current GitHub head cannot inherit a guard or mutate the repository.',
    authoringSurface: 'cursor_origin_github_mirror',
    integrationPath: 'origin_mirror_via_github',
    expected: {
      outcome: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
      reasonCodes: ['STALE_HEAD'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: false,
    },
    evaluatedHeadSha: STALE_HEAD_SHA,
  }),
  scenario({
    id: ASSURANCE_LAB_CASE.ORIGIN_MIRROR_PROTECTED_CHANGE,
    label: 'Origin mirror · protected test change',
    category: 'origin-boundary',
    description: 'A self-modified test remains human-reviewed even when the change arrives through an Origin-mirrored pull request.',
    authoringSurface: 'cursor_origin_github_mirror',
    integrationPath: 'origin_mirror_via_github',
    plannedPaths: ['src/payments/**', 'tests/**'],
    actualFiles: ['tests/payment-retry.test.js'],
    expected: {
      outcome: AUTONOMOUS_DECISION.REVIEW_REQUIRED,
      reasonCodes: ['PROTECTED_PATH_REQUIRES_APPROVAL'],
      approvalStatus: 'MISSING',
      providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
      repositoryMutation: false,
      guardEligible: false,
    },
  }),
]);

const CASES_BY_ID = new Map(CASE_DEFINITIONS.map((definition) => [definition.id, definition]));

function combineEvaluations(change, evidence, exactHead) {
  const revisionReasons = exactHead
    ? []
    : [{
        code: 'STALE_HEAD',
        path: 'revision:head',
        pathKind: 'revision',
        resolved: false,
      }];
  const evidenceReasons = evidence.reasons.map((reason) => ({ ...reason, resolved: false }));
  const reasons = [...revisionReasons, ...change.reasons, ...evidenceReasons];
  const decision = change.decision === DECISION.BLOCKED
    ? DECISION.BLOCKED
    : !exactHead || change.decision !== DECISION.PASS || evidence.decision !== DECISION.PASS
      ? DECISION.REVIEW_REQUIRED
      : DECISION.PASS;

  return { decision, reasons };
}

function applyProviderBoundary(plan, providerFailure, patchProposal) {
  if (plan.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED && providerFailure) {
    return {
      decision: AUTONOMOUS_DECISION.BLOCKED,
      reason: 'PROVIDER_FAILURE',
      humanRequired: true,
      providerStatus: PROVIDER_STATUS.FAILED,
      boundaryReasonCodes: [],
    };
  }

  if (plan.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED && patchProposal !== null) {
    try {
      validateBoundedPatchProposal(patchProposal, ['src/payments/**']);
    } catch {
      return {
        decision: AUTONOMOUS_DECISION.BLOCKED,
        reason: 'MALFORMED_PATCH',
        humanRequired: true,
        providerStatus: PROVIDER_STATUS.REJECTED,
        boundaryReasonCodes: ['MALFORMED_PATCH'],
      };
    }
  }

  return {
    decision: plan.decision,
    reason: plan.reason,
    humanRequired: plan.humanRequired,
    providerStatus: PROVIDER_STATUS.NOT_REQUESTED,
    boundaryReasonCodes: [],
  };
}

function equalStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareExpected(expected, observed) {
  const checks = {
    outcome: observed.outcome === expected.outcome,
    reasonCodes: equalStrings(observed.reasonCodes, expected.reasonCodes),
    approvalStatus: observed.approvalStatus === expected.approvalStatus,
    providerStatus: observed.providerStatus === expected.providerStatus,
    repositoryMutation: observed.repositoryMutation === expected.repositoryMutation,
    guardEligible: observed.guardEligible === expected.guardEligible,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}

export function listAssuranceLabCases() {
  return CASE_DEFINITIONS.map(({ id, label, category, description }) => ({
    id,
    label,
    category,
    description,
  }));
}

export function runAssuranceLabCase(caseId) {
  if (typeof caseId !== 'string' || !CASES_BY_ID.has(caseId)) {
    throw new RangeError(`Unknown assurance lab case: ${String(caseId)}`);
  }

  const definition = CASES_BY_ID.get(caseId);
  const change = evaluateChange(definition.change);
  const evidence = evaluateEvidence(definition.evidence);
  const exactHead = definition.evaluatedHeadSha === definition.change.headSha;
  const evaluation = combineEvaluations(change, evidence, exactHead);
  const plan = planAutonomousDecision({
    result: evaluation,
    agentConfigured: true,
    attempt: 0,
    maxAttempts: 2,
  });
  const execution = applyProviderBoundary(plan, definition.providerFailure, definition.patchProposal);
  const guardEligible = exactHead && execution.decision === AUTONOMOUS_DECISION.PASS;
  const observed = {
    outcome: execution.decision,
    evaluationDecision: evaluation.decision,
    planDecision: plan.decision,
    automationReason: execution.reason,
    humanRequired: execution.humanRequired,
    reasonCodes: [...evaluation.reasons
      .filter(({ resolved }) => !resolved)
      .map(({ code }) => code), ...execution.boundaryReasonCodes],
    approvalStatus: change.approval.status,
    staleApprovalFields: [...change.approval.staleFields],
    providerStatus: execution.providerStatus,
    repositoryMutation: false,
    guardEligible,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    id: definition.id,
    label: definition.label,
    category: definition.category,
    description: definition.description,
    revision: {
      baseSha: definition.change.baseSha,
      headSha: definition.change.headSha,
      evaluatedHeadSha: definition.evaluatedHeadSha,
      exactHead,
    },
    evidence: evidence.evidence.map((item) => ({ ...item })),
    boundary: { ...definition.boundary },
    expected: { ...definition.expected, reasonCodes: [...definition.expected.reasonCodes] },
    observed,
    assertion: compareExpected(definition.expected, observed),
  };
}

function summarize(results) {
  const decisions = {
    [AUTONOMOUS_DECISION.PASS]: 0,
    [AUTONOMOUS_DECISION.REMEDIATION_REQUIRED]: 0,
    [AUTONOMOUS_DECISION.REVIEW_REQUIRED]: 0,
    [AUTONOMOUS_DECISION.BLOCKED]: 0,
  };
  for (const result of results) {
    decisions[result.observed.outcome] += 1;
  }

  const passed = results.filter(({ assertion }) => assertion.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    allPassed: passed === results.length,
    exactHeadCases: results.filter(({ revision }) => revision.exactHead).length,
    guardEligible: results.filter(({ observed }) => observed.guardEligible).length,
    guardIneligible: results.filter(({ observed }) => !observed.guardEligible).length,
    repositoryMutations: results.filter(({ observed }) => observed.repositoryMutation).length,
    decisions,
  };
}

export function runAssuranceLab({ caseIds } = {}) {
  const selectedIds = caseIds ?? CASE_DEFINITIONS.map(({ id }) => id);
  if (!Array.isArray(selectedIds)) {
    throw new TypeError('caseIds must be an array');
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new TypeError('caseIds must not contain duplicates');
  }

  const cases = selectedIds.map(runAssuranceLabCase);
  return {
    schemaVersion: SCHEMA_VERSION,
    cases,
    summary: summarize(cases),
  };
}

function observedFingerprint(result) {
  return JSON.stringify({
    outcome: result.observed.outcome,
    reasonCodes: result.observed.reasonCodes,
    guardEligible: result.observed.guardEligible,
    repositoryMutation: result.observed.repositoryMutation,
  });
}

function proofAssertion(id, label, expected, observed, passed) {
  return { id, label, expected, observed, passed };
}

export function runOriginBoundaryProof() {
  const lab = runAssuranceLab();
  const byId = new Map(lab.cases.map((item) => [item.id, item]));
  const direct = byId.get(ASSURANCE_LAB_CASE.CLEAN_EXACT_HEAD);
  const exact = byId.get(ASSURANCE_LAB_CASE.ORIGIN_MIRROR_EXACT_HEAD);
  const stale = byId.get(ASSURANCE_LAB_CASE.ORIGIN_MIRROR_STALE_HEAD);
  const protectedChange = byId.get(ASSURANCE_LAB_CASE.ORIGIN_MIRROR_PROTECTED_CHANGE);
  const originCases = ORIGIN_BOUNDARY_CASES.map((id) => byId.get(id));
  const assertions = [
    proofAssertion(
      'github-authority-retained',
      'GitHub remains source and merge authority',
      'Every Origin-mirror fixture is decided from GitHub facts and leaves merge to GitHub.',
      originCases.every(({ boundary }) => boundary.sourceOfTruth === 'github' && boundary.mergeAuthority === 'github')
        ? 'GitHub / GitHub'
        : 'Authority drift detected',
      originCases.every(({ boundary }) => boundary.sourceOfTruth === 'github' && boundary.mergeAuthority === 'github'),
    ),
    proofAssertion(
      'authoring-surface-neutral',
      'Authoring surface does not change the decision',
      'The same exact change and evidence produce the same evaluator result.',
      observedFingerprint(exact) === observedFingerprint(direct) ? 'Identical decision fingerprint' : 'Decision changed',
      observedFingerprint(exact) === observedFingerprint(direct),
    ),
    proofAssertion(
      'origin-exact-head',
      'Exact GitHub head can become guard-eligible',
      'PASS decision; guard-eligible; no external write or evaluation-time repository mutation.',
      `${exact.observed.outcome}; guard ${exact.observed.guardEligible ? 'eligible (not published)' : 'ineligible'}; mutation ${exact.observed.repositoryMutation ? 'allowed' : 'withheld'}`,
      exact.observed.outcome === AUTONOMOUS_DECISION.PASS
        && exact.observed.guardEligible
        && !exact.observed.repositoryMutation,
    ),
    proofAssertion(
      'origin-stale-head',
      'A stale mirror view cannot inherit assurance',
      'STALE_HEAD; not guard-eligible; no mutation.',
      `${stale.observed.reasonCodes.join(',')}; guard ${stale.observed.guardEligible ? 'eligible (not published)' : 'ineligible'}; mutation ${stale.observed.repositoryMutation ? 'allowed' : 'withheld'}`,
      stale.observed.reasonCodes.includes('STALE_HEAD')
        && !stale.observed.guardEligible
        && !stale.observed.repositoryMutation,
    ),
    proofAssertion(
      'origin-protected-capability',
      'A mirrored agent cannot self-certify a protected test change',
      'Human review required; not guard-eligible; no mutation.',
      `${protectedChange.observed.outcome}; guard ${protectedChange.observed.guardEligible ? 'eligible (not published)' : 'ineligible'}; mutation ${protectedChange.observed.repositoryMutation ? 'allowed' : 'withheld'}`,
      protectedChange.observed.outcome === AUTONOMOUS_DECISION.REVIEW_REQUIRED
        && protectedChange.observed.reasonCodes.includes('PROTECTED_PATH_REQUIRES_APPROVAL')
        && !protectedChange.observed.guardEligible
        && !protectedChange.observed.repositoryMutation,
    ),
    proofAssertion(
      'guard-is-not-merge',
      'Guard eligibility is neither publication nor merge',
      'Synthetic fixtures may become guard-eligible, but make no external request, publish nothing, merge nothing, and mutate no repository.',
      `${lab.summary.guardEligible} guard-eligible cases; ${lab.summary.repositoryMutations} mutations; ${ORIGIN_CONTEXT.externalRequests} external requests`,
      lab.summary.guardEligible > 0
        && lab.summary.repositoryMutations === 0
        && ORIGIN_CONTEXT.externalRequests === 0,
    ),
  ];
  const passed = assertions.filter((assertion) => assertion.passed).length;

  return {
    schemaVersion: 1,
    type: 'changeplane.cursor-origin-boundary-proof',
    proposition: 'Keep GitHub as release authority while Cursor Origin is an optional authoring and mirror surface.',
    execution: {
      fixtureKind: 'SYNTHETIC',
      evaluator: 'CHANGEPLANE_DETERMINISTIC_CONTRACT',
      externalRequests: ORIGIN_CONTEXT.externalRequests,
    },
    documentedContext: {
      asOf: ORIGIN_CONTEXT.documentedAsOf,
      originStatus: ORIGIN_CONTEXT.originStatus,
      sources: ORIGIN_CONTEXT.sources.map((source) => ({ ...source })),
    },
    compatibility: {
      githubMirroredOrigin: ORIGIN_CONTEXT.mirroredPath,
      standaloneOrigin: ORIGIN_CONTEXT.standaloneOrigin,
    },
    assertions,
    cases: lab.cases,
    contractSummary: lab.summary,
    summary: {
      total: assertions.length,
      passed,
      failed: assertions.length - passed,
      allPassed: passed === assertions.length,
      executableCases: lab.summary.total,
      executableCasesPassed: lab.summary.passed,
      originBoundaryCases: ORIGIN_BOUNDARY_CASES.length,
    },
    limits: [...ORIGIN_CONTEXT.limits],
  };
}
