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
