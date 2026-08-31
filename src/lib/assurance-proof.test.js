import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSURANCE_PROOF_CLAIM,
  ASSURANCE_PROOF_VERDICT,
  verifyAssuranceProof,
} from "./assurance-proof.js";

const headSha = "b".repeat(40);
const baseSha = "a".repeat(40);
const policyDigest = "c".repeat(64);

function passport(overrides = {}) {
  return {
    digest: "d".repeat(64),
    target: {
      type: "pull_request",
      repositoryId: 42,
      pullRequestNumber: 7,
      headSha,
      baseSha,
    },
    binding: { policyDigest },
    decision: {
      mode: "enforce",
      outcome: "PASS",
      evidenceCount: 1,
      behavioralEvidencePassed: true,
    },
    evidence: [{
      checkName: "CI / verify",
      expectedPublisher: "trusted-ci",
      checkRunId: 101,
      publisherAppId: 811,
      actualPublisher: "trusted-ci",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      completedAt: "2026-08-31T01:00:00Z",
      headSha,
    }],
    ...overrides,
  };
}

function guard(overrides = {}) {
  return {
    id: 202,
    name: "ChangePlane / guard",
    head_sha: headSha,
    status: "completed",
    conclusion: "success",
    app: { id: 424242, slug: "changeplane" },
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    id: 101,
    name: "CI / verify",
    head_sha: headSha,
    status: "completed",
    conclusion: "success",
    completed_at: "2026-08-31T01:00:00Z",
    app: { id: 811, slug: "trusted-ci" },
    ...overrides,
  };
}

function currentTarget(overrides = {}) {
  return {
    type: "pull_request",
    repositoryId: 42,
    headRepositoryId: 42,
    baseRepositoryId: 42,
    pullRequestNumber: 7,
    headSha,
    baseSha,
    state: "open",
    merged: false,
    uniqueOpenPullRequest: true,
    ...overrides,
  };
}

function verifiedInput(overrides = {}) {
  return {
    passport: passport(),
    locatorDigest: "d".repeat(64),
    integrityVerified: true,
    repositoryIdentityVerified: true,
    guardMarkerVerified: true,
    guardCheck: guard(),
    expectedGuardPublisher: {
      appId: 424242,
      appSlug: "changeplane",
      trust: "DEDICATED_CHANGEPLANE_APP",
    },
    evidenceChecks: [evidence()],
    policyDigest,
    policyRequiredChecks: [{ name: "CI / verify", appSlug: "trusted-ci" }],
    currentTarget: currentTarget(),
    ...overrides,
  };
}

test("verifies a current behavioral PASS only after every live GitHub binding matches", () => {
  const result = verifyAssuranceProof(verifiedInput());

  assert.equal(result.verdict, ASSURANCE_PROOF_VERDICT.VERIFIED_CURRENT);
  assert.equal(result.claimLevel, ASSURANCE_PROOF_CLAIM.BEHAVIORAL_PASS);
  assert.equal(result.decision.currentBehavioralPass, true);
  assert.equal(result.authority.merge, "GITHUB");
  assert.equal(result.authority.proofCanMerge, false);
  assert.equal(result.guard.publisherTrust, "DEDICATED_CHANGEPLANE_APP");
  assert.equal(result.guard.passportDigest, "d".repeat(64));
  assert.equal(result.checks.every(({ state }) => state === "PASS"), true);
});

test("keeps a re-fetched superseded passport historical and never current", () => {
  const result = verifyAssuranceProof(verifiedInput({
    currentTarget: currentTarget({ headSha: "d".repeat(40) }),
  }));

  assert.equal(result.verdict, ASSURANCE_PROOF_VERDICT.VERIFIED_HISTORICAL);
  assert.equal(result.currentness, "HISTORICAL");
  assert.equal(result.decision.currentBehavioralPass, false);
});

test("invalidates mismatched guard identity, result, head, or marker", () => {
  for (const overrides of [
    { guardCheck: guard({ head_sha: "d".repeat(40) }) },
    { guardCheck: guard({ conclusion: "action_required" }) },
    { guardCheck: guard({ app: { id: 999, slug: "github-actions" } }) },
    { guardMarkerVerified: false },
  ]) {
    assert.equal(
      verifyAssuranceProof(verifiedInput(overrides)).verdict,
      ASSURANCE_PROOF_VERDICT.INVALID,
    );
  }
});

