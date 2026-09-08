import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildLaunchScorecard } from "./launch-scorecard.js";

const START = "2026-08-01T00:00:00.000Z";
const END = "2026-08-31T00:00:00.000Z";
const options = { now: new Date(END) };
const evidence = () => ({ id: randomUUID(), evidenceId: randomUUID() });
const metric = (report, id) => report.metrics.find((entry) => entry.id === id);

function complete() {
  const organizations = [randomUUID(), randomUUID()];
  const installations = Array.from({ length: 5 }, (_, i) => ({
    ...evidence(), organizationId: organizations[i % 2], installedAt: START, firstProtectedPrAt: "2026-08-01T00:05:00.000Z",
  }));
  return {
    schemaVersion: 1, startedAt: START,
    coverage: { through: END, evaluationsComplete: true, costsComplete: true, evidenceId: randomUUID() },
    installations,
    evaluations: Array.from({ length: 6 }, (_, i) => ({
      ...evidence(), repositoryId: installations[i % 5].id,
      startedAt: "2026-08-01T00:04:00.000Z", terminalAt: "2026-08-01T00:05:00.000Z",
      outcome: i % 2 ? "pass" : "action_required", audit: "confirmed", customerConfirmedValuable: i % 2 === 0,
    })),
    payments: organizations.map((organizationId) => ({ ...evidence(), organizationId, occurredAt: "2026-08-05T00:00:00.000Z", netRevenueUsdCents: 9900 })),
    costs: [{ ...evidence(), occurredAt: "2026-08-20T00:00:00.000Z", variableCostUsdCents: 3960 }],
  };
}

test("a complete operator-attested window measures the gate without authorizing launch", () => {
  const report = buildLaunchScorecard(complete(), options);
  assert.equal(report.state, "met");
  assert.equal(metric(report, "gross_margin").value, 0.8);
  assert.equal(metric(report, "median_activation_ms").value, 300_000);
  assert.equal(report.evidenceClass, "operator_attested");
  assert.deepEqual(report.authority, { authorizesLaunch: false, contributesToPass: false, acceptsPayment: false });
  assert.equal(JSON.stringify(report).includes("organizationId"), false);
});

test("empty evidence is not started and no observation is never zero-incident proof", () => {
  const input = complete();
  input.startedAt = null;
  input.coverage = { through: null, evaluationsComplete: false, costsComplete: false, evidenceId: null };
  for (const key of ["installations", "evaluations", "payments", "costs"]) input[key] = [];
  const report = buildLaunchScorecard(input, options);
  assert.equal(report.state, "not_started");
  for (const id of ["false_passes", "disputed_block_rate", "max_guard_age_ms", "gross_margin"]) assert.equal(metric(report, id).state, "unknown");
});

test("missing coverage, missing audit and an incomplete 30-day window cannot meet the gate", () => {
  const input = complete();
  input.coverage.evaluationsComplete = false;
  input.coverage.costsComplete = false;
  let report = buildLaunchScorecard(input, options);
  assert.equal(report.state, "evidence_required");
  assert.equal(metric(report, "false_passes").state, "unknown");
  assert.equal(metric(report, "gross_margin").state, "unknown");
  const unreviewed = complete();
  unreviewed.evaluations[1].audit = "unreviewed";
  assert.equal(metric(buildLaunchScorecard(unreviewed, options), "false_passes").state, "unknown");
  input.coverage.through = "2026-08-30T00:00:00.000Z";
  report = buildLaunchScorecard(input, { now: new Date(input.coverage.through) });
  assert.equal(report.state, "collecting");
});

test("false PASS, disputed blocks and open stuck Guards cannot disappear from the report", () => {
  const input = complete();
  input.evaluations[1].audit = "false_pass";
  input.evaluations[0].audit = "disputed_block";
  input.evaluations[0].customerConfirmedValuable = false;
  input.evaluations.push({ ...evidence(), repositoryId: input.installations[0].id, startedAt: "2026-08-30T23:40:00.000Z", terminalAt: null, outcome: "pending", audit: "unreviewed", customerConfirmedValuable: false });
  const report = buildLaunchScorecard(input, options);
  assert.equal(report.state, "not_met");
  assert.equal(metric(report, "false_passes").value, 1);
  assert.equal(metric(report, "disputed_block_rate").value, 1 / 3);
  assert.equal(metric(report, "max_guard_age_ms").value, 1_200_000);
});

