export const SDLC_POSTURE = Object.freeze({
  SETUP_REQUIRED: "setup_required",
  SCOPE_ONLY: "scope_only",
  VERIFICATION_READY: "verification_ready",
  MERGE_GATE_ACTIVE: "merge_gate_active",
  AUTONOMY_ACTIVATION_REQUIRED: "autonomy_activation_required",
  BOUNDED_AUTONOMY_ACTIVE: "bounded_autonomy_active",
});

export const SDLC_STAGE_STATE = Object.freeze({
  SETUP_REQUIRED: "setup_required",
  SCOPE_ONLY: "scope_only",
  SUPPORTED: "supported",
  CONTROLLED: "controlled",
  ACTION_REQUIRED: "action_required",
  EXTERNAL: "external",
});

export const REVISION_STAGE_STATE = Object.freeze({
  BOUND: "BOUND",
  OBSERVED: "OBSERVED",
  ADVISORY: "ADVISORY",
  READY: "READY",
  VERIFYING: "VERIFYING",
  VERIFIED: "VERIFIED",
  WITHHELD: "WITHHELD",
  EXACT_HEAD_MATCH: "EXACT_HEAD_MATCH",
  STALE_OMITTED: "STALE_OMITTED",
  NOT_OBSERVED: "NOT_OBSERVED",
  READY_FOR_GITHUB: "READY_FOR_GITHUB",
  QUEUE_GUARD_PASSED: "QUEUE_GUARD_PASSED",
  GITHUB_DECIDES: "GITHUB_DECIDES",
  NOT_CARRIED_FORWARD: "NOT_CARRIED_FORWARD",
});

const MANAGED_PROFILES = new Set(["verify-lite", "full"]);
const HARNESS_MODES = new Set(["observe", "verify", "autonomous"]);
const REVISION_STATUSES = new Set([
  "ready",
  "binding",
  "failing",
  "proposing",
  "validating",
  "applying",
  "rechecking",
  "publishing",
  "passed",
  "blocked",
]);
const RUNNING_REVISION_STATUSES = new Set([
  "binding",
  "failing",
  "proposing",
  "validating",
  "applying",
  "rechecking",
  "publishing",
]);
const EXACT_SHA = /^[a-f0-9]{40}$/u;

function stage(id, label, state, owner, proof, nextAction) {
  return { id, label, state, owner, proof, nextAction };
}

function strictEnforcementActive(enforcement) {
  return Boolean(
    enforcement
    && typeof enforcement === "object"
    && !Array.isArray(enforcement)
    && enforcement.active === true
    && enforcement.strict === true
    && typeof enforcement.mergeQueueRequired === "boolean"
    && enforcement.guardRequired === true
    && enforcement.publisherBound === true
    && enforcement.evidenceRequired === true
    && enforcement.evidencePublisherBound === true
  );
}

function requiredCheckCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 20 ? value : 0;
}

/**
 * Project repository readiness into an SDLC-shaped, read-only view. This view
 * never contributes to PASS; it explains which existing ChangePlane and
 * GitHub controls are present and where authority still lives.
 */
