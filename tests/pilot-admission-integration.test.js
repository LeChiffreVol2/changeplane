import assert from "node:assert/strict";
import { constants, createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildAssurancePassport, buildReceipt, digest, headCheckPayload, renderReceiptComment } from "../action/index.js";
import { buildSetupFiles, createGitHubHandler, seal } from "../api/github.js";
import { GuardPublicationError } from "../server/guard-publication-journal.js";

const SECRET = "pilot-admission-test-session-secret-at-least-thirty-two-characters";
const RELEASE_SHA = "f".repeat(40);
const EPOCH = "b992d77a-39e4-4b85-a41c-3f13eb755b5b";
const APP_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const OIDC_KEYS = generateKeyPairSync("rsa", { modulusLength: 2048 });

// Model only the admission contract at the actual HTTP handler boundary.
// Atomic quota reservation, immutable receipts and SQL roles have separate tests.
function admissionFixture() {
  const calls = [];
  const receipts = new Map();
  return {
    calls, receipts, reason: "admitted", failure: null, admissionBarrier: null, resultOverride: null,
    now: new Date("2026-08-31T23:59:59.000Z"),
    async admitEvaluation(scope) {
      calls.push(structuredClone(scope));
      if (this.admissionBarrier) await this.admissionBarrier.pause();
      if (this.failure) throw this.failure;
      const key = `${scope.repositoryId}:${scope.evaluationGeneration}`;
      const existing = receipts.get(key);
      if (existing) {
        assert.deepEqual(scope, existing.scope, "a retry must retain its authenticated target binding");
        return { ...existing.result, duplicate: true, reason: "already_admitted" };
      }
      const admitted = this.reason === "admitted";
      const result = { admitted, duplicate: false, reason: this.reason,
        period: this.now.toISOString().slice(0, 7), evaluations: receipts.size + Number(admitted),
        included: 100, graceRemaining: 10, admittedAt: admitted ? this.now.toISOString() : null };
      if (admitted) receipts.set(key, { scope: structuredClone(scope), result });
      return this.resultOverride ? this.resultOverride(result) : result;
    },
    async readAdmission(scope) {
      return receipts.get(`${scope.repositoryId}:${scope.evaluationGeneration}`)?.result ?? null;
    },
  };
}

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

