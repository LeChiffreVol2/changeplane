import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const HARNESS_MODE = Object.freeze({
  OBSERVE: "observe",
  VERIFY: "verify",
  AUTONOMOUS: "autonomous",
});

export const HARNESS_MAX_ATTEMPTS = 2;
export const HARNESS_BUDGET_MINUTES = 15;
const GUARD_CHECK_NAME = "ChangePlane / guard";
const RESERVED_CHANGEPLANE_CHECK_NAMES = new Set([
  GUARD_CHECK_NAME,
  "ChangePlane guard",
  "ChangePlane / review",
]);
const REQUIRED_CHECK_LIMIT = 20;
const REQUIRED_CHECK_NAME_LIMIT = 100;
const GITHUB_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u;
const GITHUB_ACTIONS_APP_SLUG = "github-actions";
const GITHUB_WORKFLOW_PATH = /^\.github\/workflows\/[^/\\\u0000-\u001f\u007f]{1,260}\.ya?ml$/u;

function validGithubWorkflowPath(value) {
  return typeof value === "string"
    && value.length <= 300
    && value === value.trim()
    && GITHUB_WORKFLOW_PATH.test(value);
}

/** Normalize GitHub's `<workflow-file>@<ref>` run path without trusting the ref. */
export function githubWorkflowFilePath(value) {
  if (typeof value !== "string" || value.length > 600 || value !== value.trim()) return null;
  const separator = value.indexOf("@");
  if (separator === -1) return validGithubWorkflowPath(value) ? value : null;
  if (separator === 0 || separator !== value.lastIndexOf("@")) return null;
  const workflowPath = value.slice(0, separator);
  const ref = value.slice(separator + 1);
  if (!validGithubWorkflowPath(workflowPath)
    || ref.length === 0
    || ref.length > 300
    || /[\u0000-\u0020\u007f]/u.test(ref)) return null;
  return workflowPath;
}

export function validateRequiredChecks(value = [], { mode = "observe" } = {}) {
  if (mode !== "observe" && mode !== "enforce") {
    throw new TypeError("Required Check validation mode must be observe or enforce.");
  }
  const requiredChecks = value ?? [];
  if (!Array.isArray(requiredChecks) || requiredChecks.length > REQUIRED_CHECK_LIMIT) {
    throw new TypeError(`evidence.requiredChecks must be an array with at most ${REQUIRED_CHECK_LIMIT} entries.`);
  }
  if (mode === "enforce" && requiredChecks.length === 0) {
    throw new TypeError("Enforce mode requires at least one exact behavioral Check with a GitHub App publisher.");
  }
  const identities = new Set();
  const wildcardNames = new Set();
  const exactNames = new Set();
  for (const requirement of requiredChecks) {
    const isObject = requirement && typeof requirement === "object" && !Array.isArray(requirement);
    const name = typeof requirement === "string" ? requirement : isObject ? requirement.name : null;
    if (typeof name !== "string"
      || name.length === 0
      || name.length > REQUIRED_CHECK_NAME_LIMIT
      || name !== name.trim()
      || /[\u0000-\u001f\u007f]/u.test(name)
      || RESERVED_CHANGEPLANE_CHECK_NAMES.has(name)) {
      throw new TypeError(`Each required Check needs a 1–${REQUIRED_CHECK_NAME_LIMIT} character name and cannot be ${GUARD_CHECK_NAME}, ChangePlane guard, or ChangePlane / review.`);
    }
    if (typeof requirement === "string") {
      if (mode === "enforce") {
        throw new TypeError("Enforce mode requires every evidence.requiredChecks entry to declare its GitHub App publisher with { name, appSlug }.");
      }
      const identity = `${name}\0Any`;
      if (identities.has(identity) || exactNames.has(name)) {
        throw new TypeError("evidence.requiredChecks cannot repeat the same Check name and publisher.");
      }
      identities.add(identity);
      wildcardNames.add(name);
      continue;
    }
    if (!isObject
      || Object.keys(requirement).some((key) => !["name", "appSlug", "workflowPath"].includes(key))
      || typeof requirement.appSlug !== "string"
      || !GITHUB_APP_SLUG.test(requirement.appSlug)) {
      throw new TypeError("Each publisher-bound required Check must contain only { name, appSlug, workflowPath? } with a lowercase GitHub App slug.");
    }
    if (requirement.appSlug === GITHUB_ACTIONS_APP_SLUG) {
      if (requirement.workflowPath != null && !validGithubWorkflowPath(requirement.workflowPath)) {
        throw new TypeError("A github-actions required Check workflowPath must be an exact .github/workflows/*.yml or *.yaml path.");
      }
      if (mode === "enforce" && !validGithubWorkflowPath(requirement.workflowPath)) {
        throw new TypeError("Enforce mode requires every github-actions Check to declare its exact .github/workflows/*.yml or *.yaml workflowPath.");
      }
    } else if (requirement.workflowPath != null) {
      throw new TypeError("workflowPath is allowed only for Checks published by github-actions.");
    }
    const identity = `${name}\0${requirement.appSlug}`;
    if (identities.has(identity) || wildcardNames.has(name) || exactNames.has(name)) {
      throw new TypeError("evidence.requiredChecks cannot repeat a Check name, even with another publisher.");
    }
    identities.add(identity);
    exactNames.add(name);
  }
  return requiredChecks;
}

export function harnessPolicy(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The harness policy must be an object.");
  }
  const mode = value.mode ?? HARNESS_MODE.OBSERVE;
  if (!Object.values(HARNESS_MODE).includes(mode)) {
    throw new TypeError("The harness mode must be observe, verify, or autonomous.");
  }
  const maxAttempts = value.maxAttempts ?? HARNESS_MAX_ATTEMPTS;
  const budgetMinutes = value.budgetMinutes ?? HARNESS_BUDGET_MINUTES;
  if (maxAttempts !== HARNESS_MAX_ATTEMPTS || budgetMinutes !== HARNESS_BUDGET_MINUTES) {
    throw new TypeError("The autonomous harness is fixed at two attempts within 15 minutes.");
  }
  return { mode, maxAttempts, budgetMinutes };
}

export function actionHarnessConfig(policy) {
  const harness = harnessPolicy(policy?.harness);
  validateRequiredChecks(policy?.evidence?.requiredChecks, {
    mode: harness.mode === HARNESS_MODE.OBSERVE ? "observe" : "enforce",
  });
  return {
    mode: harness.mode === HARNESS_MODE.OBSERVE ? "observe" : "enforce",
    dispatch: harness.mode === HARNESS_MODE.AUTONOMOUS ? "webhook" : "none",
    maxAttempts: harness.maxAttempts,
  };
}

function runCli() {
  const policyPath = process.env.CHANGEPLANE_TRUSTED_POLICY || ".changeplane.json";
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is unavailable.");
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    throw new Error("The trusted ChangePlane policy is missing or invalid.");
  }
  const config = actionHarnessConfig(policy);
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `mode=${config.mode}`,
    `dispatch=${config.dispatch}`,
    `max_attempts=${config.maxAttempts}`,
    "",
  ].join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Harness policy failed.");
    process.exitCode = 1;
  }
}
