import assert from "node:assert/strict";
import { constants, createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { rootCertificates } from "node:tls";
import { buildAssurancePassport, buildReceipt, digest, headCheckPayload, renderReceiptComment } from "../action/index.js";
import { buildSetupFiles, createGitHubHandler, seal } from "../api/github.js";
import { GuardPublicationError } from "../server/guard-publication-journal.js";

const SECRET = "serialization-test-session-secret-at-least-thirty-two-characters";
const RELEASE_SHA = "f".repeat(40);
const EPOCH = "b992d77a-39e4-4b85-a41c-3f13eb755b5b";
const APP_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const OIDC_KEYS = generateKeyPairSync("rsa", { modulusLength: 2048 });

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
    async json() { return structuredClone(body); }, async text() { return status >= 400 ? JSON.stringify(body) : ""; } };
}

function barrier() {
  let enter;
  let release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  return { entered, release, async pause() { enter(); await released; } };
}

async function entered(gate, pending) {
  await bounded(Promise.race([gate.entered, pending.done.then((result) => {
    throw new Error(`Expected an in-flight boundary, received ${result.statusCode}: ${result.body}`);
  })]));
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("A fixture request did not settle at the expected boundary")), 1500);
    })]);
  } finally { clearTimeout(timer); }
}

function journalError(code) {
  return new GuardPublicationError(code);
}

// This fake models only the handler's journal contract. The actual adapter and
// SQL concurrency/authority transitions are tested separately against PostgreSQL.
function journalFixture() {
  const lanes = new Map();
  const calls = [];
  return {
    lanes, calls, failClaim: false, failRelease: false, ackBarrier: null,
    key(scope) { return `${scope.repositoryId}:${scope.revisionFingerprint}`; },
    async withPublication(scope, callback) {
      calls.push(structuredClone(scope));
      if (this.failClaim) throw journalError("GUARD_PUBLICATION_UNAVAILABLE");
      const key = this.key(scope);
      if (lanes.has(key)) throw journalError(lanes.get(key) === "poisoned"
        ? "GUARD_PUBLICATION_UNCERTAIN" : "GUARD_PUBLICATION_BUSY");
      lanes.set(key, "reserved");
      let wrote = false;
      try {
        const result = await callback({ write: async (operation) => {
          lanes.set(key, "writing");
          wrote = true;
          const written = await operation();
          lanes.set(key, "written");
          return written;
        } });
        if (this.ackBarrier) await this.ackBarrier.pause();
        if (this.failRelease) throw journalError("GUARD_PUBLICATION_UNAVAILABLE");
        lanes.delete(key);
        return result;
      } catch (error) {
        if (wrote) {
          lanes.set(key, "poisoned");
          throw journalError("GUARD_PUBLICATION_UNCERTAIN");
        }
        lanes.delete(key);
        throw error;
      }
    },
  };
}

