const DAY_MS = 86_400_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function record(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !fields.includes(key))) {
    throw new TypeError("Launch evidence contains unsupported fields.");
  }
}

function instant(value) {
  const time = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new TypeError("Launch evidence requires canonical UTC timestamps.");
  }
  return time;
}

function identifier(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError("Use random UUIDs for private evidence identifiers.");
  }
}

function amount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Amounts must be nonnegative safe integers.");
}

function collection(value) {
  if (!Array.isArray(value) || value.length > 100_000) throw new TypeError("Launch evidence collection is invalid.");
  const ids = new Set();
  for (const entry of value) {
    identifier(entry?.id);
    identifier(entry?.evidenceId);
    if (ids.has(entry.id)) throw new TypeError("Duplicate launch evidence identifier.");
    ids.add(entry.id);
  }
  return value;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Offline operator-attested experiment evidence. No network, billing or Guard authority. */
export function buildLaunchScorecard(input, { now = new Date() } = {}) {
  const accountAware = input?.schemaVersion === 2;
  record(input, ["schemaVersion", "startedAt", "coverage", "installations", "evaluations", "payments", "costs", ...(accountAware ? ["accounts"] : [])]);
  if (![1, 2].includes(input.schemaVersion)) throw new TypeError("Unsupported launch evidence schema.");
  const ownerField = accountAware ? "accountId" : "organizationId";
  const accounts = accountAware ? collection(input.accounts) : [];
  const accountTypes = new Map();
  for (const account of accounts) {
    record(account, ["id", "type", "evidenceId"]);
    if (!["User", "Organization"].includes(account.type)) throw new TypeError("Customer account type must match GitHub ownership.");
    accountTypes.set(account.id, account.type);
  }
  const nowMs = instant(now.toISOString());
  record(input.coverage, ["through", "evaluationsComplete", "costsComplete", "evidenceId"]);
  const coverage = input.coverage;
  for (const flag of [coverage.evaluationsComplete, coverage.costsComplete]) {
    if (typeof flag !== "boolean") throw new TypeError("Evidence coverage must be explicit.");
  }
  if (coverage.evidenceId !== null) identifier(coverage.evidenceId);
  const start = input.startedAt === null ? null : instant(input.startedAt);
  if (start !== null && start > nowMs) throw new TypeError("Launch window cannot start in the future.");
  const end = start === null ? null : start + 30 * DAY_MS;
  const through = coverage.through === null ? null : instant(coverage.through);
  if (through !== null && (start === null || through < start || through > nowMs || !coverage.evidenceId)) {
    throw new TypeError("Coverage requires a started window and a private evidence reference.");
  }
  const cutoff = end === null ? null : Math.min(nowMs, end);
  const inWindow = (time) => start !== null && time >= start && time < end && time <= nowMs;
  const installations = collection(input.installations);
  const allRepositories = new Map();
  for (const entry of installations) {
    record(entry, ["id", ownerField, "installedAt", "firstProtectedPrAt", "evidenceId"]);
    identifier(entry[ownerField]);
    if (accountAware && !accountTypes.has(entry.accountId)) throw new TypeError("Installation must belong to a recorded customer account.");
    // Schema 1 is explicitly organization-only historical evidence. It cannot
    // represent personal accounts or infer their type from a person's login.
    if (!accountAware) accountTypes.set(entry.organizationId, "Organization");
    const installed = instant(entry.installedAt);
    const activated = entry.firstProtectedPrAt === null ? null : instant(entry.firstProtectedPrAt);
    if (installed > nowMs || (activated !== null && (activated < installed || activated > nowMs))) {
      throw new TypeError("Installation and activation times are inconsistent.");
    }
    allRepositories.set(entry.id, entry);
  }
  const cohort = installations.filter((entry) => inWindow(instant(entry.installedAt)));
  const activated = cohort.filter((entry) => entry.firstProtectedPrAt !== null && inWindow(instant(entry.firstProtectedPrAt)));
  const activationMedianMs = median(activated.map((entry) => instant(entry.firstProtectedPrAt) - instant(entry.installedAt)));
  const evaluations = collection(input.evaluations);
  for (const entry of evaluations) {
    record(entry, ["id", "repositoryId", "startedAt", "terminalAt", "outcome", "audit", "customerConfirmedValuable", "evidenceId"]);
    if (!allRepositories.has(entry.repositoryId)) throw new TypeError("Evaluation must belong to a recorded installation.");
    const opened = instant(entry.startedAt);
    const closed = entry.terminalAt === null ? null : instant(entry.terminalAt);
    if (opened < instant(allRepositories.get(entry.repositoryId).installedAt) || opened > nowMs
      || (closed !== null && (closed < opened || closed > nowMs))
      || !["pass", "action_required", "error", "pending"].includes(entry.outcome)
      || (entry.outcome === "pending") !== (closed === null)
      || !["confirmed", "false_pass", "disputed_block", "unreviewed"].includes(entry.audit)
      || (entry.audit === "false_pass" && entry.outcome !== "pass")
      || (entry.audit === "disputed_block" && entry.outcome !== "action_required")
      || (entry.outcome === "pending" && entry.audit !== "unreviewed")
      || typeof entry.customerConfirmedValuable !== "boolean"
      || (entry.customerConfirmedValuable && entry.audit !== "confirmed")) {
      throw new TypeError("Evaluation evidence is inconsistent.");
    }
  }
  // Reliability includes a generation carried into the window, not just the
  // installation cohort. Otherwise a pre-window stuck Guard disappears.
  const observed = evaluations.filter((entry) => start !== null
    && instant(entry.startedAt) < end && instant(entry.startedAt) <= cutoff
    && (entry.terminalAt === null || instant(entry.terminalAt) >= start));
  const terminal = observed.filter((entry) => entry.terminalAt !== null && inWindow(instant(entry.terminalAt)));
  const passes = terminal.filter((entry) => entry.outcome === "pass");
  const blocks = terminal.filter((entry) => entry.outcome === "action_required");
  const falsePasses = passes.filter((entry) => entry.audit === "false_pass").length;
  const disputedBlocks = blocks.filter((entry) => entry.audit === "disputed_block").length;
  const maxGuardAgeMs = observed.length ? Math.max(...observed.map((entry) => (
    Math.min(entry.terminalAt === null ? cutoff : instant(entry.terminalAt), cutoff) - instant(entry.startedAt)
  ))) : null;
  const payments = collection(input.payments);
  const installedAccounts = new Set(installations.map((entry) => entry[ownerField]));
  for (const entry of payments) {
    record(entry, ["id", ownerField, "occurredAt", "netRevenueUsdCents", "evidenceId"]);
    if (!installedAccounts.has(entry[ownerField])) throw new TypeError("Payment must belong to an installed customer account.");
    if (instant(entry.occurredAt) > nowMs) throw new TypeError("Payment cannot be in the future.");
    amount(entry.netRevenueUsdCents);
  }
  const paid = payments.filter((entry) => inWindow(instant(entry.occurredAt)));
  const payingAccounts = new Set(paid.filter((entry) => entry.netRevenueUsdCents > 0).map((entry) => entry[ownerField]));
  const payingOrganizations = [...payingAccounts].filter((id) => accountTypes.get(id) === "Organization").length;
  const revenue = paid.reduce((sum, entry) => sum + entry.netRevenueUsdCents, 0);
  amount(revenue);
  const costs = collection(input.costs);
  for (const entry of costs) {
    record(entry, ["id", "occurredAt", "variableCostUsdCents", "evidenceId"]);
    if (instant(entry.occurredAt) > nowMs) throw new TypeError("Cost cannot be in the future.");
    amount(entry.variableCostUsdCents);
  }
  const cost = costs.filter((entry) => inWindow(instant(entry.occurredAt))).reduce((sum, entry) => sum + entry.variableCostUsdCents, 0);
  amount(cost);
  if (start === null && (accounts.length || installations.length || evaluations.length || payments.length || costs.length
    || coverage.evaluationsComplete || coverage.costsComplete)) {
    throw new TypeError("Recorded customer evidence requires an explicit launch window.");
  }
  const margin = revenue > 0 ? (revenue - cost) / revenue : null;
  const windowComplete = end !== null && nowMs >= end;
  const fullCoverage = windowComplete && through !== null && through >= end;
  const evaluationCoverage = fullCoverage && coverage.evaluationsComplete;
  const gate = (id, value, target, meets, known = true) => ({ id, value, target, state: !known || value === null ? "unknown" : meets ? "met" : "not_met" });
  const metrics = [
    gate("installations", cohort.length, ">= 5", cohort.length >= 5),
    gate("activations", activated.length, ">= 4", activated.length >= 4),
    gate("median_activation_ms", activationMedianMs, "< 600000", activationMedianMs < 600_000),
    gate("paying_organizations", payingOrganizations, ">= 2", payingOrganizations >= 2),
    gate("false_passes", falsePasses, "= 0", falsePasses === 0, falsePasses > 0 || (evaluationCoverage && passes.length > 0 && passes.every((entry) => entry.audit !== "unreviewed"))),
    gate("disputed_block_rate", blocks.length ? disputedBlocks / blocks.length : null, "< 0.02", disputedBlocks / blocks.length < 0.02, evaluationCoverage && blocks.every((entry) => entry.audit !== "unreviewed")),
    gate("max_guard_age_ms", maxGuardAgeMs, "<= 600000", maxGuardAgeMs <= 600_000, maxGuardAgeMs > 600_000 || evaluationCoverage),
    gate("valuable_decisions", terminal.filter((entry) => entry.customerConfirmedValuable).length, ">= 3", terminal.filter((entry) => entry.customerConfirmedValuable).length >= 3),
    gate("gross_margin", margin, ">= 0.8", margin >= 0.8, fullCoverage && coverage.costsComplete),
  ];
  // Only aggregate account cohorts leave the private ledger. Reliability and
  // margin above include both types; a personal-account incident cannot vanish.
  const cohorts = accountAware ? Object.fromEntries(["User", "Organization"].map((type) => {
    const belongs = (entry) => accountTypes.get(entry[ownerField]) === type;
    const installed = cohort.filter(belongs), active = activated.filter(belongs);
    return [type, {
      installations: installed.length,
      activations: active.length,
      medianActivationMs: median(active.map((entry) => instant(entry.firstProtectedPrAt) - instant(entry.installedAt))),
      payingAccounts: [...payingAccounts].filter((id) => accountTypes.get(id) === type).length,
      netRevenueUsdCents: paid.filter(belongs).reduce((sum, entry) => sum + entry.netRevenueUsdCents, 0),
    }];
  })) : null;
  return {
    schemaVersion: input.schemaVersion,
    type: "changeplane.launch-scorecard",
    evidenceClass: "operator_attested",
    state: start === null ? "not_started" : !windowComplete ? "collecting" : metrics.every((metric) => metric.state === "met") ? "met" : metrics.some((metric) => metric.state === "not_met") ? "not_met" : "evidence_required",
    window: { startedAt: input.startedAt, endsAt: end === null ? null : new Date(end).toISOString(), complete: windowComplete },
    coverage: { evaluations: evaluationCoverage, costs: fullCoverage && coverage.costsComplete },
    metrics,
    ...(accountAware ? { cohorts } : {}),
    authority: { authorizesLaunch: false, contributesToPass: false, acceptsPayment: false },
  };
}
