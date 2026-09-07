import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresPilotAdmission, PilotAdmissionError } from "./pilot-admission.js";

const scope = { tenantId: 10, repositoryId: 20, installationId: 30, guardAppId: 40,
  revisionFingerprint: "a".repeat(64), evaluationGeneration: "8100.3",
  workflowStartedAt: "2026-09-07T00:00:00.000Z", capability: "verify", targetType: "pull_request" };
const receipt = { admitted: true, duplicate: false, reason: "admitted", period: "2026-09",
  evaluations: 1, included: 10, graceRemaining: 1, admittedAt: "2026-09-07T00:01:00.000Z" };
const duplicate = { ...receipt, duplicate: true, reason: "already_admitted" };
const isCode = (code) => (error) => error instanceof PilotAdmissionError && error.code === code;

function fixture({ result = receipt, failCommit = false, readResult = duplicate } = {}) {
  const calls = [];
  let commits = 0;
  const store = createPostgresPilotAdmission({ pool: { async connect() {
    return { async query(query, values) {
      calls.push({ query, values });
      if (query === "commit" && failCommit && commits++ === 0) throw new Error("postgres://secret@internal");
      if (!values) return { rows: [] };
      return { rows: [{ result: values[9] === "read" ? readResult : result }] };
    }, release() {} };
  } } });
  return { store, calls };
}

test("admission validates scope, uses authenticated workflow time, and commits before returning", async () => {
  const f = fixture();
  assert.deepEqual(await f.store.admitEvaluation(scope), receipt);
  const call = f.calls.find((item) => item.values);
  assert.deepEqual(call.values, [10, 20, 30, 40, scope.revisionFingerprint, "8100.3", scope.workflowStartedAt, "verify", "pull_request", "admit"]);
  assert.match(f.calls[1].query, /synchronous_commit = on.*lock_timeout = '2s'.*statement_timeout = '5s'/u);
  assert.equal(f.calls.at(-1).query, "commit");
});

test("unknown commit acknowledgment performs one receipt read and never repeats admission", async () => {
  const f = fixture({ failCommit: true });
  assert.deepEqual(await f.store.admitEvaluation(scope), duplicate);
  assert.deepEqual(f.calls.filter((call) => call.values).map((call) => call.values[9]), ["admit", "read"]);
  const absent = fixture({ failCommit: true, readResult: null });
  await assert.rejects(absent.store.admitEvaluation(scope), isCode("PILOT_ADMISSION_UNAVAILABLE"));
  assert.deepEqual(absent.calls.filter((call) => call.values).map((call) => call.values[9]), ["admit", "read"]);
});

test("denial is explicit and readAdmission accepts only a complete receipt or null", async () => {
  const denied = { ...receipt, admitted: false, reason: "quota_exhausted", admittedAt: null };
  assert.deepEqual(await fixture({ result: denied }).store.admitEvaluation(scope), denied);
  assert.equal(await fixture({ readResult: null }).store.readAdmission(scope), null);
  assert.deepEqual(await fixture().store.readAdmission(scope), duplicate);
  await assert.rejects(fixture({ readResult: denied }).store.readAdmission(scope), isCode("PILOT_ADMISSION_UNAVAILABLE"));
});

test("malformed inputs and immutable binding conflicts fail with redacted authority errors", async () => {
  const f = fixture();
  for (const invalid of [{ ...scope, tenantId: "10" }, { ...scope, workflowStartedAt: "2026-09-07T00:00:00Z" },
    { ...scope, workflowStartedAt: "2026-02-30T00:00:00.000Z" }, { ...scope, occurredAt: "caller time" },
    { ...scope, evaluationGeneration: "1.0" }]) {
    await assert.rejects(f.store.admitEvaluation(invalid), isCode("PILOT_ADMISSION_AUTHORITY"));
  }
  assert.equal(f.calls.length, 0);
  await assert.rejects(fixture({ result: { error: "authority" } }).store.admitEvaluation(scope), isCode("PILOT_ADMISSION_AUTHORITY"));
});

test("malformed database success and secret-bearing errors never become admission proof", async () => {
  for (const result of [{ ...receipt, admittedAt: null }, { ...receipt, period: "2026-08" },
    { ...receipt, reason: "PASS" }, { ...receipt, token: "secret" }]) {
    await assert.rejects(fixture({ result }).store.admitEvaluation(scope), isCode("PILOT_ADMISSION_UNAVAILABLE"));
  }
  const store = createPostgresPilotAdmission({ pool: { async connect() { throw new Error("postgres://secret@private-repository"); } } });
  await assert.rejects(store.admitEvaluation(scope), (error) => {
    assert.equal(error.code, "PILOT_ADMISSION_UNAVAILABLE");
    assert.equal(`${error.message}${JSON.stringify(error)}`.includes("secret"), false); return true;
  });
});

test("readUsage binds tenant and UTC period and rejects caller-controlled accounting fields", async () => {
  const usage = { tenantId: 10, period: "2026-09", evaluations: 4 };
  assert.deepEqual(await fixture({ result: usage }).store.readUsage({ tenantId: 10, period: "2026-09" }), usage);
  await assert.rejects(fixture({ result: { ...usage, tenantId: 99 } }).store.readUsage({ tenantId: 10, period: "2026-09" }), isCode("PILOT_ADMISSION_UNAVAILABLE"));
  await assert.rejects(fixture().store.readUsage({ tenantId: 10, period: "2026-09", evaluations: 0 }), isCode("PILOT_ADMISSION_AUTHORITY"));
});
