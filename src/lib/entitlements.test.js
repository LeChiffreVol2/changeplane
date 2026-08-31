import assert from "node:assert/strict";
import test from "node:test";

import { PLAN_CATALOG, usageDisposition } from "./entitlements.js";

test("encodes the approved tier ladder and fails closed after bounded grace", () => {
  assert.deepEqual(PLAN_CATALOG.free, {
    priceUsdMonthly: 0,
    repositories: 1,
    evaluations: 100,
    assuranceLevels: ["strict_head"],
    detailedRetentionDays: 7,
  });
  assert.equal(PLAN_CATALOG.starter.priceUsdMonthly, 99);
  assert.equal(PLAN_CATALOG.team.priceUsdMonthly, 399);
  assert.deepEqual(PLAN_CATALOG.team.assuranceLevels, ["strict_head", "queue_certified"]);
  assert.equal(PLAN_CATALOG.scale.priceUsdMonthly, 999);

  assert.equal(usageDisposition({ plan: "free", evaluations: 79 }).state, "active");
  assert.equal(usageDisposition({ plan: "free", evaluations: 80 }).state, "approaching_limit");
  assert.equal(usageDisposition({ plan: "free", evaluations: 100 }).state, "included_limit_reached");
  assert.deepEqual(usageDisposition({ plan: "free", evaluations: 101 }), {
    state: "grace",
    evaluations: 101,
    included: 100,
    graceRemaining: 9,
    guardConclusion: null,
  });
  assert.deepEqual(usageDisposition({ plan: "free", evaluations: 111 }), {
    state: "usage_action_required",
    evaluations: 111,
    included: 100,
    graceRemaining: 0,
    guardConclusion: "action_required",
  });
});
