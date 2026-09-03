const KNOWN_INACTIVE_ENFORCEMENT = new Set(["disabled", "evaluate"]);
const KNOWN_NON_BRANCH_TARGETS = new Set(["tag", "push", "repository"]);

const NEXT_ACTION = Object.freeze({
  active: "No action is required; one active default-branch GitHub Ruleset has no bypasses, requires merge queue and strict status checks, and binds the ChangePlane guard plus every behavioral evidence check to its expected publisher.",
  strict_head: "Strict Head is active. Add Merge Queue to this same Ruleset only when this repository needs Queue Certified assurance.",
  ruleset_required: "Add an active branch ruleset targeting the default branch, then recheck this repository.",
  ruleset_ambiguous: "Make every active branch ruleset target explicit, remove bypass actors, and verify its rule shapes in GitHub, then recheck.",
  strict_required: "In one active default-branch ruleset, require status checks and require branches to be up to date before merging, then recheck.",
  merge_queue_required: "Add a merge queue rule to that same active default-branch ruleset, then recheck.",
  guard_required: "Add ChangePlane / guard as a required status check in that same active default-branch ruleset, then recheck.",
  publisher_binding_required: "Bind ChangePlane / guard to the expected dedicated GitHub App in that same active default-branch ruleset, then recheck.",
  evidence_required: "Require every configured behavioral evidence check in that same active default-branch ruleset, then recheck.",
  evidence_publisher_binding_required: "Bind every configured behavioral evidence check to its expected GitHub App in that same active default-branch ruleset, then recheck.",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function evidenceDetails(entries) {
  return entries.map(({ name, integrationId }) => `${name} (integration ID ${integrationId})`).join(", ");
}

function nextAction(state, facts) {
  if (state === "publisher_binding_required") {
    return `Bind ChangePlane / guard to dedicated GitHub App integration ID ${facts.expectedPublisherId} in that same active default-branch ruleset, then recheck.`;
  }
  if (state === "evidence_required") {
    const missing = facts.missingEvidence.length > 0
      ? ` Missing: ${evidenceDetails(facts.missingEvidence)}.`
      : "";
    const misbound = facts.misboundEvidence.length > 0
      ? ` Incorrect or unbound: ${evidenceDetails(facts.misboundEvidence)}.`
      : "";
    return `Require every configured behavioral evidence check and bind it to its expected GitHub App in that same active default-branch ruleset.${missing}${misbound} Then recheck.`;
  }
  if (state === "evidence_publisher_binding_required") {
    return `Bind every configured behavioral evidence check to its expected GitHub App in that same active default-branch ruleset. Incorrect or unbound: ${evidenceDetails(facts.misboundEvidence)}. Then recheck.`;
  }
  return NEXT_ACTION[state];
}

function readiness(state, facts = {}) {
  return {
    source: "ruleset",
    state,
    assuranceLevel: state === "active"
      ? "queue_certified"
      : state === "strict_head"
        ? "strict_head"
        : null,
    active: state === "active" || state === "strict_head",
    queueCertified: state === "active",
    strict: facts.strict === true,
    mergeQueueRequired: facts.mergeQueueRequired === true,
    guardRequired: facts.guardRequired === true,
    publisherBound: facts.publisherBound === true,
    evidenceRequired: facts.evidenceRequired === true,
    evidencePublisherBound: facts.evidencePublisherBound === true,
    nextAction: nextAction(state, facts),
  };
}

function validLabel(value) {
  return typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validLabelList(value) {
  return Array.isArray(value)
    && value.length <= 1_000
    && value.every(validLabel);
}

function validRepositorySelector(conditions) {
  const selectors = ["repository_name", "repository_id", "repository_property"]
    .filter((key) => Object.hasOwn(conditions, key));
  if (selectors.length !== 1) return false;

  const [selectorName] = selectors;
  const selector = conditions[selectorName];
  if (!isRecord(selector)) return false;
  if (selectorName === "repository_name") {
    return Object.keys(selector).every((key) => ["include", "exclude", "protected"].includes(key))
      && validLabelList(selector.include)
      && validLabelList(selector.exclude)
      && selector.include.length > 0
      && typeof selector.protected === "boolean";
  }
  if (selectorName === "repository_id") {
    return Object.keys(selector).every((key) => key === "repository_ids")
      && Array.isArray(selector.repository_ids)
      && selector.repository_ids.length > 0
      && selector.repository_ids.length <= 1_000
      && selector.repository_ids.every((id) => Number.isSafeInteger(id) && id > 0);
  }

  const validProperty = (property) => isRecord(property)
    && Object.keys(property).every((key) => ["name", "property_values", "source"].includes(key))
    && validLabel(property.name)
    && validLabelList(property.property_values)
    && property.property_values.length > 0
    && (property.source == null || ["custom", "system"].includes(property.source));
  return Object.keys(selector).every((key) => ["include", "exclude"].includes(key))
    && Array.isArray(selector.include)
    && Array.isArray(selector.exclude)
    && selector.include.length + selector.exclude.length <= 1_000
    && selector.include.every(validProperty)
    && selector.exclude.every(validProperty);
}

function classifyRefPattern(pattern, defaultRef) {
  if (pattern === "~DEFAULT_BRANCH" || pattern === "~ALL" || pattern === defaultRef) {
    return "match";
  }
  if (pattern.startsWith("~") || /[*?[\\]/u.test(pattern)) return "ambiguous";
  return "no_match";
}

function targetsDefaultBranch(conditions, defaultRef, { repositoryScoped = false } = {}) {
  if (!isRecord(conditions)) {
    return "ambiguous";
  }
  const conditionKeys = Object.keys(conditions);
  const knownKeys = new Set(["ref_name", "repository_name", "repository_id", "repository_property"]);
  if (conditionKeys.some((key) => !knownKeys.has(key))) {
    return "ambiguous";
  }
  const hasRepositorySelector = conditionKeys.some((key) => key !== "ref_name");
  if (hasRepositorySelector && (!repositoryScoped || !validRepositorySelector(conditions))) {
    return "ambiguous";
  }

  const refName = conditions.ref_name;
  if (
    !isRecord(refName)
    || Object.keys(refName).some((key) => key !== "include" && key !== "exclude")
    || !Array.isArray(refName.include)
    || !Array.isArray(refName.exclude)
    || refName.include.some((pattern) => !validLabel(pattern))
    || refName.exclude.some((pattern) => !validLabel(pattern))
  ) {
    return "ambiguous";
  }

  const includes = refName.include.map((pattern) => classifyRefPattern(pattern, defaultRef));
  const excludes = refName.exclude.map((pattern) => classifyRefPattern(pattern, defaultRef));

  if (excludes.includes("match")) return "no_match";
  if (includes.includes("match")) {
    return excludes.includes("ambiguous") ? "ambiguous" : "match";
  }
  if (includes.includes("ambiguous")) return "ambiguous";
  return "no_match";
}

function requiredCheckFacts(rules, guardCheckName, publisherIntegrationId, evidenceChecks) {
  if (!Array.isArray(rules)) return { ambiguous: true };

  let strict = false;
  let mergeQueueRequired = false;
  let guardRequired = false;
  let publisherBound = false;
  const configuredChecks = new Map(evidenceChecks.map((check) => [check.name, check]));
  const observedChecks = new Map();
  let guardObserved = false;

  for (const rule of rules) {
    if (!isRecord(rule) || !validLabel(rule.type)) return { ambiguous: true };
    if (rule.type === "merge_queue") {
      mergeQueueRequired = true;
      continue;
    }
    if (rule.type !== "required_status_checks") continue;

    const parameters = rule.parameters;
    if (
      !isRecord(parameters)
      || typeof parameters.strict_required_status_checks_policy !== "boolean"
      || !Array.isArray(parameters.required_status_checks)
    ) {
      return { ambiguous: true };
    }

    strict ||= parameters.strict_required_status_checks_policy
      && parameters.required_status_checks.length > 0;
    for (const check of parameters.required_status_checks) {
      if (!isRecord(check) || !validLabel(check.context)) return { ambiguous: true };
      const hasIntegrationId = Object.hasOwn(check, "integration_id") && check.integration_id !== null;
      if (
        hasIntegrationId
        && (!Number.isSafeInteger(check.integration_id) || check.integration_id < 1)
      ) {
        return { ambiguous: true };
      }

      if (check.context === guardCheckName) {
        if (guardObserved) return { ambiguous: true };
        guardObserved = true;
        guardRequired = true;
        publisherBound = hasIntegrationId && check.integration_id === publisherIntegrationId;
        continue;
      }
      if (!configuredChecks.has(check.context)) continue;
      if (observedChecks.has(check.context)) return { ambiguous: true };
      observedChecks.set(check.context, hasIntegrationId ? check.integration_id : null);
    }
  }

  const missingEvidence = evidenceChecks.filter(({ name }) => !observedChecks.has(name));
  const misboundEvidence = evidenceChecks.filter(({ name, integrationId }) => (
    observedChecks.has(name) && observedChecks.get(name) !== integrationId
  ));
  const evidenceRequired = missingEvidence.length === 0;
  const evidencePublisherBound = evidenceRequired && misboundEvidence.length === 0;

  return {
    ambiguous: false,
    strict,
    mergeQueueRequired,
    guardRequired,
    publisherBound,
    evidenceRequired,
    evidencePublisherBound,
    missingEvidence,
    misboundEvidence,
  };
}

function inspectRuleset(
  ruleset,
  defaultRef,
  guardCheckName,
  publisherIntegrationId,
  evidenceChecks,
  repositoryScoped,
) {
  if (!isRecord(ruleset)) return { kind: "ambiguous" };

  if (KNOWN_INACTIVE_ENFORCEMENT.has(ruleset.enforcement)) return { kind: "ignored" };
  if (ruleset.enforcement !== "active") return { kind: "ambiguous" };

  if (KNOWN_NON_BRANCH_TARGETS.has(ruleset.target)) return { kind: "ignored" };
  if (ruleset.target !== "branch") return { kind: "ambiguous" };

  const target = targetsDefaultBranch(ruleset.conditions, defaultRef, { repositoryScoped });
  if (target === "no_match") return { kind: "ignored" };
  if (target === "ambiguous") return { kind: "ambiguous" };

  if (!Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length > 0) {
    return { kind: "ambiguous" };
  }

  const facts = requiredCheckFacts(
    ruleset.rules,
    guardCheckName,
    publisherIntegrationId,
    evidenceChecks,
  );
  return facts.ambiguous ? { kind: "ambiguous" } : { kind: "applicable", ...facts };
}

export function githubRulesetReadiness(
  rulesets,
  options = {},
) {
  const {
    defaultBranch,
    guardCheckName,
    publisherIntegrationId,
    evidenceChecks,
    repositoryScoped = false,
  } = isRecord(options)
    ? options
    : {};
  const expectedPublisherId = Number.isSafeInteger(publisherIntegrationId)
    && publisherIntegrationId > 0
    ? publisherIntegrationId
    : null;
  const validEvidenceChecks = Array.isArray(evidenceChecks)
    && evidenceChecks.length > 0
    && evidenceChecks.length <= 100
    && evidenceChecks.every((check) => isRecord(check)
      && Object.keys(check).length === 2
      && Object.hasOwn(check, "name")
      && Object.hasOwn(check, "integrationId")
      && validLabel(check.name)
      && check.name !== guardCheckName
      && Number.isSafeInteger(check.integrationId)
      && check.integrationId > 0)
    && new Set(evidenceChecks.map(({ name }) => name)).size === evidenceChecks.length;
  if (!Array.isArray(rulesets) || !validLabel(defaultBranch) || !validLabel(guardCheckName)
    || expectedPublisherId === null || !validEvidenceChecks) {
    return readiness("ruleset_ambiguous");
  }

  const emptyFacts = {
    strict: false,
    mergeQueueRequired: false,
    guardRequired: false,
    publisherBound: false,
    evidenceRequired: false,
    evidencePublisherBound: false,
    missingEvidence: evidenceChecks,
    misboundEvidence: [],
    expectedPublisherId,
  };
  const applicable = [];
  let ambiguous = false;
  for (const ruleset of rulesets) {
    const inspected = inspectRuleset(
      ruleset,
      `refs/heads/${defaultBranch}`,
      guardCheckName,
      expectedPublisherId,
      evidenceChecks,
      repositoryScoped === true,
    );
    if (inspected.kind === "ambiguous") {
      ambiguous = true;
      continue;
    }
    if (inspected.kind === "applicable") {
      applicable.push({ ...inspected, expectedPublisherId });
    }
  }

  const score = (facts) => [
    facts.strict,
    facts.mergeQueueRequired,
    facts.guardRequired,
    facts.publisherBound,
    facts.evidenceRequired,
    facts.evidencePublisherBound,
  ].filter(Boolean).length;
  const complete = (facts) => score(facts) === 6;
  const completeStrictHead = (facts) => facts.strict
    && facts.guardRequired
    && facts.publisherBound
    && facts.evidenceRequired
    && facts.evidencePublisherBound;
  const best = applicable.reduce((selected, facts) => (
    selected == null || score(facts) > score(selected) ? facts : selected
  ), null) ?? emptyFacts;

  if (ambiguous) return readiness("ruleset_ambiguous", best);
  if (applicable.length === 0) return readiness("ruleset_required", emptyFacts);
  const active = applicable.find(complete);
  if (active) return readiness("active", active);
  if (!best.strict) return readiness("strict_required", best);
  if (!best.guardRequired) return readiness("guard_required", best);
  if (!best.publisherBound) return readiness("publisher_binding_required", best);
  if (!best.evidenceRequired) return readiness("evidence_required", best);
  if (!best.evidencePublisherBound) return readiness("evidence_publisher_binding_required", best);
  if (completeStrictHead(best)) return readiness("strict_head", best);
  return readiness("ruleset_ambiguous", best);
}

export const rulesetEnforcementState = githubRulesetReadiness;