test("a terminal event after the window still counts as an open Guard at cutoff", () => {
  const input = complete();
  input.evaluations.push({ ...evidence(), repositoryId: input.installations[0].id, startedAt: "2026-08-30T23:40:00.000Z", terminalAt: "2026-08-31T00:10:00.000Z", outcome: "pass", audit: "confirmed", customerConfirmedValuable: false });
  const report = buildLaunchScorecard(input, { now: new Date("2026-09-01T00:00:00.000Z") });
  assert.equal(metric(report, "max_guard_age_ms").value, 1_200_000);
});

test("payments count distinct organizations and fully refunded payments do not count", () => {
  const input = complete();
  input.payments[1].netRevenueUsdCents = 0;
  input.payments.push({ ...input.payments[0], ...evidence() });
  assert.equal(metric(buildLaunchScorecard(input, options), "paying_organizations").value, 1);
});

test("pre-window stuck Guards and false PASS inside the window remain visible", () => {
  const input = complete();
  const repository = { ...evidence(), organizationId: input.installations[0].organizationId, installedAt: "2026-07-30T00:00:00.000Z", firstProtectedPrAt: null };
  input.installations.push(repository);
  input.evaluations.push({ ...evidence(), repositoryId: repository.id, startedAt: "2026-07-31T23:55:00.000Z", terminalAt: null, outcome: "pending", audit: "unreviewed", customerConfirmedValuable: false });
  input.evaluations.push({ ...evidence(), repositoryId: repository.id, startedAt: "2026-07-31T23:59:00.000Z", terminalAt: "2026-08-01T00:01:00.000Z", outcome: "pass", audit: "false_pass", customerConfirmedValuable: false });
  const report = buildLaunchScorecard(input, options);
  assert.equal(report.state, "not_met");
  assert.equal(metric(report, "installations").value, 5);
  assert.equal(metric(report, "false_passes").value, 1);
  assert.ok(metric(report, "max_guard_age_ms").value > 30 * 86_400_000);
});

test("malformed, duplicate, unbound, private-field and future evidence is rejected", () => {
  for (const mutate of [
    (input) => { input.installations[0].repositoryName = "private"; },
    (input) => { input.evaluations.push(input.evaluations[0]); },
    (input) => { input.evaluations[0].repositoryId = randomUUID(); },
    (input) => { input.evaluations[0].terminalAt = "2026-09-02T00:00:00.000Z"; },
    (input) => { input.evaluations[0].audit = "false_pass"; },
    (input) => { input.coverage.evidenceId = null; },
    (input) => { input.payments[0].netRevenueUsdCents = -1; },
    (input) => { input.startedAt = "2026-08-01"; },
    (input) => { input.startedAt = null; input.coverage.through = null; },
  ]) {
    const input = complete();
    mutate(input);
    assert.throws(() => buildLaunchScorecard(input, options), TypeError);
  }
});

function accountAware() {
  const input = complete();
  input.schemaVersion = 2;
  input.accounts = [...new Set(input.installations.map((entry) => entry.organizationId))]
    .map((id) => ({ id, type: "Organization", evidenceId: randomUUID() }));
  for (const entry of [...input.installations, ...input.payments]) {
    entry.accountId = entry.organizationId;
    delete entry.organizationId;
  }
  return input;
}

