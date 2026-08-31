export const ASSURANCE_PROOF_VERDICT = Object.freeze({
  VERIFIED_CURRENT: "VERIFIED_CURRENT",
  VERIFIED_HISTORICAL: "VERIFIED_HISTORICAL",
  INVALID: "INVALID",
  INDETERMINATE: "INDETERMINATE",
});

export const ASSURANCE_PROOF_CLAIM = Object.freeze({
  BEHAVIORAL_PASS: "BEHAVIORAL_PASS",
  SCOPE_ONLY: "SCOPE_ONLY",
  NON_PASS: "NON_PASS",
});

const CHECK_STATE = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  UNKNOWN: "UNKNOWN",
});

const EXACT_SHA = /^[a-f0-9]{40}$/u;
const EXACT_DIGEST = /^[a-f0-9]{64}$/u;
const GITHUB_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u;
const ANY_PUBLISHER = "Any";
const DEDICATED_GUARD_TRUST = "DEDICATED_CHANGEPLANE_APP";
const POSITIVE_ID = (value) => Number.isSafeInteger(value) && value > 0;

function proofCheck(id, label, state, expected, observed) {
  return { id, label, state, expected, observed };
}

function expectedGuardConclusion(passport) {
  if (passport?.decision?.mode === "observe") return "neutral";
  return passport?.decision?.outcome === "PASS" ? "success" : "action_required";
}

function evidenceComparison(passport, evidenceChecks) {
  if (!Array.isArray(passport?.evidence) || !Array.isArray(evidenceChecks)) {
    return {
      state: CHECK_STATE.UNKNOWN,
      observed: "Live evidence was not completely fetched.",
    };
  }

  if (passport.evidence.length !== evidenceChecks.length) {
    return {
      state: CHECK_STATE.FAIL,
      observed: `${evidenceChecks.length} live Checks for ${passport.evidence.length} passport entries`,
    };
  }

  const byId = new Map(evidenceChecks
    .filter((check) => POSITIVE_ID(check?.id))
    .map((check) => [check.id, check]));
  const seen = new Set();
  for (const item of passport.evidence) {
    if (!POSITIVE_ID(item?.checkRunId)) {
      return {
        state: CHECK_STATE.UNKNOWN,
        observed: "A legacy evidence entry has no re-fetchable Check Run identity.",
      };
    }
    if (seen.has(item.checkRunId)) {
      return {
        state: CHECK_STATE.FAIL,
        observed: "A passport repeats a Check Run identity.",
      };
    }
    seen.add(item.checkRunId);
    const live = byId.get(item.checkRunId);
    if (!live) {
      return {
        state: CHECK_STATE.UNKNOWN,
        observed: `Check Run ${item.checkRunId} could not be fetched.`,
      };
    }
    const matches = live.name === item.checkName
      && live.head_sha === item.headSha
      && String(live.status ?? "").toUpperCase() === item.status
      && String(live.conclusion ?? "").toUpperCase() === item.conclusion
      && live.app?.id === item.publisherAppId
      && live.app?.slug === item.actualPublisher
      && live.completed_at === item.completedAt;
    if (!matches) {
      return {
        state: CHECK_STATE.FAIL,
        observed: `Check Run ${item.checkRunId} no longer matches its exact-head passport entry.`,
      };
    }
  }

  return {
    state: CHECK_STATE.PASS,
    observed: `${passport.evidence.length} exact-head Check${passport.evidence.length === 1 ? "" : "s"} re-fetched`,
  };
}

