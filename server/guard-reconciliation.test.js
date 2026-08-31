import assert from "node:assert/strict";
import test from "node:test";

import { reconcileGuardState } from "./guard-reconciliation.js";

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
        summary: "The latest Evaluation Generation exceeded the 15-minute campaign plus 10-minute reconciliation window. No PASS was issued. Re-run ChangePlane on the same exact revision or inspect the failed workflow.",
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