export function buildSdlcAssurance({
  installed = false,
  managedProfile = null,
  harnessMode = "observe",
  requiredCheckCount: configuredChecks = 0,
  enforcement = null,
  autonomousReady = false,
  maxAttempts = 2,
} = {}) {
  const profileValid = MANAGED_PROFILES.has(managedProfile);
  const modeValid = HARNESS_MODES.has(harnessMode);
  const activeInstallation = installed === true && profileValid && modeValid;
  const checks = requiredCheckCount(configuredChecks);
  const behavioralControl = activeInstallation && harnessMode !== "observe" && checks > 0;
  const mergeGateActive = behavioralControl && strictEnforcementActive(enforcement);
  const autonomyPrerequisites = mergeGateActive
    && enforcement.mergeQueueRequired === true
    && managedProfile === "full"
    && harnessMode === "autonomous"
    && autonomousReady === true;

  const verifyState = !activeInstallation
    ? SDLC_STAGE_STATE.SETUP_REQUIRED
    : harnessMode === "observe"
      ? SDLC_STAGE_STATE.SCOPE_ONLY
      : checks === 0
        ? SDLC_STAGE_STATE.ACTION_REQUIRED
        : SDLC_STAGE_STATE.CONTROLLED;
  const releaseState = !activeInstallation
    ? SDLC_STAGE_STATE.SETUP_REQUIRED
    : mergeGateActive
      ? SDLC_STAGE_STATE.CONTROLLED
      : SDLC_STAGE_STATE.ACTION_REQUIRED;

  const posture = !activeInstallation
    ? SDLC_POSTURE.SETUP_REQUIRED
    : autonomyPrerequisites
      ? SDLC_POSTURE.BOUNDED_AUTONOMY_ACTIVE
      : managedProfile === "full" && harnessMode === "autonomous"
        ? SDLC_POSTURE.AUTONOMY_ACTIVATION_REQUIRED
        : mergeGateActive
          ? SDLC_POSTURE.MERGE_GATE_ACTIVE
          : behavioralControl
            ? SDLC_POSTURE.VERIFICATION_READY
            : SDLC_POSTURE.SCOPE_ONLY;

  return {
    schemaVersion: 1,
    type: "changeplane.agentic-sdlc-view",
    posture,
    stages: [
      stage(
        "plan",
        "Plan / contract",
        activeInstallation ? SDLC_STAGE_STATE.CONTROLLED : SDLC_STAGE_STATE.SETUP_REQUIRED,
        "Repository",
        activeInstallation
          ? "Goal and allowed scope are digest-bound to each evaluated revision; correctness of the requirement is not claimed."
          : "No managed contract binding is installed.",
        activeInstallation ? "Declare one bounded goal and scope in the pull request." : "Merge the protected setup pull request.",
      ),
      stage(
        "develop",
        "Develop",
        activeInstallation ? SDLC_STAGE_STATE.SUPPORTED : SDLC_STAGE_STATE.SETUP_REQUIRED,
        "Coding agent",
        activeInstallation
          ? "Any coding agent may author the pull request; identity is context, never decision authority."
          : "Agent-authored changes are not yet projected into ChangePlane assurance.",
        activeInstallation ? "Push a same-repository pull-request revision." : "Install ChangePlane before relying on lifecycle receipts.",
      ),
      stage(
        "review",
        "Review",
        !activeInstallation
          ? SDLC_STAGE_STATE.SETUP_REQUIRED
          : managedProfile === "full" ? SDLC_STAGE_STATE.SUPPORTED : SDLC_STAGE_STATE.EXTERNAL,
        activeInstallation && managedProfile === "full" ? "Human + advisory model" : "GitHub reviewers",
        !activeInstallation
          ? "No exact-revision review projection is installed."
          : managedProfile === "full"
            ? "Changed-line model review is advisory; protected capabilities still require a current human approval."
            : "Verify Lite leaves review with GitHub and the existing coding-agent workflow.",
        !activeInstallation
          ? "Merge the protected setup pull request."
          : managedProfile === "full"
            ? "Resolve advisory findings or provide exact-revision human approval where policy requires it."
            : "Use GitHub review; expand through a protected PR only if independent advisory review is needed.",
      ),
      stage(
        "verify",
        "Verify",
        verifyState,
        "Deterministic harness",
        verifyState === SDLC_STAGE_STATE.CONTROLLED
          ? `${checks} named behavioral Check${checks === 1 ? "" : "s"} must succeed on the same head from the configured GitHub App publisher.`
          : verifyState === SDLC_STAGE_STATE.SCOPE_ONLY
            ? "Observe binds revision and file scope but makes no behavioral claim."
            : verifyState === SDLC_STAGE_STATE.ACTION_REQUIRED
              ? "No named behavioral Check is bound, so the code cannot be claimed verified."
              : "The exact-head guard is not installed.",
        verifyState === SDLC_STAGE_STATE.CONTROLLED
          ? "Keep the named Check passing on the current head."
          : verifyState === SDLC_STAGE_STATE.SCOPE_ONLY
            ? "Bind an existing automated behavior Check and switch to Verify."
            : "Select a meaningful GitHub Check before enabling verification.",
      ),
      stage(
        "release",
        "Release gate",
        releaseState,
        "GitHub",
        releaseState === SDLC_STAGE_STATE.CONTROLLED
          ? `One no-bypass strict default-branch Ruleset requires the dedicated-App assurance guard and every configured behavioral evidence Check from its expected publisher.${enforcement.mergeQueueRequired ? " Merge Queue adds fresh queue-revision evaluation." : " Strict Head is active; Merge Queue coverage is not claimed."}`
          : "A ChangePlane result is not a merge gate until one no-bypass strict GitHub Ruleset binds the App guard and every configured evidence Check to its expected publisher.",
        releaseState === SDLC_STAGE_STATE.CONTROLLED
          ? "Let GitHub evaluate the exact merge or merge-queue revision."
          : "Review a Strict Head Ruleset plan with strict checks, no bypasses, ChangePlane / guard, and all configured evidence publishers.",
      ),
      stage(
        "deploy",
        "Deploy",
        activeInstallation ? SDLC_STAGE_STATE.SUPPORTED : SDLC_STAGE_STATE.SETUP_REQUIRED,
        "Deployment provider",
        activeInstallation
          ? "An existing GitHub Deployment may be shown only when its SHA exactly matches the evaluated head; it never contributes to PASS."
          : "No exact-SHA deployment projection is available.",
        activeInstallation ? "Keep deployment provenance attached to the exact commit." : "Install the guard before using deployment evidence.",
      ),
      stage(
        "operate",
        "Operate",
        SDLC_STAGE_STATE.EXTERNAL,
        "Customer systems",
        "Runtime health, incidents, SLOs, rollback, and production operations are not observed by this release.",
        "Use the existing observability and incident-response stack.",
      ),
    ],
    repairLoop: {
      mode: autonomyPrerequisites
        ? "bounded_autonomous"
        : managedProfile === "full" && harnessMode === "autonomous"
          ? "activation_required"
          : "agent_handback",
      maxAttempts: Number.isInteger(maxAttempts) && maxAttempts === 2 ? 2 : 2,
      budgetMinutes: 15,
    },
    authority: {
      derivedReadOnly: true,
      contributesToPass: false,
      modelDecidesPass: false,
      pass: "deterministic_harness",
      merge: "github",
      deploy: "external",
      operate: "customer",
    },
  };
}