function policyEvidenceComparison(passport, policyRequiredChecks) {
  if (policyRequiredChecks == null) {
    return {
      state: CHECK_STATE.UNKNOWN,
      observed: "The trusted policy evidence contract was not fetched.",
    };
  }
  if (!Array.isArray(policyRequiredChecks) || !Array.isArray(passport?.evidence)) {
    return {
      state: CHECK_STATE.FAIL,
      observed: "The trusted policy evidence contract is malformed.",
    };
  }

  const policyIdentities = [];
  const policySeen = new Set();
  for (const requirement of policyRequiredChecks) {
    const isObject = requirement && typeof requirement === "object" && !Array.isArray(requirement);
    const checkName = typeof requirement === "string" ? requirement : isObject ? requirement.name : null;
    const expectedPublisher = typeof requirement === "string" ? ANY_PUBLISHER : isObject ? requirement.appSlug : null;
    if (
      typeof checkName !== "string"
      || checkName.length === 0
      || typeof expectedPublisher !== "string"
      || (expectedPublisher !== ANY_PUBLISHER && !GITHUB_APP_SLUG.test(expectedPublisher))
    ) {
      return {
        state: CHECK_STATE.FAIL,
        observed: "The trusted policy contains an invalid Check requirement.",
      };
    }
    const identity = `${checkName}\0${expectedPublisher}`;
    if (policySeen.has(identity)) {
      return {
        state: CHECK_STATE.FAIL,
        observed: "The trusted policy repeats a Check requirement.",
      };
    }
    policySeen.add(identity);
    policyIdentities.push(identity);
  }

  const passportIdentities = [];
  const passportSeen = new Set();
  for (const item of passport.evidence) {
    if (
      typeof item?.checkName !== "string"
      || item.checkName.length === 0
      || typeof item.expectedPublisher !== "string"
      || (item.expectedPublisher !== ANY_PUBLISHER && !GITHUB_APP_SLUG.test(item.expectedPublisher))
    ) {
      return {
        state: CHECK_STATE.FAIL,
        observed: "The passport contains an invalid Check requirement.",
      };
    }
    const identity = `${item.checkName}\0${item.expectedPublisher}`;
    if (passportSeen.has(identity)) {
      return {
        state: CHECK_STATE.FAIL,
        observed: "The passport repeats a Check requirement.",
      };
    }
    passportSeen.add(identity);
    passportIdentities.push(identity);
  }

  policyIdentities.sort();
  passportIdentities.sort();
  const matches = policyIdentities.length === passportIdentities.length
    && policyIdentities.every((identity, index) => identity === passportIdentities[index]);
  return {
    state: matches ? CHECK_STATE.PASS : CHECK_STATE.FAIL,
    observed: matches
      ? `${policyIdentities.length} exact Check requirement${policyIdentities.length === 1 ? "" : "s"} matched`
      : `${policyIdentities.length} policy requirements versus ${passportIdentities.length} passport entries`,
  };
}

function targetComparison(passport, currentTarget) {
  if (passport?.target?.type === "merge_group") {
    return {
      state: CHECK_STATE.PASS,
      current: false,
      observed: "Merge-group revisions are transient and verified as historical exact revisions.",
    };
  }
  if (!currentTarget || typeof currentTarget !== "object") {
    return {
      state: CHECK_STATE.UNKNOWN,
      current: false,
      observed: "The current pull-request revision could not be fetched.",
    };
  }
  if (
    !EXACT_SHA.test(currentTarget.headSha ?? "")
    || !EXACT_SHA.test(currentTarget.baseSha ?? "")
    || !POSITIVE_ID(currentTarget.repositoryId)
    || !POSITIVE_ID(currentTarget.headRepositoryId)
    || !POSITIVE_ID(currentTarget.baseRepositoryId)
    || !Number.isInteger(currentTarget.pullRequestNumber)
    || currentTarget.pullRequestNumber <= 0
    || !["open", "closed"].includes(currentTarget.state)
    || typeof currentTarget.merged !== "boolean"
    || typeof currentTarget.uniqueOpenPullRequest !== "boolean"
  ) {
    return {
      state: CHECK_STATE.UNKNOWN,
      current: false,
      observed: "GitHub returned an incomplete current pull-request target.",
    };
  }
  if (
    currentTarget.type !== "pull_request"
    || currentTarget.repositoryId !== passport?.target?.repositoryId
    || currentTarget.pullRequestNumber !== passport?.target?.pullRequestNumber
  ) {
    return {
      state: CHECK_STATE.FAIL,
      current: false,
      observed: "The live target identity does not match the passport.",
    };
  }
  if (
    currentTarget.headRepositoryId !== passport.target.repositoryId
    || currentTarget.baseRepositoryId !== passport.target.repositoryId
  ) {
    return {
      state: CHECK_STATE.FAIL,
      current: false,
      observed: "Forked or cross-repository pull requests are outside the supported proof boundary.",
    };
  }
  if (!currentTarget.uniqueOpenPullRequest) {
    return {
      state: CHECK_STATE.FAIL,
      current: false,
      observed: "The passport head is not uniquely associated with this one open same-repository pull request.",
    };
  }
  const current = currentTarget.state === "open"
    && currentTarget.merged === false
    && currentTarget.headSha === passport.target.headSha
    && currentTarget.baseSha === passport.target.baseSha;
  return {
    state: CHECK_STATE.PASS,
    current,
    observed: current
      ? `Current exact head ${passport.target.headSha}`
      : `Superseded or closed; passport head ${passport.target.headSha}`,
  };
}