function targetFixture({ pullRequestNumber = 42, headSha = "b".repeat(40) } = {}) {
  const repository = "acme/payments";
  const repositoryId = 4242;
  const baseSha = "a".repeat(40);
  const files = new Map(buildSetupFiles({ name: "CI / verify", appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml" }, "verify").map(({ path, content }) => [path, content]));
  const policy = JSON.parse(files.get(".changeplane.json"));
  const plan = { goal: "Keep retries idempotent", scope: ["src/payments/**"] };
  const evidence = { name: "CI / verify", expectedSource: "github-actions", source: "github-actions",
    checkRunId: 808 + pullRequestNumber, publisherAppId: 15368, status: "COMPLETED", conclusion: "SUCCESS",
    completedAt: "2026-08-31T00:00:00Z" };
  const receipt = buildReceipt({ repository, repositoryId,
    pullRequest: { number: pullRequestNumber, base: { sha: baseSha }, head: { sha: headSha } }, plan,
    policyPath: ".changeplane.json", policyDigest: digest(policy),
    inputDigest: digest({ plan, files: [{ path: "src/payments/retry.js" }] }), contractDigest: digest(plan),
    approvalDigest: "e".repeat(64), result: { approval: { status: "MISSING" }, reasons: [] }, evidence: [evidence],
    autonomousPlan: { decision: "PASS", reason: "ALL_GUARANTEES_SATISFIED", humanRequired: false },
    mode: "enforce", actualFiles: [{ path: "src/payments/retry.js" }], maxAttempts: 2 });
  const summary = renderReceiptComment(receipt);
  const pullRequest = { number: pullRequestNumber, state: "open", merged: false,
    head: { sha: headSha, ref: `agent/retry-${pullRequestNumber}`, repo: { id: repositoryId, full_name: repository } },
    base: { sha: baseSha, ref: "main", repo: { id: repositoryId, full_name: repository } } };
  const evidenceCheck = { id: evidence.checkRunId, name: evidence.name, head_sha: headSha, status: "completed",
    conclusion: "success", app: { id: evidence.publisherAppId, slug: evidence.source },
    details_url: `https://github.com/${repository}/actions/runs/${7000 + pullRequestNumber}`,
    started_at: "2026-08-30T23:59:00Z", completed_at: evidence.completedAt };
  return { repository, repositoryId, baseSha, headSha, pullRequestNumber, files, pullRequest, evidenceCheck,
    receipt, summary, passport: buildAssurancePassport(receipt), checks: [] };
}

function oidc(runId, fixture, eventName = "pull_request_target") {
  const seconds = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "guard-journal-test" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "https://token.actions.githubusercontent.com",
    aud: "https://changeplane.vercel.app/guard-publisher/v1", exp: seconds + 300, nbf: seconds - 10, iat: seconds - 10,
    repository: fixture.repository, repository_id: String(fixture.repositoryId),
    workflow_ref: `${fixture.repository}/.github/workflows/changeplane.yml@refs/heads/main`, workflow_sha: fixture.baseSha,
    ref: "refs/heads/main", event_name: eventName, run_id: String(runId), run_attempt: "1",
    jti: `guard-journal-test-${runId}`, sha: fixture.baseSha, base_ref: "main" })).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), { key: OIDC_KEYS.privateKey,
    padding: constants.RSA_PKCS1_PADDING }).toString("base64url")}`;
}

async function withFixture(callback, { targets = [targetFixture()] } = {}) {
  const prefix = /^(?:GITHUB_|CHANGEPLANE_|VERCEL(?:_|$))/u;
  const saved = Object.fromEntries(Object.entries(process.env).filter(([name]) => prefix.test(name)));
  for (const name of Object.keys(saved)) delete process.env[name];
  Object.assign(process.env, {
    GITHUB_CLIENT_ID: "test-client", GITHUB_CLIENT_SECRET: "test-client-secret",
    GITHUB_APP_ID: "414141", GITHUB_APP_SLUG: "changeplane-installer-test",
    CHANGEPLANE_SESSION_SECRET: SECRET, CHANGEPLANE_APP_ORIGIN: "https://changeplane.example",
    CHANGEPLANE_GUARD_APP_ID: "424242", CHANGEPLANE_GUARD_APP_SLUG: "changeplane-test",
    CHANGEPLANE_GUARD_APP_PRIVATE_KEY: APP_KEY.export({ type: "pkcs8", format: "pem" }).toString(),
    CHANGEPLANE_CANARY_REPOSITORY: targets[0].repository,
    CHANGEPLANE_GUARD_JOURNAL_ENABLED: "true",
    CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL: "postgresql://guard_test:synthetic@journal.invalid/guard?sslmode=verify-full",
    CHANGEPLANE_GUARD_JOURNAL_EPOCH: EPOCH,
    CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE: RELEASE_SHA,
    VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_OWNER: "LeChiffreVol2", VERCEL_GIT_REPO_SLUG: "changeplane",
    VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: RELEASE_SHA,
  });
  const journal = journalFixture();
  const handler = createGitHubHandler({ guardJournal: journal });
  const calls = [];
  const writes = [];
  let nextCheckId = 900;
  const controls = { writeBarrier: null, writeFailure: false, invalidWriteResponse: false };
  const pendingRequests = new Set();
  const originalFetch = globalThis.fetch;
  const primary = targets[0];
  const repo = { id: primary.repositoryId, full_name: primary.repository, default_branch: "main",
    owner: { id: 77 }, permissions: { push: true, admin: true } };
  const treeSha = "c".repeat(40);
  const tree = [...primary.files].map(([path, content]) => ({ path, type: "blob", mode: "100644",
    sha: createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex") }));
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method ?? "GET";
    calls.push({ method, path: url.pathname, search: url.search });
    if (url.origin === "https://token.actions.githubusercontent.com") return response({ keys: [{
      ...OIDC_KEYS.publicKey.export({ format: "jwk" }), kid: "guard-journal-test", use: "sig", alg: "RS256", key_ops: ["verify"],
    }] });
    assert.equal(url.origin, "https://api.github.com", "the fixture never makes an external request");
    if (url.pathname.endsWith("/installation")) return response({ id: 7007, app_id: 424242,
      app_slug: "changeplane-test", account: { id: 77 } });
    if (url.pathname === "/app/installations/7007/access_tokens") {
      const requested = JSON.parse(options.body);
      return response({ token: "synthetic-guard-token", permissions: requested.permissions,
        expires_at: new Date(Date.now() + 3600000).toISOString(), repositories: [{ id: primary.repositoryId }] }, 201);
    }
    if (url.pathname === `/repos/${primary.repository}`) return response(repo);
    if (url.pathname === "/user/installations/6006/repositories") return response({ repositories: [repo] });
    if (url.pathname.endsWith("/git/ref/heads/main")) return response({ object: { sha: primary.baseSha } });
    const filePath = url.pathname.split("/contents/")[1];
    if (filePath && primary.files.has(filePath)) return response({ type: "file", encoding: "base64",
      content: Buffer.from(primary.files.get(filePath)).toString("base64") });
    if (url.pathname.endsWith(`/git/commits/${primary.baseSha}`)) return response({ tree: { sha: treeSha } });
    if (url.pathname.endsWith(`/git/trees/${treeSha}`)) return response({ truncated: false, tree });
    if (url.pathname === `/repos/${primary.repository}/pulls`) return response(targets.map((target) => target.pullRequest));
    const attemptMatch = url.pathname.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)$/u);
    if (attemptMatch) return response({ id: Number(attemptMatch[1]), run_attempt: Number(attemptMatch[2]),
      repository: repo, path: ".github/workflows/changeplane.yml", status: "completed", conclusion: "failure" });
    for (const target of targets) {
      if (url.pathname.endsWith(`/pulls/${target.pullRequestNumber}`)) return response(target.pullRequest);
      if (url.pathname.endsWith(`/commits/${target.headSha}/pulls`)) return response([target.pullRequest]);
      if (url.pathname.endsWith(`/check-runs/${target.evidenceCheck.id}`)) return response(target.evidenceCheck);
      if (url.pathname.endsWith(`/actions/runs/${7000 + target.pullRequestNumber}`)) return response({
        id: 7000 + target.pullRequestNumber, head_sha: target.headSha, path: ".github/workflows/ci.yml@refs/heads/main" });
      if (url.pathname.endsWith(`/commits/${target.headSha}/check-runs`)) {
        const checks = url.searchParams.get("check_name") === "CI / verify" ? [target.evidenceCheck] : target.checks;
        return response({ total_count: checks.length, check_runs: checks });
      }
    }
    const checkMatch = url.pathname.match(/\/check-runs\/(\d+)$/u);
    const existing = targets.flatMap((target) => target.checks).find((check) => check.id === Number(checkMatch?.[1]));
    if (checkMatch && method === "GET" && existing) return response(existing);
    if ((method === "POST" && url.pathname.endsWith("/check-runs")) || (method === "PATCH" && existing)) {
      const payload = JSON.parse(options.body);
      const target = targets.find((candidate) => candidate.headSha === (payload.head_sha ?? existing.head_sha));
      const fingerprint = createHash("sha256").update(`${target.repositoryId}\0${target.headSha}`).digest("hex");
      assert.equal(journal.lanes.get(`${target.repositoryId}:${fingerprint}`), "writing", "every Check write must be journal-owned");
      writes.push({ method, id: existing?.id, headSha: target.headSha, payload });
      if (controls.writeBarrier) await controls.writeBarrier.pause();
      if (controls.writeFailure) throw new Error("Synthetic ambiguous GitHub transport failure");
      const check = { ...existing, id: existing?.id ?? ++nextCheckId, ...payload,
        conclusion: payload.status === "in_progress" ? null : payload.conclusion,
        app: { id: 424242, slug: "changeplane-test" } };
      if (existing) target.checks[target.checks.indexOf(existing)] = check;
      else target.checks.push(check);
      const invalidResponse = typeof controls.invalidWriteResponse === "function"
        ? controls.invalidWriteResponse({ existing, payload }) : controls.invalidWriteResponse;
      return response(invalidResponse ? { ...check, id: -1 } : check, method === "POST" ? 201 : 200);
    }
    throw new Error(`Unexpected fixture request: ${method} ${url.pathname}${url.search}`);
  };
  function request(operation, runId = 8001, target = primary) {
    if (operation === "manual") {
      const session = seal({ kind: "session", token: "synthetic-admin-token", login: "owner", csrf: "test-csrf",
        authMode: "github_app", installationIds: ["6006"] }, SECRET);
      return { method: "POST", url: "/api/github?action=reconcile", headers: {
        origin: "https://changeplane.example", cookie: `__Host-changeplane_session=${session}`,
        "x-changeplane-csrf": "test-csrf", "content-type": "application/json",
      }, body: { repository: target.repository, checkRunId: target.checks[0].id } };
    }
    const type = operation === "begin" ? "changeplane.guard-publication-begin"
      : operation === "sweep" ? "changeplane.guard-reconciliation-sweep" : "changeplane.guard-publication-request";
    const body = { schemaVersion: 1, type, repository: target.repository, defaultBranch: "main", gitRef: "refs/heads/main",
      workflowRunId: runId, workflowRunAttempt: 1 };
    if (operation === "complete") Object.assign(body, { passport: target.passport, summary: target.summary });
    else Object.assign(body, { repositoryId: target.repositoryId, controllerSha: target.baseSha });
    if (operation === "begin") body.target = { type: "pull_request", pullRequestNumber: target.pullRequestNumber,
      baseSha: target.baseSha, headSha: target.headSha, baseRef: "main", headRef: target.pullRequest.head.ref };
    return { method: "POST", url: "/api/github?action=guard-publish", headers: {
      authorization: `Bearer ${oidc(runId, target, operation === "sweep" ? "schedule" : "pull_request_target")}`,
      "content-type": "application/json",
    }, body };
  }
  function start(operation, runId, target) {
    const res = { statusCode: 0, body: "", ended: false, setHeader() {}, end(value = "") { this.body = String(value); this.ended = true; } };
    const done = handler(request(operation, runId, target), res).then(() => res);
    pendingRequests.add(done);
    done.finally(() => pendingRequests.delete(done));
    return { res, done };
  }
  try { await callback({ primary, targets, journal, calls, writes, controls, start,
    async invoke(...args) { return bounded(start(...args).done); } }); }
  finally {
    controls.writeBarrier?.release();
    journal.ackBarrier?.release();
    await Promise.allSettled([...pendingRequests]);
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (prefix.test(name)) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

test("simultaneous first begins share a lane and create only one App Check", async () => {
  await withFixture(async ({ primary, controls, writes, journal, start, invoke }) => {
    const gate = barrier();
    controls.writeBarrier = gate;
    const first = start("begin", 8001);
    await entered(gate, first);
    try {
      const second = await invoke("begin", 8002);
      assert.equal(second.statusCode, 423, second.body);
      assert.equal(writes.length, 1);
      assert.equal(first.res.ended, false);
    } finally { controls.writeBarrier = null; gate.release(); }
    assert.equal((await first.done).statusCode, 200);
    assert.equal(primary.checks.length, 1);
    const next = await invoke("begin", 8002);
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(primary.checks.length, 1);
    assert.match(primary.checks[0].output.text, /run_id=8002/u);
    assert.equal(journal.lanes.size, 0);
  });
});

test("legacy same-head successes are retired inside the same publication lane", async () => {
  await withFixture(async ({ primary, controls, writes, start, invoke }) => {
    primary.checks.push({ id: 899, ...headCheckPayload(primary.receipt, primary.summary),
      external_id: "historical-guard-identity", app: { id: 424242, slug: "changeplane-test" } });
    const gate = barrier();
    controls.writeBarrier = gate;
    const beginning = start("begin", 8001);
    await entered(gate, beginning);
    try {
      assert.equal(writes[0].id, 899);
      assert.equal((await invoke("begin", 8002)).statusCode, 423);
    } finally { controls.writeBarrier = null; gate.release(); }
    const result = await beginning.done;
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(writes.map(({ method }) => method), ["PATCH", "POST"]);
    assert.equal(primary.checks.find(({ id }) => id === 899).conclusion, "action_required");
    assert.equal(primary.checks.filter(({ status }) => status === "in_progress").length, 1);
  });
});

test("a delayed old completion cannot cross a newer begin or either recovery route", async () => {
  await withFixture(async ({ primary, controls, writes, calls, start, invoke }) => {
    assert.equal((await invoke("begin")).statusCode, 200);
    primary.checks[0].started_at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const gate = barrier();
    controls.writeBarrier = gate;
    const older = start("complete", 8001);
    await entered(gate, older);
    try {
      const mutableReads = () => calls.filter(({ path }) => path.includes("/commits/") && path.endsWith("/check-runs")).length;
      const readsBeforeCompetitors = mutableReads();
      for (const [operation, runId] of [["begin", 8002], ["complete", 8001], ["sweep", 9100], ["manual", 9101]]) {
        const blocked = await invoke(operation, runId);
        assert.equal(blocked.statusCode, 423, `${operation}: ${blocked.body}`);
      }
      assert.equal(mutableReads(), readsBeforeCompetitors,
        "blocked requests must not read mutable Guard or evidence inventories outside journal ownership");
      assert.equal(writes.length, 2);
    } finally { controls.writeBarrier = null; gate.release(); }
    assert.equal((await older.done).statusCode, 200);
    assert.equal(primary.checks[0].conclusion, "success");
    assert.equal((await invoke("begin", 8002)).statusCode, 200);
    const replay = await invoke("complete", 8001);
    assert.equal(replay.statusCode, 409, replay.body);
    assert.equal(primary.checks[0].status, "in_progress");
    assert.equal(primary.checks[0].conclusion, null);
  });
});

test("reconciliation holds the same lane through its final GitHub write", async () => {
  for (const recovery of ["sweep", "manual"]) {
    await withFixture(async ({ primary, controls, start, invoke }) => {
      assert.equal((await invoke("begin")).statusCode, 200);
      primary.checks[0].started_at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const gate = barrier();
      controls.writeBarrier = gate;
      const recovering = start(recovery, 9100);
      await entered(gate, recovering);
      try {
        assert.equal((await invoke("complete", 8001)).statusCode, 423);
        assert.equal((await invoke(recovery === "sweep" ? "manual" : "sweep", 9101)).statusCode, 423);
      } finally { controls.writeBarrier = null; gate.release(); }
      assert.equal((await recovering.done).statusCode, 200);
      assert.equal(primary.checks[0].conclusion, "action_required");
      const completed = await invoke("complete", 8001);
      assert.equal(completed.statusCode, 409, completed.body);
    });
  }
});

test("journal acquisition failure and crash residue prevent all Guard mutation", async () => {
  await withFixture(async ({ primary, journal, writes, calls, invoke }) => {
    journal.failClaim = true;
    const unavailable = await invoke("begin");
    assert.equal(unavailable.statusCode, 503, unavailable.body);
    assert.equal(writes.length, 0);
    assert.equal(calls.some(({ path }) => path.includes("/contents/")), false);
    journal.failClaim = false;
    const fingerprint = createHash("sha256").update(`${primary.repositoryId}\0${primary.headSha}`).digest("hex");
    journal.lanes.set(`${primary.repositoryId}:${fingerprint}`, "writing");
    const afterCrash = await invoke("begin", 8002);
    assert.equal(afterCrash.statusCode, 423, afterCrash.body);
    assert.equal(writes.length, 0);
  });
});

test("ambiguous writes and invalid GitHub acknowledgments poison the lane", async () => {
  for (const fault of ["writeFailure", "invalidWriteResponse"]) {
    await withFixture(async ({ journal, controls, writes, invoke }) => {
      controls[fault] = true;
      const failed = await invoke("begin");
      assert.equal(failed.statusCode, 503, failed.body);
      assert.deepEqual([...journal.lanes.values()], ["poisoned"]);
      controls[fault] = false;
      const replay = await invoke("begin", 8002);
      assert.equal(replay.statusCode, 503, replay.body);
      assert.equal(writes.length, 1);
    });
  }
});

test("an invalid legacy-retirement acknowledgment prevents canonical publication", async () => {
  await withFixture(async ({ primary, journal, controls, writes, invoke }) => {
    primary.checks.push({ id: 899, ...headCheckPayload(primary.receipt, primary.summary),
      external_id: "historical-guard-identity", app: { id: 424242, slug: "changeplane-test" } });
    controls.invalidWriteResponse = ({ existing }) => existing?.id === 899;
    const result = await invoke("begin");
    assert.equal(result.statusCode, 503, result.body);
    assert.deepEqual([...journal.lanes.values()], ["poisoned"]);
    assert.deepEqual(writes.map(({ id }) => id), [899]);
  });
});

test("the HTTP response waits for journal acknowledgment and fails closed if it is uncertain", async () => {
  await withFixture(async ({ journal, start }) => {
    const gate = barrier();
    journal.ackBarrier = gate;
    journal.failRelease = true;
    const publishing = start("begin");
    await entered(gate, publishing);
    assert.equal(publishing.res.ended, false, "a GitHub response is not yet a durable journal acknowledgment");
    gate.release();
    const result = await publishing.done;
    assert.equal(result.statusCode, 503, result.body);
    assert.deepEqual([...journal.lanes.values()], ["poisoned"]);
  });
});

test("different exact heads use independent lanes without sharing Check authority", async () => {
  const targets = [targetFixture(), targetFixture({ pullRequestNumber: 43, headSha: "d".repeat(40) })];
  await withFixture(async ({ controls, primary, journal, start, invoke }) => {
    const gate = barrier();
    controls.writeBarrier = gate;
    const first = start("begin", 8001, primary);
    await entered(gate, first);
    controls.writeBarrier = null;
    try {
      const independent = await invoke("begin", 8002, targets[1]);
      assert.equal(independent.statusCode, 200, independent.body);
      assert.notEqual(journal.calls[0].revisionFingerprint, journal.calls[1].revisionFingerprint);
    } finally { gate.release(); }
    assert.equal((await first.done).statusCode, 200);
    assert.equal(targets[0].checks.length, 1);
    assert.equal(targets[1].checks.length, 1);
  }, { targets });
});

test("injected journals cannot bypass Production provenance, configuration or customer activation gates", async () => {
  for (const change of [
    () => { process.env.VERCEL_ENV = "preview"; },
    () => { delete process.env.CHANGEPLANE_GUARD_JOURNAL_ENABLED; },
    () => { process.env.CHANGEPLANE_GUARD_JOURNAL_ENABLED = "false"; },
    () => { delete process.env.CHANGEPLANE_GUARD_JOURNAL_EPOCH; },
    () => { process.env.CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE = "e".repeat(40); },
    () => { process.env.GITHUB_APP_ID = process.env.CHANGEPLANE_GUARD_APP_ID; },
    () => {
      process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON = '["acme/payments"]';
      process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED = "true";
      process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE = RELEASE_SHA;
    },
  ]) {
    await withFixture(async ({ journal, writes, invoke }) => {
      change();
      const denied = await invoke("begin");
      assert.equal(denied.statusCode, 503, denied.body);
      assert.equal(journal.calls.length, 0);
      assert.equal(writes.length, 0);
    });
  }
});

test("journal configuration rejects ambiguous TLS modes and PostgreSQL endpoint or file overrides", async () => {
  const base = "postgresql://guard_test:synthetic@journal.invalid/guard";
  for (const connectionString of [
    `${base}?sslmode=verify-full&sslmode=disable`,
    `${base}?sslmode=verify-full&sslmode=no-verify`,
    `${base}?sslmode=verify-full&host=%2Ftmp`,
    `${base}?sslmode=verify-full&sslrootcert=%2Ftmp%2Fauthority-ca.pem`,
    `${base}?sslmode=verify-full#ignored-fragment`,
    "postgresql://guard_test:synthetic@%2Ftmp/guard?sslmode=verify-full",
    "postgresql://guard_test:synthetic@%6Aournal.invalid/guard?sslmode=verify-full",
    `${base}?sslmode=require`,
    base,
  ]) {
    await withFixture(async ({ journal, calls, writes, invoke }) => {
      process.env.CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL = connectionString;
      const denied = await invoke("begin");
      assert.equal(denied.statusCode, 503, denied.body);
      assert.equal(journal.calls.length, 0);
      assert.equal(calls.length, 0, "invalid connection configuration must be rejected before external access");
      assert.equal(writes.length, 0);
      assert.equal(denied.body.includes("synthetic"), false);
      assert.equal(denied.body.includes("journal.invalid"), false);
    });
  }
});

test("journal CA is validated before external access and never appears in a response", async () => {
  for (const caCertificate of ["", "not-a-certificate", "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----"]) {
    await withFixture(async ({ calls, journal, invoke }) => {
      process.env.CHANGEPLANE_GUARD_JOURNAL_CA_CERT = caCertificate;
      const denied = await invoke("begin");
      assert.equal(denied.statusCode, 503);
      assert.equal(journal.calls.length, 0);
      assert.equal(calls.length, 0);
      assert.equal(denied.body.includes("CERTIFICATE"), false);
    });
  }
  await withFixture(async ({ journal, invoke }) => {
    process.env.CHANGEPLANE_GUARD_JOURNAL_CA_CERT = rootCertificates[0];
    const accepted = await invoke("begin");
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.ok(journal.calls.length > 0);
    assert.equal(accepted.body.includes("CERTIFICATE"), false);
  });
});
