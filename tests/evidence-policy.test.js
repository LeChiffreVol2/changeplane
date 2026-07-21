import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EVIDENCE_PROTECTED_PATHS,
  effectiveProtectedPaths,
  evidenceProtectedPaths,
  isEvidenceControlPath,
} from "../examples/changeplane-evidence-policy.js";

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
