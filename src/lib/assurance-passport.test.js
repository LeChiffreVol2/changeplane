import assert from "node:assert/strict";
import test from "node:test";
import {
  assurancePassportMarker,
  buildAssurancePassport,
  parseAssurancePassportIntegrity,
  verifyAssurancePassportAgainstCheck,
  verifyAssurancePassportSummary,
} from "./assurance-passport.js";

function passport(targetType = "pull_request") {
  return buildAssurancePassport({
    targetType,
    repository: "acme/payments",
    repositoryId: 42,
    pullRequestNumber: 7,
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    inputDigest: "c".repeat(64),
    boundContractDigest: "d".repeat(64),
    policy: { path: ".changeplane.json", digest: "e".repeat(64) },
    approvalDigest: "f".repeat(64),
    evaluatorVersion: "0.4.0",
    mode: "observe",
    decision: "PASS",
    reason: "ELIGIBLE",
    evidence: [],
  });
}

function receiptMarker(value) {
  return `<!-- changeplane-receipt:v2 contract=${value.binding.contractDigest} input=${value.binding.inputDigest} head=${value.target.headSha} -->`;
}

test("local passport and receipt binding never substitute for live Check authority", () => {
  const value = passport();
  const summary = `${receiptMarker(value)}\n${assurancePassportMarker(value)}`;
  assert.deepEqual(parseAssurancePassportIntegrity(summary), value);
  assert.equal(verifyAssurancePassportSummary(value, summary), value);
  assert.equal(value.verification.authenticity, "REQUIRES_LIVE_GITHUB_CHECK");
  const expectedPublisher = { appId: 808, appSlug: "changeplane-guard" };
  const check = {
    id: 101,
    name: "ChangePlane / guard",
    head_sha: value.target.headSha,
    status: "completed",
    conclusion: "neutral",
    app: { id: expectedPublisher.appId, slug: expectedPublisher.appSlug },
    output: { summary },
  };
  assert.equal(verifyAssurancePassportAgainstCheck(value, check, expectedPublisher).authenticity,
    "VERIFIED_LIVE_GITHUB_CHECK");
  for (const changed of [
    { app: { id: 909, slug: "lookalike-guard" } },
    { head_sha: "9".repeat(40) },
    { conclusion: "success" },
  ]) {
    assert.throws(() => verifyAssurancePassportAgainstCheck(value, { ...check, ...changed }, expectedPublisher),
      /does not authenticate/u);
  }
});

test("summary binding rejects missing, duplicate and mismatched exact revision receipts", () => {
  const value = passport();
  const marker = assurancePassportMarker(value);
  const receipt = receiptMarker(value);
  for (const summary of [
    marker,
    `${receipt}\n${marker}\n${marker}`,
    `${receipt}\n${receipt}\n${marker}`,
    `${receipt.replace(value.target.headSha, "9".repeat(40))}\n${marker}`,
    `${receipt.replace(value.binding.contractDigest, "0".repeat(64))}\n${marker}`,
  ]) {
    assert.throws(() => verifyAssurancePassportSummary(value, summary), /does not bind/u);
  }
});

test("merge-group summary binds its passport without accepting a pull-request receipt", () => {
  const value = passport("merge_group");
  const summary = assurancePassportMarker(value);
  assert.equal(verifyAssurancePassportSummary(value, summary), value);
  assert.throws(() => verifyAssurancePassportSummary(value, `${receiptMarker(value)}\n${summary}`), /does not bind/u);
});

test("passport digest stays compatible with the protected v16 wire format", () => {
  assert.equal(passport().digest, "36c30ca2433becd6b8604ee9141011c4d154d673594e63af7e3d32566bac4d29");
  assert.equal(passport("merge_group").digest, "937fe016acb7d47845fef485e197b8315783c2697bb1542b33b1560d19961ed6");
});
