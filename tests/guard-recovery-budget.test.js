import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import handler, { buildSetupFiles, seal } from "../api/github.js";
import { decodeGuardRunMarker } from "../server/github-guard-controller.js";

const SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
const BASE_SHA = "a".repeat(40);
const TREE_SHA = "b".repeat(40);
const PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, headers: { get: () => null }, async json() { return body; } };
}

async function runRecovery({ mode, callerMode, changePolicyBeforeWrite = false, sourceRun = {}, finalSourceRun = null, sourceMissing = false, sourceUnavailable = false }) {
  const prefix = /^(?:GITHUB_|CHANGEPLANE_|VERCEL(?:_|$))/u;
  const original = Object.fromEntries(Object.entries(process.env).filter(([name]) => prefix.test(name)));
  for (const name of Object.keys(original)) delete process.env[name];
  Object.assign(process.env, {
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    CHANGEPLANE_SESSION_SECRET: SECRET,
    CHANGEPLANE_APP_ORIGIN: "https://changeplane.example",
    CHANGEPLANE_GUARD_APP_ID: "424242",
    CHANGEPLANE_GUARD_APP_SLUG: "changeplane-test",
    CHANGEPLANE_GUARD_APP_PRIVATE_KEY: PRIVATE_KEY,
  });
  const files = new Map(buildSetupFiles(mode === "observe" ? null : {
    name: "CI / test", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml",
  }, mode).map(({ path, content }) => [path, content]));
  const tree = [...files].map(([path, content]) => ({
    path, type: "blob", mode: "100644",
    sha: createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex"),
  }));
  const check = {
    id: 919, name: "ChangePlane / guard", head_sha: "c".repeat(40),
    status: "in_progress", conclusion: null,
    started_at: new Date(Date.now() - 6 * 60 * 1_000).toISOString(),
    output: { text: `changeplane.guard-run/v1;run_id=8001;run_attempt=2;phase=begin;contract_digest=${"d".repeat(64)};pull_request_number=42` },
    app: { id: 424242, slug: "changeplane-test" },
  };
  let patches = 0;
  let writeTokens = 0;
  let baseReads = 0;
  let sourceReads = 0;
  const policyRefs = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request, options = {}) => {
    const url = new URL(String(request));
    const method = options.method ?? "GET";
    if (url.pathname === "/repos/acme/service") return jsonResponse({
      id: 4242, full_name: "acme/service", default_branch: "main", permissions: { push: true, admin: true },
    });
    if (url.pathname.endsWith("/installation")) return jsonResponse({ id: 7007, app_id: 424242, app_slug: "changeplane-test" });
    if (url.pathname === "/app/installations/7007/access_tokens") {
      const requested = JSON.parse(options.body);
      if (requested.permissions.checks === "write") writeTokens += 1;
      return jsonResponse({ token: "test-installation-token", permissions: requested.permissions,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(), repositories: [{ id: 4242 }] }, 201);
    }
    if (url.pathname.endsWith("/git/ref/heads/main")) {
      baseReads += 1;
      return jsonResponse({ object: { sha: changePolicyBeforeWrite && baseReads >= 3 ? "e".repeat(40) : BASE_SHA } });
    }
    const filePath = url.pathname.split("/contents/")[1];
    if (filePath && files.has(filePath)) {
      policyRefs.push(url.searchParams.get("ref"));
      return jsonResponse({ type: "file", encoding: "base64", content: Buffer.from(files.get(filePath)).toString("base64") });
    }
    if (url.pathname.endsWith(`/git/commits/${BASE_SHA}`)) return jsonResponse({ tree: { sha: TREE_SHA } });
    if (url.pathname.endsWith(`/git/trees/${TREE_SHA}`)) return jsonResponse({ truncated: false, tree });
    if (url.pathname === "/repos/acme/service/actions/runs/8001/attempts/2") {
      sourceReads += 1;
      if (sourceMissing) return jsonResponse({ message: "Not Found" }, 404);
      if (sourceUnavailable) return jsonResponse({ message: "Unavailable" }, 500);
      return jsonResponse({ id: 8001, run_attempt: 2, repository: { id: 4242, full_name: "acme/service" },
        path: ".github/workflows/changeplane.yml", status: "completed", conclusion: "failure",
        ...sourceRun, ...(sourceReads > 1 ? finalSourceRun : {}) });
    }
    if (url.pathname.endsWith("/check-runs/919")) {
      if (method === "PATCH") {
        patches += 1;
        Object.assign(check, JSON.parse(options.body));
      }
      return jsonResponse(check);
    }
    throw new Error(`Unexpected recovery request: ${method} ${url.pathname}`);
  };
  const response = { statusCode: 0, body: "", setHeader() {}, end(value = "") { this.body = String(value); } };
  try {
    const session = seal({ kind: "session", token: "admin-token", login: "owner", csrf: "test-csrf", authMode: "oauth" }, SECRET);
    await handler({
      method: "POST", url: "/api/github?action=reconcile",
      headers: { origin: "https://changeplane.example", cookie: `__Host-changeplane_session=${session}`,
        "x-changeplane-csrf": "test-csrf", "content-type": "application/json" },
      body: { repository: "acme/service", checkRunId: 919, sourceRunCompleted: true,
        ...(callerMode ? { harnessMode: callerMode, budgetMinutes: 0 } : {}) },
    }, response);
    assert.deepEqual(policyRefs, [BASE_SHA, BASE_SHA]);
    return { status: response.statusCode, payload: JSON.parse(response.body), check, patches, writeTokens, sourceReads };
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (prefix.test(name)) delete process.env[name];
    Object.assign(process.env, original);
  }
}

