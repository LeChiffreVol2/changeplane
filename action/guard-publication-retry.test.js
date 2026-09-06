import assert from "node:assert/strict";
import test from "node:test";
import { beginDedicatedGuard, buildAssurancePassport, publishDedicatedGuard, requestGuardReconciliationSweep } from "./index.js";

const target = { type: "pull_request", pullRequestNumber: 42, baseSha: "a".repeat(40),
  headSha: "b".repeat(40), baseRef: "main", headRef: "agent/change" };
const passport = buildAssurancePassport({
  repository: "acme/payments", repositoryId: 4242, pullRequestNumber: 42,
  baseSha: target.baseSha, headSha: target.headSha, inputDigest: "c".repeat(64),
  boundContractDigest: "d".repeat(64), approvalDigest: "f".repeat(64),
  policy: { path: ".changeplane.json", digest: "e".repeat(64), sourceRevision: target.baseSha },
  evaluatorVersion: "0.4.0", mode: "enforce", decision: "PASS", reason: "ALL_GUARANTEES_SATISFIED",
  evidence: [{ name: "CI / verify", expectedSource: "github-actions", source: "github-actions",
    checkRunId: 808, publisherAppId: 15368, status: "COMPLETED", conclusion: "SUCCESS",
    completedAt: "2026-08-20T00:01:00Z" }],
});
const beginProof = { schemaVersion: 1, type: "changeplane.guard-publication-begin",
  check: { id: 1001, name: "ChangePlane / guard", headSha: target.headSha, status: "in_progress",
    publisherAppId: 424242, publisherAppSlug: "changeplane" },
  run: { id: 8100, attempt: 3 }, previousContractDigest: null };
const completeProof = { schemaVersion: 1, type: "changeplane.guard-publication", passportDigest: passport.digest,
  check: { id: 1001, name: "ChangePlane / guard", headSha: target.headSha, conclusion: "success",
    publisherAppId: 424242, publisherAppSlug: "changeplane" } };
const busyBody = { code: "GUARD_PUBLICATION_BUSY", error: "Another evaluation holds this revision.", requestId: "request-12345678" };
const response = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: new Headers({ "content-type": "application/json; charset=utf-8", ...headers }),
  async json() { return body; } });
const busy = () => response(423, busyBody, { "retry-after": "1" });
const configuredContexts = new WeakSet();

function fixture(t, kind, nextResponse, { waitOvershoot = 0 } = {}) {
  const env = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/oidc/token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-oidc-request-token-long-enough", GITHUB_RUN_ID: "8100",
    GITHUB_RUN_ATTEMPT: "3", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "schedule" };
  if (!configuredContexts.has(t)) {
    configuredContexts.add(t);
    const prior = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    Object.assign(process.env, env);
    t.after(() => { for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    } });
  }
  let elapsed = 0;
  let oidcRequests = 0;
  const requests = [];
  const waits = [];
  const fetchImpl = async (input, options) => {
    if (new URL(String(input)).hostname.endsWith(".actions.githubusercontent.com")) {
      oidcRequests++; return response(200, { value: "o".repeat(120) });
    }
    requests.push({ url: String(input), ...structuredClone(options) });
    return nextResponse(requests.length, { advance(milliseconds) { elapsed += milliseconds; } });
  };
  const common = { repository: "acme/payments", defaultBranch: "main", fetchImpl,
    sleepImpl: async (milliseconds) => { waits.push(milliseconds); elapsed += milliseconds + waitOvershoot; },
    nowImpl: () => elapsed };
  return { requests, waits, get oidcRequests() { return oidcRequests; },
    run: () => kind === "begin"
      ? beginDedicatedGuard({ ...common, repositoryId: 4242, controllerSha: target.baseSha, target })
      : kind === "complete"
        ? publishDedicatedGuard({ ...common, passport, summary: "trusted summary" })
        : requestGuardReconciliationSweep({ ...common, repositoryId: 4242, controllerSha: target.baseSha }) };
}