function claimLevel(passport) {
  if (passport?.decision?.mode === "observe") return ASSURANCE_PROOF_CLAIM.SCOPE_ONLY;
  if (
    passport?.decision?.outcome === "PASS"
    && passport.decision.behavioralEvidencePassed === true
    && passport.decision.evidenceCount > 0
  ) return ASSURANCE_PROOF_CLAIM.BEHAVIORAL_PASS;
  return ASSURANCE_PROOF_CLAIM.NON_PASS;
}

/**
 * Reconcile an integrity-checked passport with facts freshly read from GitHub.
 * This function performs no I/O. Its caller must fetch the guard, policy,
 * evidence Checks, and current pull-request state from the repository named in
 * the passport. A verified proof still carries no merge authority.
 */
export function verifyAssuranceProof({
  passport,
  locatorDigest = null,
  integrityVerified = false,
  repositoryIdentityVerified = false,
  guardMarkerVerified = false,
  guardCheck = null,
  expectedGuardPublisher = null,
  evidenceChecks = null,
  policyDigest = null,
  policyRequiredChecks = null,
  currentTarget = null,
} = {}) {
  const checks = [];
  const passportPresent = passport && typeof passport === "object" && !Array.isArray(passport);
  const integrityState = passportPresent && integrityVerified === true
    ? CHECK_STATE.PASS
    : integrityVerified == null ? CHECK_STATE.UNKNOWN : CHECK_STATE.FAIL;
  checks.push(proofCheck(
    "passport-integrity",
    "Passport integrity",
    integrityState,
    "Domain-separated SHA-256 and strict schema",
    integrityState === CHECK_STATE.PASS ? "Verified" : integrityState === CHECK_STATE.UNKNOWN ? "Not fetched" : "Invalid or unverified",
  ));
  const locatorState = !passportPresent
    ? integrityVerified == null ? CHECK_STATE.UNKNOWN : CHECK_STATE.FAIL
    : locatorDigest == null
    ? CHECK_STATE.UNKNOWN
    : EXACT_DIGEST.test(locatorDigest) && locatorDigest === passport?.digest
      ? CHECK_STATE.PASS
      : CHECK_STATE.FAIL;
  checks.push(proofCheck(
    "locator-binding",
    "Proof locator binding",
    locatorState,
    passport?.digest ?? "Passport unavailable",
    locatorDigest ?? "Not supplied",
  ));
  checks.push(proofCheck(
    "repository-identity",
    "Repository identity",
    repositoryIdentityVerified === true
      ? CHECK_STATE.PASS
      : repositoryIdentityVerified == null ? CHECK_STATE.UNKNOWN : CHECK_STATE.FAIL,
    "Passport repository name and numeric ID match the selected GitHub installation repository",
    repositoryIdentityVerified === true ? "Verified" : repositoryIdentityVerified == null ? "Not fetched" : "Mismatch",
  ));

  const publisherValid = expectedGuardPublisher
    && POSITIVE_ID(expectedGuardPublisher.appId)
    && typeof expectedGuardPublisher.appSlug === "string"
    && GITHUB_APP_SLUG.test(expectedGuardPublisher.appSlug)
    && expectedGuardPublisher.appSlug !== "github-actions"
    && expectedGuardPublisher.trust === DEDICATED_GUARD_TRUST;
  const guardAvailable = guardCheck && typeof guardCheck === "object";
  const publisherUnavailable = expectedGuardPublisher == null;
  const publisherIdentityMatches = guardAvailable && publisherValid
    && guardCheck.app?.id === expectedGuardPublisher.appId
    && guardCheck.app?.slug === expectedGuardPublisher.appSlug;
  const guardMatches = passportPresent && guardAvailable && publisherValid
    && POSITIVE_ID(guardCheck.id)
    && guardCheck.name === "ChangePlane / guard"
    && guardCheck.head_sha === passport.target?.headSha
    && guardCheck.status === "completed"
    && guardCheck.conclusion === expectedGuardConclusion(passport)
    && guardCheck.app?.id === expectedGuardPublisher.appId
    && guardCheck.app?.slug === expectedGuardPublisher.appSlug
    && guardMarkerVerified === true;
  checks.push(proofCheck(
    "live-guard",
    "Live guard envelope",
    !guardAvailable || publisherUnavailable ? CHECK_STATE.UNKNOWN : guardMatches ? CHECK_STATE.PASS : CHECK_STATE.FAIL,
    "Exact head, expected conclusion, embedded passport, dedicated ChangePlane GitHub App identity",
    !guardAvailable
      ? "Not fetched"
      : publisherUnavailable
        ? "Dedicated publisher is not configured"
        : guardMatches ? `Check Run ${guardCheck.id}` : "Mismatch",
  ));

  const policyState = policyDigest == null
    ? CHECK_STATE.UNKNOWN
    : policyDigest === passport?.binding?.policyDigest ? CHECK_STATE.PASS : CHECK_STATE.FAIL;
  checks.push(proofCheck(
    "trusted-policy",
    "Trusted-base policy",
    policyState,
    passport?.binding?.policyDigest ?? "Passport unavailable",
    policyDigest ?? "Not fetched",
  ));

  const policyEvidence = policyEvidenceComparison(passport, policyRequiredChecks);
  checks.push(proofCheck(
    "policy-evidence-contract",
    "Policy-to-evidence contract",
    policyEvidence.state,
    "Exact Check name and publisher set with matching cardinality",
    policyEvidence.observed,
  ));

  const evidence = evidenceComparison(passport, evidenceChecks);
  checks.push(proofCheck(
    "live-evidence",
    "Live behavioral evidence",
    evidence.state,
    `${passport?.decision?.evidenceCount ?? "unknown"} passport-bound Check Run entries`,
    evidence.observed,
  ));

  const target = targetComparison(passport, currentTarget);
  checks.push(proofCheck(
    "current-target",
    "Current GitHub target",
    target.state,
    "Same repository, pull request, base, and full head",
    target.observed,
  ));

  const hasFailure = checks.some(({ state }) => state === CHECK_STATE.FAIL);
  const hasUnknown = checks.some(({ state }) => state === CHECK_STATE.UNKNOWN);
  const verdict = hasFailure
    ? ASSURANCE_PROOF_VERDICT.INVALID
    : hasUnknown
      ? ASSURANCE_PROOF_VERDICT.INDETERMINATE
      : target.current
        ? ASSURANCE_PROOF_VERDICT.VERIFIED_CURRENT
        : ASSURANCE_PROOF_VERDICT.VERIFIED_HISTORICAL;
  const assertedLevel = claimLevel(passport);
  const level = [ASSURANCE_PROOF_VERDICT.VERIFIED_CURRENT, ASSURANCE_PROOF_VERDICT.VERIFIED_HISTORICAL].includes(verdict)
    ? assertedLevel
    : ASSURANCE_PROOF_CLAIM.NON_PASS;

  return {
    schemaVersion: 1,
    type: "changeplane.live-assurance-proof",
    verdict,
    currentness: verdict === ASSURANCE_PROOF_VERDICT.VERIFIED_CURRENT
      ? "CURRENT"
      : verdict === ASSURANCE_PROOF_VERDICT.VERIFIED_HISTORICAL ? "HISTORICAL" : "UNPROVEN",
    claimLevel: level,
    decision: {
      mode: passport?.decision?.mode ?? null,
      outcome: passport?.decision?.outcome ?? null,
      currentBehavioralPass: verdict === ASSURANCE_PROOF_VERDICT.VERIFIED_CURRENT
        && level === ASSURANCE_PROOF_CLAIM.BEHAVIORAL_PASS,
    },
    target: passportPresent ? {
      type: passport.target?.type ?? null,
      repositoryId: passport.target?.repositoryId ?? null,
      pullRequestNumber: passport.target?.pullRequestNumber ?? null,
      headSha: passport.target?.headSha ?? null,
      baseSha: passport.target?.baseSha ?? null,
    } : null,
    guard: guardAvailable ? {
      checkRunId: guardCheck.id ?? null,
      passportDigest: passport?.digest ?? null,
      publisherAppId: guardCheck.app?.id ?? null,
      publisherAppSlug: guardCheck.app?.slug ?? null,
      publisherTrust: publisherIdentityMatches
        ? DEDICATED_GUARD_TRUST
        : guardCheck.app?.slug === "github-actions"
          ? "SHARED_GITHUB_ACTIONS_APP"
          : "UNVERIFIED_PUBLISHER",
    } : null,
    authority: {
      merge: "GITHUB",
      proofCanMerge: false,
      proofCanPublishGuard: false,
    },
    checks,
    limitations: [
      "This proof verifies ChangePlane behavior and GitHub evidence; it does not prove that the code is defect-free.",
      "A verified guard must be published by the configured repository-scoped ChangePlane GitHub App; a GitHub Actions App Check is rejected.",
      "GitHub rules and required Checks still decide whether the revision can merge.",
    ],
  };
}
