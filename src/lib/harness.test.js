import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_BUDGET_MINUTES,
  HARNESS_MAX_ATTEMPTS,
  actionHarnessConfig,
  harnessPolicy,
} from "./harness.js";

test("trusted harness policy maps observe and autonomous modes to the Action boundary", () => {
  assert.deepEqual(actionHarnessConfig({}), {
    mode: "observe",
    dispatch: "none",
    maxAttempts: HARNESS_MAX_ATTEMPTS,
  });
  assert.deepEqual(actionHarnessConfig({
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
  assert.throws(() => harnessPolicy({ mode: "unbounded" }), /observe or autonomous/u);
  assert.throws(() => harnessPolicy({ mode: "autonomous", maxAttempts: 3 }), /two attempts/u);
  assert.throws(() => harnessPolicy({ mode: "autonomous", budgetMinutes: 30 }), /15 minutes/u);
});