test("admin recovery verifies the exact terminal owning attempt before shortening Verify and Observe budgets", async () => {
  for (const mode of ["verify", "observe"]) {
    const result = await runRecovery({ mode });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.equal(result.payload.state, "reconciled");
    assert.equal(result.patches, 1);
    assert.equal(result.sourceReads, 2);
    assert.equal(result.check.conclusion, "action_required");
    assert.equal(decodeGuardRunMarker(result.check.output.text).boundContractDigest, "d".repeat(64));
    assert.equal(decodeGuardRunMarker(result.check.output.text).pullRequestNumber, 42);
  }
});

test("healthy, missing and mismatched owning runs cannot trigger early recovery or mint a Checks-write token", async () => {
  const cases = [
    { sourceRun: { status: "in_progress", conclusion: null } },
    { sourceMissing: true },
    { sourceUnavailable: true },
    { sourceRun: { id: 8002 } },
    { sourceRun: { run_attempt: 1 } },
    { sourceRun: { repository: { id: 9999, full_name: "acme/service" } } },
    { sourceRun: { repository: { id: 4242, full_name: "other/service" } } },
    { sourceRun: { path: ".github/workflows/untrusted.yml" } },
    { sourceRun: { conclusion: null } },
  ];
  for (const scenario of cases) {
    const result = await runRecovery({ mode: "verify", ...scenario });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.equal(result.payload.state, "within_window");
    assert.equal(result.patches, 0);
    assert.equal(result.writeTokens, 0);
  }
});

test("admin recovery rechecks source-run completion before mutation", async () => {
  const result = await runRecovery({ mode: "verify", finalSourceRun: { status: "in_progress", conclusion: null } });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.state, "within_window");
  assert.equal(result.sourceReads, 2);
  assert.equal(result.patches, 0);
});

test("a browser request cannot shorten the trusted Autonomous recovery budget", async () => {
  const result = await runRecovery({ mode: "autonomous", callerMode: "verify" });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.state, "within_window");
  assert.equal(result.patches, 0);
  assert.equal(result.writeTokens, 0);
});

test("admin recovery rejects default-branch policy drift before the Check patch", async () => {
  const result = await runRecovery({ mode: "verify", changePolicyBeforeWrite: true });
  assert.equal(result.status, 409, JSON.stringify(result.payload));
  assert.match(result.payload.error, /trusted recovery policy/u);
  assert.equal(result.patches, 0);
  assert.equal(result.check.status, "in_progress");
});
