import { createHash } from "node:crypto";

import { githubRulesetReadiness } from "./github-ruleset-readiness.js";

const GUARD_CHECK_NAME = "ChangePlane / guard";
const ASSURANCE_LEVELS = new Set(["strict_head", "queue_certified"]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function validRepository(repository) {
  return repository !== null
    && typeof repository === "object"
    && Number.isSafeInteger(repository.id)
    && repository.id > 0
    && typeof repository.fullName === "string"
    && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository.fullName)
    && typeof repository.defaultBranch === "string"
    && repository.defaultBranch.length > 0
    && /^[a-f0-9]{40,64}$/u.test(repository.defaultBranchSha ?? "");
}

function validEvidenceChecks(evidenceChecks) {
  return Array.isArray(evidenceChecks)
    && evidenceChecks.length > 0
    && evidenceChecks.length <= 100
    && evidenceChecks.every((check) => check !== null
      && typeof check === "object"
      && typeof check.name === "string"
      && check.name.length > 0
      && check.name !== GUARD_CHECK_NAME
      && Number.isSafeInteger(check.integrationId)
      && check.integrationId > 0)
    && new Set(evidenceChecks.map(({ name }) => name)).size === evidenceChecks.length;
}

function mergeQueueRule() {
  return {
    type: "merge_queue",
    parameters: {
      check_response_timeout_minutes: 60,
      grouping_strategy: "ALLGREEN",
      max_entries_to_build: 5,
      max_entries_to_merge: 5,
      merge_method: "SQUASH",
      min_entries_to_merge: 1,
      min_entries_to_merge_wait_minutes: 5,
    },
  };
}

function rulesetBody(assuranceLevel, guardIntegrationId, evidenceChecks, defaultBranch) {
  const requiredChecks = [
    { context: GUARD_CHECK_NAME, integration_id: guardIntegrationId },
    ...evidenceChecks.map(({ name, integrationId }) => ({
      context: name,
      integration_id: integrationId,
    })),
  ];
  return {
    name: assuranceLevel === "queue_certified"
      ? "ChangePlane · Queue Certified"
      : "ChangePlane · Strict Head",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: [`refs/heads/${defaultBranch}`], exclude: [] } },
    rules: [
      ...(assuranceLevel === "queue_certified" ? [mergeQueueRule()] : []),
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          strict_required_status_checks_policy: true,
          required_status_checks: requiredChecks,
        },
      },
    ],
  };
}

function withDigest(plan) {
  return { ...plan, planDigest: digest(plan) };
}

export function buildRulesetPlan({
  repository,
  assuranceLevel,
  guardIntegrationId,
  evidenceChecks,
  rulesets,
}) {
  if (!validRepository(repository)
    || !ASSURANCE_LEVELS.has(assuranceLevel)
    || !Number.isSafeInteger(guardIntegrationId)
    || guardIntegrationId <= 0
    || !validEvidenceChecks(evidenceChecks)
    || !Array.isArray(rulesets)) {
    throw new TypeError("Ruleset plan input is invalid.");
  }

  const readiness = githubRulesetReadiness(rulesets, {
    defaultBranch: repository.defaultBranch,
    guardCheckName: GUARD_CHECK_NAME,
    publisherIntegrationId: guardIntegrationId,
    evidenceChecks,
    repositoryScoped: true,
  });
  const repositoryBinding = {
    id: repository.id,
    fullName: repository.fullName,
    defaultBranch: repository.defaultBranch,
    defaultBranchSha: repository.defaultBranchSha,
  };
  const snapshot = digest(rulesets);
  const alreadySatisfied = readiness.active
    && (assuranceLevel === "strict_head" || readiness.queueCertified);
  if (alreadySatisfied) {
    return withDigest({
      schemaVersion: 1,
      action: "none",
      assuranceLevel,
      repository: repositoryBinding,
      rulesetSnapshotDigest: snapshot,
      readiness,
      mutation: null,
      summary: `${assuranceLevel === "queue_certified" ? "Queue Certified" : "Strict Head"} is already active. No GitHub policy change is needed.`,
    });
  }
  if (readiness.state === "ruleset_ambiguous") {
    return withDigest({
      schemaVersion: 1,
      action: "manual_review",
      assuranceLevel,
      repository: repositoryBinding,
      rulesetSnapshotDigest: snapshot,
      readiness,
      mutation: null,
      summary: "Existing GitHub Rulesets are ambiguous or bypass-bearing. ChangePlane will not mutate policy until an administrator resolves them.",
    });
  }

  return withDigest({
    schemaVersion: 1,
    action: "create",
    assuranceLevel,
    repository: repositoryBinding,
    rulesetSnapshotDigest: snapshot,
    readiness,
    mutation: {
      method: "POST",
      path: `/repos/${repository.fullName}/rulesets`,
      body: rulesetBody(assuranceLevel, guardIntegrationId, evidenceChecks, repository.defaultBranch),
    },
    summary: `Create one active, strict, no-bypass ${assuranceLevel === "queue_certified" ? "Queue Certified" : "Strict Head"} Ruleset bound to the observed Check publishers.`,
  });
}

export function rulesetPlanMatches(left, right) {
  return left?.planDigest === right?.planDigest
    && /^[a-f0-9]{64}$/u.test(left?.planDigest ?? "")
    && left.planDigest === digest(Object.fromEntries(
      Object.entries(left).filter(([key]) => key !== "planDigest"),
    ));
}