test("invalidates policy or evidence drift", () => {
  for (const overrides of [
    { policyDigest: "d".repeat(64) },
    { policyRequiredChecks: [{ name: "CI / unrelated", appSlug: "trusted-ci" }] },
    { policyRequiredChecks: [{ name: "CI / verify", appSlug: "lookalike-ci" }] },
    { evidenceChecks: [evidence({ head_sha: "d".repeat(40) })] },
    { evidenceChecks: [evidence({ conclusion: "failure" })] },
    { evidenceChecks: [evidence({ app: { id: 999, slug: "github-actions" } })] },
    { evidenceChecks: [evidence({ completed_at: "2026-08-31T01:00:01Z" })] },
  ]) {
    assert.equal(
      verifyAssuranceProof(verifiedInput(overrides)).verdict,
      ASSURANCE_PROOF_VERDICT.INVALID,
    );
  }
});

test("returns indeterminate when a required live GitHub fact cannot be fetched", () => {
  for (const overrides of [
    { locatorDigest: null },
    { guardCheck: null },
    { evidenceChecks: null },
    { policyDigest: null },
    { policyRequiredChecks: null },
    { currentTarget: null },
  ]) {
    const result = verifyAssuranceProof(verifiedInput(overrides));
    assert.equal(result.verdict, ASSURANCE_PROOF_VERDICT.INDETERMINATE);
    assert.equal(result.decision.currentBehavioralPass, false);
  }
});

test("rejects shared GitHub Actions guard authority and unsafe locator reuse", () => {
  for (const overrides of [
    {
      guardCheck: guard({ app: { id: 15368, slug: "github-actions" } }),
      expectedGuardPublisher: {
        appId: 15368,
        appSlug: "github-actions",
        trust: "DEDICATED_CHANGEPLANE_APP",
      },
    },
    { locatorDigest: "e".repeat(64) },
  ]) {
    const result = verifyAssuranceProof(verifiedInput(overrides));
    assert.equal(result.verdict, ASSURANCE_PROOF_VERDICT.INVALID);
    assert.equal(result.claimLevel, ASSURANCE_PROOF_CLAIM.NON_PASS);
    assert.equal(result.decision.currentBehavioralPass, false);
  }
});

test("rejects forked and cross-repository pull-request heads", () => {
  const result = verifyAssuranceProof(verifiedInput({
    currentTarget: currentTarget({ headRepositoryId: 99 }),
  }));
  assert.equal(result.verdict, ASSURANCE_PROOF_VERDICT.INVALID);
  assert.equal(result.checks.find(({ id }) => id === "current-target")?.state, "FAIL");
});

test("rejects a head shared by multiple open pull requests", () => {
  const result = verifyAssuranceProof(verifiedInput({
    currentTarget: currentTarget({ uniqueOpenPullRequest: false }),
  }));
  assert.equal(result.verdict, ASSURANCE_PROOF_VERDICT.INVALID);
  assert.equal(result.checks.find(({ id }) => id === "current-target")?.state, "FAIL");
});

test("classifies a live-verified Observe receipt as scope only", () => {
  const observePassport = passport({
    decision: {
      mode: "observe",
      outcome: "PASS",
      evidenceCount: 1,
      behavioralEvidencePassed: true,
    },
  });
  const result = verifyAssuranceProof(verifiedInput({
    passport: observePassport,
    guardCheck: guard({ conclusion: "neutral" }),
  }));

  assert.equal(result.verdict, ASSURANCE_PROOF_VERDICT.VERIFIED_CURRENT);
  assert.equal(result.claimLevel, ASSURANCE_PROOF_CLAIM.SCOPE_ONLY);
  assert.equal(result.decision.currentBehavioralPass, false);
});

test("verifies merge-group evidence only as a historical exact revision", () => {
  const mergePassport = passport({
    target: {
      type: "merge_group",
      repositoryId: 42,
      pullRequestNumber: null,
      headSha,
      baseSha,
    },
  });
  const result = verifyAssuranceProof(verifiedInput({
    passport: mergePassport,
    currentTarget: null,
  }));

  assert.equal(result.verdict, ASSURANCE_PROOF_VERDICT.VERIFIED_HISTORICAL);
  assert.equal(result.decision.currentBehavioralPass, false);
});