function targetFixture({ pullRequestNumber = 42, headSha = "b".repeat(40), harnessMode = "verify",
  repository = "acme/payments" } = {}) {
  const repositoryId = 4242;
  const baseSha = "a".repeat(40);
  const files = new Map(buildSetupFiles({ name: "CI / verify", appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml" }, harnessMode).map(({ path, content }) => [path, content]));
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

function oidc(runId, fixture, eventName = "pull_request_target", runAttempt = 1) {
  const seconds = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "pilot-admission-test" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "https://token.actions.githubusercontent.com",
    aud: "https://changeplane.vercel.app/guard-publisher/v1", exp: seconds + 300, nbf: seconds - 10, iat: seconds - 10,
    repository: fixture.repository, repository_id: String(fixture.repositoryId),
    workflow_ref: `${fixture.repository}/.github/workflows/changeplane.yml@refs/heads/main`, workflow_sha: fixture.baseSha,
    ref: "refs/heads/main", event_name: eventName, run_id: String(runId), run_attempt: String(runAttempt),
    jti: `pilot-admission-test-${runId}`, sha: fixture.baseSha, base_ref: "main" })).toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), { key: OIDC_KEYS.privateKey,
    padding: constants.RSA_PKCS1_PADDING }).toString("base64url")}`;
}

async function withFixture(callback, { targets = [targetFixture()], pilotAdmission = admissionFixture(),
  ownerAccount = { id: 77, type: "Organization", login: "acme" }, installationAccount = ownerAccount } = {}) {
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
    CHANGEPLANE_COMMERCIAL_STORE_ENABLED: "true",
    CHANGEPLANE_DATABASE_URL: "postgresql://pilot_test:synthetic@commercial.invalid/pilot?sslmode=verify-full",
    CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE: RELEASE_SHA,
    CHANGEPLANE_GUARD_JOURNAL_ENABLED: "true",
    CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL: "postgresql://guard_test:synthetic@journal.invalid/guard?sslmode=verify-full",
    CHANGEPLANE_GUARD_JOURNAL_EPOCH: EPOCH,
    CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE: RELEASE_SHA,
    VERCEL: "1", VERCEL_ENV: "production", VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_OWNER: "LeChiffreVol2", VERCEL_GIT_REPO_SLUG: "changeplane",
    VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: RELEASE_SHA,
  });
  const journal = journalFixture();
  const handler = createGitHubHandler({ guardJournal: journal, pilotAdmission });
  const calls = [];
  const writes = [];
  let nextCheckId = 900;
  const controls = { writeBarrier: null, writeFailure: false, invalidWriteResponse: false, mutateRequest: null,
    owningRunResponse: null, owningRunUnavailable: false,
    workflowStartedAt: new Date(Date.now() - 1000).toISOString() };
  const pendingRequests = new Set();
  const originalFetch = globalThis.fetch;
  const primary = targets[0];
  const repo = { id: primary.repositoryId, full_name: primary.repository, default_branch: "main",
    owner: { ...ownerAccount }, permissions: { push: true, admin: true } };
  const treeSha = "c".repeat(40);
  const tree = [...primary.files].map(([path, content]) => ({ path, type: "blob", mode: "100644",
    sha: createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex") }));
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method ?? "GET";
    calls.push({ method, path: url.pathname, search: url.search });
    if (url.origin === "https://token.actions.githubusercontent.com") return response({ keys: [{
      ...OIDC_KEYS.publicKey.export({ format: "jwk" }), kid: "pilot-admission-test", use: "sig", alg: "RS256", key_ops: ["verify"],
    }] });
    assert.equal(url.origin, "https://api.github.com", "the fixture never makes an external request");
    if (url.pathname.endsWith("/installation")) return response({ id: 7007, app_id: 424242,
      app_slug: "changeplane-test", account: { ...installationAccount } });
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
    if (attemptMatch) {
      if (controls.owningRunUnavailable) throw new Error("Synthetic GitHub run inventory outage");
      const run = { id: Number(attemptMatch[1]), run_attempt: Number(attemptMatch[2]),
        repository: repo, path: ".github/workflows/changeplane.yml", status: "completed", conclusion: "failure",
        event: "pull_request_target", run_started_at: controls.workflowStartedAt };
      return response(controls.owningRunResponse ? controls.owningRunResponse(run) : run);
    }
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
    if (/\/commits\/[a-f0-9]{40}\/pulls$/u.test(url.pathname)) return response([]);
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
  function request(operation, runId = 8001, target = primary, runAttempt = 1) {
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
      workflowRunId: runId, workflowRunAttempt: runAttempt };
    if (operation === "complete") Object.assign(body, { passport: target.passport, summary: target.summary });
    else Object.assign(body, { repositoryId: target.repositoryId, controllerSha: target.baseSha });
    if (operation === "begin") body.target = { type: "pull_request", pullRequestNumber: target.pullRequestNumber,
      baseSha: target.baseSha, headSha: target.headSha, baseRef: "main", headRef: target.pullRequest.head.ref };
    return { method: "POST", url: "/api/github?action=guard-publish", headers: {
      authorization: `Bearer ${oidc(runId, target, operation === "sweep" ? "schedule" : "pull_request_target", runAttempt)}`,
      "content-type": "application/json",
    }, body };
  }
  function start(operation, runId, target, runAttempt) {
    const res = { statusCode: 0, body: "", ended: false, setHeader() {}, end(value = "") { this.body = String(value); this.ended = true; } };
    const req = request(operation, runId, target, runAttempt);
    controls.mutateRequest?.(req);
    const done = handler(req, res).then(() => res);
    pendingRequests.add(done);
    done.finally(() => pendingRequests.delete(done));
    return { res, done };
  }
  try { await callback({ primary, targets, journal, pilotAdmission, calls, writes, controls, start, request, handler,
    async invoke(...args) { return bounded(start(...args).done); } }); }
  finally {
    controls.writeBarrier?.release();
    journal.ackBarrier?.release();
    pilotAdmission.admissionBarrier?.release();
    await Promise.allSettled([...pendingRequests]);
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (prefix.test(name)) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

function assertBlockedCheck(check, runId) {
  assert.equal(check.status, "completed");
  assert.equal(check.conclusion, "action_required");
  assert.match(check.output.text, new RegExp(`run_id=${runId};run_attempt=1;phase=complete`, "u"));
  assert.equal(check.output.summary.includes("changeplane-assurance-passport"), false,
    "commercial admission must never manufacture an assurance passport");
}

test("individual and business repository owners receive the same Verify pilot lifecycle", async () => {
  for (const ownerAccount of [
    { id: 77, type: "User", login: "solo-builder" },
    { id: 88, type: "Organization", login: "acme" },
  ]) {
    const target = targetFixture({ repository: `${ownerAccount.login}/payments` });
    await withFixture(async ({ primary, pilotAdmission, journal, controls, invoke }) => {
      const begin = await invoke("begin", 8001);
      assert.equal(begin.statusCode, 200, `${ownerAccount.type}: ${begin.body}`);
      assert.equal(pilotAdmission.calls.length, 1);
      assert.equal(pilotAdmission.calls[0].tenantId, ownerAccount.id);
      assert.equal(journal.calls[0].tenantId, ownerAccount.id);
      const complete = await invoke("complete", 8001);
      assert.equal(complete.statusCode, 200, `${ownerAccount.type}: ${complete.body}`);
      assert.equal(primary.checks[0].conclusion, "success");
      assert.equal(pilotAdmission.calls.length, 1, "completion does not charge either account type again");
      controls.mutateRequest = (request) => { request.body.tenantId = 999; request.body.organizationId = 999; };
      assert.equal((await invoke("begin", 8002)).statusCode, 409,
        "caller-selected account fields are rejected by the strict request contract");
      assert.equal(pilotAdmission.calls.length, 1, "an account override cannot consume another account's allowance");
    }, { targets: [target], ownerAccount });
  }
});

test("a personal and organization account cannot substitute each other's installation binding", async () => {
  for (const [ownerAccount, installationAccount] of [
    [{ id: 77, type: "User", login: "solo-builder" }, { id: 88, type: "Organization", login: "acme" }],
    [{ id: 88, type: "Organization", login: "acme" }, { id: 77, type: "User", login: "solo-builder" }],
  ]) {
    await withFixture(async ({ pilotAdmission, journal, writes, invoke }) => {
      const begin = await invoke("begin", 8001);
      assert.equal(begin.statusCode, 503, begin.body);
      assert.equal(JSON.parse(begin.body).code, "GUARD_PUBLICATION_AUTHORITY");
      assert.equal(pilotAdmission.calls.length, 0);
      assert.equal(journal.calls.length, 0);
      assert.equal(writes.length, 0, "wrong-account installation cannot reach Check authority");
    }, { targets: [targetFixture({ repository: `${ownerAccount.login}/payments` })], ownerAccount, installationAccount });
  }
});

test("authenticated begin retries reuse one admission and its original UTC month", async () => {
  await withFixture(async ({ primary, pilotAdmission, writes, journal, controls, invoke }) => {
    const first = await invoke("begin", 8001);
    assert.equal(first.statusCode, 200, first.body);
    pilotAdmission.now = new Date("2026-09-01T00:00:01.000Z");
    const retry = await invoke("begin", 8001);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(pilotAdmission.receipts.size, 1);
    assert.equal(writes.length, 1, "idempotent begin does not replace the App Check");
    const receipt = [...pilotAdmission.receipts.values()][0];
    assert.equal(receipt.result.period, "2026-08");
    assert.equal(receipt.scope.tenantId, 77);
    assert.equal(receipt.scope.repositoryId, primary.repositoryId);
    assert.equal(receipt.scope.installationId, 7007);
    assert.equal(receipt.scope.guardAppId, 424242);
    assert.equal(receipt.scope.evaluationGeneration, "8001.1");
    assert.equal(receipt.scope.targetType, "pull_request");
    assert.equal(receipt.scope.capability, "verify");
    assert.equal(receipt.scope.workflowStartedAt, controls.workflowStartedAt);
    assert.equal(receipt.scope.revisionFingerprint, createHash("sha256")
      .update(`${primary.repositoryId}\0pull_request\0${primary.pullRequestNumber}\0${primary.headSha}`).digest("hex"));
    assert.notEqual(receipt.scope.revisionFingerprint, journal.calls[0].revisionFingerprint,
      "commercial target identity includes the PR; the publication lane remains shared by SHA");
    assert.equal((await invoke("begin", 8001, primary, 2)).statusCode, 200);
    assert.equal((await invoke("begin", 8002)).statusCode, 200);
    assert.equal(pilotAdmission.receipts.size, 3, "new attempts and runs are new Evaluation Generations");
  });
});

test("all prior successes are invalidated before waiting for commercial admission", async () => {
  await withFixture(async ({ primary, pilotAdmission, journal, writes, start, invoke }) => {
    assert.equal((await invoke("begin", 8001)).statusCode, 200);
    assert.equal((await invoke("complete", 8001)).statusCode, 200);
    const canonicalId = primary.checks[0].id;
    primary.checks.push({ id: 899, ...headCheckPayload(primary.receipt, primary.summary),
      external_id: "historical-guard-identity", app: { id: 424242, slug: "changeplane-test" } });
    assert.equal(primary.checks.every((check) => check.conclusion === "success"), true);
    const writesBeforeAdmission = writes.length;
    const gate = barrier();
    pilotAdmission.admissionBarrier = gate;
    const admitting = start("begin", 8002);
    await entered(gate, admitting);
    try {
      assert.equal(primary.checks.some((check) => check.status === "completed"
        && ["success", "neutral", "skipped"].includes(check.conclusion)), false,
      "a worker lost during the commercial wait must leave no usable old success");
      const canonical = primary.checks.find((check) => check.id === canonicalId);
      assert.equal(canonical.status, "completed");
      assert.equal(canonical.conclusion, "action_required");
      assert.match(canonical.output.text, /run_id=8002;run_attempt=1;phase=begin/u);
      assert.equal(primary.checks.find((check) => check.id === 899).conclusion, "action_required");
      assert.equal(journal.lanes.size, 1);
      const competing = await invoke("begin", 8003);
      assert.equal(competing.statusCode, 423, competing.body);
      assert.equal(pilotAdmission.calls.length, 2);
      assert.equal(writes.length, writesBeforeAdmission + 3);
      assert.equal(admitting.res.ended, false);
    } finally { pilotAdmission.admissionBarrier = null; gate.release(); }
    assert.equal((await admitting.done).statusCode, 200);
    assert.equal(pilotAdmission.receipts.size, 2);
  });
});

test("invalid OIDC identity, stale policy and stale generations never reach commercial admission", async () => {
  for (const mutateRequest of [
    (req) => { req.body.workflowRunId += 1; },
    (req) => { req.body.controllerSha = "e".repeat(40); },
    (req) => { req.body.target.headSha = "d".repeat(40); },
    (req) => { req.body.workflowStartedAt = "2026-01-01T00:00:00.000Z"; },
  ]) {
    await withFixture(async ({ pilotAdmission, writes, controls, invoke }) => {
      controls.mutateRequest = mutateRequest;
      const denied = await invoke("begin");
      assert.ok([403, 409].includes(denied.statusCode), denied.body);
      assert.equal(pilotAdmission.calls.length, 0);
      assert.equal(writes.length, 0);
    });
  }
  await withFixture(async ({ pilotAdmission, invoke }) => {
    assert.equal((await invoke("begin", 8002)).statusCode, 200);
    const before = pilotAdmission.calls.length;
    const stale = await invoke("begin", 8001);
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(pilotAdmission.calls.length, before);
  });
});

test("replacement pull requests at the same SHA have distinct commercial target bindings", async () => {
  await withFixture(async ({ primary, pilotAdmission, invoke }) => {
    assert.equal((await invoke("begin", 8001)).statusCode, 200);
    assert.equal((await invoke("complete", 8001)).statusCode, 200);
    primary.pullRequestNumber = 43;
    primary.pullRequest.number = 43;
    const replacement = await invoke("begin", 8002);
    assert.equal(replacement.statusCode, 200, replacement.body);
    const accepted = [...pilotAdmission.receipts.values()];
    assert.equal(accepted.length, 2);
    assert.notEqual(accepted[0].scope.revisionFingerprint, accepted[1].scope.revisionFingerprint);
    assert.match(primary.checks[0].output.text, /pull_request_number=43/u);
  });
});

test("missing or mismatched trusted owning-run evidence safely denies before admission", async () => {
  for (const change of [
    (controls) => { controls.owningRunUnavailable = true; },
    ...[
      (run) => ({ ...run, id: run.id + 1 }),
      (run) => ({ ...run, run_attempt: 2 }),
      (run) => ({ ...run, repository: { ...run.repository, id: 99 } }),
      (run) => ({ ...run, path: ".github/workflows/untrusted.yml" }),
      (run) => ({ ...run, event: "workflow_dispatch" }),
      (run) => ({ ...run, run_started_at: "invalid" }),
      (run) => ({ ...run, run_started_at: undefined }),
    ].map((transform) => (controls) => { controls.owningRunResponse = transform; }),
  ]) {
    await withFixture(async ({ primary, pilotAdmission, journal, controls, invoke }) => {
      change(controls);
      const denied = await invoke("begin");
      assert.equal(denied.statusCode, 503, denied.body);
      assert.equal(pilotAdmission.calls.length, 0);
      assertBlockedCheck(primary.checks[0], 8001);
      assert.equal(journal.lanes.size, 0);
    });
  }
});

test("commercial admission cannot bypass the hosted production provenance check", async () => {
  await withFixture(async ({ pilotAdmission, journal, calls, writes, invoke }) => {
    process.env.VERCEL_ENV = "preview";
    const denied = await invoke("begin");
    assert.equal(denied.statusCode, 503, denied.body);
    assert.equal(pilotAdmission.calls.length, 0);
    assert.equal(journal.calls.length, 0);
    assert.equal(calls.length, 0);
    assert.equal(writes.length, 0);
  });
});

test("quota and enrollment denials invalidate a prior PASS without admitting work or bypassing Guard", async () => {
  for (const reason of ["quota_exhausted", "not_enrolled", "contract_expired", "repository_limit"]) {
    await withFixture(async ({ primary, pilotAdmission, journal, invoke }) => {
      assert.equal((await invoke("begin", 8001)).statusCode, 200);
      assert.equal((await invoke("complete", 8001)).statusCode, 200);
      assert.equal(primary.checks[0].conclusion, "success");
      pilotAdmission.reason = reason;
      const denied = await invoke("begin", 8002);
      assert.equal(denied.statusCode, 402, `${reason}: ${denied.body}`);
      assertBlockedCheck(primary.checks[0], 8002);
      assert.match(primary.checks[0].output.text, new RegExp(`contract_digest=${primary.passport.binding.contractDigest}`, "u"));
      assert.equal(pilotAdmission.receipts.size, 1);
      assert.equal(journal.lanes.size, 0, "a definitive denial must release the journal normally");
      const cannotPublish = await invoke("complete", 8002);
      assert.equal(cannotPublish.statusCode, 409, cannotPublish.body);
      assertBlockedCheck(primary.checks[0], 8002);
    });
  }
});

test("a denied first generation retires all legacy same-head successes", async () => {
  await withFixture(async ({ primary, pilotAdmission, journal, writes, invoke }) => {
    primary.checks.push({ id: 899, ...headCheckPayload(primary.receipt, primary.summary),
      external_id: "historical-guard-identity", app: { id: 424242, slug: "changeplane-test" } });
    pilotAdmission.reason = "quota_exhausted";
    const denied = await invoke("begin", 8001);
    assert.equal(denied.statusCode, 402, denied.body);
    assert.deepEqual(writes.map(({ method }) => method), ["PATCH", "POST", "PATCH"]);
    assert.equal(primary.checks.every((check) => check.conclusion === "action_required"), true);
    assertBlockedCheck(primary.checks.find((check) => check.id !== 899), 8001);
    assert.equal(journal.lanes.size, 0);
  });
});

test("an unavailable or ambiguous admission store stops work but does not poison known Guard writes", async () => {
  await withFixture(async ({ primary, pilotAdmission, journal, invoke }) => {
    assert.equal((await invoke("begin", 8001)).statusCode, 200);
    assert.equal((await invoke("complete", 8001)).statusCode, 200);
    pilotAdmission.failure = new Error("synthetic credential-bearing database error; never return this");
    const unavailable = await invoke("begin", 8002);
    assert.equal(unavailable.statusCode, 503, unavailable.body);
    assert.equal(unavailable.body.includes("credential-bearing"), false);
    assertBlockedCheck(primary.checks[0], 8002);
    assert.equal(journal.lanes.size, 0);
    pilotAdmission.failure = null;
    const recovered = await invoke("begin", 8003);
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.equal(primary.checks[0].status, "completed");
    assert.equal(primary.checks[0].conclusion, "action_required");
  });
});

test("GitHub uncertainty during a commercial denial still poisons publication", async () => {
  for (const fault of ["writeFailure", "invalidWriteResponse"]) {
    await withFixture(async ({ pilotAdmission, controls, journal, invoke }) => {
      pilotAdmission.reason = "quota_exhausted";
      controls[fault] = true;
      const uncertain = await invoke("begin", 8001);
      assert.equal(uncertain.statusCode, 503, uncertain.body);
      assert.deepEqual([...journal.lanes.values()], ["poisoned"]);
      controls[fault] = false;
      assert.equal((await invoke("begin", 8002)).statusCode, 503);
    });
  }
});

test("an invalid final blocked acknowledgment cannot be mistaken for a definitive commercial denial", async () => {
  await withFixture(async ({ pilotAdmission, controls, journal, writes, invoke }) => {
    pilotAdmission.reason = "quota_exhausted";
    controls.invalidWriteResponse = ({ payload }) => payload.status === "completed";
    const uncertain = await invoke("begin", 8001);
    assert.equal(uncertain.statusCode, 503, uncertain.body);
    assert.equal(writes.length, 2, "the initial invalidation was acknowledged before the final response failed");
    assert.deepEqual([...journal.lanes.values()], ["poisoned"]);
  });
});

test("malformed accepted admission receipts become safe unavailable results", async () => {
  for (const transform of [
    () => null,
    (result) => ({ ...result, duplicate: "false" }),
    (result) => ({ ...result, reason: "already_admitted" }),
    (result) => ({ ...result, evaluations: 0 }),
    (result) => ({ ...result, included: 0 }),
    (result) => ({ ...result, graceRemaining: -1 }),
    (result) => ({ ...result, admittedAt: "invalid" }),
  ]) {
    await withFixture(async ({ primary, pilotAdmission, journal, invoke }) => {
      pilotAdmission.resultOverride = transform;
      const denied = await invoke("begin", 8001);
      assert.equal(denied.statusCode, 503, denied.body);
      assertBlockedCheck(primary.checks[0], 8001);
      assert.equal(journal.lanes.size, 0);
    });
  }
});

test("pilot admission never enables Observe or Autonomous Full profiles", async () => {
  for (const harnessMode of ["observe", "autonomous"]) {
    await withFixture(async ({ primary, pilotAdmission, journal, invoke }) => {
      const denied = await invoke("begin", 8001);
      assert.equal(denied.statusCode, 402, denied.body);
      assert.equal(pilotAdmission.calls.length, 0, "unsupported profiles do not spend the pilot allowance");
      assertBlockedCheck(primary.checks[0], 8001);
      assert.equal(journal.lanes.size, 0);
    }, { targets: [targetFixture({ harnessMode })] });
  }
});

test("commercial denial is not returned before the durable publication acknowledgment", async () => {
  await withFixture(async ({ pilotAdmission, journal, start }) => {
    pilotAdmission.reason = "quota_exhausted";
    const gate = barrier();
    journal.ackBarrier = gate;
    const denying = start("begin", 8001);
    await entered(gate, denying);
    assert.equal(denying.res.ended, false);
    gate.release();
    const result = await denying.done;
    assert.equal(result.statusCode, 402, result.body);
    assert.equal(journal.lanes.size, 0);
  });
});

test("an accepted generation can complete or reconcile after contract expiry and commercial outage", async () => {
  for (const operation of ["complete", "sweep", "manual"]) {
    await withFixture(async ({ primary, pilotAdmission, invoke }) => {
      assert.equal((await invoke("begin", 8001)).statusCode, 200);
      const admissions = pilotAdmission.calls.length;
      pilotAdmission.reason = "contract_expired";
      pilotAdmission.failure = new Error("commercial store is unavailable");
      process.env.CHANGEPLANE_DATABASE_URL = "invalid-commercial-configuration";
      process.env.CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE = "e".repeat(40);
      primary.checks[0].started_at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const terminal = await invoke(operation, operation === "complete" ? 8001 : 9100);
      assert.equal(terminal.statusCode, 200, `${operation}: ${terminal.body}`);
      assert.equal(pilotAdmission.calls.length, admissions, "finishing an existing generation does not reserve quota");
      assert.equal(primary.checks[0].conclusion, operation === "complete" ? "success" : "action_required");
    });
  }
});

test("injected admission stores cannot bypass hosted provenance, release binding or strict TLS configuration", async () => {
  const base = "postgresql://pilot_test:synthetic@commercial.invalid/pilot";
  for (const change of [
    () => { delete process.env.CHANGEPLANE_COMMERCIAL_STORE_ENABLED; },
    () => { process.env.CHANGEPLANE_COMMERCIAL_STORE_ENABLED = "false"; },
    () => { process.env.CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE = "e".repeat(40); },
    ...[
      base, `${base}?sslmode=require`, `${base}?sslmode=verify-full&sslmode=disable`,
      `${base}?sslmode=verify-full&host=%2Ftmp`, `${base}?sslmode=verify-full&sslrootcert=%2Ftmp%2Fca.pem`,
    ].map((url) => () => { process.env.CHANGEPLANE_DATABASE_URL = url; }),
  ]) {
    await withFixture(async ({ primary, pilotAdmission, journal, calls, writes, invoke }) => {
      change();
      const denied = await invoke("begin");
      assert.equal(denied.statusCode, 503, denied.body);
      assert.equal(pilotAdmission.calls.length, 0);
      assert.ok(journal.calls.length > 0, "configuration failure still invalidates the authenticated exact-head Guard");
      assert.ok(calls.length > 0);
      assert.equal(writes.length, 2);
      assertBlockedCheck(primary.checks[0], 8001);
      assert.equal(journal.lanes.size, 0);
      assert.equal(denied.body.includes("synthetic"), false);
    });
  }
});

test("commercial and publication configuration reject the same database login despite URL aliases", async () => {
  for (const connectionString of [
    "postgresql://guard_test:synthetic@journal.invalid/guard?sslmode=verify-full",
    "postgresql://guard_test:different-password@journal.invalid/guard?sslmode=verify-full",
    "postgres://guard_test:different-password@journal.invalid/guard?sslmode=verify-full",
    "postgresql://guard_test:different-password@JOURNAL.INVALID:5432/guard?sslmode=verify-full",
    "postgresql://guard_test:different-password@journal.invalid/another_database?sslmode=verify-full",
    "postgresql://%67uard_test:different-password@journal.invalid/g%75ard?sslmode=verify-full",
  ]) {
    await withFixture(async ({ primary, pilotAdmission, journal, invoke }) => {
      process.env.CHANGEPLANE_DATABASE_URL = connectionString;
      const denied = await invoke("begin", 8001);
      assert.equal(denied.statusCode, 503, denied.body);
      assert.equal(pilotAdmission.calls.length, 0);
      assertBlockedCheck(primary.checks[0], 8001);
      assert.equal(journal.lanes.size, 0);
      assert.equal(denied.body.includes("different-password"), false);
      assert.equal(denied.body.includes("journal.invalid"), false);
    });
  }
  await withFixture(async ({ pilotAdmission, invoke }) => {
    process.env.CHANGEPLANE_DATABASE_URL = "postgresql://commercial_test:synthetic@journal.invalid/guard?sslmode=verify-full";
    const possible = await invoke("begin", 8001);
    assert.equal(possible.statusCode, 200, possible.body);
    assert.equal(pilotAdmission.calls.length, 1);
    // Distinct configured login names do not attest actual database role grants.
  });
});
