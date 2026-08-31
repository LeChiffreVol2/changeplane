export const PLAN_CATALOG = Object.freeze({
  free: Object.freeze({
    priceUsdMonthly: 0,
    repositories: 1,
    evaluations: 100,
    assuranceLevels: Object.freeze(["strict_head"]),
    detailedRetentionDays: 7,
  }),
  starter: Object.freeze({
    priceUsdMonthly: 99,
    repositories: 3,
    evaluations: 2_500,
    assuranceLevels: Object.freeze(["strict_head"]),
    detailedRetentionDays: 30,
  }),
  team: Object.freeze({
    priceUsdMonthly: 399,
    repositories: 15,
    evaluations: 20_000,
    assuranceLevels: Object.freeze(["strict_head", "queue_certified"]),
    detailedRetentionDays: 90,
  }),
  scale: Object.freeze({
    priceUsdMonthly: 999,
    repositories: 50,
    evaluations: 100_000,
    assuranceLevels: Object.freeze(["strict_head", "queue_certified"]),
    detailedRetentionDays: 90,
    aggregateRetentionMonths: 13,
  }),
  enterprise: Object.freeze({
    priceUsdMonthly: 2_000,
    repositories: null,
    evaluations: null,
    assuranceLevels: Object.freeze(["strict_head", "queue_certified"]),
    detailedRetentionDays: 90,
    aggregateRetentionMonths: 13,
  }),
});

export function usageDisposition({ plan, evaluations }) {
  const entitlement = PLAN_CATALOG[plan];
  if (!entitlement || !Number.isSafeInteger(evaluations) || evaluations < 0) {
    throw new TypeError("Usage input is invalid.");
  }
  if (entitlement.evaluations == null) {
    return { state: "contracted", evaluations, included: null, graceRemaining: null, guardConclusion: null };
  }
  const included = entitlement.evaluations;
  const grace = Math.max(10, Math.ceil(included * 0.01));
  const base = { evaluations, included, graceRemaining: Math.max(0, included + grace - evaluations), guardConclusion: null };
  if (evaluations < included * 0.8) return { state: "active", ...base };
  if (evaluations < included) return { state: "approaching_limit", ...base };
  if (evaluations === included) return { state: "included_limit_reached", ...base };
  if (evaluations <= included + grace) return { state: "grace", ...base };
  return { ...base, state: "usage_action_required", guardConclusion: "action_required" };
}
