import assert from "node:assert/strict";
import test from "node:test";

import { reconcileGuardState } from "./guard-reconciliation.js";
import { decodeGuardRunMarker } from "./github-guard-controller.js";

const NOW = "2026-09-01T12:30:00.000Z";

test("returns an idempotent action_required patch only after campaign and reconciliation windows expire", () => {
  const stale = reconcileGuardState({
    checkRun: {
      id: 44,
      name: "ChangePlane / guard",
      status: "in_progress",
      conclusion: null,
      started_at: "2026-09-01T12:00:00.000Z",
      output: { text: "changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=begin" },
    },
    now: NOW,
  });
  assert.deepEqual(stale, {
    state: "reconcile_required",
    checkRunId: 44,
    generation: "8001.1",
    patch: {
      status: "completed",
      conclusion: "action_required",
      completed_at: NOW,
      output: {
        title: "Evaluation timed out safely",
        summary: "The latest Evaluation Generation reached the 15-minute campaign plus 10-minute reconciliation window. No PASS was issued. Re-run ChangePlane on the same exact revision or inspect the failed workflow.",
        text: "changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=complete",
      },
    },
  });

  assert.deepEqual(reconcileGuardState({
    checkRun: { id: 44, name: "ChangePlane / guard", status: "completed", conclusion: "action_required" },
    now: NOW,
  }).state, "terminal");
});

test("does not interrupt a generation inside its bounded window", () => {
  const result = reconcileGuardState({
    checkRun: {
      id: 44,
      name: "ChangePlane / guard",
      status: "in_progress",
      conclusion: null,
      started_at: "2026-09-01T12:10:00.000Z",
      output: { text: "changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=begin" },
    },
    now: NOW,
  });
  assert.equal(result.state, "within_window");
  assert.equal(result.patch, null);
});

test("preserves an earlier exact-head contract when an interrupted generation times out", () => {
  const boundContractDigest = "a".repeat(64);
  const result = reconcileGuardState({
    checkRun: {
      id: 44,
      name: "ChangePlane / guard",
      status: "in_progress",
      conclusion: null,
      started_at: "2026-09-01T12:00:00.000Z",
      output: { text: `changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=begin;contract_digest=${boundContractDigest};pull_request_number=42` },
    },
    now: NOW,
  });
  assert.equal(result.patch.conclusion, "action_required");
  assert.equal(decodeGuardRunMarker(result.patch.output.text).boundContractDigest, boundContractDigest);
  assert.equal(decodeGuardRunMarker(result.patch.output.text).pullRequestNumber, 42);
});

test("completed Verify and Observe runs permit five-minute recovery while live runs and Autonomous keep the fallback", () => {
  const checkRun = {
    id: 44,
    name: "ChangePlane / guard",
    status: "in_progress",
    conclusion: null,
    started_at: "2026-09-01T12:00:00.000Z",
    output: { text: `changeplane.guard-run/v1;run_id=8001;run_attempt=2;phase=begin;contract_digest=${"a".repeat(64)};pull_request_number=42` },
  };
  for (const trustedHarnessMode of ["observe", "verify"]) {
    assert.equal(reconcileGuardState({ checkRun, trustedHarnessMode, sourceRunCompleted: true, now: "2026-09-01T12:04:59.999Z" }).patch, null);
    const recovered = reconcileGuardState({ checkRun, trustedHarnessMode, sourceRunCompleted: true, now: "2026-09-01T12:05:00.000Z" });
    assert.equal(recovered.patch.conclusion, "action_required");
    assert.match(recovered.patch.output.summary, /5-minute recovery window after its owning workflow run completed/u);
    assert.equal(decodeGuardRunMarker(recovered.patch.output.text).boundContractDigest, "a".repeat(64));
    assert.equal(decodeGuardRunMarker(recovered.patch.output.text).pullRequestNumber, 42);
    assert.equal(recovered.generation, "8001.2");
    for (const sourceRunCompleted of [false, undefined, "true"]) {
      assert.equal(reconcileGuardState({ checkRun, trustedHarnessMode, sourceRunCompleted, now: "2026-09-01T12:06:00.000Z" }).patch, null);
      assert.equal(reconcileGuardState({ checkRun, trustedHarnessMode, sourceRunCompleted, now: "2026-09-01T12:25:00.000Z" }).patch.conclusion, "action_required");
    }
  }
  for (const trustedHarnessMode of ["autonomous", undefined]) {
    for (const now of ["2026-09-01T12:05:00.000Z", "2026-09-01T12:15:00.000Z", "2026-09-01T12:24:59.999Z"]) {
      assert.equal(reconcileGuardState({ checkRun, trustedHarnessMode, sourceRunCompleted: true, now }).patch, null);
    }
    assert.equal(reconcileGuardState({ checkRun, trustedHarnessMode, now: "2026-09-01T12:25:00.000Z" }).patch.conclusion, "action_required");
  }
  assert.throws(() => reconcileGuardState({ checkRun, trustedHarnessMode: "fast", now: NOW }), /recovery mode is invalid/u);
});


test("a blocked same-head evaluation remains recoverable until its generation completes", () => {
  const checkRun = {
    id: 919, name: "ChangePlane / guard", status: "completed", conclusion: "action_required",
    started_at: "2026-09-08T20:00:00.000Z", completed_at: "2026-09-08T20:00:00.000Z",
    output: { text: "changeplane.guard-run/v1;run_id=8001;run_attempt=2;phase=begin" },
  };
  assert.equal(reconcileGuardState({ checkRun, trustedHarnessMode: "verify", sourceRunCompleted: true,
    now: "2026-09-08T20:04:59.000Z" }).state, "within_window");
  const recovery = reconcileGuardState({ checkRun, trustedHarnessMode: "verify", sourceRunCompleted: true,
    now: "2026-09-08T20:05:00.000Z" });
  assert.equal(recovery.patch.conclusion, "action_required");
  assert.match(recovery.patch.output.text, /run_attempt=2;phase=complete/u);
  assert.equal(reconcileGuardState({ checkRun: { ...checkRun, ...recovery.patch } }).state, "terminal");
});