for (const kind of ["begin", "complete"]) {
  const proof = kind === "begin" ? beginProof : completeProof;
  test(`${kind}: definite contention retries exact request and returns only validated acknowledgment`, async (t) => {
    const f = fixture(t, kind, (attempt) => attempt === 1 ? busy() : response(200, proof));
    const result = await f.run();
    assert.equal(kind === "begin" ? result.check.status : result.conclusion, kind === "begin" ? "in_progress" : "success");
    assert.equal(f.requests.length, 2);
    assert.equal(f.oidcRequests, 1);
    assert.deepEqual(f.waits, [1000]);
    assert.deepEqual(f.requests[0], f.requests[1]);
    assert.equal(JSON.parse(f.requests[1].body).workflowRunAttempt, 3);
  });

  test(`${kind}: persistent contention stops after three requests and two seconds of waiting`, async (t) => {
    const f = fixture(t, kind, busy);
    await assert.rejects(f.run(), /failed \(423\)/u);
    assert.equal(f.requests.length, 3);
    assert.deepEqual(f.waits, [1000, 1000]);
  });

  test(`${kind}: BUSY never resolves as successful publication before the retried response`, async (t) => {
    let deliver;
    let requested;
    const waiting = new Promise((resolve) => { requested = resolve; });
    const pending = new Promise((resolve) => { deliver = resolve; });
    const f = fixture(t, kind, (attempt) => {
      if (attempt === 1) return busy();
      requested(); return pending;
    });
    let settled = false;
    const result = f.run().finally(() => { settled = true; });
    await waiting;
    assert.equal(settled, false);
    deliver(response(200, proof));
    await result;
    assert.equal(settled, true);
  });

  test(`${kind}: elapsed response time and scheduler delay cannot extend the retry window`, async (t) => {
    const f = fixture(t, kind, (_attempt, clock) => { clock.advance(1500); return busy(); });
    await assert.rejects(f.run(), /failed \(423\)/u);
    assert.equal(f.requests.length, 1); assert.deepEqual(f.waits, []);
    const delayed = fixture(t, kind, busy, { waitOvershoot: 1500 });
    await assert.rejects(delayed.run(), /failed \(423\)/u);
    assert.equal(delayed.requests.length, 1); assert.deepEqual(delayed.waits, [1000]);
  });

  test(`${kind}: transport failures, 5xx, stale heads and malformed contention never retry`, async (t) => {
    const cases = [
      () => { throw new Error("unknown transport outcome"); },
      () => response(503, busyBody, { "retry-after": "1" }),
      () => response(409, busyBody, { "retry-after": "1" }),
      () => response(423, { ...busyBody, code: "GUARD_PUBLICATION_UNCERTAIN" }, { "retry-after": "1" }),
      () => response(423, { code: "GUARD_PUBLICATION_BUSY" }, { "retry-after": "1" }),
      () => response(423, { ...busyBody, requestId: "bad" }, { "retry-after": "1" }),
      () => response(423, { ...busyBody, check: completeProof.check }, { "retry-after": "1" }),
      () => response(423, busyBody),
      () => response(423, busyBody, { "retry-after": "0" }),
      () => response(423, busyBody, { "retry-after": "60" }),
      () => response(423, busyBody, { "retry-after": "1", "content-type": "text/html" }),
      () => ({ ...busy(), async json() { throw new SyntaxError("invalid JSON"); } }),
    ];
    for (const next of cases) {
      const f = fixture(t, kind, next);
      await assert.rejects(f.run());
      assert.equal(f.requests.length, 1); assert.deepEqual(f.waits, []);
    }
  });

  test(`${kind}: a stale or ambiguous response after one BUSY stops without a third request`, async (t) => {
    for (const outcome of [409, 503, "transport"]) {
      const f = fixture(t, kind, (attempt) => {
        if (attempt === 1) return busy();
        if (outcome === "transport") throw new Error("response lost");
        return response(outcome, busyBody, { "retry-after": "1" });
      });
      await assert.rejects(f.run());
      assert.equal(f.requests.length, 2); assert.deepEqual(f.waits, [1000]);
    }
  });

  test(`${kind}: contention retry never relaxes exact-head and publisher proof checks`, async (t) => {
    for (const check of [{ ...proof.check, headSha: "f".repeat(40) },
      { ...proof.check, publisherAppSlug: "github-actions" }]) {
      const f = fixture(t, kind, (attempt) => attempt === 1 ? busy() : response(200, { ...proof, check }));
      await assert.rejects(f.run(), /invalid (?:begin )?proof/u);
      assert.equal(f.requests.length, 2);
    }
  });
}

test("reconciliation sweep never retries BUSY because earlier heads may already have changed", async (t) => {
  const f = fixture(t, "sweep", busy);
  await assert.rejects(f.run(), /reconciliation failed \(423\)/u);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.waits, []);
});