function revisionStage(id, label, state, trust, owner, detail) {
  return { id, label, state, trust, owner, detail };
}

/**
 * Build the per-revision lifecycle projection used by the workspace. It is a
 * presentation of already-derived facts, not a second evaluator or Check.
 */
export function buildRevisionSdlcAssurance({
  targetType = "pull_request",
  headSha,
  status = "ready",
  previewHeadSha = null,
  reviewHeadSha = null,
  reviewAvailable = false,
  intentHeadSha = null,
  changeHeadSha = null,
  evidenceHeadSha = null,
} = {}) {
  if (!["pull_request", "merge_group"].includes(targetType)) {
    throw new TypeError("targetType must be pull_request or merge_group.");
  }
  if (typeof headSha !== "string" || !EXACT_SHA.test(headSha)) {
    throw new TypeError("headSha must be a full 40-character lowercase hexadecimal revision.");
  }
  if (!REVISION_STATUSES.has(status)) {
    throw new TypeError("status is not a supported revision-assurance state.");
  }
  if (previewHeadSha != null && (typeof previewHeadSha !== "string" || !EXACT_SHA.test(previewHeadSha))) {
    throw new TypeError("previewHeadSha must be null or a full 40-character lowercase hexadecimal revision.");
  }
  if (reviewHeadSha != null && (typeof reviewHeadSha !== "string" || !EXACT_SHA.test(reviewHeadSha))) {
    throw new TypeError("reviewHeadSha must be null or a full 40-character lowercase hexadecimal revision.");
  }
  if (intentHeadSha != null && (typeof intentHeadSha !== "string" || !EXACT_SHA.test(intentHeadSha))) {
    throw new TypeError("intentHeadSha must be null or a full 40-character lowercase hexadecimal revision.");
  }
  if (changeHeadSha != null && (typeof changeHeadSha !== "string" || !EXACT_SHA.test(changeHeadSha))) {
    throw new TypeError("changeHeadSha must be null or a full 40-character lowercase hexadecimal revision.");
  }
  if (evidenceHeadSha != null && (typeof evidenceHeadSha !== "string" || !EXACT_SHA.test(evidenceHeadSha))) {
    throw new TypeError("evidenceHeadSha must be null or a full 40-character lowercase hexadecimal revision.");
  }
  if (typeof reviewAvailable !== "boolean") {
    throw new TypeError("reviewAvailable must be a boolean.");
  }

  const intentBound = intentHeadSha === headSha;
  const changeObserved = changeHeadSha === headSha;
  const assuranceBound = intentBound && changeObserved;
  const evidenceBound = evidenceHeadSha === headSha;
  const passed = status === "passed" && assuranceBound && evidenceBound;
  const blocked = status === "blocked";
  const running = RUNNING_REVISION_STATUSES.has(status) && assuranceBound;
  const verificationState = !assuranceBound
    ? REVISION_STAGE_STATE.WITHHELD
    : status === "passed" && !evidenceBound
      ? REVISION_STAGE_STATE.WITHHELD
    : passed
      ? REVISION_STAGE_STATE.VERIFIED
      : blocked
        ? REVISION_STAGE_STATE.WITHHELD
        : running ? REVISION_STAGE_STATE.VERIFYING : REVISION_STAGE_STATE.READY;
  const previewMatches = passed && previewHeadSha === headSha;
  const deliveryState = previewMatches
    ? REVISION_STAGE_STATE.EXACT_HEAD_MATCH
    : previewHeadSha && previewHeadSha !== headSha
      ? REVISION_STAGE_STATE.STALE_OMITTED
      : REVISION_STAGE_STATE.NOT_OBSERVED;
  const mergeState = targetType === "merge_group" && passed
    ? REVISION_STAGE_STATE.QUEUE_GUARD_PASSED
    : passed ? REVISION_STAGE_STATE.READY_FOR_GITHUB : REVISION_STAGE_STATE.GITHUB_DECIDES;
  const reviewCurrent = targetType === "pull_request" && reviewAvailable && reviewHeadSha === headSha;
  const reviewState = targetType === "merge_group"
    ? REVISION_STAGE_STATE.NOT_CARRIED_FORWARD
    : reviewCurrent
      ? REVISION_STAGE_STATE.ADVISORY
      : reviewHeadSha ? REVISION_STAGE_STATE.STALE_OMITTED : REVISION_STAGE_STATE.NOT_OBSERVED;

  return {
    schemaVersion: 1,
    type: "changeplane.revision-sdlc-view",
    target: { type: targetType, headSha },
    stages: [
      revisionStage(
        "intent",
        "Intent",
        intentBound ? REVISION_STAGE_STATE.BOUND : REVISION_STAGE_STATE.NOT_OBSERVED,
        intentBound ? "declared" : "withheld",
        "Repository",
        intentBound
          ? "Goal and allowed paths are digest-bound for this revision; ChangePlane does not judge whether the requirement is correct."
          : "No receipt-backed intent contract is present for this revision, so no intent assurance is projected.",
      ),
      revisionStage(
        "change",
        "Change",
        changeObserved ? REVISION_STAGE_STATE.OBSERVED : REVISION_STAGE_STATE.NOT_OBSERVED,
        changeObserved ? "observed" : "withheld",
        "Coding agent",
        changeObserved
          ? `The GitHub diff and full current head are observed at ${headSha}.`
          : "No receipt-backed GitHub diff observation is present for this revision.",
      ),
      revisionStage(
        "review",
        "Review",
        reviewState,
        reviewCurrent ? "advisory" : "withheld",
        targetType === "merge_group" ? "Not inherited" : reviewAvailable ? "Human + advisory model" : "GitHub reviewers",
        targetType === "merge_group"
          ? "PR review, approval, repair, and model state are not carried into a merge-group revision."
          : reviewCurrent
            ? "Model review may advise; only an authorized exact-revision human approval can resolve a protected capability."
            : reviewHeadSha
              ? "Review evidence belongs to another revision and is omitted until the current head is reviewed."
              : "No exact-head review is observed. Review remains in GitHub and cannot manufacture ChangePlane PASS.",
      ),
      revisionStage("verify", "Verify", verificationState, passed ? "verified" : "withheld", "Deterministic harness", !assuranceBound ? "Intent and change observations are incomplete, so no verification state is projected." : status === "passed" && !evidenceBound ? "The recorded evidence result belongs to another revision or has no full-SHA binding, so it is omitted." : passed ? `Repository-owned behavioral evidence passed on ${headSha}.` : blocked ? "Policy or evidence withheld the guard; no prior green state is reused." : running ? "The current exact head is being evaluated from scratch." : "The current exact head is ready for deterministic evaluation."),
      revisionStage("delivery", "Delivery", deliveryState, previewMatches ? "observed" : "withheld", "Deployment provider", previewMatches ? `Existing GitHub Deployment metadata matches ${headSha}; informational only.` : deliveryState === REVISION_STAGE_STATE.STALE_OMITTED ? "Deployment metadata belongs to another revision and is omitted." : "No exact-head deployment is observed; no release or production claim is made."),
      revisionStage("merge", "Merge", mergeState, "external", "GitHub", mergeState === REVISION_STAGE_STATE.QUEUE_GUARD_PASSED ? "The exact merge-group guard passed; GitHub still owns queue and merge decisions." : passed ? "ChangePlane is ready for GitHub to apply every repository rule and required Check." : "GitHub cannot use a passing ChangePlane guard for this revision yet."),
      revisionStage("operate", "Operate", REVISION_STAGE_STATE.NOT_OBSERVED, "not_observed", "Customer systems", "Production health, incidents, SLOs, promotion, and rollback are outside this receipt."),
    ],
    invalidation: {
      exactHeadOnly: true,
      aggregateAcrossRevisions: false,
      onNewRevision: "RESTART_ALL_ASSURANCE",
    },
    authority: {
      derivedReadOnly: true,
      contributesToPass: false,
      merge: "github",
      deploy: "external",
      operate: "customer",
    },
  };
}
