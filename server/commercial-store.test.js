import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryCommercialStore } from "./commercial-store.js";

test("derives tenant-isolated Fleet Posture and usage from append-only evaluation events", async () => {
  const store = createMemoryCommercialStore({
    now: () => new Date("2026-09-01T12:00:00.000Z"),
  });

  await store.recordEvaluationEvent({
    organizationId: 10,
    installationId: 100,
    repositoryId: 1000,
    revisionFingerprint: "a".repeat(64),
    evaluationGeneration: "8001.1",
    assuranceLevel: "strict_head",
    state: "pass",
    reason: "evidence_passed",
    latencyMs: 12_400,
    occurredAt: "2026-09-01T10:00:00.000Z",
  });
  await store.recordEvaluationEvent({
    organizationId: 10,
    installationId: 100,
    repositoryId: 1000,
    revisionFingerprint: "a".repeat(64),
    evaluationGeneration: "8001.1",
    assuranceLevel: "strict_head",
    state: "evaluating",
    reason: "evaluation_started",
    latencyMs: 0,
    occurredAt: "2026-09-01T09:59:00.000Z",
  });
  await store.recordEvaluationEvent({
    organizationId: 10,
    installationId: 100,
    repositoryId: 1001,
    revisionFingerprint: "b".repeat(64),
    evaluationGeneration: "8002.1",
    assuranceLevel: "queue_certified",
    state: "action_required",
    reason: "protected_path",
    latencyMs: 8_100,
    occurredAt: "2026-09-01T11:00:00.000Z",
    customerConfirmedValuable: true,
  });
  await store.recordEvaluationEvent({
    organizationId: 20,
    installationId: 200,
    repositoryId: 2000,
    revisionFingerprint: "c".repeat(64),
    evaluationGeneration: "9001.1",
    assuranceLevel: "strict_head",
    state: "pass",
    reason: "evidence_passed",
    latencyMs: 5_000,
    occurredAt: "2026-09-01T11:30:00.000Z",
  });

  assert.deepEqual(await store.readFleet({ organizationId: 10 }), {
    organizationId: 10,
    repositories: [
      {
        repositoryId: 1000,
        assuranceLevel: "strict_head",
        latestState: "pass",
        latestReason: "evidence_passed",
        lastEvaluatedAt: "2026-09-01T10:00:00.000Z",
        weeklyEvaluations: 1,
        weeklyAssuredPullRequests: 1,
        valuableBlocks: 0,
        p95LatencyMs: 12_400,
      },
      {
        repositoryId: 1001,
        assuranceLevel: "queue_certified",
        latestState: "action_required",
        latestReason: "protected_path",
        lastEvaluatedAt: "2026-09-01T11:00:00.000Z",
        weeklyEvaluations: 1,
        weeklyAssuredPullRequests: 0,
        valuableBlocks: 1,
        p95LatencyMs: 8_100,
      },
    ],
  });
  assert.deepEqual(await store.readUsage({ organizationId: 10, period: "2026-09" }), {
    organizationId: 10,
    period: "2026-09",
    evaluations: 2,
  });

  assert.equal(await store.deleteOrganization({ organizationId: 10 }), 3);
  assert.deepEqual((await store.readFleet({ organizationId: 10 })).repositories, []);
  assert.equal((await store.readUsage({ organizationId: 20, period: "2026-09" })).evaluations, 1);
});

test("orders numeric Evaluation Generations and bills one evaluation per generation", async () => {
  const store = createMemoryCommercialStore({
    now: () => new Date("2026-09-01T12:00:00.000Z"),
  });
  for (const [evaluationGeneration, state] of [["2.1", "pass"], ["10.1", "action_required"]]) {
    await store.recordEvaluationEvent({
      organizationId: 10,
      installationId: 100,
      repositoryId: 1000,
      revisionFingerprint: "a".repeat(64),
      evaluationGeneration,
      assuranceLevel: "strict_head",
      state,
      reason: state === "pass" ? "evidence_passed" : "newer_failure",
      latencyMs: 10,
      occurredAt: "2026-09-01T10:00:00.000Z",
    });
  }
  const fleet = await store.readFleet({ organizationId: 10 });
  assert.equal(fleet.repositories[0].latestState, "action_required");
  assert.equal(fleet.repositories[0].weeklyEvaluations, 2);
  assert.equal((await store.readUsage({ organizationId: 10, period: "2026-09" })).evaluations, 2);
});

test("rejects source-shaped or secret-shaped fields at the storage boundary", async () => {
  const store = createMemoryCommercialStore();
  const base = {
    organizationId: 10,
    installationId: 100,
    repositoryId: 1000,
    revisionFingerprint: "a".repeat(64),
    evaluationGeneration: "8001.1",
    assuranceLevel: "strict_head",
    state: "pass",
    reason: "evidence_passed",
    latencyMs: 1,
    occurredAt: "2026-09-01T10:00:00.000Z",
  };

  await assert.rejects(() => store.recordEvaluationEvent({ ...base, repositoryName: "acme/private" }), /invalid fields/u);
  await assert.rejects(() => store.recordEvaluationEvent({ ...base, prompt: "private source" }), /invalid fields/u);
  await assert.rejects(() => store.recordEvaluationEvent({ ...base, apiKey: "secret" }), /invalid fields/u);
  await store.recordEvaluationEvent(base);
  await assert.rejects(() => store.recordEvaluationEvent({
    ...base,
    state: "action_required",
    reason: "conflicting_terminal",
  }), /immutable generation state/u);
});

test("attributes a generation crossing a UTC month boundary once to its earliest event", async () => {
  const store = createMemoryCommercialStore();
  const base = {
    organizationId: 10,
    installationId: 100,
    repositoryId: 1000,
    revisionFingerprint: "a".repeat(64),
    evaluationGeneration: "8001.1",
    assuranceLevel: "strict_head",
    latencyMs: 2_000,
  };
  // Delayed start delivery must produce the same attribution as chronological delivery.
  await store.recordEvaluationEvent({
    ...base, state: "pass", reason: "evidence_passed", occurredAt: "2026-09-01T00:00:01.000Z",
  });
  await store.recordEvaluationEvent({
    ...base, state: "evaluating", reason: "evaluation_started", occurredAt: "2026-08-31T23:59:59.000Z",
  });
  await store.recordEvaluationEvent({
    ...base, evaluationGeneration: "8001.2", state: "pass", reason: "evidence_passed", occurredAt: "2026-09-01T00:00:02.000Z",
  });
  assert.equal((await store.readUsage({ organizationId: 10, period: "2026-08" })).evaluations, 1);
  assert.equal((await store.readUsage({ organizationId: 10, period: "2026-09" })).evaluations, 1);
  assert.equal((await store.readUsage({ organizationId: 20, period: "2026-09" })).evaluations, 0);
});
