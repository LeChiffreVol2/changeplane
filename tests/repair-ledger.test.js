import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  issueRepairGrant,
  reduceVerifiedRepairLedger,
  repairLedgerEntryDigest,
  repairLedgerKeyId,
  repairLedgerPublicKeyValue,
  signRepairLedgerEntry,
  verifyRepairLedgerEnvelope,
} from "../server/repair-ledger.js";
import { verifyRepairGrantEnvironment } from "../examples/changeplane-grant.js";

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyId = repairLedgerKeyId(publicKey);
  return { privateKey, publicKey, keyId, publicKeys: { [keyId]: publicKey } };
}

function candidate(overrides = {}) {
  return {
    repository: "acme/payments",
    pullRequestNumber: 42,
    contractDigest: "1".repeat(64),
    policyDigest: "4".repeat(64),
    evaluatorVersion: "0.3.0",
    inputDigest: "2".repeat(64),
    baseRef: "main",
    baseSha: "a".repeat(40),
    controllerSha: "d".repeat(40),
    headSha: "b".repeat(40),
    headRef: "agent/payment-retry",
    headRepository: "acme/payments",
    repairKind: "scope",
    declaredScope: ["src/payments/**"],
    allowedPaths: ["docs/release-note.md"],
    protectedPaths: ["infra/**", "migrations/**"],
    instructions: [{
      code: "OUTSIDE_PLANNED_SCOPE",
      path: "docs/release-note.md",
      pathKind: "current",
      action: "REVERT_OR_MOVE_INTO_DECLARED_SCOPE",
    }],
    ...overrides,
  };
}

function ids(seed = 10) {
  let value = seed;
  return () => (value++).toString(16).padStart(64, "0");
}

test("issues two signed attempts under one immutable 15-minute campaign", async () => {
  const signing = keys();
  const persisted = [];
  const publishEntry = async (envelope) => { persisted.push(envelope); };
  const readEntries = async () => structuredClone(persisted);
  const first = await issueRepairGrant({
    ledger: [],
    candidate: candidate(),
    privateKey: signing.privateKey,
    publicKeys: signing.publicKeys,
    generation: 7,
    enabled: true,
    publishEntry,
    readEntries,
    now: new Date("2026-07-18T00:00:00.000Z"),
    randomId: ids(),
  });
  const second = await issueRepairGrant({
    ledger: persisted,
    candidate: candidate({ inputDigest: "3".repeat(64), headSha: "c".repeat(40) }),
    privateKey: signing.privateKey,
    publicKeys: signing.publicKeys,
    generation: 7,
    enabled: true,
    publishEntry,
    readEntries,
    now: new Date("2026-07-18T00:14:00.000Z"),
    randomId: ids(20),
  });

  assert.equal(first.envelope.entry.attempt, 1);
  assert.equal(second.envelope.entry.attempt, 2);
  assert.equal(first.envelope.entry.deadlineAt, "2026-07-18T00:15:00.000Z");
  assert.equal(second.envelope.entry.firstIssuedAt, first.envelope.entry.firstIssuedAt);
  assert.equal(second.envelope.entry.deadlineAt, first.envelope.entry.deadlineAt);
  assert.equal(second.envelope.entry.priorEntryDigest, repairLedgerEntryDigest(first.envelope));
  assert.equal(second.state.attemptsUsed, 2);
  await assert.rejects(issueRepairGrant({
    ledger: persisted,
    candidate: candidate({ inputDigest: "4".repeat(64), headSha: "d".repeat(40) }),
    privateKey: signing.privateKey,
    publicKeys: signing.publicKeys,
    generation: 7,
    enabled: true,
    publishEntry,
    readEntries,
    now: new Date("2026-07-18T00:14:30.000Z"),
  }), /budget is exhausted/u);
});

test("rejects expiry, deadline reset, generation rollback, and a second attempt without attempt one", async () => {
  const signing = keys();
  const persisted = [];
  const first = await issueRepairGrant({
    ledger: [],
    candidate: candidate(),
    privateKey: signing.privateKey,
    publicKeys: signing.publicKeys,
    generation: 3,
    enabled: true,
    publishEntry: async (entry) => persisted.push(entry),
    readEntries: async () => persisted,
    now: new Date("2026-07-18T00:00:00.000Z"),
    randomId: ids(),
  });
  assert.throws(() => reduceVerifiedRepairLedger(persisted, signing.publicKeys, {
    now: Date.parse("2026-07-18T00:15:00.000Z"),
    expectedGeneration: 3,
  }), /expired/u);
  assert.throws(() => reduceVerifiedRepairLedger(persisted, signing.publicKeys, {
    now: Date.parse("2026-07-18T00:01:00.000Z"),
    expectedGeneration: 4,
  }), /generation/u);

  const reset = structuredClone(first.envelope.entry);
  reset.deadlineAt = "2026-07-18T00:16:00.000Z";
  assert.throws(() => signRepairLedgerEntry(reset, signing.privateKey), /deadline/u);

  const orphan = structuredClone(first.envelope.entry);
  orphan.attempt = 2;
  orphan.issuedAt = "2026-07-18T00:01:00.000Z";
  orphan.priorEntryDigest = "9".repeat(64);
  orphan.authorizationId = "8".repeat(64);
  orphan.nonce = "7".repeat(64);
  const orphanEnvelope = signRepairLedgerEntry(orphan, signing.privateKey);
  assert.throws(() => reduceVerifiedRepairLedger([orphanEnvelope], signing.publicKeys, {
    now: Date.parse("2026-07-18T00:02:00.000Z"),
  }), /no valid first attempt/u);
});

