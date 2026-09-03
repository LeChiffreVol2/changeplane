import assert from "node:assert/strict";
import test from "node:test";

import { auditReleaseClaims } from "./release-claims.js";

test("finds stale release claims that contradict the shipped contract", () => {
  const findings = auditReleaseClaims([
    { path: "SECURITY.md", content: "A rerun after completion requires a new commit." },
    { path: "docs/release-checklist.md", content: "ChangePlane reports merge_queue_required." },
    { path: "README.md", content: "The managed v13 candidate is not deployed." },
    { path: "EVALUATION.md", content: "The v13 dedicated guard publisher protected live App/OIDC canary remains pending." },
    { path: "SECURITY.md", content: "The dedicated-App guard lifecycle has not been deployed or exercised in a protected v13 canary." },
  ]);

  assert.deepEqual(findings.map(({ rule }) => rule), [
    "same_sha_generation",
    "strict_head_availability",
    "deployed_release_boundary",
    "deployed_release_boundary",
    "deployed_release_boundary",
  ]);
  assert.deepEqual(findings.map(({ line }) => line), [1, 1, 1, 1, 1]);
});

test("accepts precise deployed and assurance-level boundaries", () => {
  assert.deepEqual(auditReleaseClaims([{
    path: "README.md",
    content: "Managed v13 is deployed. Strict Head is active without Merge Queue; Queue Certified requires a fresh merge_group evaluation.",
  }]), []);
});