test("account-aware evidence measures both customer types without counting a personal payment as an organization", () => {
  const input = accountAware();
  input.accounts[0].type = "User";
  input.payments.push({ ...input.payments[0], ...evidence(), netRevenueUsdCents: 5000 });
  const report = buildLaunchScorecard(input, options);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.state, "not_met");
  assert.equal(metric(report, "installations").value, 5);
  assert.equal(metric(report, "activations").value, 5);
  assert.equal(metric(report, "paying_organizations").value, 1);
  assert.deepEqual(report.cohorts, {
    User: { installations: 3, activations: 3, medianActivationMs: 300_000, payingAccounts: 1, netRevenueUsdCents: 14900 },
    Organization: { installations: 2, activations: 2, medianActivationMs: 300_000, payingAccounts: 1, netRevenueUsdCents: 9900 },
  });
  assert.equal(metric(report, "gross_margin").value, (24800 - 3960) / 24800);
  for (const entry of [...input.accounts, ...input.installations, ...input.payments]) {
    assert.equal(JSON.stringify(report).includes(entry.id), false);
    assert.equal(JSON.stringify(report).includes(entry.evidenceId), false);
  }
  assert.deepEqual(report.authority, { authorizesLaunch: false, contributesToPass: false, acceptsPayment: false });
});

test("individual incidents and pre-window stuck Guards remain in the product reliability gate", () => {
  const input = accountAware();
  input.accounts[0].type = "User";
  input.evaluations[0].outcome = "pass";
  input.evaluations[0].audit = "false_pass";
  input.evaluations[0].customerConfirmedValuable = false;
  const repo = { ...evidence(), accountId: input.accounts[0].id, installedAt: "2026-07-30T00:00:00.000Z", firstProtectedPrAt: null };
  input.installations.push(repo);
  input.evaluations.push({ ...evidence(), repositoryId: repo.id, startedAt: "2026-07-31T23:55:00.000Z", terminalAt: null, outcome: "pending", audit: "unreviewed", customerConfirmedValuable: false });
  const report = buildLaunchScorecard(input, options);
  assert.equal(metric(report, "false_passes").value, 1);
  assert.equal(metric(report, "false_passes").state, "not_met");
  assert.ok(metric(report, "max_guard_age_ms").value > 30 * 86_400_000);
  assert.equal(report.cohorts.User.installations, 3);
});

test("legacy organization ledgers retain their values and fully refunded personal payments do not count", () => {
  const old = complete();
  const next = { ...old, schemaVersion: 2, accounts: [...new Set(old.installations.map((e) => e.organizationId))]
    .map((id) => ({ id, type: "Organization", evidenceId: randomUUID() })),
    installations: old.installations.map(({ organizationId, ...entry }) => ({ ...entry, accountId: organizationId })),
    payments: old.payments.map(({ organizationId, ...entry }) => ({ ...entry, accountId: organizationId })),
  };
  assert.deepEqual(buildLaunchScorecard(next, options).metrics, buildLaunchScorecard(old, options).metrics);
  assert.equal(buildLaunchScorecard(old, options).schemaVersion, 1);
  assert.equal("cohorts" in buildLaunchScorecard(old, options), false);
  next.accounts[0].type = "User";
  next.payments[0].netRevenueUsdCents = 0;
  const report = buildLaunchScorecard(next, options);
  assert.equal(report.cohorts.User.payingAccounts, 0);
  assert.equal(report.cohorts.User.netRevenueUsdCents, 0);
  assert.equal(metric(report, "paying_organizations").value, 1);
});

test("account-aware ledgers reject unbound, ambiguous and private identity data", () => {
  for (const mutate of [
    (input) => { delete input.accounts; },
    (input) => { input.accounts.push({ ...input.accounts[0], type: "User" }); },
    (input) => { input.accounts[0].type = "Business"; },
    (input) => { input.accounts[0].name = "private"; },
    (input) => { input.accounts[0].evidenceId = null; },
    (input) => { input.installations[0].accountId = randomUUID(); },
    (input) => { input.installations[0].organizationId = input.installations[0].accountId; },
    (input) => { input.payments[0].accountId = randomUUID(); },
    (input) => { const account = { ...evidence(), type: "User" }; input.accounts.push(account); input.payments[0].accountId = account.id; },
  ]) {
    const input = accountAware(); mutate(input);
    assert.throws(() => buildLaunchScorecard(input, options), TypeError);
  }
});