test("rejects signature tampering, unknown keys, extra fields, and replayed entries", async () => {
  const signing = keys();
  const other = keys();
  const persisted = [];
  const { envelope } = await issueRepairGrant({
    ledger: [],
    candidate: candidate(),
    privateKey: signing.privateKey,
    publicKeys: signing.publicKeys,
    generation: 1,
    enabled: true,
    publishEntry: async (entry) => persisted.push(entry),
    readEntries: async () => persisted,
    now: new Date("2026-07-18T00:00:00.000Z"),
    randomId: ids(),
  });

  for (const mutate of [
    (value) => { value.entry.repository = "acme/other"; },
    (value) => { value.entry.headSha = "c".repeat(40); },
    (value) => { value.entry.allowedPaths = ["secrets/**"]; },
    (value) => { value.entry.attempt = 2; },
    (value) => { value.entry.generation = 2; },
    (value) => { value.entry.policyDigest = "5".repeat(64); },
    (value) => { value.entry.controllerSha = "e".repeat(40); },
    (value) => { value.entry.extra = true; },
  ]) {
    const tampered = structuredClone(envelope);
    mutate(tampered);
    assert.throws(() => verifyRepairLedgerEnvelope(tampered, signing.publicKeys, {
      now: Date.parse("2026-07-18T00:01:00.000Z"),
    }));
  }
  assert.throws(() => verifyRepairLedgerEnvelope(envelope, other.publicKeys, {
    now: Date.parse("2026-07-18T00:01:00.000Z"),
  }), /not trusted/u);
  assert.throws(() => reduceVerifiedRepairLedger([envelope, envelope], signing.publicKeys, {
    now: Date.parse("2026-07-18T00:01:00.000Z"),
  }), /replay|fork|attempt/u);
});

test("fails closed before dispatch when the kill switch or App-authored persistence is unavailable", async () => {
  const signing = keys();
  let publishes = 0;
  await assert.rejects(issueRepairGrant({
    ledger: [],
    candidate: candidate(),
    privateKey: signing.privateKey,
    publicKeys: signing.publicKeys,
    generation: 1,
    enabled: false,
    publishEntry: async () => { publishes += 1; },
    readEntries: async () => [],
  }), /kill switch is off/u);
  assert.equal(publishes, 0);

  await assert.rejects(issueRepairGrant({
    ledger: [],
    candidate: candidate(),
    privateKey: signing.privateKey,
    publicKeys: signing.publicKeys,
    generation: 1,
    enabled: true,
    publishEntry: async () => { publishes += 1; },
    readEntries: async () => [],
    now: new Date("2026-07-18T00:00:00.000Z"),
    randomId: ids(),
  }), /unique signed tip/u);
  assert.equal(publishes, 1);
});

test("inactive workflow verifier accepts only the pinned signed grant and current kill-switch generation", async () => {
  const signing = keys();
  const persisted = [];
  const { envelope } = await issueRepairGrant({
    ledger: [],
    candidate: candidate(),
    privateKey: signing.privateKey,
    publicKeys: signing.publicKeys,
    generation: 9,
    enabled: true,
    publishEntry: async (entry) => persisted.push(entry),
    readEntries: async () => persisted,
    now: new Date("2026-07-18T00:00:00.000Z"),
    randomId: ids(),
  });
  const event = { client_payload: envelope };
  const publicKeys = JSON.stringify({
    [signing.keyId]: repairLedgerPublicKeyValue(signing.publicKey),
  });
  const verified = verifyRepairGrantEnvironment({
    event,
    enabled: "true",
    generation: "9",
    publicKeys,
    repository: "acme/payments",
    baseRef: "main",
    controllerSha: "d".repeat(40),
    now: Date.parse("2026-07-18T00:01:00.000Z"),
  });
  assert.equal(verified.authorizationId, envelope.entry.authorizationId);
  assert.equal(verified.claimName, `changeplane-claim-${envelope.entry.authorizationId}`);
  assert.equal(verified.grantDigest, repairLedgerEntryDigest(envelope));

  for (const overrides of [
    { enabled: "false" },
    { generation: "10" },
    { repository: "acme/other" },
    { baseRef: "release" },
    { controllerSha: "e".repeat(40) },
    { expectedDigest: "f".repeat(64) },
    { now: Date.parse("2026-07-18T00:15:00.000Z") },
  ]) {
    assert.throws(() => verifyRepairGrantEnvironment({
      event,
      enabled: "true",
      generation: "9",
      publicKeys,
      repository: "acme/payments",
      baseRef: "main",
      controllerSha: "d".repeat(40),
      now: Date.parse("2026-07-18T00:01:00.000Z"),
      ...overrides,
    }));
  }
});

test("refuses reserved and policy-protected repair paths before a grant is signed", async () => {
  const signing = keys();
  for (const allowedPath of [".github/workflows/release.yml", "changeplane/action/index.js", "infra/prod.tf"]) {
    await assert.rejects(issueRepairGrant({
      ledger: [],
      candidate: candidate({
        allowedPaths: [allowedPath],
        instructions: [{
          code: "OUTSIDE_PLANNED_SCOPE",
          path: allowedPath,
          pathKind: "current",
          action: "REVERT_OR_MOVE_INTO_DECLARED_SCOPE",
        }],
      }),
      privateKey: signing.privateKey,
      publicKeys: signing.publicKeys,
      generation: 1,
      enabled: true,
      publishEntry: async () => assert.fail("protected grants must not publish"),
      readEntries: async () => [],
      now: new Date("2026-07-18T00:00:00.000Z"),
      randomId: ids(),
    }), /protected or reserved/u);
  }
});
