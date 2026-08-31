import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EVIDENCE_PROTECTED_PATHS,
  effectiveProtectedPaths,
  evidenceProtectedPaths,
  isEvidenceControlPath,
} from "../examples/changeplane-evidence-policy.js";
import { evaluateChange } from "../src/lib/changeplane.js";

test("protects common tests, evidence configuration, and dependency controls", () => {
  for (const filePath of [
    "tests/checkout.test.js",
    "src/payments/retry.spec.ts",
    "src/__tests__/retry.js",
    "services/router/test_windows.py",
    "service/payment_test.go",
    "packages/api/package.json",
    "playwright.config.ts",
    "requirements-test.txt",
    ".changeplane.json",
    ".github/workflows/ci.yml",
    "changeplane/action/index.js",
  ]) assert.equal(isEvidenceControlPath(filePath), true, filePath);

  for (const filePath of [
    "src/payments/retry.js",
    "src/routing/service-window.ts",
    "docs/release-notes.md",
  ]) assert.equal(isEvidenceControlPath(filePath), false, filePath);
});

test("keeps immutable evidence defaults while allowing repository-owned additions", () => {
  const policy = {
    protectedPaths: { requireApproval: ["infra/**"], block: [".env"] },
    evidence: { protectedPaths: ["fixtures/contracts/**"] },
  };
  const evidence = evidenceProtectedPaths(policy);
  assert.equal(evidence.includes("tests/**"), true);
  assert.equal(evidence.includes("fixtures/contracts/**"), true);
  assert.equal(evidence.length, DEFAULT_EVIDENCE_PROTECTED_PATHS.length + 1);
  assert.deepEqual(effectiveProtectedPaths(policy), {
    requireApproval: [...new Set(["infra/**", ...evidence])].sort(),
    block: [".env"],
  });
});

test("prevents a policy PR from removing review of its own evidence authority", () => {
  const revision = {
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    policyDigest: "policy-digest",
    inputDigest: "input-digest",
    contractDigest: "contract-digest",
    evaluatorVersion: "changeplane-evaluator-v1",
  };
  const originalPolicy = {
    protectedPaths: {
      requireApproval: [".github/**", "changeplane/**"],
      block: [".env"],
    },
    evidence: { protectedPaths: [] },
  };
  const policyChange = evaluateChange({
    ...revision,
    plannedPaths: [".changeplane.json"],
    actualFiles: [".changeplane.json"],
    protectedPaths: effectiveProtectedPaths(originalPolicy, [".changeplane.json"]),
  });
  assert.equal(policyChange.decision, "REVIEW_REQUIRED");
  assert.equal(policyChange.reasons[0]?.code, "PROTECTED_PATH_REQUIRES_APPROVAL");

  const weakenedPolicy = {
    ...originalPolicy,
    protectedPaths: { ...originalPolicy.protectedPaths, requireApproval: [] },
  };
  const workflowChange = evaluateChange({
    ...revision,
    plannedPaths: [".github/workflows/ci.yml"],
    actualFiles: [".github/workflows/ci.yml"],
    protectedPaths: effectiveProtectedPaths(weakenedPolicy, [".github/workflows/ci.yml"]),
  });
  assert.equal(workflowChange.decision, "REVIEW_REQUIRED");
  assert.equal(workflowChange.reasons[0]?.code, "PROTECTED_PATH_REQUIRES_APPROVAL");
});

test("materializes nested test and dependency controls as exact review rules", () => {
  const policy = {
    protectedPaths: { requireApproval: [], block: [] },
    evidence: { protectedPaths: [] },
  };
  const effective = effectiveProtectedPaths(policy, [
    "packages/api/package.json",
    "services/payments/tests/retry.js",
    "src/payments/retry.js",
    { path: "src/legacy-config.js", previousPath: "packages/legacy/package-lock.json" },
  ]);
  assert.equal(effective.requireApproval.includes("packages/api/package.json"), true);
  assert.equal(effective.requireApproval.includes("services/payments/tests/retry.js"), true);
  assert.equal(effective.requireApproval.includes("packages/legacy/package-lock.json"), true);
  assert.equal(effective.requireApproval.includes("src/payments/retry.js"), false);
  assert.equal(effective.requireApproval.includes("src/legacy-config.js"), false);
});

test("rejects malformed repository evidence policy before evaluation", () => {
  assert.throws(
    () => evidenceProtectedPaths({ evidence: { protectedPaths: ["tests/*.js"] } }),
    /exact paths or terminal/u,
  );
  assert.throws(
    () => evidenceProtectedPaths({ evidence: { protectedPaths: "tests/**" } }),
    /at most 50/u,
  );
});
