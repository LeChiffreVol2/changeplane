import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_BUDGET_MINUTES,
  HARNESS_MAX_ATTEMPTS,
  actionHarnessConfig,
  githubWorkflowFilePath,
  harnessPolicy,
  validateRequiredChecks,
} from "./harness.js";

test("normalizes only GitHub's canonical workflow-file path and optional ref suffix", () => {
  assert.equal(githubWorkflowFilePath(".github/workflows/ci.yml"), ".github/workflows/ci.yml");
  assert.equal(githubWorkflowFilePath(".github/workflows/ci.yml@main"), ".github/workflows/ci.yml");
  assert.equal(githubWorkflowFilePath(`.github/workflows/ci.yaml@${"a".repeat(40)}`), ".github/workflows/ci.yaml");
  for (const invalid of [
    ".github/workflows/ci.yml@",
    ".github/workflows/ci.yml@main@other",
    ".github/workflows/nested/ci.yml@main",
    ".github/workflows/ci.yml@refs/heads/bad branch",
    "../ci.yml@main",
  ]) assert.equal(githubWorkflowFilePath(invalid), null);
});

const exactCheck = {
  name: "test",
  appSlug: "github-actions",
  workflowPath: ".github/workflows/ci.yml",
};

test("trusted harness policy maps observe, verify, and autonomous modes to the Action boundary", () => {
  assert.deepEqual(actionHarnessConfig({}), {
    mode: "observe",
    dispatch: "none",
    maxAttempts: HARNESS_MAX_ATTEMPTS,
  });
  assert.deepEqual(actionHarnessConfig({
    evidence: { requiredChecks: [exactCheck] },
    harness: {
      mode: "verify",
      maxAttempts: HARNESS_MAX_ATTEMPTS,
      budgetMinutes: HARNESS_BUDGET_MINUTES,
    },
  }), {
    mode: "enforce",
    dispatch: "none",
    maxAttempts: HARNESS_MAX_ATTEMPTS,
  });
  assert.deepEqual(actionHarnessConfig({
    evidence: { requiredChecks: [exactCheck] },
    harness: {
      mode: "autonomous",
      maxAttempts: HARNESS_MAX_ATTEMPTS,
      budgetMinutes: HARNESS_BUDGET_MINUTES,
    },
  }), {
    mode: "enforce",
    dispatch: "webhook",
    maxAttempts: HARNESS_MAX_ATTEMPTS,
  });
});

test("harness policy rejects expanded authority and budgets", () => {
  assert.throws(() => harnessPolicy({ mode: "unbounded" }), /observe, verify, or autonomous/u);
  assert.throws(() => harnessPolicy({ mode: "autonomous", maxAttempts: 3 }), /two attempts/u);
  assert.throws(() => harnessPolicy({ mode: "autonomous", budgetMinutes: 30 }), /15 minutes/u);
});

test("enforce policy requires publisher-bound behavioral evidence with an exact schema", () => {
  assert.deepEqual(validateRequiredChecks([exactCheck], { mode: "enforce" }), [exactCheck]);
  assert.throws(
    () => actionHarnessConfig({ harness: { mode: "verify" }, evidence: { requiredChecks: [] } }),
    /at least one exact behavioral Check/u,
  );
  assert.throws(
    () => validateRequiredChecks([{ ...exactCheck, extra: true }], { mode: "enforce" }),
    /contain only/u,
  );
  assert.throws(
    () => validateRequiredChecks([{ name: "test", appSlug: "GitHub-Actions" }], { mode: "enforce" }),
    /lowercase GitHub App slug/u,
  );
  assert.deepEqual(
    validateRequiredChecks([{ name: "test", appSlug: "github-actions" }]),
    [{ name: "test", appSlug: "github-actions" }],
  );
  assert.throws(
    () => validateRequiredChecks([{ name: "test", appSlug: "github-actions" }], { mode: "enforce" }),
    /workflowPath/u,
  );
  assert.throws(
    () => validateRequiredChecks([{ name: "test", appSlug: "github-actions", workflowPath: ".github/workflows/nested/ci.yml" }], { mode: "enforce" }),
    /workflowPath/u,
  );
  assert.throws(
    () => validateRequiredChecks([{ name: "test", appSlug: "trusted-ci", workflowPath: ".github/workflows/ci.yml" }], { mode: "enforce" }),
    /only for Checks published by github-actions/u,
  );
  assert.deepEqual(
    validateRequiredChecks([{ name: "test", appSlug: "trusted-ci" }], { mode: "enforce" }),
    [{ name: "test", appSlug: "trusted-ci" }],
  );
  assert.deepEqual(validateRequiredChecks(["legacy-ci"]), ["legacy-ci"]);
  assert.throws(
    () => validateRequiredChecks(["legacy-ci"], { mode: "enforce" }),
    /declare its GitHub App publisher/u,
  );
  assert.throws(
    () => validateRequiredChecks([exactCheck, { ...exactCheck }], { mode: "enforce" }),
    /cannot repeat/u,
  );
  assert.throws(
    () => validateRequiredChecks([exactCheck, { name: "test", appSlug: "trusted-ci" }], { mode: "enforce" }),
    /cannot repeat/u,
  );
  assert.throws(
    () => validateRequiredChecks(["legacy-ci", "legacy-ci"]),
    /cannot repeat/u,
  );
  assert.throws(
    () => validateRequiredChecks(["legacy-ci", { name: "legacy-ci", appSlug: "github-actions" }]),
    /cannot repeat/u,
  );
  for (const reservedName of ["ChangePlane / guard", "ChangePlane guard", "ChangePlane / review"]) {
    assert.throws(
      () => validateRequiredChecks([{ ...exactCheck, name: reservedName }], { mode: "enforce" }),
      /cannot be ChangePlane \/ guard, ChangePlane guard, or ChangePlane \/ review/u,
    );
  }
});
