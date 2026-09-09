/** Evidence outcomes are not root causes. Only a classified behavioral failure is patch-eligible. */
export function diagnoseEvidence({ status, conclusion, failureKind } = {}) {
  const state = String(status ?? '').toLowerCase();
  const outcome = String(conclusion ?? '').toLowerCase();
  if (state !== 'completed') return { category: 'pending', code: 'EVIDENCE_PENDING', nextAction: 'WAIT_FOR_EVIDENCE', sourceProposalEligible: false };
  if (outcome === 'success') return { category: 'none', code: null, nextAction: 'REASSESS_ON_CHANGE', sourceProposalEligible: false };
  const dispositions = {
    cancelled: ['cancelled', 'EVIDENCE_CANCELLED', 'INSPECT_CANCELLATION'],
    timed_out: ['timeout', 'EVIDENCE_TIMED_OUT', 'INSPECT_TIMEOUT'],
    skipped: ['skipped', 'EVIDENCE_SKIPPED', 'CHECK_REQUIRED_JOB_CONFIGURATION'],
    neutral: ['skipped', 'EVIDENCE_SKIPPED', 'CHECK_REQUIRED_JOB_CONFIGURATION'],
    stale: ['stale', 'EVIDENCE_STALE', 'REOBSERVE_REVISION'],
    startup_failure: ['infrastructure', 'EVIDENCE_INFRASTRUCTURE_FAILURE', 'INSPECT_RUNNER'],
    action_required: ['configuration', 'EVIDENCE_ACTION_REQUIRED', 'CHECK_PERMISSIONS_AND_CONFIGURATION'],
  };
  let classified = Object.hasOwn(dispositions, outcome) ? dispositions[outcome] : null;
  // This field is structured evidence from a trusted harness, not a diagnosis inferred from log prose.
  // Public collectors omit it unless their producer protocol has independently established it.
  const failureKinds = {
    behavioral: ['behavioral', 'EVIDENCE_FAILED', 'PROPOSE_WITHIN_REVIEWED_SCOPE'],
    infrastructure: ['infrastructure', 'EVIDENCE_INFRASTRUCTURE_FAILURE', 'INSPECT_RUNNER'],
    configuration: ['configuration', 'EVIDENCE_ACTION_REQUIRED', 'CHECK_PERMISSIONS_AND_CONFIGURATION'],
  };
  if (outcome === 'failure') classified = Object.hasOwn(failureKinds, failureKind) ? failureKinds[failureKind] : null;
  const [category, code, nextAction] = classified ?? ['unknown', 'EVIDENCE_DIAGNOSIS_REQUIRED', 'INSPECT_FAILURE_EVIDENCE'];
  return { category, code, nextAction, sourceProposalEligible: category === 'behavioral' };
}

export function recoveryAction(findings = []) {
  const codes = new Set(findings.map(finding => finding.code));
  if ([...codes].some(code => /STALE|CHANGED|AMBIGUOUS/u.test(code))) return 'REOBSERVE_REVISION';
  if ([...codes].some(code => /PROTECTED|BLOCKED_PATH|CONTROL_PATH/u.test(code))) return 'REQUEST_HUMAN_REVIEW';
  if (codes.has('EVIDENCE_ACTION_REQUIRED')) return 'CHECK_PERMISSIONS_AND_CONFIGURATION';
  if (codes.has('EVIDENCE_INFRASTRUCTURE_FAILURE')) return 'INSPECT_RUNNER';
  if (codes.has('EVIDENCE_CANCELLED')) return 'INSPECT_CANCELLATION';
  if (codes.has('EVIDENCE_TIMED_OUT')) return 'INSPECT_TIMEOUT';
  if (codes.has('EVIDENCE_SKIPPED')) return 'CHECK_REQUIRED_JOB_CONFIGURATION';
  if (codes.has('EVIDENCE_DIAGNOSIS_REQUIRED')) return 'INSPECT_FAILURE_EVIDENCE';
  if (codes.has('EVIDENCE_PENDING')) return 'WAIT_FOR_EVIDENCE';
  if (codes.has('SUBJECT_UNVERIFIED')) return 'CAPTURE_TESTED_SUBJECT';
  if (codes.size) return 'REVIEW_FINDINGS';
  return 'REASSESS_ON_CHANGE';
}
