import assert from "node:assert/strict";
import { constants, createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sodium from "libsodium-wrappers";

import {
  buildAssurancePassport,
  buildReceipt,
  digest,
  headCheckPayload,
  renderReceiptComment,
} from "../action/index.js";
import {
  buildSetupFiles,
  buildUpgradeRecoveryPolicy,
  buildRuntimePolicy,
  classifyManagedInstallation,
  classifyManagedInstallationDigests,
  classifyManagedRuntimeTree,
  classifyUpgradePolicyMigration,
  createObserveUpgradePullRequest,
  default as handler,
  githubRetryDelayMs,
  managedVersionSnapshot,
  prepareAutonomousHarness,
  seal,
  unseal,
  validateAutonomousBranchProtection,
  validateByokKey,
  validateRepository,
  validateRuntimeModel,
  verifyOpenAIKey,
} from "../api/github.js";
import {
  parseCanaryEvidenceChecks,
  provisionRepairCanary,
  validateCanaryRulesets,
  validateInstallationCredential,
  validateRepairGeneration,
} from "../scripts/provision-repair-canary.mjs";

const SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
const TEST_GUARD_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function responseRecorder() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: "",
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(value = "") { this.body = String(value); },
  };
}

function githubJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return body; },
    async text() { return status >= 400 ? JSON.stringify(body) : ""; },
  };
}

function assuranceProofApiFixture(overrides = {}) {
  const repository = "acme/payments";
  const repositoryId = 4242;
  const pullRequestNumber = 42;
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const plan = { goal: "Keep payment retries idempotent", scope: ["src/payments/**"] };
  const policy = overrides.policy ?? {
    version: 1,
    evidence: {
      requiredChecks: [{
        name: "CI / verify",
        appSlug: "github-actions",
        workflowPath: ".github/workflows/ci.yml",
      }],
    },
  };
  const evidence = {
    name: "CI / verify",
    expectedSource: "github-actions",
    source: "github-actions",
    checkRunId: 808,
    publisherAppId: 15368,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    completedAt: "2026-08-31T00:00:00Z",
    ...(overrides.evidence ?? {}),
  };
  const receipt = buildReceipt({
    repository,
    repositoryId,
    pullRequest: {
      number: pullRequestNumber,
      base: { sha: baseSha },
      head: { sha: headSha },
    },
    plan,
    policyPath: ".changeplane.json",
    policyDigest: digest(policy),
    inputDigest: digest({ plan, files: [{ path: "src/payments/retry.js" }] }),
    contractDigest: digest(plan),
    approvalDigest: "f".repeat(64),
    result: { approval: { status: "MISSING" }, reasons: [] },
    evidence: [evidence],
    autonomousPlan: {
      decision: "PASS",
      reason: "ALL_GUARANTEES_SATISFIED",
      humanRequired: false,
    },
    mode: "enforce",
    actualFiles: [{ path: "src/payments/retry.js" }],
    maxAttempts: 2,
  });
  const summary = renderReceiptComment(receipt);
  const passportDigest = buildAssurancePassport(receipt).digest;
  const guardCheck = {
    id: 909,
    ...headCheckPayload(receipt, summary),
    external_id: `changeplane.guard/v1:${repositoryId}:pull_request:${headSha}`,
    output: {
      ...headCheckPayload(receipt, summary).output,
      text: "changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=complete",
    },
    app: { id: 424242, slug: "changeplane-test" },
  };
  const evidenceCheck = {
    id: evidence.checkRunId,
    name: evidence.name,
    head_sha: headSha,
    status: "completed",
    conclusion: "success",
    app: { id: evidence.publisherAppId, slug: evidence.source },
    details_url: `https://github.com/${repository}/actions/runs/7001`,
    started_at: "2026-08-30T23:59:00Z",
    completed_at: evidence.completedAt,
  };
  const pullRequest = {
    number: pullRequestNumber,
    state: "open",
    merged: false,
    head: { sha: headSha, ref: "agent/retry-fix", repo: { id: repositoryId, full_name: repository } },
    base: { sha: baseSha, ref: "main", repo: { id: repositoryId, full_name: repository } },
  };
  const repositoryPayload = {
    id: repositoryId,
    full_name: repository,
    default_branch: "main",
    permissions: { push: true, admin: false },
  };
  return {
    repository,
    repositoryId,
    pullRequestNumber,
    baseSha,
    headSha,
    policy,
    passportDigest,
    receipt,
    guardCheck,
    evidenceCheck,
    pullRequest,
    repositoryPayload,
  };
}

function assuranceProofFetch(fixture, {
  policy = fixture.policy,
  evidenceCheck = fixture.evidenceCheck,
  evidenceCheckRuns,
  pullRequest = fixture.pullRequest,
  associatedPullRequests = [pullRequest],
  workflowPath = ".github/workflows/ci.yml",
} = {}) {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, search: url.search, options });
    assert.equal(options.headers.authorization, "Bearer alice-token");
    if (url.pathname === `/repos/${fixture.repository}`) {
      return githubJsonResponse(fixture.repositoryPayload);
    }
    if (url.pathname === `/repos/${fixture.repository}/check-runs/${fixture.guardCheck.id}`) {
      return githubJsonResponse(fixture.guardCheck);
    }
    if (url.pathname === `/repos/${fixture.repository}/contents/.changeplane.json`) {
      assert.equal(url.searchParams.get("ref"), fixture.baseSha);
      return githubJsonResponse({
        type: "file",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(policy)).toString("base64"),
      });
    }
    if (url.pathname === `/repos/${fixture.repository}/check-runs/${fixture.evidenceCheck.id}`) {
      return githubJsonResponse(evidenceCheck);
    }
    if (url.pathname === `/repos/${fixture.repository}/commits/${fixture.headSha}/check-runs`) {
      assert.equal(url.searchParams.get("check_name"), fixture.evidenceCheck.name);
      assert.equal(url.searchParams.get("filter"), "all");
      return githubJsonResponse({
        total_count: (evidenceCheckRuns ?? [evidenceCheck]).length,
        check_runs: evidenceCheckRuns ?? [evidenceCheck],
      });
    }
    if (url.pathname === `/repos/${fixture.repository}/actions/runs/7001`) {
      return githubJsonResponse({
        id: 7001,
        head_sha: fixture.headSha,
        path: workflowPath,
      });
    }
    if (url.pathname === `/repos/${fixture.repository}/pulls/${fixture.pullRequestNumber}`) {
      return githubJsonResponse(pullRequest);
    }
    if (url.pathname === `/repos/${fixture.repository}/commits/${fixture.headSha}/pulls`) {
      return githubJsonResponse(associatedPullRequests);
    }
    throw new Error(`Unexpected assurance-proof request: ${url.pathname}${url.search}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function managedManifestFileResponse(managedProfile = "verify-lite") {
  const content = Buffer.from(managedVersionSnapshot(15, managedProfile).manifest).toString("base64");
  return {
    ok: true,
    status: 200,
    async json() { return { type: "file", encoding: "base64", content }; },
  };
}

function managedFileResponse(content) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { type: "file", encoding: "base64", content: Buffer.from(content).toString("base64") };
    },
  };
}

function managedRuntimeTreeFixture(managedProfile, policyContent) {
  const files = buildSetupFiles(
    managedProfile === "full" ? {
      name: "CI / test",
      appSlug: "github-actions",
      workflowPath: ".github/workflows/ci.yml",
    } : null,
    managedProfile === "full" ? "autonomous" : "observe",
  );
  const contents = new Map(files.map(({ path: filePath, content }) => [filePath, content]));
  contents.set(".changeplane.json", policyContent);
  const treeSha = managedProfile === "full" ? "d".repeat(40) : "c".repeat(40);
  return {
    treeSha,
    payload: {
      truncated: false,
      tree: [...contents].map(([filePath, content]) => ({
        path: filePath,
        type: "blob",
        mode: "100644",
        sha: createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex"),
      })),
    },
  };
}

async function withOAuthEnvironment(callback) {
  const names = [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_APP_SLUG",
    "CHANGEPLANE_SESSION_SECRET",
    "CHANGEPLANE_APP_ORIGIN",
    "CHANGEPLANE_CANARY_REPOSITORY",
    "CHANGEPLANE_ALPHA_REPOSITORIES_JSON",
    "CHANGEPLANE_SELF_SERVE_ENABLED",
    "CHANGEPLANE_REPAIR_REPOSITORY",
    "CHANGEPLANE_REPAIR_ENABLED",
    "CHANGEPLANE_REPAIR_GENERATION",
    "CHANGEPLANE_CONTROLLER_SECRET",
    "CHANGEPLANE_MANAGED_OPENAI_API_KEY",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "CHANGEPLANE_GUARD_APP_ID",
    "CHANGEPLANE_GUARD_APP_SLUG",
    "CHANGEPLANE_GUARD_APP_PRIVATE_KEY",
    "CHANGEPLANE_GUARD_REUSE_GITHUB_APP",
    "CHANGEPLANE_COMMERCIAL_STORE_ENABLED",
    "CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE",
    "CHANGEPLANE_DATABASE_URL",
    "CHANGEPLANE_LEGAL_RELEASE_APPROVED",
    "CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE",
    "VERCEL",
    "VERCEL_ENV",
    "VERCEL_GIT_PROVIDER",
    "VERCEL_GIT_REPO_OWNER",
    "VERCEL_GIT_REPO_SLUG",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_DEPLOYMENT_ID",
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    CHANGEPLANE_SESSION_SECRET: SECRET,
    CHANGEPLANE_APP_ORIGIN: "https://changeplane.example",
    CHANGEPLANE_GUARD_APP_ID: "424242",
    CHANGEPLANE_GUARD_APP_SLUG: "changeplane-test",
    CHANGEPLANE_GUARD_APP_PRIVATE_KEY: TEST_GUARD_PRIVATE_KEY,
  });
  delete process.env.GITHUB_APP_SLUG;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_GIT_PROVIDER;
  delete process.env.VERCEL_GIT_REPO_OWNER;
  delete process.env.VERCEL_GIT_REPO_SLUG;
  delete process.env.VERCEL_GIT_COMMIT_REF;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_DEPLOYMENT_ID;
  delete process.env.CHANGEPLANE_CANARY_REPOSITORY;
  delete process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON;
  delete process.env.CHANGEPLANE_SELF_SERVE_ENABLED;
  delete process.env.CHANGEPLANE_REPAIR_REPOSITORY;
  delete process.env.CHANGEPLANE_REPAIR_ENABLED;
  delete process.env.CHANGEPLANE_REPAIR_GENERATION;
  delete process.env.CHANGEPLANE_CONTROLLER_SECRET;
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  delete process.env.CHANGEPLANE_GUARD_REUSE_GITHUB_APP;
  delete process.env.CHANGEPLANE_COMMERCIAL_STORE_ENABLED;
  delete process.env.CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE;
  delete process.env.CHANGEPLANE_DATABASE_URL;
  delete process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED;
  delete process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE;
  try {
    return await callback();
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
}

async function withGitHubAppEnvironment(callback) {
  return withOAuthEnvironment(async () => {
    process.env.GITHUB_APP_SLUG = "changeplane-test";
    return callback();
  });
}

test("sealed sessions decrypt before expiry without exposing plaintext", () => {
  const token = seal({ token: "github-secret-token", login: "octocat" }, SECRET, {
    now: 1_000,
    ttlMs: 8 * 60 * 60 * 1000,
  });
  assert.equal(token.includes("github-secret-token"), false);
  const session = unseal(token, SECRET, { now: 2_000 });
  assert.equal(session.token, "github-secret-token");
  assert.equal(session.exp, 1_000 + 8 * 60 * 60 * 1000);
});

test("sealed sessions reject expiry and tampering", () => {
  const token = seal({ login: "octocat" }, SECRET, { now: 1_000, ttlMs: 1_000 });
  assert.throws(() => unseal(token, SECRET, { now: 2_000 }), /expired/u);
  const parts = token.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.throws(() => unseal(parts.join("."), SECRET, { now: 1_500 }), /Invalid sealed value/u);
});

test("repository input accepts canonical owner/name and rejects unsafe values", () => {
  assert.equal(validateRepository("octocat/hello-world"), "octocat/hello-world");
  for (const value of ["owner", "owner/repo/extra", "../repo", "owner/repo?x=1", "owner/. ."]) {
    assert.throws(() => validateRepository(value));
  }
});

test("BYOK validation accepts opaque provider keys and rejects unsafe input", () => {
  const key = `provider-${"x".repeat(32)}`;
  assert.equal(validateByokKey(key), key);
  for (const value of ["short", `provider ${"x".repeat(32)}`, `provider\n${"x".repeat(32)}`, "x".repeat(513)]) {
    assert.throws(() => validateByokKey(value));
  }
});

test("OpenAI credential verification confirms the active allowlisted model without returning the key", async () => {
  const apiKey = `provider-${"v".repeat(32)}`;
  let authorization;
  const result = await verifyOpenAIKey(apiKey, {
    fetchImpl: async (url, options) => {
      assert.equal(String(url), "https://api.openai.com/v1/models/gpt-5.6-luna");
      authorization = options.headers.authorization;
      assert.equal(options.redirect, "error");
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: "gpt-5.6-luna", object: "model", owned_by: "openai" };
        },
      };
    },
  });
  assert.equal(authorization, `Bearer ${apiKey}`);
  assert.deepEqual(result, { provider: "openai", model: "gpt-5.6-luna", verified: true });
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test("OpenAI credential verification fails closed before a secret can be saved", async () => {
  const apiKey = `provider-${"x".repeat(32)}`;
  await assert.rejects(
    verifyOpenAIKey(apiKey, {
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    /rejected this API key/u,
  );
});

test("runtime model validation rejects unsupported values before provider or GitHub access", () => {
  assert.equal(validateRuntimeModel("gpt-5.6-luna"), "gpt-5.6-luna");
  assert.equal(validateRuntimeModel("gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(validateRuntimeModel("gpt-5.6-sol"), "gpt-5.6-sol");
  for (const value of ["gpt-5.6", "deepseek-v4-flash", "gpt-5.6-luna\n", null]) {
    assert.throws(() => validateRuntimeModel(value), /Luna, Terra, or Sol/u);
  }
});

test("runtime policy changes only the reserved runtime object and preserves repository policy", () => {
  const original = `${JSON.stringify({
    version: 1,
    protectedPaths: { requireApproval: ["infra/**"], block: ["secrets/**"] },
    evidence: { requiredChecks: [{
      name: "test",
      appSlug: "github-actions",
      workflowPath: ".github/workflows/ci.yml",
    }], timeoutSeconds: 120 },
    runtime: { provider: "legacy", model: "legacy" },
  }, null, 2)}\n`;
  const updated = JSON.parse(buildRuntimePolicy(original, "gpt-5.6-terra"));
  assert.deepEqual(updated.protectedPaths, { requireApproval: ["infra/**"], block: ["secrets/**"] });
  assert.deepEqual(updated.evidence, { requiredChecks: [{
    name: "test",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
  }], timeoutSeconds: 120 });
  assert.deepEqual(updated.runtime, {
    funding: "byok",
    provider: "openai",
    secretName: "OPENAI_API_KEY",
    model: "gpt-5.6-terra",
    reasoningEffort: "high",
    managedSubscription: "reserved",
  });
  assert.deepEqual(JSON.parse(buildRuntimePolicy(original, "gpt-5.6-luna", "verify")).harness, {
    mode: "verify",
    maxAttempts: 2,
    budgetMinutes: 15,
  });
  const noEvidence = `${JSON.stringify({ version: 1, evidence: { requiredChecks: [] } })}\n`;
  assert.throws(
    () => buildRuntimePolicy(noEvidence, "gpt-5.6-luna", "verify"),
    /Verify only requires at least one exact behavioral check and publisher/u,
  );
});

test("autonomous mode requires one complete no-bypass merge-queue authority gate", () => {
  const active = {
    active: true,
    strict: true,
    mergeQueueRequired: true,
    guardRequired: true,
    publisherBound: true,
    evidenceRequired: true,
    evidencePublisherBound: true,
  };
  assert.equal(validateAutonomousBranchProtection(active), true);
  for (const value of [
    null,
    {},
    { ...active, active: false },
    { ...active, strict: false },
    { ...active, mergeQueueRequired: false },
    { ...active, guardRequired: false },
    { ...active, publisherBound: false },
    { ...active, evidenceRequired: false },
    { ...active, evidencePublisherBound: false },
  ]) {
    assert.throws(
      () => validateAutonomousBranchProtection(value),
      /one verified no-bypass GitHub merge gate/u,
    );
  }
});

test("the production canary provisioner requires one complete no-bypass authority Ruleset", () => {
  const evidenceChecks = [{ name: "CI / verify", integrationId: 15368 }];
  const ruleset = {
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "merge_queue" },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: "ChangePlane / guard", integration_id: 424242 },
            { context: "CI / verify", integration_id: 15368 },
          ],
        },
      },
    ],
  };
  const input = {
    rulesets: [ruleset],
    defaultBranch: "main",
    guardIntegrationId: 424242,
    evidenceChecks,
  };
  assert.equal(validateCanaryRulesets(input).active, true);
  assert.throws(
    () => validateCanaryRulesets({ ...input, rulesets: [] }),
    /ruleset_required/u,
    "missing ruleset",
  );
  for (const [name, mutate, expected] of [
    ["missing strict policy", (value) => { value.rules[1].parameters.strict_required_status_checks_policy = false; }, /strict_required/u],
    ["missing merge queue", (value) => { value.rules = value.rules.slice(1); }, /merge_queue_required/u],
    ["missing evidence", (value) => { value.rules[1].parameters.required_status_checks.pop(); }, /evidence_required/u],
    ["ambiguous target", (value) => { value.conditions.ref_name.include = ["release/*"]; }, /ruleset_ambiguous/u],
    ["bypass actor", (value) => { value.bypass_actors = [{ actor_id: 1 }]; }, /ruleset_ambiguous/u],
    ["guard publisher mismatch", (value) => { value.rules[1].parameters.required_status_checks[0].integration_id = 999; }, /publisher_binding_required/u],
    ["evidence publisher mismatch", (value) => { value.rules[1].parameters.required_status_checks[1].integration_id = 999; }, /evidence_publisher_binding_required/u],
  ]) {
    const candidate = structuredClone(ruleset);
    mutate(candidate);
    assert.throws(
      () => validateCanaryRulesets({ ...input, rulesets: [candidate] }),
      expected,
      name,
    );
  }
});

test("the production canary provisioner requires explicit evidence publisher identities", () => {
  assert.deepEqual(
    parseCanaryEvidenceChecks('[{"name":"CI / verify","integrationId":15368}]'),
    [{ name: "CI / verify", integrationId: 15368 }],
  );
  for (const value of [
    undefined,
    "not-json",
    "[]",
    '[{"name":"CI / verify","integrationId":0}]',
    '[{"name":"ChangePlane / guard","integrationId":15368}]',
    '[{"name":"CI / verify","integrationId":15368},{"name":"CI / verify","integrationId":15369}]',
  ]) {
    assert.throws(() => parseCanaryEvidenceChecks(value), /CHANGEPLANE_CANARY_EVIDENCE_CHECKS_JSON/u);
  }
});

test("the production canary provisioner requires the active positive generation", () => {
  assert.equal(validateRepairGeneration("7"), "7");
  for (const value of [undefined, "", "0", "-1", "1.5", "01", "9007199254740992"]) {
    assert.throws(() => validateRepairGeneration(value), /must be a positive integer/u);
  }
});

test("the production canary accepts only short-lived exact-repository installation credentials", () => {
  const repositoryId = 77;
  const permissions = { administration: "read" };
  const valid = {
    token: "ghs-exact-repository-token",
    expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    permissions: { administration: "read", metadata: "read" },
    repositories: [{ id: repositoryId }],
  };
  assert.equal(
    validateInstallationCredential(valid, { repositoryId, permissions }),
    valid.token,
  );

  for (const [name, mutate] of [
    ["wrong repository", (value) => { value.repositories[0].id = 78; }],
    ["multiple repositories", (value) => { value.repositories.push({ id: 79 }); }],
    ["widened permissions", (value) => { value.permissions.contents = "write"; }],
    ["missing requested permission", (value) => { delete value.permissions.administration; }],
    ["overlong lifetime", (value) => { value.expires_at = new Date(Date.now() + 66 * 60 * 1_000).toISOString(); }],
    ["expired", (value) => { value.expires_at = new Date(Date.now() - 1_000).toISOString(); }],
    ["unsafe token", (value) => { value.token = "ghs token"; }],
  ]) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.throws(
      () => validateInstallationCredential(candidate, { repositoryId, permissions }),
      /invalid exact-repository installation credential/u,
      name,
    );
  }
});

test("the production canary provisioner uses its exact repository and stays disabled on final policy drift", async () => {
  await sodium.ready;
  const directory = mkdtempSync(join(tmpdir(), "changeplane-canary-provisioner-"));
  const privateKeyPath = join(directory, "github-app.pem");
  const adminTokenPath = join(directory, "github-admin-token");
  const controllerSecretPath = join(directory, "controller-secret");
  const openAIKeyPath = join(directory, "openai-key");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  writeFileSync(adminTokenPath, "ghu-admin-token", { mode: 0o600 });
  writeFileSync(controllerSecretPath, "c".repeat(64), { mode: 0o600 });
  writeFileSync(openAIKeyPath, "opaque-test-provider-key", { mode: 0o600 });

  const names = [
    "CHANGEPLANE_GITHUB_APP_ID",
    "CHANGEPLANE_GUARD_APP_ID",
    "CHANGEPLANE_CANARY_REPOSITORY",
    "CHANGEPLANE_CANARY_REPOSITORY_ID",
    "CHANGEPLANE_CANARY_INSTALLATION_ID",
    "CHANGEPLANE_CANARY_EVIDENCE_CHECKS_JSON",
    "CHANGEPLANE_REPAIR_GENERATION",
    "CHANGEPLANE_GITHUB_APP_PRIVATE_KEY_PATH",
    "CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH",
    "CHANGEPLANE_CONTROLLER_SECRET_PATH",
    "CHANGEPLANE_OPENAI_KEY_PATH",
    "CHANGEPLANE_ENABLE_REPAIR",
  ];
  const originalEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    CHANGEPLANE_GITHUB_APP_ID: "101",
    CHANGEPLANE_GUARD_APP_ID: "424242",
    CHANGEPLANE_CANARY_REPOSITORY: "acme/canary",
    CHANGEPLANE_CANARY_REPOSITORY_ID: "77",
    CHANGEPLANE_CANARY_INSTALLATION_ID: "44",
    CHANGEPLANE_CANARY_EVIDENCE_CHECKS_JSON: '[{"name":"CI / verify","integrationId":15368}]',
    CHANGEPLANE_REPAIR_GENERATION: "7",
    CHANGEPLANE_GITHUB_APP_PRIVATE_KEY_PATH: privateKeyPath,
    CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH: adminTokenPath,
    CHANGEPLANE_CONTROLLER_SECRET_PATH: controllerSecretPath,
    CHANGEPLANE_OPENAI_KEY_PATH: openAIKeyPath,
    CHANGEPLANE_ENABLE_REPAIR: "true",
  });

  const box = sodium.crypto_box_keypair();
  const repositoryPublicKey = sodium.to_base64(box.publicKey, sodium.base64_variants.ORIGINAL);
  const originalFetch = globalThis.fetch;
  const expectedPrefix = [
    "CHANGEPLANE_REPAIR_ENABLED",
    "CHANGEPLANE_CONTROLLER_HMAC",
    "CHANGEPLANE_CONTROLLER_INSTALLATION_ID",
    "CHANGEPLANE_REPAIR_GENERATION",
    "CHANGEPLANE_REPAIR_PUBLIC_KEYS",
    "CHANGEPLANE_CONTROLLER_HMAC_V12",
    "OPENAI_API_KEY",
  ];
  try {
    for (const scenario of [
      { name: "eligible first creation", finalComplete: true, secretStatus: 201 },
      { name: "merge queue removed before activation update", finalComplete: false, secretStatus: 204 },
    ]) {
      const calls = [];
      const writes = [];
      let rulesetReads = 0;
      globalThis.fetch = async (url, options = {}) => {
        const requestUrl = new URL(String(url));
        const method = options.method ?? "GET";
        calls.push(`${method} ${requestUrl.pathname}`);
        if (method === "POST" && requestUrl.pathname === "/app/installations/44/access_tokens") {
          const request = JSON.parse(String(options.body));
          assert.deepEqual(request.repository_ids, [77]);
          return new Response(JSON.stringify({
            token: request.permissions.administration === "read"
              ? "ghs-administration-read-token"
              : "ghs-secrets-write-token",
            expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
            permissions: request.permissions,
            repositories: [{ id: 77 }],
          }), { status: 200 });
        }
        if (method === "GET" && requestUrl.pathname === "/repos/acme/canary") {
          return new Response(JSON.stringify({
            id: 77,
            full_name: "acme/canary",
            default_branch: "main",
            permissions: { admin: true },
          }), { status: 200 });
        }
        if (method === "GET" && requestUrl.pathname === "/repositories/77") {
          return new Response(JSON.stringify({
            id: 77,
            full_name: "acme/canary",
            default_branch: "main",
            archived: false,
            disabled: false,
          }), { status: 200 });
        }
        if (method === "GET" && requestUrl.pathname === "/repos/acme/canary/rulesets") {
          assert.equal(requestUrl.searchParams.get("includes_parents"), "true");
          return new Response(JSON.stringify([{ id: 42 }]), { status: 200 });
        }
        if (method === "GET" && requestUrl.pathname === "/repos/acme/canary/rulesets/42") {
          rulesetReads += 1;
          return new Response(JSON.stringify({
            id: 42,
            target: "branch",
            enforcement: "active",
            bypass_actors: [],
            conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
            rules: [
              ...(rulesetReads === 1 || scenario.finalComplete ? [{ type: "merge_queue" }] : []),
              {
                type: "required_status_checks",
                parameters: {
                  strict_required_status_checks_policy: true,
                  required_status_checks: [
                    { context: "ChangePlane / guard", integration_id: 424242 },
                    { context: "CI / verify", integration_id: 15368 },
                  ],
                },
              },
            ],
          }), { status: 200 });
        }
        if (method === "GET" && requestUrl.pathname === "/repos/acme/canary/actions/secrets/public-key") {
          return new Response(JSON.stringify({
            key_id: "repository-key-1",
            key: repositoryPublicKey,
          }), { status: 200 });
        }
        if (method === "PUT" && requestUrl.pathname.startsWith("/repos/acme/canary/actions/secrets/")) {
          writes.push(requestUrl.pathname.split("/").at(-1));
          const body = JSON.parse(String(options.body));
          assert.equal(body.key_id, "repository-key-1");
          assert.equal(typeof body.encrypted_value, "string");
          return new Response(null, { status: scenario.secretStatus });
        }
        throw new Error(`Unexpected ${scenario.name} request: ${method} ${requestUrl.pathname}`);
      };

      let output = "";
      if (scenario.finalComplete) {
        await provisionRepairCanary({ writeOutput: (value) => { output += value; } });
        assert.deepEqual(writes, [...expectedPrefix, "CHANGEPLANE_REPAIR_ENABLED"]);
        assert.deepEqual(JSON.parse(output), {
          repository: "acme/canary",
          installationId: 44,
          repairGeneration: "7",
          keyId: JSON.parse(output).keyId,
          controllerSecretStored: true,
          openAIStored: true,
          repairEnabled: true,
        });
      } else {
        await assert.rejects(
          provisionRepairCanary({ writeOutput: (value) => { output += value; } }),
          /merge_queue_required/u,
        );
        assert.deepEqual(writes, expectedPrefix);
        assert.equal(output, "");
      }
      assert.equal(rulesetReads, 2);
      assert.equal(calls.filter((call) => call === "POST /app/installations/44/access_tokens").length, 2);
      assert.equal(
        calls.filter((call) => call.includes("/actions/secrets/")).every(
          (call) => call.includes("/repos/acme/canary/actions/secrets/"),
        ),
        true,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (originalEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnvironment[name];
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fresh onboarding cannot bootstrap Autonomous authority or touch GitHub", async () => {
  await withGitHubAppEnvironment(async () => {
    Object.assign(process.env, {
      CHANGEPLANE_SELF_SERVE_ENABLED: "true",
      CHANGEPLANE_REPAIR_ENABLED: "true",
      CHANGEPLANE_REPAIR_GENERATION: "1",
      CHANGEPLANE_CONTROLLER_SECRET: "c".repeat(64),
      GITHUB_APP_ID: "101",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-used-before-rejection\n-----END PRIVATE KEY-----",
    });
    const session = seal({
      kind: "session",
      token: "ghu-user-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "github_app",
      installationId: "123",
      installationIds: ["123"],
      byokSecretWrite: true,
    }, SECRET);
    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      externalCalls += 1;
      throw new Error("fresh autonomous rejection must happen before GitHub access");
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          origin: "https://changeplane.example",
          cookie: `__Host-changeplane_session=${session}`,
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: {
          repository: "alice/private-service",
          requiredCheck: {
            name: "CI / verify",
            appSlug: "github-actions",
            workflowPath: ".github/workflows/ci.yml",
          },
          harnessMode: "autonomous",
        },
      }, response);
      assert.equal(response.statusCode, 409, response.body);
      assert.match(JSON.parse(response.body).error, /Install Verify Lite first/u);
      assert.equal(externalCalls, 0);

      await assert.rejects(
        prepareAutonomousHarness("alice/private-service", {
          token: "ghu-user-token",
          authMode: "github_app",
          installationId: "123",
        }, { state: "fresh" }),
        /Install Verify Lite first/u,
      );
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("runtime API rejects an unsupported model before GitHub access", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { called = true; throw new Error("network should not be reached"); };
    try {
      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=runtime",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", model: "gpt-5.6" },
      }, response);
      assert.equal(response.statusCode, 400);
      assert.match(JSON.parse(response.body).error, /Luna, Terra, or Sol/u);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("managed setup defaults to Verify Lite and keeps Full Autonomous explicit", () => {
  const files = new Map(buildSetupFiles().map((file) => [file.path, file.content]));
  assert.equal(files.size, 9);
  for (const expected of [
    "changeplane/action.yml",
    "changeplane/action/index.js",
    "changeplane/src/lib/changeplane.js",
    "changeplane/src/lib/harness.js",
    "changeplane/examples/changeplane-evidence-policy.js",
    "changeplane/package.json",
    "changeplane/manifest.json",
    ".changeplane.json",
    ".github/workflows/changeplane.yml",
  ]) assert.equal(files.has(expected), true, `missing ${expected}`);
  for (const privilegedPath of [
    "changeplane/src/lib/review.js",
    "changeplane/src/lib/runtime.js",
    "changeplane/server/github-repair-controller.js",
    "changeplane/server/repair-ledger.js",
    "changeplane/examples/changeplane-provider-openai.js",
    "changeplane/examples/changeplane-review-openai.js",
    "changeplane/examples/changeplane-review-run.js",
    ".changeplane/assurance.md",
    ".github/workflows/changeplane-repair.yml",
  ]) assert.equal(files.has(privilegedPath), false, `Verify Lite must omit ${privilegedPath}`);

  const manifest = JSON.parse(files.get("changeplane/manifest.json"));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.managedVersion, 15);
  assert.equal(manifest.managedProfile, "verify-lite");
  assert.equal(Object.hasOwn(manifest.managedFiles, ".changeplane.json"), false);
  assert.deepEqual(Object.keys(manifest.managedFiles).sort(), [
    ".github/workflows/changeplane.yml",
    "changeplane/action.yml",
    "changeplane/action/index.js",
    "changeplane/examples/changeplane-evidence-policy.js",
    "changeplane/package.json",
    "changeplane/src/lib/changeplane.js",
    "changeplane/src/lib/harness.js",
  ]);

  const fullFiles = new Map(buildSetupFiles({
    name: "CI / test",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
  }, "autonomous").map((file) => [file.path, file.content]));
  assert.equal(fullFiles.size, 21);
  for (const expected of [
    "changeplane/src/lib/review.js",
    "changeplane/src/lib/runtime.js",
    "changeplane/server/github-repair-controller.js",
    "changeplane/server/repair-ledger.js",
    "changeplane/examples/changeplane-claim.js",
    "changeplane/examples/changeplane-grant.js",
    "changeplane/examples/changeplane-proposal.js",
    "changeplane/examples/changeplane-provider-openai.js",
    "changeplane/examples/changeplane-review-openai.js",
    "changeplane/examples/changeplane-review-run.js",
    ".changeplane/assurance.md",
    ".github/workflows/changeplane-repair.yml",
  ]) assert.equal(fullFiles.has(expected), true, `Full Autonomous is missing ${expected}`);
  const fullManifest = JSON.parse(fullFiles.get("changeplane/manifest.json"));
  assert.equal(fullManifest.schemaVersion, 2);
  assert.equal(fullManifest.managedVersion, 15);
  assert.equal(fullManifest.managedProfile, "full");
  assert.equal(Object.keys(fullManifest.managedFiles).length, 18);

  const liteWorkflow = files.get(".github/workflows/changeplane.yml");
  assert.match(liteWorkflow, /Evaluate the exact pull-request revision/u);
  assert.match(liteWorkflow, /agent_dispatch: none/u);
  assert.match(liteWorkflow, /permissions:\n  actions: read\n  checks: read\n  id-token: write/u);
  assert.doesNotMatch(liteWorkflow, /checks: write/u);
  assert.doesNotMatch(liteWorkflow, /review_propose:|review_publish:|OPENAI_API_KEY|CONTROLLER_HMAC|CONTROLLER_INSTALLATION_ID/u);

  const workflow = fullFiles.get(".github/workflows/changeplane.yml");
  assert.match(workflow, /pull_request_target:/u);
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited\]/u);
  assert.doesNotMatch(workflow, /\n  push:/u);
  assert.match(workflow, /deployment_status:/u);
  assert.match(workflow, /merge_group:\n    types: \[checks_requested\]/u);
  assert.match(workflow, /repository_dispatch:\n    types: \[changeplane_recheck\]/u);
  assert.match(workflow, /uses: \.\/changeplane/u);
  assert.match(workflow, /Read the trusted harness policy/u);
  assert.match(workflow, /if: github\.event_name != 'merge_group' && steps\.harness\.outputs\.mode == 'observe'/u);
  assert.match(workflow, /if: github\.event_name != 'merge_group' && steps\.harness\.outputs\.mode == 'enforce' && steps\.harness\.outputs\.dispatch == 'none'/u);
  assert.match(workflow, /if: github\.event_name != 'merge_group' && steps\.harness\.outputs\.mode == 'enforce' && steps\.harness\.outputs\.dispatch == 'webhook'/u);
  assert.match(workflow, /agent_dispatch: \$\{\{ steps\.harness\.outputs\.dispatch \}\}/u);
  assert.match(workflow, /max_remediation_attempts: \$\{\{ steps\.harness\.outputs\.max_attempts \}\}/u);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/u);
  const workflowPermissions = workflow.match(/permissions:\n([\s\S]*?)\nconcurrency:/u)?.[1] ?? "";
  assert.match(workflowPermissions, /checks: read/u);
  assert.match(workflowPermissions, /id-token: write/u);
  assert.doesNotMatch(workflowPermissions, /checks: write/u);
  assert.match(workflow, /pull-requests: write/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /deployments: read/u);
  assert.match(workflow, /statuses: read/u);
  assert.match(workflow, /group: changeplane-pr-\$\{\{ github.event_name == 'schedule' && 'reconcile' \|\| github.event_name == 'workflow_dispatch' && 'reconcile' \|\| github\.event\.pull_request\.number \|\| github\.event\.client_payload\.pullRequestNumber \|\| github\.event\.merge_group\.head_sha \|\| github\.event\.deployment\.sha \|\| github\.run_id \}\}/u);
  assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/u);
  assert.match(workflow, /ref: \$\{\{ github\.event\.merge_group\.base_sha \|\| \(github\.event\.pull_request\.base\.ref == github\.event\.repository\.default_branch && github\.event\.pull_request\.base\.sha\) \|\| github\.event\.repository\.default_branch \}\}/u);
  assert.match(workflow, /Bind the trusted controller revision/u);
  assert.match(workflow, /trusted_controller_sha: \$\{\{ steps\.controller\.outputs\.sha \}\}/u);
  const guardJob = workflow.match(/  guard:\n([\s\S]*?)\n  reconcile:/u)?.[1] ?? "";
  assert.doesNotMatch(guardJob, /\n    concurrency:/u);
  const verifyStep = guardJob.match(/- name: Verify the exact revision without repair authority\n([\s\S]*?)(?=\n      - name: Run the autonomous exact-revision harness)/u)?.[1] ?? "";
  assert.match(verifyStep, /agent_dispatch: none/u);
  assert.match(verifyStep, /mode: enforce/u);
  assert.doesNotMatch(verifyStep, /OPENAI_API_KEY|CONTROLLER_HMAC|CONTROLLER_INSTALLATION_ID|agent_webhook/u);
  const autonomousStep = guardJob.match(/- name: Run the autonomous exact-revision harness\n([\s\S]*?)(?=\n      - name: Evaluate the merge queue without repair authority)/u)?.[1] ?? "";
  assert.match(autonomousStep, /agent_dispatch: \$\{\{ steps\.harness\.outputs\.dispatch \}\}/u);
  assert.match(autonomousStep, /CHANGEPLANE_CONTROLLER_HMAC_V12/u);
  assert.match(autonomousStep, /CHANGEPLANE_CONTROLLER_INSTALLATION_ID/u);
  const mergeQueueStep = guardJob.match(/- name: Evaluate the merge queue without repair authority\n([\s\S]*)$/u)?.[1] ?? "";
  assert.match(mergeQueueStep, /if: github\.event_name == 'merge_group'/u);
  assert.match(mergeQueueStep, /mode: \$\{\{ steps\.harness\.outputs\.mode \}\}/u);
  assert.match(mergeQueueStep, /agent_dispatch: none/u);
  assert.doesNotMatch(mergeQueueStep, /OPENAI_API_KEY|CONTROLLER_HMAC|CONTROLLER_INSTALLATION_ID|agent_webhook/u);
  const reviewProposalJob = workflow.match(/  review_propose:\n([\s\S]*?)\n  review_publish:/u)?.[1] ?? "";
  const reviewPublisherJob = workflow.match(/  review_publish:\n([\s\S]*)$/u)?.[1] ?? "";
  assert.match(reviewProposalJob, /Independent review proposal/u);
  assert.match(reviewProposalJob, /Read the trusted review profile/u);
  assert.match(reviewProposalJob, /if: steps\.harness\.outputs\.mode != 'enforce' \|\| steps\.harness\.outputs\.dispatch == 'webhook'/u);
  assert.match(reviewProposalJob, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/u);
  assert.match(reviewProposalJob, /CHANGEPLANE_TRUSTED_CONTROLLER_SHA: \$\{\{ steps\.controller\.outputs\.sha \}\}/u);
  assert.match(reviewProposalJob, /pull-requests: read/u);
  assert.doesNotMatch(reviewProposalJob, /checks: write/u);
  assert.match(reviewPublisherJob, /Independent review receipt/u);
  assert.match(reviewPublisherJob, /needs\.review_propose\.outputs\.review_job != ''/u);
  assert.match(reviewPublisherJob, /checks: write/u);
  assert.match(reviewPublisherJob, /CHANGEPLANE_REVIEW_JOB: \$\{\{ needs\.review_propose\.outputs\.review_job \}\}/u);
  assert.match(reviewPublisherJob, /CHANGEPLANE_TRUSTED_CONTROLLER_SHA: \$\{\{ steps\.controller\.outputs\.sha \}\}/u);
  assert.doesNotMatch(reviewPublisherJob, /OPENAI_API_KEY/u);
  const actionMetadata = files.get("changeplane/action.yml");
  const actionInputs = actionMetadata.match(/inputs:\n([\s\S]*?)outputs:/u)?.[1] ?? "";
  assert.match(actionMetadata, /name: ChangePlane Guard/u);
  assert.match(actionMetadata, /revision-bound assurance harness in Observe, Verify only, or Autonomous profile/u);
  assert.match(actionInputs, /^  mode:/mu);
  assert.match(actionInputs, /^  agent_dispatch:/mu);
  assert.match(actionInputs, /^  controller_installation_id:/mu);
  assert.match(actionInputs, /^  max_remediation_attempts:/mu);
  assert.match(actionInputs, /^  trusted_controller_sha:/mu);
  assert.match(actionMetadata, /^  agent_handback:/mu);
  assert.match(actionMetadata, /^  assurance_passport:/mu);
  assert.match(actionMetadata, /^  assurance_passport_digest:/mu);
  const installerSource = readFileSync(new URL("../api/github.js", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(appSource, /Agentic SDLC assurance/u);
  assert.match(appSource, /keeps intent, review, evidence, and delivery tied to the exact commit/u);
  assert.match(appSource, /Portable evidence, never portable authority/u);
  assert.match(installerSource, /\*\*Done when:\*\* open or update one normal pull request/u);
  assert.match(installerSource, /\*\*Neutral\*\* means ChangePlane reported findings without changing merge rules/u);
  assert.match(installerSource, /\*\*Scope only\*\* means the exact commit and files were checked/u);
  assert.match(installerSource, /Open this repository's pull requests/u);
  assert.match(installerSource, /\*\*Behavior checks: none configured\*\*/u);
  assert.match(installerSource, /receipts prove the exact commit and file scope only/u);
  assert.match(installerSource, /\*\*Behavior check configured:\*\*/u);
  assert.match(installerSource, /The receipt will not claim that the code works/u);
  const policy = JSON.parse(files.get(".changeplane.json"));
  assert.equal(policy.version, 1);
  assert.deepEqual(policy.evidence, {
    requiredChecks: [],
    protectedPaths: [
      ".changeplane.json", ".github/workflows/**", "changeplane/**",
      "test/**", "tests/**", "spec/**", "specs/**", "__tests__/**", "e2e/**", "cypress/**",
      "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
      "pyproject.toml", "pytest.ini", "tox.ini", "poetry.lock", "Pipfile", "Pipfile.lock",
      "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "pom.xml", "build.gradle", "build.gradle.kts",
      "gradle.lockfile", "composer.json", "composer.lock", "Makefile",
    ],
    timeoutSeconds: 0,
  });
  assert.deepEqual(policy.harness, { mode: "observe", maxAttempts: 2, budgetMinutes: 15 });
  assert.deepEqual(policy.review, {
    mode: "off",
    maxFindings: 0,
  });
  assert.equal(files.has(".changeplane/assurance.md"), false);
  const fullPolicy = JSON.parse(fullFiles.get(".changeplane.json"));
  assert.deepEqual(fullPolicy.review, {
    mode: "advisory",
    maxFindings: 5,
    memoryPath: ".changeplane/assurance.md",
  });
  assert.match(fullFiles.get(".changeplane/assurance.md"), /repository-owned context for independent review/u);
  assert.deepEqual(policy.runtime, {
    funding: "byok",
    provider: "openai",
    secretName: "OPENAI_API_KEY",
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    managedSubscription: "reserved",
  });

  const behaviorFiles = new Map(buildSetupFiles({
    name: "CI / test",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
  }).map((file) => [file.path, file.content]));
  assert.deepEqual(JSON.parse(behaviorFiles.get(".changeplane.json")).evidence, {
    requiredChecks: [{
      name: "CI / test",
      appSlug: "github-actions",
      workflowPath: ".github/workflows/ci.yml",
    }],
    protectedPaths: [
      ".changeplane.json", ".github/workflows/**", "changeplane/**",
      "test/**", "tests/**", "spec/**", "specs/**", "__tests__/**", "e2e/**", "cypress/**",
      "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
      "pyproject.toml", "pytest.ini", "tox.ini", "poetry.lock", "Pipfile", "Pipfile.lock",
      "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "pom.xml", "build.gradle", "build.gradle.kts",
      "gradle.lockfile", "composer.json", "composer.lock", "Makefile",
    ],
    timeoutSeconds: 120,
  });
  const autonomousFiles = new Map(buildSetupFiles({
    name: "CI / test",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
  }, "autonomous").map((file) => [file.path, file.content]));
  assert.deepEqual(JSON.parse(autonomousFiles.get(".changeplane.json")).harness, {
    mode: "autonomous",
    maxAttempts: 2,
    budgetMinutes: 15,
  });
  const verifyFiles = new Map(buildSetupFiles({
    name: "CI / test",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
  }, "verify").map((file) => [file.path, file.content]));
  assert.deepEqual(JSON.parse(verifyFiles.get(".changeplane.json")).harness, {
    mode: "verify",
    maxAttempts: 2,
    budgetMinutes: 15,
  });
  assert.throws(() => buildSetupFiles(null, "verify"), /Verify only requires one exact behavioral check/u);
  assert.throws(() => buildSetupFiles(null, "autonomous"), /exact behavioral check/u);
  for (const appSlug of ["not a valid slug", "bad.slug", "bad_slug", "bad-"]) {
    assert.throws(
      () => buildSetupFiles({ name: "test", appSlug }),
      /valid GitHub App slug/u,
    );
  }
  assert.throws(
    () => buildSetupFiles({ name: "ChangePlane / guard", appSlug: "github-actions" }),
    /cannot be ChangePlane \/ guard/u,
  );
  for (const reservedName of ["ChangePlane guard", "ChangePlane / review"]) {
    assert.throws(
      () => buildSetupFiles({ name: reservedName, appSlug: "github-actions" }),
      /cannot be ChangePlane \/ guard/u,
    );
  }
});

test("managed install classification protects policy and rejects modified reserved bytes", () => {
  const currentFiles = Object.fromEntries(buildSetupFiles().map(({ path, content }) => [path, content]));
  currentFiles[".changeplane.json"] = `${JSON.stringify({
    version: 1,
    protectedPaths: { requireApproval: ["custom/**"], block: [] },
    evidence: { requiredChecks: [], timeoutSeconds: 0 },
  }, null, 2)}\n`;
  const reservedEntries = Object.keys(currentFiles).filter((filePath) => filePath.startsWith("changeplane/"));
  assert.deepEqual(classifyManagedInstallation({ files: currentFiles, reservedEntries }), {
    state: "current",
    currentVersion: 15,
    targetVersion: 15,
    managedProfile: "verify-lite",
    conflicts: [],
  });

  const installerSource = readFileSync(new URL("../api/github.js", import.meta.url), "utf8");
  assert.match(installerSource, /\n  6: Object\.freeze\(\{/u);
  assert.match(installerSource, /\n  7: Object\.freeze\(\{/u);
  assert.match(installerSource, /\n  8: Object\.freeze\(\{/u);
  assert.match(installerSource, /\n  9: Object\.freeze\(\{/u);
  assert.match(installerSource, /\n  10: Object\.freeze\(\{/u);
  assert.match(installerSource, /"changeplane\/action\/index\.js": "94bad97303c1abe64b1e904045d90f4b0186f301957d50fe17d131b417898041"/u);
  assert.match(installerSource, /"changeplane\/examples\/changeplane-evidence-policy\.js": "cc8521368126ccf23a31564633ac80cc393ff270c0e6e5f4588b9cb3c0a1fd7e"/u);
  assert.match(installerSource, /"changeplane\/action\/index\.js": "ea330794dfc3c9cd2cf1753a67f72cd0fdd71cb6946e80fbb7fe5a97dca71bf2"/u);
  assert.match(installerSource, /"\.github\/workflows\/changeplane\.yml": "f8a241d54c5a84c24ce2b333c25ca688f6f0f81dceb1ae65337057d4881c41f2"/u);
  assert.match(installerSource, /"changeplane\/examples\/changeplane-provider-openai\.js": "28c2264457b438d4e0830d1c378121c1892b0883888068e4fa95a4b2708373bb"/u);
  assert.match(installerSource, /"changeplane\/examples\/changeplane-provider-openai\.js": "f217665808dadfd180c960e6a1ab583b1e0d9d3c217578575e3cbf423eb348f8"/u);
  const legacyFiles = { ...currentFiles, "changeplane/manifest.json": null };
  assert.deepEqual(classifyManagedInstallation({ files: legacyFiles, reservedEntries: reservedEntries.filter((path) => path !== "changeplane/manifest.json") }), {
    state: "conflict",
    currentVersion: null,
    targetVersion: 15,
    conflicts: [".github/workflows/changeplane.yml"],
  });

  const modifiedFiles = { ...currentFiles, "changeplane/action/index.js": "repository-owned modification\n" };
  const modified = classifyManagedInstallation({ files: modifiedFiles, reservedEntries });
  assert.equal(modified.state, "conflict");
  assert.deepEqual(modified.conflicts, ["changeplane/action/index.js"]);

  const reservedConflict = classifyManagedInstallation({
    files: currentFiles,
    reservedEntries: [...reservedEntries, "changeplane/custom-hook.js"],
  });
  assert.equal(reservedConflict.state, "conflict");
  assert.deepEqual(reservedConflict.conflicts, ["changeplane/custom-hook.js"]);

  const repairWorkflowConflict = classifyManagedInstallation({
    files: {
      ...currentFiles,
      ".github/workflows/changeplane-repair.yml": "name: repository-owned repair\n",
    },
    reservedEntries: [...reservedEntries, ".github/workflows/changeplane-repair.yml"],
  });
  assert.equal(repairWorkflowConflict.state, "conflict");
  assert.deepEqual(repairWorkflowConflict.conflicts, [".github/workflows/changeplane-repair.yml"]);
});

test("every installed profile includes a separate least-privilege reconciliation job", () => {
  for (const mode of ["verify", "autonomous"]) {
    const files = buildSetupFiles({
      name: "CI / verify",
      appSlug: "github-actions",
      workflowPath: ".github/workflows/ci.yml",
    }, mode);
    const workflow = files.find((file) => file.path === ".github/workflows/changeplane.yml").content;
    assert.match(workflow, /schedule:\n    - cron: "\*\/5 \* \* \* \*"\n  workflow_dispatch:/u);
    assert.match(workflow, /guard:\n    name: ChangePlane guard\n    if: github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'/u);
    assert.match(workflow, /github.event_name == 'schedule' && 'reconcile' \|\| github.event_name == 'workflow_dispatch' && 'reconcile'/u);
    const reconciliation = workflow.split("\n  reconcile:\n")[1]?.split("\n  review_propose:\n")[0];
    assert.ok(reconciliation, `${mode} installation is missing scheduled Guard recovery`);
    assert.match(reconciliation, /if: github.event_name == 'schedule' \|\| github.event_name == 'workflow_dispatch'/u);
    assert.match(reconciliation, /permissions:\n      contents: read\n      id-token: write\n    steps:/u);
    assert.match(reconciliation, /ref: \$\{\{ github.event.repository.default_branch \}\}\n          persist-credentials: false/u);
    assert.match(reconciliation, /operation: reconcile/u);
    assert.match(reconciliation, /trusted_controller_sha: \$\{\{ steps.controller.outputs.sha \}\}/u);
    assert.match(reconciliation, /if: steps.reconcile.outputs.decision == 'ACTION_REQUIRED'[\s\S]*exit 1/u);
    assert.doesNotMatch(reconciliation, /secrets\.|checks: write|contents: write|pull-requests:|OPENAI|agent_dispatch|harness\.js|review-run|operation: evaluate/u);
    for (const action of reconciliation.matchAll(/uses: (actions\/[^\n]+)/gu)) {
      assert.match(action[1], /^actions\/[a-z-]+@[a-f0-9]{40}$/u);
    }
  }
});

test("v13 profiles preserve their immutable hashes and upgrade without adding another profile's authority", () => {
  for (const [profile, workflowHash, count] of [
    ["full", "71919b7998ce010f25e1b078febd7722a8c4662504ec3ac6cc3b4a4a0f262b1b", 18],
    ["verify-lite", "550ef2f0fd030686ac5b2d9b285cbc0019d751a171e239515f86f61279de1f20", 7],
  ]) {
    const previous = managedVersionSnapshot(13, profile);
    const current = managedVersionSnapshot(15, profile);
    assert.equal(previous.managedProfile, profile);
    assert.equal(previous.managedHashes[".github/workflows/changeplane.yml"], workflowHash);
    assert.equal(Object.keys(previous.managedHashes).length, count);
    assert.deepEqual(Object.keys(current.managedHashes), Object.keys(previous.managedHashes));
    assert.notEqual(current.managedHashes[".github/workflows/changeplane.yml"], workflowHash);
    const classification = {
      digests: { ...previous.managedHashes },
      manifest: previous.manifest,
      policyPresent: true,
      reservedEntries: Object.keys(previous.managedHashes),
    };
    assert.deepEqual(classifyManagedInstallationDigests(classification), {
      state: "outdated",
      currentVersion: 13,
      targetVersion: 15,
      managedProfile: profile,
      conflicts: [],
    });
    classification.digests[".github/workflows/changeplane.yml"] = "f".repeat(64);
    assert.deepEqual(classifyManagedInstallationDigests(classification).conflicts, [".github/workflows/changeplane.yml"]);
  }
});

test("a Verify Lite managed upgrade preserves its profile and repository policy", async () => {
  const check = { name: "CI / verify", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml" };
  const files = new Map(buildSetupFiles(check, "verify").map((file) => [file.path, file.content]));
  files.set("changeplane/manifest.json", managedVersionSnapshot(13, "verify-lite").manifest);
  files.set(".github/workflows/changeplane.yml", "name: Previous reviewed ChangePlane workflow\n");
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const baseTreeSha = "c".repeat(40);
  const newTreeSha = "d".repeat(40);
  const mutations = [];
  const blobs = new Map();
  let upgradeTree = [];
  const originalFetch = globalThis.fetch;
  let branchCreated = false;
  globalThis.fetch = async (request, options = {}) => {
    const url = new URL(String(request));
    const method = options.method ?? "GET";
    if (method === "POST") {
      const body = JSON.parse(options.body);
      mutations.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/git/blobs")) {
        const sha = createHash("sha1").update(`blob ${Buffer.byteLength(body.content)}\0`).update(body.content).digest("hex");
        blobs.set(sha, body.content);
        return githubJsonResponse({ sha }, 201);
      }
      if (url.pathname.endsWith("/git/trees")) {
        upgradeTree = body.tree;
        return githubJsonResponse({ sha: newTreeSha }, 201);
      }
      if (url.pathname.endsWith("/git/commits")) return githubJsonResponse({ sha: headSha }, 201);
      if (url.pathname.endsWith("/git/refs")) {
        branchCreated = true;
        return githubJsonResponse({ ref: body.ref, object: { sha: headSha } }, 201);
      }
      if (url.pathname.endsWith("/pulls")) return githubJsonResponse({
        number: 17, html_url: "https://github.com/alice/service/pull/17", state: "open",
        body: body.body, base: { sha: baseSha }, head: { sha: headSha },
      }, 201);
    }
    if (url.pathname.includes("/contents/")) {
      const filePath = decodeURIComponent(url.pathname.split("/contents/")[1]);
      if (url.searchParams.get("ref") === headSha) {
        const entry = upgradeTree.find(({ path }) => path === filePath);
        return githubJsonResponse({ type: "file", encoding: "base64", sha: entry.sha,
          content: Buffer.from(blobs.get(entry.sha)).toString("base64") });
      }
      return files.has(filePath) ? managedFileResponse(files.get(filePath)) : githubJsonResponse({}, 404);
    }
    if (url.pathname.endsWith("/pulls")) return githubJsonResponse([]);
    if (url.pathname.endsWith("/git/ref/heads/main")) return githubJsonResponse({ object: { sha: baseSha } });
    if (url.pathname.endsWith("/git/ref/heads/changeplane/observe-upgrade-v15")) {
      return branchCreated ? githubJsonResponse({ object: { sha: headSha } }) : githubJsonResponse({}, 404);
    }
    if (url.pathname.endsWith(`/git/commits/${baseSha}`)) return githubJsonResponse({ tree: { sha: baseTreeSha } });
    if (url.pathname.endsWith(`/git/commits/${headSha}`)) {
      return githubJsonResponse({ tree: { sha: newTreeSha }, parents: [{ sha: baseSha }] });
    }
    if (url.pathname.endsWith(`/git/trees/${newTreeSha}`)) return githubJsonResponse({ tree: upgradeTree, truncated: false });
    if (url.pathname.endsWith(`/compare/${baseSha}...${headSha}`)) return githubJsonResponse({
      base_commit: { sha: baseSha }, merge_base_commit: { sha: baseSha },
      ahead_by: 1, behind_by: 0, total_commits: 1,
      files: upgradeTree.map(({ path }) => ({ filename: path, status: "modified" })),
    });
    throw new Error(`Unexpected upgrade request: ${method} ${url.pathname}`);
  };
  try {
    const result = await createObserveUpgradePullRequest({
      encodedRepository: "alice/service",
      repo: { full_name: "alice/service", owner: { login: "alice" }, default_branch: "main", permissions: { admin: true } },
      baseSha,
    }, { token: "test-upgrade-token" });
    assert.equal(result.managedProfile, "verify-lite");
    assert.equal(result.managedVersion, 15);
    assert.equal(result.policyIncluded, false);
    const tree = mutations.find(({ path }) => path.endsWith("/git/trees")).body;
    assert.equal(tree.base_tree, baseTreeSha);
    assert.deepEqual(tree.tree.map(({ path }) => path).sort(), [
      ".github/workflows/changeplane.yml", "changeplane/manifest.json",
    ]);
    const manifestBlob = mutations.filter(({ path }) => path.endsWith("/git/blobs"))
      .map(({ body }) => body.content).find((content) => content.includes('"managedFiles"'));
    assert.equal(JSON.parse(manifestBlob).managedProfile, "verify-lite");
    assert.equal(Object.keys(JSON.parse(manifestBlob).managedFiles).length, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runtime trusts a managed profile only after exact tree and reserved-path verification", () => {
  const policy = `${JSON.stringify({
    version: 1,
    harness: { mode: "verify", maxAttempts: 2, budgetMinutes: 15 },
  }, null, 2)}\n`;
  const liteManifest = managedVersionSnapshot(15, "verify-lite").manifest;
  const liteTree = managedRuntimeTreeFixture("verify-lite", policy).payload.tree;
  assert.deepEqual(classifyManagedRuntimeTree({
    manifest: liteManifest,
    policy,
    treeEntries: liteTree,
  }), {
    state: "current",
    managedProfile: "verify-lite",
    conflicts: [],
  });

  const injectedRepair = [
    ...liteTree,
    {
      path: ".github/workflows/changeplane-repair.yml",
      type: "blob",
      mode: "100644",
      sha: "e".repeat(40),
    },
  ];
  assert.deepEqual(classifyManagedRuntimeTree({
    manifest: liteManifest,
    policy,
    treeEntries: injectedRepair,
  }), {
    state: "conflict",
    managedProfile: null,
    conflicts: [".github/workflows/changeplane-repair.yml"],
  });

  const forgedFullProfile = classifyManagedRuntimeTree({
    manifest: managedVersionSnapshot(15, "full").manifest,
    policy,
    treeEntries: liteTree,
  });
  assert.equal(forgedFullProfile.state, "conflict");
  assert.equal(forgedFullProfile.managedProfile, null);
  assert.equal(forgedFullProfile.conflicts.includes("changeplane/src/lib/runtime.js"), true);
  assert.equal(forgedFullProfile.conflicts.includes(".github/workflows/changeplane-repair.yml"), true);
});

test("pristine v11 is safely classified for a v15 Full upgrade", () => {
  const v11 = managedVersionSnapshot(11);
  const v15 = managedVersionSnapshot(15);
  assert.equal(v11.managedVersion, 11);
  assert.equal(Object.keys(v11.managedHashes).length, 18);
  assert.equal(v11.manifest.includes('"managedVersion": 11'), true);
  const reservedEntries = Object.keys(v11.managedHashes)
    .filter((filePath) => filePath.startsWith("changeplane/"));
  assert.deepEqual(classifyManagedInstallationDigests({
    digests: { ...v11.managedHashes },
    manifest: v11.manifest,
    policyPresent: true,
    reservedEntries,
  }), {
    state: "outdated",
    currentVersion: 11,
    targetVersion: 15,
    managedProfile: "full",
    conflicts: [],
  });

  const changedManagedPaths = Object.keys(v15.managedHashes)
    .filter((filePath) => v11.managedHashes[filePath] !== v15.managedHashes[filePath]);
  assert.equal(changedManagedPaths.length > 0, true);
  assert.equal(changedManagedPaths.includes(".github/workflows/changeplane.yml"), true);
  assert.equal(changedManagedPaths.includes("changeplane/action/index.js"), true);
  assert.equal(changedManagedPaths.includes("changeplane/server/github-repair-controller.js"), true);
  assert.equal(changedManagedPaths.includes(".changeplane.json"), false);
  assert.equal(changedManagedPaths.includes(".changeplane/assurance.md"), false);

  const modifiedDigests = { ...v11.managedHashes, "changeplane/action/index.js": "f".repeat(64) };
  assert.deepEqual(classifyManagedInstallationDigests({
    digests: modifiedDigests,
    manifest: v11.manifest,
    policyPresent: true,
    reservedEntries,
  }), {
    state: "conflict",
    currentVersion: null,
    targetVersion: 15,
    conflicts: ["changeplane/action/index.js"],
  });
});

test("v11/v12 enforce policy recovery is reviewable, defaults to Verify, and cannot retain autonomous authority", () => {
  const legacyPolicy = `${JSON.stringify({
    version: 1,
    ownerPolicy: { protectedService: true },
    evidence: {
      requiredChecks: [{ name: "CI / verify", appSlug: "github-actions" }],
      protectedPaths: [".github/**", "tests/**"],
      timeoutSeconds: 90,
    },
    harness: { mode: "autonomous", maxAttempts: 2, budgetMinutes: 15 },
    runtime: { provider: "openai", model: "gpt-5.6-luna" },
  }, null, 2)}\n`;
  const migration = classifyUpgradePolicyMigration(legacyPolicy);
  assert.deepEqual(migration, {
    required: true,
    reason: "github_actions_workflow_path_required",
    previousHarnessMode: "autonomous",
    defaultHarnessMode: "verify",
    allowedHarnessModes: ["verify", "observe"],
    policyIncluded: true,
    ownerSelectionRequired: true,
    autonomousCredentialsProvisioned: false,
    legacyGuardPolicyAction: "replace_with_dedicated_app_guard",
  });

  const exactCheck = {
    name: "CI / verify",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
  };
  const recovered = JSON.parse(buildUpgradeRecoveryPolicy(legacyPolicy, exactCheck));
  assert.deepEqual(recovered.ownerPolicy, { protectedService: true });
  assert.deepEqual(recovered.evidence.requiredChecks, [exactCheck]);
  assert.deepEqual(recovered.evidence.protectedPaths, [".github/**", "tests/**"]);
  assert.equal(recovered.evidence.timeoutSeconds, 120);
  assert.deepEqual(recovered.harness, { mode: "verify", maxAttempts: 2, budgetMinutes: 15 });
  assert.deepEqual(recovered.runtime, { provider: "openai", model: "gpt-5.6-luna" });

  const scopeOnly = JSON.parse(buildUpgradeRecoveryPolicy(legacyPolicy, null, "observe"));
  assert.deepEqual(scopeOnly.evidence.requiredChecks, []);
  assert.equal(scopeOnly.evidence.timeoutSeconds, 0);
  assert.deepEqual(scopeOnly.harness, { mode: "observe", maxAttempts: 2, budgetMinutes: 15 });

  assert.throws(
    () => buildUpgradeRecoveryPolicy(legacyPolicy),
    /defaults to Verify only.*owner-selected exact behavioral Check/iu,
  );
  assert.throws(
    () => buildUpgradeRecoveryPolicy(legacyPolicy, exactCheck, "autonomous"),
    /cannot retain Autonomous repair/iu,
  );
  assert.throws(
    () => buildUpgradeRecoveryPolicy(legacyPolicy, exactCheck, "observe"),
    /Scope-only Observe must not include/iu,
  );
  assert.throws(
    () => buildUpgradeRecoveryPolicy(legacyPolicy, {
      ...exactCheck,
      name: "ChangePlane / review",
    }),
    /cannot be ChangePlane \/ guard.*ChangePlane \/ review/iu,
  );

  const currentPolicy = `${JSON.stringify({
    ...JSON.parse(legacyPolicy),
    evidence: { requiredChecks: [exactCheck], timeoutSeconds: 120 },
    harness: { mode: "verify", maxAttempts: 2, budgetMinutes: 15 },
  })}\n`;
  assert.equal(classifyUpgradePolicyMigration(currentPolicy), null);
});

test("v12 recovery creates one exact reviewed policy upgrade and never provisions autonomous credentials", async () => {
  const exactCheck = {
    name: "CI / verify",
    appSlug: "github-actions",
    workflowPath: ".github/workflows/ci.yml",
  };
  const legacyPolicy = `${JSON.stringify({
    version: 1,
    ownerPolicy: { protectedService: true },
    evidence: {
      requiredChecks: [{ name: exactCheck.name, appSlug: exactCheck.appSlug }],
      protectedPaths: ["tests/**"],
      timeoutSeconds: 90,
    },
    harness: { mode: "autonomous", maxAttempts: 2, budgetMinutes: 15 },
    runtime: { provider: "openai", model: "gpt-5.6-luna" },
  }, null, 2)}\n`;
  const recoveredPolicy = buildUpgradeRecoveryPolicy(legacyPolicy, exactCheck);
  const current = new Map(buildSetupFiles(exactCheck, "autonomous").map(({ path, content }) => [path, content]));
  current.set(".changeplane.json", legacyPolicy);
  current.set("changeplane/manifest.json", managedVersionSnapshot(12).manifest);
  const desiredManifest = new Map(buildSetupFiles(exactCheck, "autonomous").map(({ path, content }) => [path, content]))
    .get("changeplane/manifest.json");
  const baseSha = "a".repeat(40);
  const baseTreeSha = "b".repeat(40);
  const upgradeTreeSha = "c".repeat(40);
  const upgradeHeadSha = "d".repeat(40);
  const shaFor = (content) => createHash("sha1")
    .update(`blob ${Buffer.byteLength(content)}\0`)
    .update(content)
    .digest("hex");
  const headFiles = new Map([
    ["changeplane/manifest.json", desiredManifest],
    [".changeplane.json", recoveredPolicy],
  ]);
  const calls = [];
  let upgradeBranch = null;
  let upgradePullRequest = null;
  let upgradeTreeEntries = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: url.pathname, method, body });
    if (url.pathname.startsWith("/repos/alice/service/actions/secrets")
      || url.pathname.includes("/dispatches")) {
      throw new Error(`Recovery must not call an authority endpoint: ${method} ${url.pathname}`);
    }
    if (url.pathname === "/repos/alice/service/contents/changeplane%2Fmanifest.json") {
      throw new Error("Encoded slashes must stay path segments.");
    }
    if (url.pathname.startsWith("/repos/alice/service/contents/")) {
      const filePath = decodeURIComponent(url.pathname.split("/contents/")[1]);
      const content = url.searchParams.get("ref") === upgradeHeadSha
        ? headFiles.get(filePath)
        : current.get(filePath);
      return typeof content === "string"
        ? githubJsonResponse({
          type: "file",
          encoding: "base64",
          sha: shaFor(content),
          content: Buffer.from(content).toString("base64"),
        })
        : githubJsonResponse({}, 404);
    }
    if (url.pathname === "/repos/alice/service/pulls" && method === "GET") {
      return githubJsonResponse(upgradePullRequest ? [upgradePullRequest] : []);
    }
    if (url.pathname === "/repos/alice/service/git/ref/heads/changeplane/observe-upgrade-v15") {
      return upgradeBranch
        ? githubJsonResponse({ object: { sha: upgradeBranch } })
        : githubJsonResponse({}, 404);
    }
    if (url.pathname === "/repos/alice/service/git/ref/heads/main") {
      return githubJsonResponse({ object: { sha: baseSha } });
    }
    if (url.pathname === `/repos/alice/service/git/commits/${baseSha}`) {
      return githubJsonResponse({ tree: { sha: baseTreeSha }, parents: [] });
    }
    if (url.pathname === "/repos/alice/service/git/blobs" && method === "POST") {
      return githubJsonResponse({ sha: shaFor(body.content) }, 201);
    }
    if (url.pathname === "/repos/alice/service/git/trees" && method === "POST") {
      assert.equal(body.base_tree, baseTreeSha);
      assert.deepEqual(body.tree.map(({ path }) => path), [
        "changeplane/manifest.json",
        ".changeplane.json",
      ]);
      upgradeTreeEntries = body.tree;
      return githubJsonResponse({ sha: upgradeTreeSha }, 201);
    }
    if (url.pathname === "/repos/alice/service/git/commits" && method === "POST") {
      assert.equal(body.tree, upgradeTreeSha);
      assert.deepEqual(body.parents, [baseSha]);
      return githubJsonResponse({ sha: upgradeHeadSha }, 201);
    }
    if (url.pathname === "/repos/alice/service/git/refs" && method === "POST") {
      assert.deepEqual(body, {
        ref: "refs/heads/changeplane/observe-upgrade-v15",
        sha: upgradeHeadSha,
      });
      upgradeBranch = upgradeHeadSha;
      return githubJsonResponse({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    if (url.pathname === `/repos/alice/service/git/commits/${upgradeHeadSha}`) {
      return githubJsonResponse({ tree: { sha: upgradeTreeSha }, parents: [{ sha: baseSha }] });
    }
    if (url.pathname === "/repos/alice/service/pulls" && method === "POST") {
      assert.match(body.body, /replace any legacy `github-actions` branch-policy binding/u);
      assert.match(body.body, /dedicated ChangePlane App publisher/u);
      assert.match(body.body, /no repair credential is provisioned/u);
      upgradePullRequest = {
        number: 31,
        html_url: "https://github.com/alice/service/pull/31",
        state: "open",
        title: body.title,
        body: body.body,
        head: { ref: body.head, sha: upgradeHeadSha, repo: { full_name: "alice/service" } },
        base: { ref: body.base, sha: baseSha },
      };
      return githubJsonResponse(upgradePullRequest, 201);
    }
    if (url.pathname === `/repos/alice/service/compare/${baseSha}...${upgradeHeadSha}`) {
      return githubJsonResponse({
        base_commit: { sha: baseSha },
        merge_base_commit: { sha: baseSha },
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: [
          { filename: "changeplane/manifest.json", status: "modified" },
          { filename: ".changeplane.json", status: "modified" },
        ],
      });
    }
    if (url.pathname === `/repos/alice/service/git/trees/${upgradeTreeSha}`) {
      return githubJsonResponse({ truncated: false, tree: upgradeTreeEntries });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const target = {
    encodedRepository: "alice/service",
    repo: {
      full_name: "alice/service",
      default_branch: "main",
      permissions: { push: true, admin: true },
    },
    baseSha,
    installation: { state: "outdated", currentVersion: 12, targetVersion: 15 },
  };
  try {
    const first = await createObserveUpgradePullRequest(target, { token: "alice-token" }, exactCheck);
    assert.equal(first.operation, "upgrade");
    assert.equal(first.harnessMode, "verify");
    assert.equal(first.policyIncluded, true);
    assert.equal(first.policyMigration.previousHarnessMode, "autonomous");
    assert.equal(first.policyMigration.autonomousCredentialsProvisioned, false);
    assert.deepEqual(JSON.parse(headFiles.get(".changeplane.json")).evidence.requiredChecks, [exactCheck]);
    assert.deepEqual(JSON.parse(headFiles.get(".changeplane.json")).harness, {
      mode: "verify",
      maxAttempts: 2,
      budgetMinutes: 15,
    });
    assert.deepEqual(upgradeTreeEntries.map(({ path }) => path), [
      "changeplane/manifest.json",
      ".changeplane.json",
    ]);
    const mutationCount = calls.filter(({ method }) => method !== "GET").length;

    const retry = await createObserveUpgradePullRequest(target, { token: "alice-token" }, exactCheck);
    assert.equal(retry.pullRequest.number, 31);
    assert.equal(calls.filter(({ method }) => method !== "GET").length, mutationCount);
    assert.equal(calls.filter(({ path, method }) => path === "/repos/alice/service/pulls" && method === "POST").length, 1);
    assert.equal(calls.some(({ path }) => path.includes("/actions/secrets") || path.includes("/dispatches")), false);

    const nonAdminTarget = {
      ...target,
      repo: { ...target.repo, permissions: { push: true, admin: false } },
    };
    await assert.rejects(
      () => createObserveUpgradePullRequest(nonAdminTarget, { token: "alice-token" }, exactCheck),
      /repository administrator must choose/iu,
    );
    assert.equal(calls.filter(({ method }) => method !== "GET").length, mutationCount);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pristine manifestless Full install creates one manifest-only v15 upgrade PR from the base commit tree", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "oauth",
    }, SECRET);
    const desired = new Map(buildSetupFiles({
      name: "CI / test",
      appSlug: "github-actions",
      workflowPath: ".github/workflows/ci.yml",
    }, "autonomous").map(({ path, content }) => [path, content]));
    desired.set(".changeplane.json", "{\n  \"version\": 1,\n  \"ownerPolicy\": true\n}\n");
    const baseSha = "a".repeat(40);
    const baseTreeSha = "b".repeat(40);
    const upgradeTreeSha = "c".repeat(40);
    const upgradeHeadSha = "d".repeat(40);
    const manifest = desired.get("changeplane/manifest.json");
    const manifestBlobSha = createHash("sha1").update(`blob ${Buffer.byteLength(manifest)}\0`).update(manifest).digest("hex");
    const calls = [];
    let upgradePullRequest = null;
    let upgradeBranch = null;
    let repoAdmin = true;
    const response = (body, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      async json() { return body; },
      async text() { return status >= 400 ? "not found" : JSON.stringify(body); },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = options.method ?? "GET";
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path: url.pathname, method, body });
      if (url.pathname === "/repos/alice/service" && method === "GET") {
        return response({ full_name: "alice/service", default_branch: "main", permissions: { push: true, admin: repoAdmin } });
      }
      if (url.pathname === "/repos/alice/service/git/ref/heads/main") return response({ object: { sha: baseSha } });
      if (url.pathname === "/repos/alice/service/contents/changeplane") return response([]);
      if (url.pathname.startsWith("/repos/alice/service/contents/")) {
        const filePath = decodeURIComponent(url.pathname.split("/contents/")[1]);
        const ref = url.searchParams.get("ref");
        if (filePath === "changeplane/manifest.json" && ref === baseSha) return response({}, 404);
        if (filePath === "changeplane/manifest.json" && ref === upgradeHeadSha) {
          return response({ type: "file", encoding: "base64", sha: manifestBlobSha, content: Buffer.from(manifest).toString("base64") });
        }
        const content = desired.get(filePath);
        if (typeof content === "string") {
          return response({
            type: "file",
            encoding: "base64",
            sha: createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex"),
            content: Buffer.from(content).toString("base64"),
          });
        }
        return response({}, 404);
      }
      if (url.pathname === `/repos/alice/service/git/commits/${baseSha}`) {
        return response({ tree: { sha: baseTreeSha }, parents: [] });
      }
      if (url.pathname === `/repos/alice/service/git/trees/${baseTreeSha}` && method === "GET") {
        return response({
          truncated: false,
          tree: [...desired.entries()]
            .filter(([filePath]) => filePath.startsWith("changeplane/") && filePath !== "changeplane/manifest.json")
            .map(([path]) => ({ path, type: "blob", mode: "100644" })),
        });
      }
      if (url.pathname === "/repos/alice/service/pulls" && method === "GET") {
        return response(upgradePullRequest ? [upgradePullRequest] : []);
      }
      if (url.pathname === "/repos/alice/service/git/ref/heads/changeplane/observe-upgrade-v15") {
        return upgradeBranch ? response({ object: { sha: upgradeBranch } }) : response({}, 404);
      }
      if (url.pathname === "/repos/alice/service/git/blobs" && method === "POST") return response({ sha: manifestBlobSha }, 201);
      if (url.pathname === "/repos/alice/service/git/trees" && method === "POST") {
        assert.deepEqual(body.tree.map(({ path }) => path), ["changeplane/manifest.json"]);
        assert.equal(body.tree.some(({ path }) => path === ".changeplane.json"), false);
        return response({ sha: upgradeTreeSha }, 201);
      }
      if (url.pathname === "/repos/alice/service/git/commits" && method === "POST") {
        assert.deepEqual(body.parents, [baseSha]);
        return response({ sha: upgradeHeadSha }, 201);
      }
      if (url.pathname === "/repos/alice/service/git/refs" && method === "POST") {
        upgradeBranch = upgradeHeadSha;
        return response({ ref: body.ref, object: { sha: upgradeHeadSha } }, 201);
      }
      if (url.pathname === `/repos/alice/service/git/commits/${upgradeHeadSha}`) {
        return response({ tree: { sha: upgradeTreeSha }, parents: [{ sha: baseSha }] });
      }
      if (url.pathname === "/repos/alice/service/pulls" && method === "POST") {
        upgradePullRequest = {
          number: 21,
          html_url: "https://github.com/alice/service/pull/21",
          state: "open",
          title: body.title,
          body: body.body,
          head: { ref: body.head, sha: upgradeHeadSha, repo: { full_name: "alice/service" } },
          base: { ref: body.base, sha: baseSha },
        };
        return response(upgradePullRequest, 201);
      }
      if (url.pathname === `/repos/alice/service/compare/${baseSha}...${upgradeHeadSha}`) {
        return response({
          base_commit: { sha: baseSha },
          merge_base_commit: { sha: baseSha },
          ahead_by: 1,
          behind_by: 0,
          total_commits: 1,
          files: [{ filename: "changeplane/manifest.json", status: "added" }],
        });
      }
      if (url.pathname === `/repos/alice/service/git/trees/${upgradeTreeSha}`) {
        return response({ truncated: false, tree: [{ path: "changeplane/manifest.json", type: "blob", mode: "100644", sha: manifestBlobSha }] });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    };
    const request = async () => {
      const recorder = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: null, harnessMode: "observe" },
      }, recorder);
      return recorder;
    };
    try {
      const first = await request();
      assert.equal(first.statusCode, 201);
      assert.equal(JSON.parse(first.body).operation, "upgrade");
      const firstMutationCount = calls.filter(({ method }) => method !== "GET").length;
      assert.equal(calls.some(({ path }) => path === `/repos/alice/service/git/trees/${baseSha}`), false);
      assert.equal(calls.some(({ path }) => path === `/repos/alice/service/git/trees/${baseTreeSha}`), true);
      assert.equal(calls.filter(({ path, method }) => path === "/repos/alice/service/pulls" && method === "POST").length, 1);
      const secondResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: null, harnessMode: "observe" },
      }, secondResponse);
      assert.equal(secondResponse.statusCode, 201);
      assert.equal(JSON.parse(secondResponse.body).operation, "upgrade");
      assert.equal(JSON.parse(secondResponse.body).pullRequest.number, 21);
      assert.equal(calls.filter(({ method }) => method !== "GET").length, firstMutationCount);
      assert.equal(calls.filter(({ path, method }) => path === "/repos/alice/service/pulls" && method === "POST").length, 1);

      desired.set(".changeplane.json", `${JSON.stringify({
        version: 1,
        evidence: { requiredChecks: [{ name: "CI / test", appSlug: "github-actions" }] },
        harness: { mode: "autonomous", maxAttempts: 2, budgetMinutes: 15 },
      }, null, 2)}\n`);
      const staleRecoveryPreflight = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fservice",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, staleRecoveryPreflight);
      assert.equal(staleRecoveryPreflight.statusCode, 200);
      assert.equal(JSON.parse(staleRecoveryPreflight.body).installable, false);
      assert.equal(JSON.parse(staleRecoveryPreflight.body).setup.state, "stale");
      assert.match(JSON.parse(staleRecoveryPreflight.body).setup.message, /Close it and delete changeplane\/observe-upgrade-v15/u);
      assert.equal(calls.filter(({ method }) => method !== "GET").length, firstMutationCount);

      repoAdmin = false;
      const ownerRequiredPreflight = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fservice",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, ownerRequiredPreflight);
      assert.equal(ownerRequiredPreflight.statusCode, 200);
      assert.equal(JSON.parse(ownerRequiredPreflight.body).installable, false);
      assert.equal(JSON.parse(ownerRequiredPreflight.body).setup.state, "owner_required");
      assert.equal(JSON.parse(ownerRequiredPreflight.body).setup.policyMigration.ownerAuthorized, false);

      const nonAdminInstall = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: {
          repository: "alice/service",
          requiredCheck: {
            name: "CI / test",
            appSlug: "github-actions",
            workflowPath: ".github/workflows/ci.yml",
          },
        },
      }, nonAdminInstall);
      assert.equal(nonAdminInstall.statusCode, 403);
      assert.match(JSON.parse(nonAdminInstall.body).error, /repository administrator must choose/iu);
      assert.equal(calls.filter(({ method }) => method !== "GET").length, firstMutationCount);
      assert.equal(calls.some(({ path }) => path.includes("/actions/secrets") || path.includes("/dispatches")), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("Verify-first setup defaults a selected Check to Verify and reuses one GitHub-native pull request", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "oauth",
    }, SECRET);
    const configuredCheck = {
      name: "test",
      appSlug: "github-actions",
      workflowPath: ".github/workflows/ci.yml",
    };
    let files = buildSetupFiles(configuredCheck, "verify");
    let fileContents = new Map(files.map(({ path, content }) => [path, content]));
    const baseSha = "a".repeat(40);
    const headSha = "b".repeat(40);
    const treeSha = "c".repeat(40);
    let setupBranchHead = headSha;
    const blobSha = (content) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
    const scope = files.map(({ path }) => path === "changeplane/package.json" ? "changeplane/**" : path);
    let plan = {
      goal: "Install the ChangePlane verify harness",
      scope: [...new Set(scope)],
      harnessMode: "verify",
      managedVersion: 15,
      managedProfile: "verify-lite",
      requiredCheck: configuredCheck,
    };
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      calls.push({ method: options.method ?? "GET", path: `${url.pathname}${url.search}` });
      if (url.pathname === "/repos/alice/service" && !url.pathname.includes("/contents/")) {
        return { ok: true, status: 200, async json() { return { full_name: "alice/service", default_branch: "main", permissions: { push: true } }; } };
      }
      if (url.pathname === "/repos/alice/service/git/ref/heads/main") {
        return { ok: true, status: 200, async json() { return { object: { sha: baseSha } }; } };
      }
      if (url.pathname.includes("/contents/")) {
        if (url.searchParams.get("ref") === headSha) {
          const filePath = decodeURIComponent(url.pathname.split("/contents/")[1]);
          const content = fileContents.get(filePath);
          if (content !== undefined) {
            return {
              ok: true,
              status: 200,
              async json() { return { type: "file", encoding: "base64", sha: blobSha(content), content: Buffer.from(content).toString("base64") }; },
            };
          }
        }
        return { ok: false, status: 404, headers: { get: () => null } };
      }
      if (url.pathname === "/repos/alice/service/pulls") {
        return {
          ok: true,
          status: 200,
          async json() {
            return [{
              number: 17,
              html_url: "https://github.com/alice/service/pull/17",
              state: "open",
              title: "chore: install ChangePlane harness",
              body: `<!-- changeplane ${JSON.stringify(plan)} -->`,
              head: { ref: "changeplane/observe-setup", sha: headSha, repo: { full_name: "alice/service" } },
              base: { ref: "main", sha: baseSha },
            }];
          },
        };
      }
      if (url.pathname === "/repos/alice/service/git/ref/heads/changeplane/observe-setup") {
        return { ok: true, status: 200, async json() { return { object: { sha: setupBranchHead } }; } };
      }
      if (url.pathname === `/repos/alice/service/git/commits/${headSha}`) {
        return { ok: true, status: 200, async json() { return { tree: { sha: treeSha }, parents: [{ sha: baseSha }] }; } };
      }
      if (url.pathname === `/repos/alice/service/compare/${baseSha}...${headSha}`) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              base_commit: { sha: baseSha },
              merge_base_commit: { sha: baseSha },
              ahead_by: 1,
              behind_by: 0,
              total_commits: 1,
              files: files.map(({ path: filename, content }) => ({ filename, status: "added", sha: blobSha(content) })),
            };
          },
        };
      }
      if (url.pathname === `/repos/alice/service/git/trees/${treeSha}`) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { truncated: false, tree: files.map(({ path, content }) => ({ path, mode: "100644", type: "blob", sha: blobSha(content) })) };
          },
        };
      }
      throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`);
    };
    try {
      const implicitScopeResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service" },
      }, implicitScopeResponse);
      assert.equal(implicitScopeResponse.statusCode, 400);
      assert.match(JSON.parse(implicitScopeResponse.body).error, /explicitly continue/u);
      assert.equal(calls.length, 0);

      const implicitObserveResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: null },
      }, implicitObserveResponse);
      assert.equal(implicitObserveResponse.statusCode, 400);
      assert.match(JSON.parse(implicitObserveResponse.body).error, /Verify only requires/u);
      assert.equal(calls.length, 0);

      const observeWithCheckResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: configuredCheck, harnessMode: "observe" },
      }, observeWithCheckResponse);
      assert.equal(observeWithCheckResponse.statusCode, 400);
      assert.match(JSON.parse(observeWithCheckResponse.body).error, /Scope-only Observe.*cannot include/u);
      assert.equal(calls.length, 0);

      const conflictingScopeResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: null, harnessMode: "observe" },
      }, conflictingScopeResponse);
      assert.equal(conflictingScopeResponse.statusCode, 409);
      assert.match(JSON.parse(conflictingScopeResponse.body).error, /different evidence or harness choice/u);
      assert.equal(calls.every(({ method }) => method === "GET"), true);

      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: configuredCheck },
      }, response);
      assert.equal(response.statusCode, 201);
      assert.equal(JSON.parse(response.body).branch, "changeplane/observe-setup");
      assert.equal(JSON.parse(response.body).pullRequest.number, 17);
      assert.equal(calls.every(({ method }) => method === "GET"), true);

      const pendingPreflight = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fservice",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, pendingPreflight);
      assert.equal(pendingPreflight.statusCode, 200);
      assert.equal(JSON.parse(pendingPreflight.body).installable, true);
      assert.deepEqual(JSON.parse(pendingPreflight.body).setup, {
        state: "pending",
        pullRequest: { number: 17, url: "https://github.com/alice/service/pull/17" },
        requiredCheck: configuredCheck,
        harnessMode: "verify",
      });

      fileContents.set(files[0].path, "tampered setup payload\n");
      const stalePreflight = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fservice",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, stalePreflight);
      assert.equal(stalePreflight.statusCode, 200);
      assert.equal(JSON.parse(stalePreflight.body).installable, false);
      assert.equal(JSON.parse(stalePreflight.body).setup.state, "stale");
      assert.match(JSON.parse(stalePreflight.body).setup.message, /Close it and delete changeplane\/observe-setup/u);

      const tamperedResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: configuredCheck },
      }, tamperedResponse);
      assert.equal(tamperedResponse.statusCode, 409);
      assert.match(JSON.parse(tamperedResponse.body).error, /existing setup file was modified/u);

      fileContents.set(files[0].path, files[0].content);
      setupBranchHead = "d".repeat(40);
      const forgedResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: configuredCheck },
      }, forgedResponse);
      assert.equal(forgedResponse.statusCode, 409);
      assert.match(JSON.parse(forgedResponse.body).error, /not bound to the setup branch head/u);

      setupBranchHead = headSha;
      files = buildSetupFiles();
      fileContents = new Map(files.map(({ path, content }) => [path, content]));
      plan = {
        goal: "Install the ChangePlane observe harness",
        scope: [...new Set(scope)],
        harnessMode: "observe",
        managedVersion: 15,
        managedProfile: "verify-lite",
      };
      const conflictingBehaviorResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: configuredCheck },
      }, conflictingBehaviorResponse);
      assert.equal(conflictingBehaviorResponse.statusCode, 409);
      assert.match(JSON.parse(conflictingBehaviorResponse.body).error, /different evidence or harness choice/u);

      files = buildSetupFiles(configuredCheck, "autonomous");
      fileContents = new Map(files.map(({ path, content }) => [path, content]));
      const autonomousScope = files.map(({ path }) => path === "changeplane/package.json" ? "changeplane/**" : path);
      plan = {
        goal: "Install the ChangePlane autonomous harness",
        scope: [...new Set(autonomousScope)],
        harnessMode: "autonomous",
        managedVersion: 15,
        managedProfile: "full",
        requiredCheck: configuredCheck,
      };
      const mutationCountBeforeAutonomousCheck = calls.filter(({ method }) => method !== "GET").length;
      const autonomousPreflight = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fservice",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, autonomousPreflight);
      assert.equal(autonomousPreflight.statusCode, 200);
      assert.equal(JSON.parse(autonomousPreflight.body).installable, false);
      assert.equal(JSON.parse(autonomousPreflight.body).setup.state, "stale");
      assert.match(JSON.parse(autonomousPreflight.body).setup.message, /Branch changeplane\/observe-setup.*Delete the branch/u);

      const autonomousRetry = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=install",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", requiredCheck: configuredCheck },
      }, autonomousRetry);
      assert.equal(autonomousRetry.statusCode, 409);
      assert.match(JSON.parse(autonomousRetry.body).error, /compatible verified Verify-first setup PR/u);
      assert.equal(calls.filter(({ method }) => method !== "GET").length, mutationCountBeforeAutonomousCheck);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GitHub retries honor server rate-limit headers and fail fast on a distant reset", () => {
  const headers = (values) => ({ get: (name) => values[name] ?? null });
  assert.equal(githubRetryDelayMs(429, headers({ "retry-after": "2" }), 1, 1_000), 2_000);
  assert.equal(githubRetryDelayMs(403, headers({
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "31",
  }), 1, 1_000), 30_000);
  assert.equal(githubRetryDelayMs(403, headers({
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "301",
  }), 1, 1_000), null);
  assert.equal(githubRetryDelayMs(503, headers({}), 2, 1_000), 500);
});

test("managed autonomous harness keeps OpenAI proposal access separate from forge write", () => {
  const workflow = readFileSync(new URL("../examples/changeplane-repair.yml", import.meta.url), "utf8");
  const guardWorkflow = readFileSync(new URL("../examples/changeplane-repair-guard.yml", import.meta.url), "utf8");
  const grantVerifier = readFileSync(new URL("../examples/changeplane-grant.js", import.meta.url), "utf8");
  const claimClient = readFileSync(new URL("../examples/changeplane-claim.js", import.meta.url), "utf8");
  const provisioner = readFileSync(new URL("../scripts/provision-repair-canary.mjs", import.meta.url), "utf8");
  const installerApi = readFileSync(new URL("../api/github.js", import.meta.url), "utf8");
  const guardAction = readFileSync(new URL("../action/index.js", import.meta.url), "utf8");
  const vercelConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const vercelIgnore = readFileSync(new URL("../.vercelignore", import.meta.url), "utf8");
  const repairLedger = readFileSync(new URL("../server/repair-ledger.js", import.meta.url), "utf8");
  assert.match(workflow, /Managed autonomous harness/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /CHANGEPLANE_REPAIR_ENABLED/u);
  assert.doesNotMatch(workflow, /^\s+if:\s+secrets\./mu);
  assert.equal((workflow.match(/run: test "\$CHANGEPLANE_REPAIR_ENABLED" = "managed-v12"/gu) ?? []).length, 2);
  assert.match(workflow, /CHANGEPLANE_REPAIR_GENERATION/u);
  assert.match(workflow, /CHANGEPLANE_REPAIR_PUBLIC_KEYS/u);
  assert.match(workflow, /CHANGEPLANE_CONTROLLER_SHA: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /CHANGEPLANE_BASE_REF: \$\{\{ github\.event\.repository\.default_branch \}\}/u);
  assert.equal((workflow.match(/ref: \$\{\{ github\.sha \}\}/gu) ?? []).length, 2);
  assert.equal((workflow.match(/repository: LeChiffreVol2\/changeplane/gu) ?? []).length, 0);
  assert.match(workflow, /CHANGEPLANE_PUBLISHER_RELEASE_SHA: \$\{\{ github\.event\.client_payload\.entry\.publisherReleaseSha \}\}/u);
  assert.equal((workflow.match(/changeplane-grant\.js verify/gu) ?? []).length, 3);
  assert.equal((workflow.match(/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/gu) ?? []).length, 2);
  assert.equal((workflow.match(/node-version: 22\.18\.0/gu) ?? []).length, 2);
  assert.equal((guardWorkflow.match(/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/gu) ?? []).length, 2);
  assert.equal((guardWorkflow.match(/node-version: 22\.18\.0/gu) ?? []).length, 2);
  assert.doesNotMatch(workflow, /\/usr\/bin\/node/u);
  assert.doesNotMatch(guardWorkflow, /\/usr\/bin\/node/u);
  assert.match(workflow, /changeplane-grant\.js verify/u);
  assert.match(workflow, /grant-digest/u);
  assert.match(workflow, /listArtifactsForRepo/u);
  assert.match(grantVerifier, /changeplane-claim-/u);
  assert.match(claimClient, /signClaimRequest/u);
  const repairEndpoint = "https://changeplane.vercel.app/api/github?action=repair";
  const claimEndpoint = "https://changeplane.vercel.app/api/github?action=repair-claim";
  const pushTokenEndpoint = "https://changeplane.vercel.app/api/github?action=repair-push-token";
  const validateEndpoint = "https://changeplane.vercel.app/api/github?action=repair-validate";
  assert.equal(guardWorkflow.includes(`INPUT_AGENT_WEBHOOK_URL: "${repairEndpoint}"`), true);
  assert.doesNotMatch(guardWorkflow, /CHANGEPLANE_REPAIR_URL/u);
  assert.equal(workflow.split(claimEndpoint).length - 1, 1);
  assert.equal(workflow.split(pushTokenEndpoint).length - 1, 1);
  assert.equal(workflow.split(validateEndpoint).length - 1, 3);
  assert.equal((workflow.match(/changeplane-claim\.js claim/gu) ?? []).length, 1);
  assert.equal((workflow.match(/changeplane-claim\.js push-token/gu) ?? []).length, 1);
  assert.equal((workflow.match(/changeplane-claim\.js validate/gu) ?? []).length, 3);
  assert.doesNotMatch(workflow, /vars\.CHANGEPLANE_CLAIM_URL/u);
  const controllerClaimIndex = workflow.indexOf("Claim the App-authored grant before provider access");
  const claimIndex = workflow.indexOf("Reserve the one-time claim before provider access");
  const providerValidateIndex = workflow.indexOf("Revalidate server authority immediately before provider access");
  const providerHeadIndex = workflow.indexOf("Re-check the exact pull-request head immediately before OpenAI");
  const providerIndex = workflow.indexOf("Ask GPT-5.6 for a bounded patch proposal");
  assert.ok(controllerClaimIndex > 0 && claimIndex > controllerClaimIndex
    && providerValidateIndex > claimIndex && providerHeadIndex > providerValidateIndex
    && providerIndex > providerHeadIndex,
  "server authority and the exact head must be rechecked immediately before provider access");
  assert.match(workflow, /CHANGEPLANE_TRUSTED_POLICY: \$\{\{ github\.workspace \}\}\/trusted\/\.changeplane\.json/u);
  assert.match(workflow, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/u);
  const providerStep = workflow.match(/- name: Ask GPT-5\.6 for a bounded patch proposal[\s\S]*?changeplane-proposal\.js propose/u)?.[0] ?? "";
  assert.doesNotMatch(providerStep, /CHANGEPLANE_CONTROLLER_HMAC|CHANGEPLANE_PUSH_TOKEN/u);
  assert.match(workflow, /ref: \$\{\{ steps\.grant\.outputs\.base-sha \}\}[\s\S]*?path: trusted/u);
  assert.match(workflow, /ref: \$\{\{ steps\.grant\.outputs\.head-sha \}\}[\s\S]*?path: workspace/u);
  assert.match(workflow, /working-directory: workspace[\s\S]*?\.\.\/controller\/changeplane\/examples\/changeplane-proposal\.js propose/u);
  assert.doesNotMatch(workflow, /run: \/usr\/bin\/node examples\/changeplane-proposal\.js/u);
  assert.match(workflow, /jobs:\n  repair:[\s\S]*?permissions:\n      actions: read\n      contents: read/u);
  assert.match(workflow, /\n  apply:[\s\S]*?permissions:\n      actions: read\n      contents: read\n      pull-requests: read/u);
  assert.doesNotMatch(workflow.match(/jobs:\n  repair:[\s\S]*?\n  apply:/u)?.[0] ?? "", /contents: write/u);
  assert.doesNotMatch(workflow.match(/\n  apply:[\s\S]*/u)?.[0] ?? "", /contents: write/u);
  assert.doesNotMatch(workflow.match(/\n  apply:[\s\S]*/u)?.[0] ?? "", /OPENAI_API_KEY/u);
  assert.match(workflow.match(/\n  apply:[\s\S]*/u)?.[0] ?? "", /\.\.\/controller\/changeplane\/examples\/changeplane-proposal\.js validate/u);
  assert.doesNotMatch(workflow, /uses: [^\n]+@(v\d+|main|master)$/mu);
  assert.match(guardAction, /async function dispatchAgentWebhook[\s\S]*?AbortSignal\.timeout\(30_000\)/u);
  assert.match(workflow, /git apply --check --index/u);
  const finalVerifyIndex = workflow.lastIndexOf("changeplane-grant.js verify");
  const applyValidateIndex = workflow.indexOf("Revalidate server authority immediately before clean apply");
  const applyIndex = workflow.indexOf("Apply and independently validate only the granted paths");
  const finalValidateIndex = workflow.lastIndexOf("changeplane-claim.js validate");
  const pushTokenIndex = workflow.indexOf("changeplane-claim.js push-token");
  const pushIndex = workflow.indexOf("credential.helper= push");
  assert.ok(finalVerifyIndex > 0 && pushIndex > finalVerifyIndex, "grant deadline must be rechecked at the write boundary");
  assert.ok(applyValidateIndex > 0 && applyIndex > applyValidateIndex, "server authority must be rechecked before clean apply");
  assert.ok(finalValidateIndex > finalVerifyIndex && pushIndex > finalValidateIndex, "the server kill switch must be rechecked immediately before push");
  assert.ok(pushTokenIndex > finalValidateIndex && pushIndex > pushTokenIndex, "the one-time App token must be minted only at the push boundary");
  assert.match(workflow, /ref: \$\{\{ steps\.grant\.outputs\.head-sha \}\}[\s\S]*?path: workspace[\s\S]*?persist-credentials: false/u);
  assert.match(workflow, /GIT_ASKPASS: \$\{\{ runner\.temp \}\}\/changeplane-git-askpass/u);
  assert.match(workflow, /if: always\(\)[\s\S]*?rm -f -- "\$CHANGEPLANE_PUSH_TOKEN_FILE"/u);
  assert.match(claimClient, /writeFileSync\(tokenPath, result\.token, \{ encoding: "utf8", flag: "wx", mode: 0o600 \}\)/u);
  assert.doesNotMatch(claimClient, /appendFileSync\([^\n]*result\.token/u);
  assert.match(workflow, /Clean apply did not restore granted paths to the trusted merge base/u);
  assert.match(repairLedger, /RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE/u);
  assert.match(workflow, /CHANGEPLANE_REPAIR_KIND/u);
  assert.match(workflow, /allowedPaths/u);
  assert.match(workflow, /GITHUB_TOKEN pushes do not start fresh workflow runs/u);
  assert.match(workflow, /pull_request synchronize[\s\S]*?fresh CI/u);
  assert.doesNotMatch(workflow, /createDispatchEvent|event_type: 'changeplane_recheck'/u);
  assert.equal(workflow.includes("github.event.client_payload.change."), false);
  assert.match(guardWorkflow, /INPUT_MODE: enforce/u);
  assert.match(guardWorkflow, /INPUT_AGENT_DISPATCH: webhook/u);
  assert.match(guardWorkflow, /ref: __CHANGEPLANE_RELEASE_SHA__/u);
  assert.doesNotMatch(guardWorkflow, /statuses: read/u);
  assert.match(provisioner, /permissions: \{ administration: "read" \}/u);
  assert.match(provisioner, /permissions: \{ secrets: "write" \}/u);
  assert.doesNotMatch(provisioner, /permissions: \{[^}]*administration: "read"[^}]*secrets: "write"/u);
  assert.match(provisioner, /installationToken: readToken/u);
  assert.match(provisioner, /token: secretsToken/u);
  assert.match(provisioner, /requiredRepository\(\)/u);
  assert.match(provisioner, /CHANGEPLANE_CANARY_REPOSITORY_ID/u);
  assert.match(provisioner, /CHANGEPLANE_CANARY_INSTALLATION_ID/u);
  assert.match(provisioner, /CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH/u);
  assert.match(provisioner, /adminRepository\.permissions\?\.admin !== true/u);
  const eligibilityCall = "await requireEligibleCanary(eligibility)";
  const firstEligibilityCheck = provisioner.indexOf(eligibilityCall);
  const firstSecretWrite = provisioner.indexOf('name: "CHANGEPLANE_REPAIR_ENABLED", value: "false"');
  const secondEligibilityCheck = provisioner.indexOf(
    eligibilityCall,
    firstEligibilityCheck + 1,
  );
  const activationWrite = provisioner.indexOf('name: "CHANGEPLANE_REPAIR_ENABLED", value: MANAGED_REPAIR_ACTIVATION');
  assert.ok(firstEligibilityCheck > 0 && firstEligibilityCheck < firstSecretWrite, "canary eligibility must be proven before any secret write");
  assert.ok(secondEligibilityCheck > firstSecretWrite && secondEligibilityCheck < activationWrite, "canary eligibility must be revalidated before activation");
  assert.doesNotMatch(provisioner, /variables: "write"|upsertVariable/u);
  assert.ok(
    provisioner.indexOf('name: "CHANGEPLANE_REPAIR_ENABLED", value: "false"')
      < provisioner.indexOf('name: "CHANGEPLANE_CONTROLLER_HMAC", value: "retired-by-managed-v12"')
      && provisioner.indexOf('name: "CHANGEPLANE_CONTROLLER_HMAC", value: "retired-by-managed-v12"')
      < provisioner.indexOf('putEncryptedSecret({ name: "CHANGEPLANE_CONTROLLER_HMAC_V12"'),
    "a partial provisioning run must be disabled before any secret is written",
  );
  assert.ok(
    provisioner.indexOf('putEncryptedSecret({ name: "OPENAI_API_KEY"')
      < provisioner.indexOf('name: "CHANGEPLANE_REPAIR_ENABLED", value: MANAGED_REPAIR_ACTIVATION'),
    "repair may be enabled only after the provider secret is stored",
  );
  const autonomousStart = installerApi.indexOf("async function prepareAutonomousHarness");
  const autonomousEnd = installerApi.indexOf("\nasync function install", autonomousStart);
  const autonomousProvisioning = autonomousStart >= 0 && autonomousEnd > autonomousStart
    ? installerApi.slice(autonomousStart, autonomousEnd)
    : "";
  const disableIndex = autonomousProvisioning.indexOf('HARNESS_SECRETS.enabled,\n    "false"');
  const retireLegacyIndex = autonomousProvisioning.indexOf("HARNESS_SECRETS.legacyController");
  const controllerTombstoneIndex = autonomousProvisioning.indexOf("HARNESS_SECRETS.controller", retireLegacyIndex);
  const enableIndex = autonomousProvisioning.indexOf("HARNESS_SECRETS.enabled,\n    MANAGED_REPAIR_ACTIVATION");
  const controllerCredentialIndex = autonomousProvisioning.lastIndexOf("HARNESS_SECRETS.controller");
  assert.ok(
    disableIndex > 0
      && retireLegacyIndex > disableIndex
      && controllerTombstoneIndex > retireLegacyIndex
      && enableIndex > controllerTombstoneIndex
      && controllerCredentialIndex > enableIndex,
    "self-serve provisioning must tombstone credentials before rotation and write the usable HMAC last",
  );
  const includedFiles = vercelConfig.functions["api/github.js"].includeFiles;
  assert.equal(
    includedFiles,
    "{action.yml,action/**,src/lib/**,server/**,examples/changeplane-*.{js,yml}}",
    "the Vercel installer must bundle every managed harness source",
  );
  for (const managedExample of [
    "changeplane-claim.js",
    "changeplane-evidence-policy.js",
    "changeplane-grant.js",
    "changeplane-proposal.js",
    "changeplane-provider-openai.js",
    "changeplane-review-openai.js",
    "changeplane-review-run.js",
    "changeplane-repair.yml",
  ]) {
    assert.equal(
      vercelIgnore.split(/\r?\n/u).includes(`!examples/${managedExample}`),
      true,
      `${managedExample} must remain available to the Vercel function bundler`,
    );
  }
});

test("session reports whether the real GitHub connector is configured", async () => {
  await withOAuthEnvironment(async () => {
    const response = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      authenticated: false,
      configured: true,
      authMode: "oauth",
      rolloutMode: "self_serve",
    });
    assert.equal(response.getHeader("cache-control"), "no-store");
  });
});

test("GitHub App cutover rejects stale broad-OAuth sessions before repository access", async () => {
  await withGitHubAppEnvironment(async () => {
    const staleSession = seal({
      kind: "session",
      token: "stale-broad-oauth-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "oauth",
    }, SECRET);
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("GitHub must not be called"); };
    try {
      const sessionResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=session",
        headers: { cookie: `__Host-changeplane_session=${staleSession}` },
      }, sessionResponse);
      assert.deepEqual(JSON.parse(sessionResponse.body), {
        authenticated: false,
        configured: true,
        authMode: "github_app",
        rolloutMode: "self_serve",
      });

      const repositoriesResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=repos",
        headers: { cookie: `__Host-changeplane_session=${staleSession}` },
      }, repositoriesResponse);
      assert.equal(repositoriesResponse.statusCode, 401);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("readiness fails closed when a Vercel deployment has no source commit", async () => {
  await withOAuthEnvironment(async () => {
    process.env.GITHUB_APP_SLUG = "changeplane-test";
    process.env.CHANGEPLANE_CANARY_REPOSITORY = "alice/disposable-canary";
    process.env.VERCEL = "1";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_test_release_identifier";
    const response = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, response);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), {
      status: "configuration_required",
      commercialReady: false,
      principalSeparation: "installer_app_not_configured",
      checks: {
        githubClientId: true,
        githubClientSecret: true,
        githubAppSlug: true,
        sessionSecret: true,
        appOrigin: true,
        guardPublisher: true,
        guardPrincipalSeparated: false,
        guardPublicationSerialized: false,
        guardJournalConfigured: false,
        guardJournalConfiguration: false,
        pilotAdmissionConfiguration: true,
        commercialStore: false,
        commercialStoreVerified: false,
        commercialRuntimeIntegrated: false,
        legalRelease: false,
        sourceProvenance: false,
        canaryRepository: true,
        rolloutAuthorized: true,
      },
      authMode: "github_app",
      rolloutMode: "controlled_canary",
      release: "dpl_test_release_identifier",
      managedRuntime: "reserved",
      repairController: {
        enabled: false,
        configured: false,
        checks: {
          enabled: false,
          repositoryScope: false,
          installationBound: false,
          appId: false,
          appPrivateKey: false,
          controllerSecret: false,
          generation: false,
        },
      },
    });
    assert.match(response.getHeader("x-request-id"), /^[a-f0-9]{24}$/u);
    assert.equal(response.getHeader("x-frame-options"), "DENY");
    assert.equal(response.body.includes("client-secret"), false);
  });
});

test("readiness exposes the exact Vercel source commit without secret values", async () => {
  await withOAuthEnvironment(async () => {
    process.env.GITHUB_APP_SLUG = "changeplane-test";
    process.env.CHANGEPLANE_CANARY_REPOSITORY = "alice/disposable-canary";
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_GIT_PROVIDER = "github";
    process.env.VERCEL_GIT_REPO_OWNER = "LeChiffreVol2";
    process.env.VERCEL_GIT_REPO_SLUG = "changeplane";
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_test_release_identifier";
    const response = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, response);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), {
      status: "configuration_required",
      commercialReady: false,
      principalSeparation: "installer_app_not_configured",
      checks: {
        githubClientId: true,
        githubClientSecret: true,
        githubAppSlug: true,
        sessionSecret: true,
        appOrigin: true,
        guardPublisher: true,
        guardPrincipalSeparated: false,
        guardPublicationSerialized: false,
        guardJournalConfigured: false,
        guardJournalConfiguration: false,
        pilotAdmissionConfiguration: true,
        commercialStore: false,
        commercialStoreVerified: false,
        commercialRuntimeIntegrated: false,
        legalRelease: false,
        sourceProvenance: true,
        canaryRepository: true,
        rolloutAuthorized: true,
      },
      authMode: "github_app",
      rolloutMode: "controlled_canary",
      release: "aaaaaaaaaaaa",
      managedRuntime: "reserved",
      repairController: {
        enabled: false,
        configured: false,
        checks: {
          enabled: false,
          repositoryScope: false,
          installationBound: false,
          appId: false,
          appPrivateKey: false,
          controllerSecret: false,
          generation: false,
        },
      },
    });
  });
});

test("readiness and onboarding fail closed without the dedicated guard publisher", async () => {
  await withOAuthEnvironment(async () => {
    delete process.env.CHANGEPLANE_GUARD_APP_PRIVATE_KEY;

    const readinessResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, readinessResponse);
    const readinessPayload = JSON.parse(readinessResponse.body);
    assert.equal(readinessResponse.statusCode, 503);
    assert.equal(readinessPayload.status, "configuration_required");
    assert.equal(readinessPayload.checks.guardPublisher, false);

    process.env.CHANGEPLANE_GUARD_APP_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----";
    const malformedResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, malformedResponse);
    assert.equal(malformedResponse.statusCode, 503);
    assert.equal(JSON.parse(malformedResponse.body).checks.guardPublisher, false);

    const sessionResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, sessionResponse);
    assert.equal(JSON.parse(sessionResponse.body).configured, false);
  });
});

test("readiness marks explicit Installer App reuse as operational but not commercially ready", async () => {
  await withOAuthEnvironment(async () => {
    delete process.env.CHANGEPLANE_GUARD_APP_ID;
    delete process.env.CHANGEPLANE_GUARD_APP_SLUG;
    delete process.env.CHANGEPLANE_GUARD_APP_PRIVATE_KEY;
    Object.assign(process.env, {
      GITHUB_APP_ID: "424242",
      GITHUB_APP_SLUG: "changeplane-test",
      GITHUB_APP_PRIVATE_KEY: TEST_GUARD_PRIVATE_KEY,
    });

    const closedResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, closedResponse);
    assert.equal(closedResponse.statusCode, 503);
    assert.equal(JSON.parse(closedResponse.body).checks.guardPublisher, false);

    process.env.CHANGEPLANE_GUARD_REUSE_GITHUB_APP = "true";
    const readyResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, readyResponse);
    assert.equal(readyResponse.statusCode, 200);
    const shared = JSON.parse(readyResponse.body);
    assert.equal(shared.checks.guardPublisher, true);
    assert.equal(shared.checks.guardPrincipalSeparated, false);
    assert.equal(shared.commercialReady, false);
    assert.equal(shared.principalSeparation, "shared_installer_guard");

    process.env.GITHUB_APP_SLUG = "github-actions";
    const unsafeResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, unsafeResponse);
    assert.equal(unsafeResponse.statusCode, 503);
    assert.equal(JSON.parse(unsafeResponse.body).checks.guardPublisher, false);
  });
});

test("readiness cannot claim commercial integration from configuration and release approvals", async () => {
  await withOAuthEnvironment(async () => {
    Object.assign(process.env, {
      GITHUB_APP_ID: "111111",
      GITHUB_APP_SLUG: "changeplane-installer",
    });

    const response = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, response);
    const separatedOnly = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(separatedOnly.checks.guardPrincipalSeparated, true);
    assert.equal(separatedOnly.commercialReady, false);

    Object.assign(process.env, {
      CHANGEPLANE_COMMERCIAL_STORE_ENABLED: "true",
      CHANGEPLANE_DATABASE_URL: "postgresql://changeplane:test@db.example/changeplane?sslmode=verify-full",
      CHANGEPLANE_LEGAL_RELEASE_APPROVED: "true",
    });
    const unboundResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, unboundResponse);
    const unbound = JSON.parse(unboundResponse.body);
    assert.equal(unbound.checks.commercialStore, true);
    assert.equal(unbound.checks.commercialStoreVerified, false);
    assert.equal(unbound.checks.legalRelease, false);
    assert.equal(unbound.commercialReady, false);

    Object.assign(process.env, {
      CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE: "development",
      CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE: "development",
    });
    const commercialResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, commercialResponse);
    const commercial = JSON.parse(commercialResponse.body);
    assert.equal(commercial.checks.guardPrincipalSeparated, true);
    assert.equal(commercial.checks.commercialStore, true);
    assert.equal(commercial.checks.commercialStoreVerified, true);
    assert.equal(commercial.checks.legalRelease, true);
    assert.equal(commercial.checks.commercialRuntimeIntegrated, false);
    assert.equal(commercial.commercialReady, false);
    assert.equal(commercial.principalSeparation, "separate_guard_app");
  });
});

test("hosted rollout stays closed when the disposable canary setting is missing", async () => {
  await withGitHubAppEnvironment(async () => {
    Object.assign(process.env, {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_OWNER: "LeChiffreVol2",
      VERCEL_GIT_REPO_SLUG: "changeplane",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    });
    delete process.env.CHANGEPLANE_CANARY_REPOSITORY;
    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { externalCalls += 1; throw new Error("No external request expected"); };
    try {
      const readinessResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, readinessResponse);
      const readinessPayload = JSON.parse(readinessResponse.body);
      assert.equal(readinessResponse.statusCode, 503);
      assert.equal(readinessPayload.checks.canaryRepository, false);
      assert.equal(readinessPayload.rolloutMode, "controlled_canary");

      const sessionResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, sessionResponse);
      assert.equal(JSON.parse(sessionResponse.body).configured, false);

      const loginResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=login", headers: {} }, loginResponse);
      assert.equal(loginResponse.statusCode, 503);
      assert.equal(loginResponse.getHeader("location"), undefined);
      assert.equal(loginResponse.getHeader("set-cookie"), undefined);
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("production self-serve stays closed without exact legal approval and commercial integration", async () => {
  await withGitHubAppEnvironment(async () => {
    Object.assign(process.env, {
      CHANGEPLANE_SELF_SERVE_ENABLED: "true",
      CHANGEPLANE_CANARY_REPOSITORY: "alice/disposable-canary",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_OWNER: "LeChiffreVol2",
      VERCEL_GIT_REPO_SLUG: "changeplane",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: "c".repeat(40),
    });

    for (const legal of [
      {},
      { CHANGEPLANE_LEGAL_RELEASE_APPROVED: "true" },
      {
        CHANGEPLANE_LEGAL_RELEASE_APPROVED: "true",
        CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE: "b".repeat(40),
      },
    ]) {
      delete process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED;
      delete process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE;
      Object.assign(process.env, legal);
      const closedResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, closedResponse);
      const closed = JSON.parse(closedResponse.body);
      assert.equal(closedResponse.statusCode, 503);
      assert.equal(closed.rolloutMode, "self_serve");
      assert.equal(closed.checks.canaryRepository, true);
      assert.equal(closed.commercialReady, false);
    }

    Object.assign(process.env, {
      CHANGEPLANE_LEGAL_RELEASE_APPROVED: "true",
      CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE: "c".repeat(40),
    });
    const openResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, openResponse);
    const open = JSON.parse(openResponse.body);
    assert.equal(openResponse.statusCode, 503);
    assert.equal(open.rolloutMode, "self_serve");
    assert.equal(open.checks.canaryRepository, true);
    assert.equal(open.checks.legalRelease, true);
    assert.equal(open.repairController.configured, false);

    const sessionResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, sessionResponse);
    const blockedSession = JSON.parse(sessionResponse.body);
    assert.equal(blockedSession.authenticated, false);
    assert.equal(blockedSession.configured, false);
    assert.equal(blockedSession.authMode, "github_app");
    assert.equal(blockedSession.rolloutMode, "self_serve");
    assert.equal(blockedSession.accessBlock.reason, "separate_guard_required");
  });
});

test("controlled canary requires a GitHub App slug for returning-owner access", async () => {
  await withOAuthEnvironment(async () => {
    Object.assign(process.env, {
      CHANGEPLANE_CANARY_REPOSITORY: "alice/disposable-canary",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_OWNER: "LeChiffreVol2",
      VERCEL_GIT_REPO_SLUG: "changeplane",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
    });
    delete process.env.GITHUB_APP_SLUG;

    const readinessResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, readinessResponse);
    const readinessPayload = JSON.parse(readinessResponse.body);
    assert.equal(readinessResponse.statusCode, 503);
    assert.equal(readinessPayload.checks.githubAppSlug, false);
    assert.equal(readinessPayload.rolloutMode, "controlled_canary");

    const sessionResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, sessionResponse);
    assert.equal(JSON.parse(sessionResponse.body).configured, false);

    const authorizeResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=authorize", headers: {} }, authorizeResponse);
    assert.equal(authorizeResponse.statusCode, 503);
    assert.equal(authorizeResponse.getHeader("location"), undefined);
  });
});

test("repair stays disabled when its repository differs from the disposable canary", async () => {
  await withGitHubAppEnvironment(async () => {
    Object.assign(process.env, {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_OWNER: "LeChiffreVol2",
      VERCEL_GIT_REPO_SLUG: "changeplane",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      CHANGEPLANE_CANARY_REPOSITORY: "alice/disposable-canary",
      CHANGEPLANE_REPAIR_REPOSITORY: "alice/different-repository",
      CHANGEPLANE_REPAIR_ENABLED: "true",
      CHANGEPLANE_REPAIR_GENERATION: "1",
      CHANGEPLANE_CONTROLLER_SECRET: "c".repeat(64),
      GITHUB_APP_ID: "101",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-used-by-readiness\n-----END PRIVATE KEY-----",
    });
    const readinessResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, readinessResponse);
    const readinessBody = JSON.parse(readinessResponse.body);
    assert.equal(readinessBody.repairController.configured, false);
    assert.equal(readinessBody.repairController.checks.installationBound, false);

    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      externalCalls += 1;
      throw new Error("GitHub must not be called");
    };
    try {
      for (const action of ["repair", "repair-claim", "repair-validate", "repair-push-token"]) {
        const response = responseRecorder();
        await handler({
          method: "POST",
          url: `/api/github?action=${action}`,
          headers: { "content-type": "application/json" },
        }, response);
        assert.equal(response.statusCode, 503, `${action} must stay disabled before GitHub access`);
      }
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("repair kill switch stays closed even when every other controller setting is valid", async () => {
  await withGitHubAppEnvironment(async () => {
    Object.assign(process.env, {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_OWNER: "LeChiffreVol2",
      VERCEL_GIT_REPO_SLUG: "changeplane",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: "c".repeat(40),
      CHANGEPLANE_CANARY_REPOSITORY: "alice/disposable-canary",
      CHANGEPLANE_REPAIR_REPOSITORY: "alice/disposable-canary",
      CHANGEPLANE_REPAIR_ENABLED: "false",
      CHANGEPLANE_REPAIR_GENERATION: "1",
      CHANGEPLANE_CONTROLLER_SECRET: "c".repeat(64),
      GITHUB_APP_ID: "101",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-used-by-readiness\n-----END PRIVATE KEY-----",
    });
    const readinessResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, readinessResponse);
    const repairState = JSON.parse(readinessResponse.body).repairController;
    assert.equal(readinessResponse.statusCode, 503);
    assert.equal(JSON.parse(readinessResponse.body).checks.guardJournalConfigured, false);
    assert.equal(repairState.enabled, false);
    assert.equal(repairState.configured, false);
    assert.deepEqual(repairState.checks, {
      enabled: false,
      repositoryScope: true,
      installationBound: true,
      appId: true,
      appPrivateKey: true,
      controllerSecret: true,
      generation: true,
    });

    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { externalCalls += 1; throw new Error("No external request expected"); };
    try {
      for (const action of ["repair", "repair-claim", "repair-validate", "repair-push-token"]) {
        const response = responseRecorder();
        await handler({ method: "POST", url: `/api/github?action=${action}`, headers: {} }, response);
        assert.equal(response.statusCode, 503, `${action} must stop before body or external access`);
      }
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("Vercel provenance rejects CLI, preview, branch, and wrong-repository releases", async () => {
  await withOAuthEnvironment(async () => {
    Object.assign(process.env, {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_GIT_PROVIDER: "github",
      VERCEL_GIT_REPO_OWNER: "LeChiffreVol2",
      VERCEL_GIT_REPO_SLUG: "changeplane",
      VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    });
    const mismatches = [
      ["VERCEL_GIT_PROVIDER", ""],
      ["VERCEL_ENV", "preview"],
      ["VERCEL_GIT_COMMIT_REF", "agent/unreviewed"],
      ["VERCEL_GIT_REPO_OWNER", "someone-else"],
      ["VERCEL_GIT_REPO_SLUG", "another-project"],
    ];
    for (const [name, value] of mismatches) {
      const original = process.env[name];
      process.env[name] = value;
      const response = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, response);
      assert.equal(response.statusCode, 503, `${name} must fail closed`);
      assert.equal(JSON.parse(response.body).checks.sourceProvenance, false);
      process.env[name] = original;
    }
  });
});

test("unattributed Vercel deployments reject every connector and provider route before external access", async () => {
  await withOAuthEnvironment(async () => {
    process.env.VERCEL = "1";
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("External access must not occur"); };
    try {
      const externalRoutes = [
        ["GET", "login"],
        ["GET", "authorize"],
        ["GET", "installation"],
        ["GET", "callback"],
        ["GET", "repos"],
        ["GET", "preflight"],
        ["GET", "runtime"],
        ["POST", "runtime"],
        ["GET", "byok"],
        ["POST", "byok"],
        ["DELETE", "byok"],
        ["POST", "install"],
        ["POST", "repair"],
        ["POST", "repair-claim"],
        ["POST", "repair-push-token"],
        ["POST", "repair-validate"],
      ];
      for (const [method, action] of externalRoutes) {
        const response = responseRecorder();
        await handler({ method, url: `/api/github?action=${action}`, headers: {} }, response);
        assert.equal(response.statusCode, 503);
        assert.match(JSON.parse(response.body).error, /bound to a verified source commit/u);
      }
      assert.equal(calls, 0);

      const sessionResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, sessionResponse);
      assert.deepEqual(JSON.parse(sessionResponse.body), {
        authenticated: false,
        configured: false,
        authMode: "oauth",
        rolloutMode: "controlled_canary",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("repository picker rejects unauthenticated requests before calling GitHub", async () => {
  await withOAuthEnvironment(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("GitHub must not be called without a user session");
    };
    try {
      const response = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=repos", headers: {} }, response);
      assert.equal(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.equal(body.error, "Connect GitHub first.");
      assert.match(body.requestId, /^[a-f0-9]{24}$/u);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("repository picker uses only the signed-in user's token and returns writable repositories", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), authorization: options?.headers?.authorization });
      return {
        ok: true,
        status: 200,
        async json() {
          return [
            {
              full_name: "alice/private-service",
              private: true,
              default_branch: "main",
              permissions: { push: true, admin: false },
            },
            {
              full_name: "shared/read-only",
              private: true,
              default_branch: "main",
              permissions: { push: false, admin: false },
            },
          ];
        },
      };
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=repos",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), {
        repositories: [{
          fullName: "alice/private-service",
          private: true,
          defaultBranch: "main",
          permissions: { push: true, admin: false },
        }],
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].authorization, "Bearer alice-token");
      assert.match(calls[0].url, /^https:\/\/api\.github\.com\/user\/repos\?/u);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("controlled canary mode lists and authorizes only the exact disposable repository", async () => {
  await withOAuthEnvironment(async () => {
    process.env.CHANGEPLANE_CANARY_REPOSITORY = "alice/disposable-canary";
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    let calls = 0;
    const paths = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls += 1;
      paths.push(new URL(url).pathname);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            full_name: "alice/disposable-canary",
            private: true,
            default_branch: "main",
            permissions: { push: true, admin: true },
          };
        },
      };
    };
    try {
      const listResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=repos",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, listResponse);
      assert.equal(listResponse.statusCode, 200);
      assert.deepEqual(JSON.parse(listResponse.body).repositories.map(({ fullName }) => fullName), ["alice/disposable-canary"]);
      assert.equal(calls, 1);
      assert.deepEqual(paths, ["/repos/alice/disposable-canary"]);

      const rejectedResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fbusiness-repository",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, rejectedResponse);
      assert.equal(rejectedResponse.statusCode, 403);
      assert.match(JSON.parse(rejectedResponse.body).error, /access only its approved test repository/u);
      assert.equal(calls, 1);
      assert.deepEqual(paths, ["/repos/alice/disposable-canary"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("private alpha cannot access invited or uninvited repositories before publication serialization", async () => {
  await withGitHubAppEnvironment(async () => {
    Object.assign(process.env, {
      GITHUB_APP_ID: "111111",
      GITHUB_APP_SLUG: "changeplane-installer",
      CHANGEPLANE_ALPHA_REPOSITORIES_JSON: JSON.stringify([
        "acme/payment-api",
        "beta/agent-service",
      ]),
      CHANGEPLANE_SELF_SERVE_ENABLED: "true",
      CHANGEPLANE_LEGAL_RELEASE_APPROVED: "true",
      CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE: "development",
    });
    const session = seal({
      kind: "session",
      token: "alpha-user-token",
      login: "founder",
      csrf: "alpha-csrf",
      authMode: "github_app",
      installationId: 123,
      installationIds: [123],
    }, SECRET);
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("Customer publication containment must fail before GitHub");
    };
    try {
      const sessionResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, sessionResponse);
      assert.equal(JSON.parse(sessionResponse.body).rolloutMode, "private_alpha");

      const listResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=repos",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, listResponse);
      assert.equal(listResponse.statusCode, 503, listResponse.body);
      assert.match(JSON.parse(listResponse.body).error, /overlapping evaluations/u);
      assert.equal(calls, 0);

      const rejectedResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=stranger%2Funinvited",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, rejectedResponse);
      assert.equal(rejectedResponse.statusCode, 503);
      assert.match(JSON.parse(rejectedResponse.body).error, /overlapping evaluations/u);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("private alpha fails closed for malformed, duplicate, or oversized repository scope", async () => {
  await withGitHubAppEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alpha-user-token",
      login: "founder",
      csrf: "alpha-csrf",
      authMode: "github_app",
      installationId: 123,
      installationIds: [123],
    }, SECRET);
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("Invalid alpha scope must fail before GitHub");
    };
    try {
      for (const value of [
        "not-json",
        JSON.stringify(["acme/api", "ACME/API"]),
        JSON.stringify(["a/one", "b/two", "c/three", "d/four", "e/five", "f/six"]),
      ]) {
        process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON = value;
        const readinessResponse = responseRecorder();
        await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, readinessResponse);
        assert.equal(readinessResponse.statusCode, 503);
        assert.equal(JSON.parse(readinessResponse.body).rolloutMode, "private_alpha");

        const listResponse = responseRecorder();
        await handler({
          method: "GET",
          url: "/api/github?action=repos",
          headers: { cookie: `__Host-changeplane_session=${session}` },
        }, listResponse);
        assert.equal(listResponse.statusCode, 503);
        assert.match(JSON.parse(listResponse.body).error, /CHANGEPLANE_ALPHA_REPOSITORIES_JSON/u);
      }
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("controlled canary exposes owner access but rejects every new GitHub App installation", async () => {
  await withGitHubAppEnvironment(async () => {
    process.env.CHANGEPLANE_CANARY_REPOSITORY = "alice/disposable-canary";
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("GitHub must not be called"); };
    try {
      const sessionResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, sessionResponse);
      assert.deepEqual(JSON.parse(sessionResponse.body), {
        authenticated: false,
        configured: true,
        authMode: "github_app",
        rolloutMode: "controlled_canary",
      });

      const loginResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=login", headers: {} }, loginResponse);
      assert.equal(loginResponse.statusCode, 403);
      assert.equal(loginResponse.getHeader("location"), undefined);
      assert.equal(loginResponse.getHeader("set-cookie"), undefined);
      assert.equal(
        JSON.parse(loginResponse.body).error,
        "New GitHub App installations are disabled for this controlled canary.",
      );

      const installState = "i".repeat(43);
      const installationCookie = seal({
        kind: "installation",
        state: installState,
        redirectUri: "https://changeplane.example/api/github?action=callback",
        authMode: "github_app",
      }, SECRET, { purpose: "oauth" });
      const installationResponse = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=installation&installation_id=12345&state=${installState}`,
        headers: { cookie: `__Host-changeplane_oauth=${installationCookie}` },
      }, installationResponse);
      assert.equal(installationResponse.statusCode, 403);
      assert.equal(installationResponse.getHeader("location"), undefined);

      const oauthState = "o".repeat(43);
      const postInstallCookie = seal({
        kind: "oauth",
        state: oauthState,
        redirectUri: "https://changeplane.example/api/github?action=callback",
        authMode: "github_app",
        installationId: "12345",
        verifier: "v".repeat(64),
      }, SECRET, { purpose: "oauth" });
      const callbackResponse = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=callback&code=abcdefgh&state=${oauthState}`,
        headers: { cookie: `__Host-changeplane_oauth=${postInstallCookie}` },
      }, callbackResponse);
      assert.equal(callbackResponse.statusCode, 403);
      assert.equal(callbackResponse.getHeader("location"), undefined);

      const ownerResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=authorize", headers: {} }, ownerResponse);
      assert.equal(ownerResponse.statusCode, 302);
      assert.equal(new URL(ownerResponse.getHeader("location")).pathname, "/login/oauth/authorize");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("controlled canary returns a non-owner cleanly to the unlisted owner entry", async () => {
  await withGitHubAppEnvironment(async () => {
    process.env.CHANGEPLANE_CANARY_REPOSITORY = "alice/disposable-canary";
    const authorizeResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=authorize", headers: {} }, authorizeResponse);
    const authorizeUrl = new URL(authorizeResponse.getHeader("location"));
    const oauthState = authorizeUrl.searchParams.get("state");
    const oauthCookie = authorizeResponse.getHeader("set-cookie")[0].split(";", 1)[0];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.origin === "https://github.com") {
        return { ok: true, status: 200, async json() { return { access_token: "ghu_non_owner", expires_in: 28_800, scope: "" }; } };
      }
      if (requestUrl.pathname === "/user") {
        return { ok: true, status: 200, async json() { return { login: "not-the-owner" }; } };
      }
      if (requestUrl.pathname === "/user/installations") {
        return { ok: true, status: 200, async json() { return { installations: [] }; } };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };
    try {
      const callbackResponse = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=callback&code=valid-code-123&state=${oauthState}`,
        headers: { cookie: oauthCookie },
      }, callbackResponse);
      assert.equal(callbackResponse.statusCode, 302);
      const returnUrl = new URL(callbackResponse.getHeader("location"));
      assert.equal(returnUrl.origin, "https://changeplane.example");
      assert.equal(returnUrl.searchParams.get("access"), "canary-owner");
      assert.equal(returnUrl.searchParams.get("github"), "owner_required");
      assert.match(callbackResponse.getHeader("set-cookie")[0], /Max-Age=0/u);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("invalid controlled canary configuration disables the connector before GitHub access", async () => {
  await withOAuthEnvironment(async () => {
    process.env.CHANGEPLANE_CANARY_REPOSITORY = "not-a-repository";
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("GitHub must not be called"); };
    try {
      const readinessResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, readinessResponse);
      assert.equal(readinessResponse.statusCode, 503);
      assert.equal(JSON.parse(readinessResponse.body).checks.canaryRepository, false);

      const sessionResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, sessionResponse);
      assert.equal(JSON.parse(sessionResponse.body).configured, false);

      const preflightResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fdisposable-canary",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, preflightResponse);
      assert.equal(preflightResponse.statusCode, 503);
      assert.match(JSON.parse(preflightResponse.body).error, /No GitHub request was made/u);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("repository preflight is read-only and exposes the exact zero-impact boundary", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const headSha = "a".repeat(40);
    const pullHeadSha = "b".repeat(40);
    const calls = [];
    let discoveryMode = "found";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      calls.push({ path: requestUrl.pathname, method: options.method || "GET" });
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              full_name: "alice/private-service",
              default_branch: "main",
              archived: false,
              disabled: false,
              permissions: { push: true, admin: false },
            };
          },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/git/ref/heads/main") {
        return { ok: true, status: 200, async json() { return { object: { sha: headSha } }; } };
      }
      if (requestUrl.pathname === `/repos/alice/private-service/commits/${headSha}/check-runs`) {
        if (discoveryMode === "unavailable") {
          return {
            ok: false,
            status: 503,
            headers: { get: () => "github-request-discovery" },
            async text() { return "private upstream body"; },
          };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            if (discoveryMode === "empty") return { check_runs: [] };
            return {
              check_runs: [
                { name: "Vercel deployment", app: { slug: "vercel" } },
                { name: "ChangePlane / guard", app: { slug: "changeplane" } },
              ],
            };
          },
        };
      }
      if (requestUrl.pathname === `/repos/alice/private-service/commits/${pullHeadSha}/check-runs`) {
        if (discoveryMode === "unavailable") {
          return {
            ok: false,
            status: 503,
            headers: { get: () => "github-request-discovery" },
            async text() { return "private upstream body"; },
          };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            if (discoveryMode === "empty") return { check_runs: [] };
            return { check_runs: [{
              name: "unit tests",
              head_sha: pullHeadSha,
              details_url: "https://github.com/alice/private-service/actions/runs/7001/job/8001",
              app: { slug: "github-actions" },
            }] };
          },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/actions/runs/7001") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: 7001, head_sha: pullHeadSha, path: ".github/workflows/ci.yml" };
          },
        };
      }
      if (requestUrl.pathname.startsWith("/repos/alice/private-service/contents/")) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => "github-request-preflight" },
          async text() { return "not found"; },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/pulls") {
        if (requestUrl.searchParams.get("sort") === "updated") {
          return {
            ok: true,
            status: 200,
            async json() {
              return [{ head: { sha: pullHeadSha, repo: { full_name: "alice/private-service" } } }];
            },
          };
        }
        return { ok: true, status: 200, async json() { return []; } };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/git/ref/heads/changeplane/observe-setup") {
        return {
          ok: false,
          status: 404,
          headers: { get: () => "github-request-preflight" },
          async text() { return "not found"; },
        };
      }
      throw new Error(`Unexpected request: ${requestUrl.pathname}`);
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fprivate-service",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200);
      const payload = JSON.parse(response.body);
      assert.equal(payload.installable, true);
      assert.equal(payload.defaultBranch, "main");
      assert.equal(payload.setupFiles, 9);
      assert.equal(payload.setupProfile, "verify-lite");
      assert.deepEqual(payload.payloadProfiles, {
        verifyLite: {
          managedProfile: "verify-lite",
          files: 9,
          repairAuthority: false,
          providerKeyRequired: false,
        },
        autonomous: {
          managedProfile: "full",
          files: 21,
          repairAuthority: true,
          providerKeyRequired: true,
        },
      });
      assert.deepEqual(payload.installation, {
        state: "fresh",
        currentVersion: null,
        targetVersion: 15,
        conflicts: [],
      });
      assert.deepEqual(payload.conflicts, []);
      assert.deepEqual(payload.setup, { state: "none" });
      assert.deepEqual(payload.evidenceOptions, [
        {
          name: "unit tests",
          appSlug: "github-actions",
          workflowPath: ".github/workflows/ci.yml",
          suggested: true,
        },
        { name: "Vercel deployment", appSlug: "vercel", suggested: false },
      ]);
      assert.deepEqual(payload.evidenceDiscovery, { state: "found", checkedHeads: 2 });
      assert.deepEqual(payload.boundary, {
        defaultBranchWrite: false,
        pullRequestOnly: true,
        mergeBlocking: false,
        agentRepairDuringSetup: false,
        untrustedCodeExecution: false,
        providerSecretAccess: false,
      });
      assert.deepEqual(payload.harness, {
        verifyAvailable: true,
        autonomousAvailable: false,
        maxAttempts: 2,
        budgetMinutes: 15,
      });
      assert.deepEqual(payload.capabilities, {
        independentReview: false,
        agentHandback: true,
        assuranceMemory: false,
        exactHeadPreview: true,
        mergeQueue: true,
      });
      assert.equal(calls.every(({ method }) => method === "GET"), true);

      discoveryMode = "empty";
      const emptyResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fprivate-service",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, emptyResponse);
      const emptyPayload = JSON.parse(emptyResponse.body);
      assert.equal(emptyResponse.statusCode, 200);
      assert.equal(emptyPayload.installable, true);
      assert.deepEqual(emptyPayload.evidenceOptions, []);
      assert.deepEqual(emptyPayload.evidenceDiscovery, { state: "empty", checkedHeads: 2 });

      discoveryMode = "unavailable";
      const unavailableResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Fprivate-service",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, unavailableResponse);
      const unavailablePayload = JSON.parse(unavailableResponse.body);
      assert.equal(unavailableResponse.statusCode, 200);
      assert.equal(unavailablePayload.installable, true);
      assert.deepEqual(unavailablePayload.evidenceOptions, []);
      assert.deepEqual(unavailablePayload.evidenceDiscovery, { state: "unavailable" });
      assert.doesNotMatch(unavailableResponse.body, /private upstream body/u);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("safe GitHub reads retry one transient upstream failure", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const requestUrl = new URL(String(input));
      if (requestUrl.pathname !== "/user/repos") {
        return { ok: true, status: 200, async json() { return []; } };
      }
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => "github-request-1" },
          async text() { return "temporarily unavailable"; },
        };
      }
      return { ok: true, status: 200, async json() { return []; } };
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=repos",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), { repositories: [] });
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("runtime status redacts secret metadata from a non-admin writer", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const managedKey = `provider-${"m".repeat(40)}`;
    const headSha = "a".repeat(40);
    const policyContent = JSON.stringify({
      version: 1,
      evidence: { requiredChecks: [] },
      runtime: {
        funding: "byok",
        provider: "openai",
        secretName: "OPENAI_API_KEY",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        managedSubscription: "reserved",
      },
    });
    const runtimeTree = managedRuntimeTreeFixture("verify-lite", policyContent);
    const originalManagedKey = process.env.CHANGEPLANE_MANAGED_OPENAI_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.CHANGEPLANE_MANAGED_OPENAI_API_KEY = managedKey;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.origin === "https://api.openai.com") {
        assert.equal(options.headers.authorization, `Bearer ${managedKey}`);
        return {
          ok: true,
          status: 200,
          async json() { return { id: "gpt-5.6-luna" }; },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() { return { full_name: "alice/private-service", default_branch: "main", permissions: { push: true, admin: false } }; },
        };
      }
      if (requestUrl.pathname.endsWith("/git/ref/heads/main")) {
        return { ok: true, status: 200, async json() { return { object: { sha: headSha } }; } };
      }
      if (requestUrl.pathname.endsWith("/contents/changeplane/manifest.json")) {
        return managedManifestFileResponse();
      }
      if (requestUrl.pathname.endsWith("/contents/.changeplane.json")) {
        return managedFileResponse(policyContent);
      }
      if (requestUrl.pathname.endsWith(`/git/commits/${headSha}`)) {
        return { ok: true, status: 200, async json() { return { tree: { sha: runtimeTree.treeSha } }; } };
      }
      if (requestUrl.pathname.endsWith(`/git/trees/${runtimeTree.treeSha}`)) {
        return { ok: true, status: 200, async json() { return runtimeTree.payload; } };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=runtime&repository=alice%2Fprivate-service",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200);
      const payload = JSON.parse(response.body);
      assert.deepEqual(payload.managed, {
        state: "provider_verified",
        available: false,
        providerVerified: true,
        executionReady: false,
      });
      assert.deepEqual(payload.byok, {
        configured: false,
        state: "admin_required",
        secretName: "OPENAI_API_KEY",
        updatedAt: null,
      });
      assert.equal(payload.harness.autonomousAvailable, false);
      assert.equal(payload.harness.verifyAvailable, true);
      assert.equal(payload.harness.ready, false);
      assert.equal(payload.model, "gpt-5.6-luna");
      assert.equal(payload.sdlc.type, "changeplane.agentic-sdlc-view");
      assert.equal(payload.sdlc.posture, "scope_only");
      assert.equal(payload.sdlc.stages.find(({ id }) => id === "operate").state, "external");
      assert.equal(payload.sdlc.authority.merge, "github");
      assert.equal(response.body.includes(managedKey), false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalManagedKey === undefined) delete process.env.CHANGEPLANE_MANAGED_OPENAI_API_KEY;
      else process.env.CHANGEPLANE_MANAGED_OPENAI_API_KEY = originalManagedKey;
    }
  });
});

test("runtime status rejects required Check schema drift before projecting SDLC readiness", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const headSha = "a".repeat(40);
    const originalFetch = globalThis.fetch;
    try {
      for (const requiredChecks of [
        [{ name: "test", appSlug: "github-actions", unexpected: true }],
        [{ name: "test", appSlug: "GitHub-Actions" }],
        [],
      ]) {
        const policyContent = JSON.stringify({
          version: 1,
          harness: { mode: "verify", maxAttempts: 2, budgetMinutes: 15 },
          evidence: { requiredChecks },
          runtime: {
            funding: "byok",
            provider: "openai",
            secretName: "OPENAI_API_KEY",
            model: "gpt-5.6-luna",
            reasoningEffort: "high",
            managedSubscription: "reserved",
          },
        });
        const runtimeTree = managedRuntimeTreeFixture("verify-lite", policyContent);
        const calls = [];
        globalThis.fetch = async (url) => {
          const requestUrl = new URL(String(url));
          calls.push(`${requestUrl.pathname}${requestUrl.search}`);
          if (requestUrl.pathname === "/repos/alice/private-service") {
            return {
              ok: true,
              status: 200,
              async json() {
                return { full_name: "alice/private-service", default_branch: "main", permissions: { push: true, admin: true } };
              },
            };
          }
          if (requestUrl.pathname.endsWith("/git/ref/heads/main")) {
            return { ok: true, status: 200, async json() { return { object: { sha: headSha } }; } };
          }
          if (requestUrl.pathname.endsWith("/contents/changeplane/manifest.json")) {
            return managedManifestFileResponse();
          }
          if (requestUrl.pathname.endsWith("/contents/.changeplane.json")) {
            return managedFileResponse(policyContent);
          }
          if (requestUrl.pathname.endsWith(`/git/commits/${headSha}`)) {
            return { ok: true, status: 200, async json() { return { tree: { sha: runtimeTree.treeSha } }; } };
          }
          if (requestUrl.pathname.endsWith(`/git/trees/${runtimeTree.treeSha}`)) {
            return { ok: true, status: 200, async json() { return runtimeTree.payload; } };
          }
          throw new Error(`Unexpected request: ${requestUrl}`);
        };
        const response = responseRecorder();
        await handler({
          method: "GET",
          url: "/api/github?action=runtime&repository=alice%2Fprivate-service",
          headers: { cookie: `__Host-changeplane_session=${session}` },
        }, response);
        assert.equal(response.statusCode, 409);
        assert.match(JSON.parse(response.body).error, /evidence checks are malformed/u);
        assert.equal(response.body.includes("changeplane.agentic-sdlc-view"), false);
        assert.equal(calls.some((call) => call.includes("/rulesets")), false);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("runtime status rejects a forged Full profile over a Lite managed tree before authority checks", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const headSha = "a".repeat(40);
    const policyContent = JSON.stringify({
      version: 1,
      harness: { mode: "autonomous", maxAttempts: 2, budgetMinutes: 15 },
      runtime: {
        funding: "byok",
        provider: "openai",
        secretName: "OPENAI_API_KEY",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        managedSubscription: "reserved",
      },
    });
    const liteTree = managedRuntimeTreeFixture("verify-lite", policyContent);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const requestUrl = new URL(String(url));
      calls.push(requestUrl.pathname);
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              full_name: "alice/private-service",
              default_branch: "main",
              permissions: { push: true, admin: true },
            };
          },
        };
      }
      if (requestUrl.pathname.endsWith("/git/ref/heads/main")) {
        return { ok: true, status: 200, async json() { return { object: { sha: headSha } }; } };
      }
      if (requestUrl.pathname.endsWith("/contents/changeplane/manifest.json")) {
        return managedManifestFileResponse("full");
      }
      if (requestUrl.pathname.endsWith("/contents/.changeplane.json")) {
        return managedFileResponse(policyContent);
      }
      if (requestUrl.pathname.endsWith(`/git/commits/${headSha}`)) {
        return { ok: true, status: 200, async json() { return { tree: { sha: liteTree.treeSha } }; } };
      }
      if (requestUrl.pathname.endsWith(`/git/trees/${liteTree.treeSha}`)) {
        return { ok: true, status: 200, async json() { return liteTree.payload; } };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=runtime&repository=alice%2Fprivate-service",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 409);
      assert.match(JSON.parse(response.body).error, /profile-expanded outside a protected pull request/u);
      assert.equal(calls.some((call) => call.endsWith("/rulesets")), false);
      assert.equal(calls.some((call) => call.includes("/actions/secrets")), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

for (const authMode of ["oauth", "github_app"]) {
test(`Ruleset plan separates classic protection and revalidates optional write authority (${authMode})`, async () => {
  await withOAuthEnvironment(async () => {
    process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
    process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
    if (authMode === "github_app") process.env.GITHUB_APP_SLUG = "changeplane-test";
    const session = seal({
      kind: "session",
      authMode,
      installationId: "12345",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const headSha = "a".repeat(40);
    const pullHeadSha = "b".repeat(40);
    const policyContent = JSON.stringify({
      harness: { mode: "verify", maxAttempts: 2, budgetMinutes: 15 },
      evidence: { requiredChecks: [{
        name: "test",
        appSlug: "github-actions",
        workflowPath: ".github/workflows/ci.yml",
      }] },
      runtime: {
        funding: "byok",
        provider: "openai",
        secretName: "OPENAI_API_KEY",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        managedSubscription: "reserved",
      },
    });
    const runtimeTree = managedRuntimeTreeFixture("verify-lite", policyContent);
    const calls = [];
    let createdRuleset = null;
    let administration = "read";
    let installationId = 12345;
    let appSlug = "changeplane-test";
    let suspendedAt = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      calls.push(`${requestUrl.pathname}${requestUrl.search}`);
      if (requestUrl.pathname === "/user/installations") {
        return { ok: true, status: 200, async json() { return { installations: [
          { id: installationId, app_slug: appSlug, suspended_at: suspendedAt, permissions: { administration } },
          { id: 99999, app_slug: "changeplane-test", permissions: { administration: "write" } },
        ] }; } };
      }
      if (requestUrl.pathname === "/user/installations/12345/repositories") {
        return { ok: true, status: 200, async json() { return { repositories: [{
          id: 77, full_name: "alice/private-service", default_branch: "main", permissions: { push: true, admin: true },
        }] }; } };
      }
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: 77,
              full_name: "alice/private-service",
              default_branch: "main",
              permissions: { push: true, admin: true },
            };
          },
        };
      }
      if (requestUrl.pathname.endsWith("/git/ref/heads/main")) {
        return { ok: true, status: 200, async json() { return { object: { sha: headSha } }; } };
      }
      if (requestUrl.pathname.endsWith("/contents/changeplane/manifest.json")) {
        return managedManifestFileResponse();
      }
      if (requestUrl.pathname.endsWith("/contents/.changeplane.json")) {
        return managedFileResponse(policyContent);
      }
      if (requestUrl.pathname.endsWith(`/git/commits/${headSha}`)) {
        return { ok: true, status: 200, async json() { return { tree: { sha: runtimeTree.treeSha } }; } };
      }
      if (requestUrl.pathname.endsWith(`/git/trees/${runtimeTree.treeSha}`)) {
        return { ok: true, status: 200, async json() { return runtimeTree.payload; } };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/rulesets") {
        if (options.method === "POST") {
          const submitted = JSON.parse(options.body);
          createdRuleset = { id: 99, source_type: "Repository", ...submitted };
          return { ok: true, status: 201, async json() { return createdRuleset; } };
        }
        return {
          ok: true,
          status: 200,
          async json() { return createdRuleset ? [{ id: createdRuleset.id }] : []; },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/rulesets/99") {
        return { ok: true, status: 200, async json() { return createdRuleset; } };
      }
      if (requestUrl.pathname.endsWith("/branches/main/protection/required_status_checks")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              strict: true,
              checks: [
                { context: "ChangePlane / guard", app_id: 424242 },
                { context: "ChangePlane guard", app_id: 15368 },
              ],
            };
          },
        };
      }
      if (requestUrl.pathname.endsWith("/pulls")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return [{ head: { sha: pullHeadSha, repo: { full_name: "alice/private-service" } } }];
          },
        };
      }
      if (requestUrl.pathname === `/repos/alice/private-service/commits/${pullHeadSha}/check-runs`) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { check_runs: [
              {
                name: "ChangePlane / guard",
                head_sha: pullHeadSha,
                app: { id: 424242, slug: "changeplane-test" },
              },
              {
                name: "test",
                head_sha: pullHeadSha,
                app: { id: 15368, slug: "github-actions" },
                details_url: "https://github.com/alice/private-service/actions/runs/7001",
              },
            ] };
          },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/actions/runs/7001") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: 7001, head_sha: pullHeadSha, path: ".github/workflows/ci.yml@refs/heads/main" };
          },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/actions/secrets/OPENAI_API_KEY") {
        return {
          ok: false,
          status: 404,
          headers: { get: () => "github-request-secret" },
          async text() { return "not found"; },
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=runtime&repository=alice%2Fprivate-service",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200, `${response.body}\n${calls.join("\n")}`);
      assert.deepEqual(JSON.parse(response.body).harness.enforcement, {
        source: "ruleset",
        state: "ruleset_required",
        assuranceLevel: null,
        active: false,
        queueCertified: false,
        strict: false,
        mergeQueueRequired: false,
        guardRequired: false,
        publisherBound: false,
        evidenceRequired: false,
        evidencePublisherBound: false,
        nextAction: "Add an active branch ruleset targeting the default branch, then recheck this repository.",
      });
      const sdlc = JSON.parse(response.body).sdlc;
      assert.equal(sdlc.posture, "verification_ready");
      assert.equal(sdlc.stages.find(({ id }) => id === "verify").state, "controlled");
      assert.equal(sdlc.stages.find(({ id }) => id === "release").state, "action_required");
      assert.equal(sdlc.authority.contributesToPass, false);
      assert.equal(calls.some((call) => call.includes("/branches/main/protection")), false);

      const planResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=ruleset-plan&repository=alice%2Fprivate-service&assuranceLevel=strict_head",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, planResponse);
      assert.equal(planResponse.statusCode, 200, planResponse.body);
      const plan = JSON.parse(planResponse.body).plan;
      assert.equal(plan.action, "create");
      assert.equal(plan.canApply, authMode === "oauth");
      if (authMode === "github_app") assert.match(plan.nextAction, /Administration write.*Nothing was changed/u);
      assert.equal(plan.mutation.body.bypass_actors.length, 0);
      assert.deepEqual(plan.mutation.body.conditions.ref_name.include, ["refs/heads/main"]);

      if (authMode === "github_app") {
        administration = "write";
        const allowed = responseRecorder();
        await handler({ method: "GET", url: "/api/github?action=ruleset-plan&repository=alice%2Fprivate-service", headers: { cookie: `__Host-changeplane_session=${session}` } }, allowed);
        assert.equal(allowed.statusCode, 200, allowed.body);
        assert.equal(JSON.parse(allowed.body).plan.canApply, true);
        assert.equal(JSON.parse(allowed.body).plan.planDigest, plan.planDigest);
        for (const scenario of ["revoked", "wrong_installation", "wrong_app", "suspended"]) {
          administration = scenario === "revoked" ? "read" : "write";
          installationId = scenario === "wrong_installation" ? 54321 : 12345;
          appSlug = scenario === "wrong_app" ? "other-app" : "changeplane-test";
          suspendedAt = scenario === "suspended" ? "2026-09-08T00:00:00Z" : null;
          const denied = responseRecorder();
          await handler({ method: "POST", url: "/api/github?action=ruleset-apply", headers: {
            origin: "https://changeplane.example", cookie: `__Host-changeplane_session=${session}`,
            "content-type": "application/json", "x-changeplane-csrf": "alice-csrf",
          }, body: { repository: "alice/private-service", assuranceLevel: "strict_head", planDigest: plan.planDigest } }, denied);
          assert.equal(denied.statusCode, 403, `${scenario}: ${denied.body}`);
          assert.match(JSON.parse(denied.body).error, /Administration write.*Nothing was changed/u);
          assert.equal(createdRuleset, null, `${scenario}: no Ruleset may be written`);
        }
        administration = "write";
        installationId = 12345;
        appSlug = "changeplane-test";
        suspendedAt = null;
      }

      const applyResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=ruleset-apply",
        headers: {
          origin: "https://changeplane.example",
          cookie: `__Host-changeplane_session=${session}`,
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: {
          repository: "alice/private-service",
          assuranceLevel: "strict_head",
          planDigest: plan.planDigest,
        },
      }, applyResponse);
      assert.equal(applyResponse.statusCode, 200, applyResponse.body);
      const applied = JSON.parse(applyResponse.body);
      assert.equal(applied.state, "applied");
      assert.equal(applied.enforcement.assuranceLevel, "strict_head");
      assert.equal(applied.ruleset.id, 99);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

}

test("runtime status proves active merge blocking from one strict default-branch ruleset", async () => {
  await withOAuthEnvironment(async () => {
    process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
    process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const headSha = "a".repeat(40);
    const pullHeadSha = "b".repeat(40);
    const policyContent = JSON.stringify({
      harness: { mode: "verify", maxAttempts: 2, budgetMinutes: 15 },
      evidence: { requiredChecks: [{
        name: "test",
        appSlug: "github-actions",
        workflowPath: ".github/workflows/ci.yml",
      }] },
      runtime: {
        funding: "byok",
        provider: "openai",
        secretName: "OPENAI_API_KEY",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        managedSubscription: "reserved",
      },
    });
    const runtimeTree = managedRuntimeTreeFixture("verify-lite", policyContent);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const requestUrl = new URL(String(url));
      calls.push(`${requestUrl.pathname}${requestUrl.search}`);
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: 77,
              full_name: "alice/private-service",
              default_branch: "main",
              permissions: { push: true, admin: true },
            };
          },
        };
      }
      if (requestUrl.pathname.endsWith("/git/ref/heads/main")) {
        return { ok: true, status: 200, async json() { return { object: { sha: headSha } }; } };
      }
      if (requestUrl.pathname.endsWith("/contents/changeplane/manifest.json")) {
        return managedManifestFileResponse();
      }
      if (requestUrl.pathname.endsWith("/contents/.changeplane.json")) {
        return managedFileResponse(policyContent);
      }
      if (requestUrl.pathname.endsWith(`/git/commits/${headSha}`)) {
        return { ok: true, status: 200, async json() { return { tree: { sha: runtimeTree.treeSha } }; } };
      }
      if (requestUrl.pathname.endsWith(`/git/trees/${runtimeTree.treeSha}`)) {
        return { ok: true, status: 200, async json() { return runtimeTree.payload; } };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/rulesets") {
        return { ok: true, status: 200, async json() { return [{ id: 42 }]; } };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/rulesets/42") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: 42,
              source_type: "Organization",
              target: "branch",
              enforcement: "active",
              bypass_actors: [],
              conditions: {
                ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
                repository_name: { include: ["private-service"], exclude: [], protected: true },
              },
              rules: [
                { type: "merge_queue" },
                {
                  type: "required_status_checks",
                  parameters: {
                    strict_required_status_checks_policy: true,
                    required_status_checks: [
                      { context: "ChangePlane / guard", integration_id: 424242 },
                      { context: "test", integration_id: 15368 },
                    ],
                  },
                },
              ],
            };
          },
        };
      }
      if (requestUrl.pathname.endsWith("/pulls")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return [{ head: { sha: pullHeadSha, repo: { full_name: "alice/private-service" } } }];
          },
        };
      }
      if (requestUrl.pathname === `/repos/alice/private-service/commits/${pullHeadSha}/check-runs`) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { check_runs: [
              {
                name: "ChangePlane / guard",
                head_sha: pullHeadSha,
                app: { id: 424242, slug: "changeplane-test" },
              },
              {
                name: "test",
                head_sha: pullHeadSha,
                app: { id: 15368, slug: "github-actions" },
                details_url: "https://github.com/alice/private-service/actions/runs/7001",
              },
            ] };
          },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/actions/runs/7001") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: 7001, head_sha: pullHeadSha, path: ".github/workflows/ci.yml@main" };
          },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service/actions/secrets/OPENAI_API_KEY") {
        return {
          ok: false,
          status: 404,
          headers: { get: () => "github-request-ruleset-secret" },
          async text() { return "not found"; },
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=runtime&repository=alice%2Fprivate-service",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200, `${response.body}\n${calls.join("\n")}`);
      assert.deepEqual(JSON.parse(response.body).harness.enforcement, {
        source: "ruleset",
        state: "active",
        assuranceLevel: "queue_certified",
        active: true,
        queueCertified: true,
        strict: true,
        mergeQueueRequired: true,
        guardRequired: true,
        publisherBound: true,
        evidenceRequired: true,
        evidencePublisherBound: true,
        nextAction: "No action is required; one active default-branch GitHub Ruleset has no bypasses, requires merge queue and strict status checks, and binds the ChangePlane guard plus every behavioral evidence check to its expected publisher.",
      });
      assert.equal(JSON.parse(response.body).sdlc.posture, "merge_gate_active");
      assert.equal(JSON.parse(response.body).sdlc.authority.merge, "github");
      assert.equal(calls.some((call) => call.includes("/branches/main/protection")), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("write collaborators cannot create or delete repository BYOK", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      calls.push(`${options.method || "GET"} ${requestUrl.origin}${requestUrl.pathname}`);
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              full_name: "alice/private-service",
              default_branch: "main",
              permissions: { push: true, admin: false },
            };
          },
        };
      }
      throw new Error(`Unexpected external call: ${requestUrl}`);
    };
    try {
      for (const [method, body] of [
        ["POST", { repository: "alice/private-service", apiKey: `provider-${"x".repeat(40)}` }],
        ["DELETE", { repository: "alice/private-service" }],
      ]) {
        const response = responseRecorder();
        await handler({
          method,
          url: "/api/github?action=byok",
          headers: {
            origin: "https://changeplane.example",
            cookie: `__Host-changeplane_session=${session}`,
            "content-type": "application/json",
            "x-changeplane-csrf": "alice-csrf",
          },
          body,
        }, response);
        assert.equal(response.statusCode, 403);
        assert.match(JSON.parse(response.body).error, /admin access is required/u);
      }
      assert.equal(calls.length, 4);
      assert.equal(calls.some((call) => call.includes("api.openai.com")), false);
      assert.equal(calls.some((call) => call.includes("/actions/secrets")), false);
      assert.equal(calls.some((call) => call.includes("/access_tokens")), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("BYOK save rechecks admin after provider verification and performs no secret write after revocation", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({ kind: "session", token: "alice-token", login: "alice", csrf: "alice-csrf" }, SECRET);
    const apiKey = `provider-${"r".repeat(40)}`;
    const headSha = "a".repeat(40);
    const policyContent = JSON.stringify({
      version: 1,
      evidence: { requiredChecks: [] },
      runtime: {
        funding: "byok",
        provider: "openai",
        secretName: "OPENAI_API_KEY",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        managedSubscription: "reserved",
      },
    });
    const runtimeTree = managedRuntimeTreeFixture("full", policyContent);
    const calls = [];
    let repoReads = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      const method = options.method || "GET";
      calls.push(`${method} ${requestUrl.origin}${requestUrl.pathname}`);
      if (requestUrl.origin === "https://api.openai.com") {
        return { ok: true, status: 200, async json() { return { id: "gpt-5.6-luna" }; } };
      }
      if (requestUrl.pathname === "/repos/alice/private-service") {
        repoReads += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: 77,
              full_name: "alice/private-service",
              default_branch: "main",
              permissions: { push: true, admin: repoReads < 3 },
            };
          },
        };
      }
      if (requestUrl.pathname.endsWith("/git/ref/heads/main")) {
        return { ok: true, status: 200, async json() { return { object: { sha: headSha } }; } };
      }
      if (requestUrl.pathname.endsWith("/contents/changeplane/manifest.json")) {
        return managedManifestFileResponse("full");
      }
      if (requestUrl.pathname.endsWith("/contents/.changeplane.json")) {
        return managedFileResponse(policyContent);
      }
      if (requestUrl.pathname.endsWith(`/git/commits/${headSha}`)) {
        return { ok: true, status: 200, async json() { return { tree: { sha: runtimeTree.treeSha } }; } };
      }
      if (requestUrl.pathname.endsWith(`/git/trees/${runtimeTree.treeSha}`)) {
        return { ok: true, status: 200, async json() { return runtimeTree.payload; } };
      }
      throw new Error(`Unexpected external call: ${method} ${requestUrl}`);
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=byok",
        headers: {
          origin: "https://changeplane.example",
          cookie: `__Host-changeplane_session=${session}`,
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/private-service", apiKey },
      }, response);
      assert.equal(response.statusCode, 403);
      assert.match(JSON.parse(response.body).error, /admin access changed/u);
      assert.equal(calls.some((call) => call.includes("api.openai.com")), true);
      assert.equal(calls.some((call) => call.includes("/access_tokens")), false);
      assert.equal(calls.some((call) => call.includes("/actions/secrets")), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("repository BYOK encrypts and rotates directly in GitHub Actions without echoing plaintext", async () => {
  await withOAuthEnvironment(async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    const repositoryPublicKey = sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL);
    const apiKey = `provider-${"s".repeat(40)}`;
    const rotatedApiKey = `provider-${"r".repeat(40)}`;
    const driftedApiKey = `provider-${"d".repeat(40)}`;
    const headSha = "a".repeat(40);
    const policyContent = JSON.stringify({
      version: 1,
      evidence: { requiredChecks: [] },
      runtime: {
        funding: "byok",
        provider: "openai",
        secretName: "OPENAI_API_KEY",
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        managedSubscription: "reserved",
      },
    });
    const runtimeTree = managedRuntimeTreeFixture("full", policyContent);
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const storedSecrets = [];
    let headReads = 0;
    let driftOnNextSave = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      const method = options.method || "GET";
      if (requestUrl.origin === "https://api.openai.com" && requestUrl.pathname === "/v1/models/gpt-5.6-luna") {
        assert.equal([`Bearer ${apiKey}`, `Bearer ${rotatedApiKey}`, `Bearer ${driftedApiKey}`].includes(options.headers.authorization), true);
        return {
          ok: true,
          status: 200,
          async json() { return { id: "gpt-5.6-luna" }; },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { id: 77, full_name: "alice/private-service", default_branch: "main", permissions: { push: true, admin: true } };
          },
        };
      }
      if (requestUrl.pathname.endsWith("/git/ref/heads/main")) {
        headReads += 1;
        const sha = driftOnNextSave && headReads % 2 === 0 ? "b".repeat(40) : headSha;
        return { ok: true, status: 200, async json() { return { object: { sha } }; } };
      }
      if (requestUrl.pathname.endsWith("/contents/changeplane/manifest.json")) {
        return managedManifestFileResponse("full");
      }
      if (requestUrl.pathname.endsWith("/contents/.changeplane.json")) {
        return managedFileResponse(policyContent);
      }
      if (requestUrl.pathname.endsWith(`/git/commits/${headSha}`)
        || requestUrl.pathname.endsWith(`/git/commits/${"b".repeat(40)}`)) {
        return { ok: true, status: 200, async json() { return { tree: { sha: runtimeTree.treeSha } }; } };
      }
      if (requestUrl.pathname.endsWith(`/git/trees/${runtimeTree.treeSha}`)) {
        return { ok: true, status: 200, async json() { return runtimeTree.payload; } };
      }
      if (requestUrl.pathname.endsWith("/actions/secrets/public-key")) {
        return {
          ok: true,
          status: 200,
          async json() { return { key_id: "github-key-1", key: repositoryPublicKey }; },
        };
      }
      if (requestUrl.pathname.endsWith("/actions/secrets/OPENAI_API_KEY") && method === "PUT") {
        storedSecrets.push(JSON.parse(options.body));
        return { ok: true, status: 201 };
      }
      if (requestUrl.pathname.endsWith("/actions/secrets/OPENAI_API_KEY") && method === "GET") {
        return {
          ok: true,
          status: 200,
          async json() { return { name: "OPENAI_API_KEY", updated_at: "2026-07-18T10:24:00Z" }; },
        };
      }
      throw new Error(`Unexpected GitHub call: ${method} ${requestUrl.pathname}`);
    };

    try {
      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=byok",
        headers: {
          origin: "https://changeplane.example",
          cookie: `__Host-changeplane_session=${session}`,
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/private-service", apiKey },
      }, response);

      assert.equal(response.statusCode, 200);
      assert.equal(response.body.includes(apiKey), false);
      assert.equal(storedSecrets[0].key_id, "github-key-1");
      assert.equal(storedSecrets[0].encrypted_value.includes(apiKey), false);

      const cipher = sodium.from_base64(storedSecrets[0].encrypted_value, sodium.base64_variants.ORIGINAL);
      const plaintext = sodium.crypto_box_seal_open(cipher, keyPair.publicKey, keyPair.privateKey);
      assert.equal(sodium.to_string(plaintext), apiKey);
      sodium.memzero(cipher);
      sodium.memzero(plaintext);

      const rotatedResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=byok",
        headers: {
          origin: "https://changeplane.example",
          cookie: `__Host-changeplane_session=${session}`,
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/private-service", apiKey: rotatedApiKey },
      }, rotatedResponse);
      assert.equal(rotatedResponse.statusCode, 200);
      assert.equal(rotatedResponse.body.includes(rotatedApiKey), false);
      assert.equal(storedSecrets.length, 2);
      const rotatedCipher = sodium.from_base64(storedSecrets[1].encrypted_value, sodium.base64_variants.ORIGINAL);
      const rotatedPlaintext = sodium.crypto_box_seal_open(rotatedCipher, keyPair.publicKey, keyPair.privateKey);
      assert.equal(sodium.to_string(rotatedPlaintext), rotatedApiKey);
      sodium.memzero(rotatedCipher);
      sodium.memzero(rotatedPlaintext);

      driftOnNextSave = true;
      const driftResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=byok",
        headers: {
          origin: "https://changeplane.example",
          cookie: `__Host-changeplane_session=${session}`,
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/private-service", apiKey: driftedApiKey },
      }, driftResponse);
      assert.equal(driftResponse.statusCode, 409);
      assert.match(JSON.parse(driftResponse.body).error, /default branch or managed payload changed/u);
      assert.equal(driftResponse.body.includes(driftedApiKey), false);
      assert.equal(storedSecrets.length, 2);
    } finally {
      sodium.memzero(keyPair.publicKey);
      sodium.memzero(keyPair.privateKey);
      globalThis.fetch = originalFetch;
    }
  });
});

test("repository BYOK deletion removes only the OpenAI Actions Secret", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({ kind: "session", token: "alice-token", login: "alice", csrf: "alice-csrf" }, SECRET);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      const method = options.method || "GET";
      calls.push(`${method} ${requestUrl.pathname}`);
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return { ok: true, status: 200, async json() { return { full_name: "alice/private-service", permissions: { push: true, admin: true } }; } };
      }
      if (requestUrl.pathname.endsWith("/actions/secrets/OPENAI_API_KEY") && method === "DELETE") {
        return { ok: true, status: 204 };
      }
      throw new Error(`Unexpected request: ${method} ${requestUrl.pathname}`);
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "DELETE",
        url: "/api/github?action=byok",
        headers: {
          origin: "https://changeplane.example",
          cookie: `__Host-changeplane_session=${session}`,
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/private-service" },
      }, response);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, [
        "GET /repos/alice/private-service",
        "GET /repos/alice/private-service",
        "DELETE /repos/alice/private-service/actions/secrets/OPENAI_API_KEY",
      ]);
      assert.equal(response.body.includes("OPENAI_API_KEY"), true);
      assert.equal(response.body.includes(".changeplane.json"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("mutating JSON endpoints reject ambiguous content types before GitHub", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("GitHub must not be called"); };
    try {
      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=byok",
        headers: {
          origin: "https://changeplane.example",
          cookie: `__Host-changeplane_session=${session}`,
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/private-service", apiKey: `provider-${"x".repeat(40)}` },
      }, response);
      assert.equal(response.statusCode, 415);
      assert.equal(JSON.parse(response.body).error, "Content-Type must be application/json.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("known API actions return 405 and an Allow header for the wrong method", async () => {
  const response = responseRecorder();
  await handler({ method: "POST", url: "/api/github?action=session", headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.getHeader("allow"), "GET");
  assert.equal(JSON.parse(response.body).error, "Method not allowed for this API action.");
});

test("login creates a state-bound secure OAuth redirect without exposing the client secret", async () => {
  await withOAuthEnvironment(async () => {
    const response = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=login", headers: {} }, response);
    assert.equal(response.statusCode, 302);
    const location = new URL(response.getHeader("location"));
    assert.equal(location.origin, "https://github.com");
    assert.equal(location.searchParams.get("client_id"), "client-id");
    assert.equal(location.searchParams.get("redirect_uri"), "https://changeplane.example/api/github?action=callback");
    assert.equal(location.searchParams.get("scope"), "repo workflow");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.match(location.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(location.toString().includes("client-secret"), false);
    const setCookie = response.getHeader("set-cookie")[0];
    assert.match(setCookie, /HttpOnly; Secure; SameSite=Lax/u);
    assert.equal(setCookie.includes("client-secret"), false);
  });
});

test("cancelled GitHub authorization returns to a bounded retry screen without external access", async () => {
  await withOAuthEnvironment(async () => {
    const state = "s".repeat(43);
    const saved = seal({
      kind: "oauth",
      state,
      redirectUri: "https://changeplane.example/api/github?action=callback",
      authMode: "oauth",
      verifier: "v".repeat(64),
    }, SECRET, { purpose: "oauth" });
    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { externalCalls += 1; throw new Error("No external request expected"); };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=callback&error=access_denied&error_description=do-not-reflect&state=${state}`,
        headers: { cookie: `__Host-changeplane_oauth=${saved}` },
      }, response);
      assert.equal(response.statusCode, 302);
      const location = new URL(response.getHeader("location"));
      assert.equal(location.origin, "https://changeplane.example");
      assert.equal(location.searchParams.get("github"), "authorization_cancelled");
      assert.equal(location.toString().includes("do-not-reflect"), false);
      assert.match(response.getHeader("set-cookie")[0], /Max-Age=0/u);
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("failed GitHub authorization returns to a redacted retry screen", async () => {
  await withOAuthEnvironment(async () => {
    const state = "s".repeat(43);
    const saved = seal({
      kind: "oauth",
      state,
      redirectUri: "https://changeplane.example/api/github?action=callback",
      authMode: "oauth",
      verifier: "v".repeat(64),
    }, SECRET, { purpose: "oauth" });
    const response = responseRecorder();
    await handler({
      method: "GET",
      url: `/api/github?action=callback&error=server_error&error_description=private-upstream-message&state=${state}`,
      headers: { cookie: `__Host-changeplane_oauth=${saved}` },
    }, response);
    assert.equal(response.statusCode, 302);
    const location = new URL(response.getHeader("location"));
    assert.equal(location.searchParams.get("github"), "authorization_failed");
    assert.equal(location.toString().includes("private-upstream-message"), false);
    assert.match(response.getHeader("set-cookie")[0], /Max-Age=0/u);
  });
});

test("GitHub App onboarding installs first, then verifies the installation through user OAuth", async () => {
  await withGitHubAppEnvironment(async () => {
    const installResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=login", headers: {} }, installResponse);
    assert.equal(installResponse.statusCode, 302);
    const installUrl = new URL(installResponse.getHeader("location"));
    assert.equal(installUrl.pathname, "/apps/changeplane-test/installations/new");
    const installState = installUrl.searchParams.get("state");
    assert.match(installState, /^[A-Za-z0-9_-]{32,128}$/u);
    const installCookie = installResponse.getHeader("set-cookie")[0].split(";", 1)[0];

    const authorizeResponse = responseRecorder();
    await handler({
      method: "GET",
      url: `/api/github?action=installation&installation_id=12345&state=${installState}`,
      headers: { cookie: installCookie },
    }, authorizeResponse);
    assert.equal(authorizeResponse.statusCode, 302);
    const authorizeUrl = new URL(authorizeResponse.getHeader("location"));
    assert.equal(authorizeUrl.pathname, "/login/oauth/authorize");
    assert.equal(authorizeUrl.searchParams.get("scope"), null);
    assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    const oauthState = authorizeUrl.searchParams.get("state");
    const oauthCookie = authorizeResponse.getHeader("set-cookie")[0].split(";", 1)[0];

    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      calls.push({ url: requestUrl, options });
      if (requestUrl.origin === "https://github.com") {
        const body = JSON.parse(options.body);
        assert.equal(body.client_secret, "client-secret");
        assert.match(body.code_verifier, /^[A-Za-z0-9_-]{64}$/u);
        return {
          ok: true,
          status: 200,
          async json() { return { access_token: "ghu_user_token", expires_in: 28_800, scope: "" }; },
        };
      }
      if (requestUrl.pathname === "/user") {
        return { ok: true, status: 200, async json() { return { login: "alice" }; } };
      }
      if (requestUrl.pathname === "/user/installations") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              installations: [{
                id: 12345,
                permissions: {
                  actions: "read",
                  administration: "write",
                  contents: "write",
                  pull_requests: "write",
                  workflows: "write",
                  checks: "write",
                  secrets: "write",
                },
              }],
            };
          },
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };
    try {
      const callbackResponse = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=callback&code=valid-code-123&state=${oauthState}`,
        headers: { cookie: oauthCookie },
      }, callbackResponse);
      assert.equal(callbackResponse.statusCode, 302);
      assert.equal(callbackResponse.getHeader("location"), "https://changeplane.example/?github=connected");
      assert.equal(calls.length, 3);
      const sessionCookie = callbackResponse.getHeader("set-cookie")[1].split(";", 1)[0];
      const sessionResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=session",
        headers: { cookie: sessionCookie },
      }, sessionResponse);
      const session = JSON.parse(sessionResponse.body);
      assert.equal(session.authenticated, true);
      assert.equal(session.authMode, "github_app");
      assert.equal(session.login, "alice");
      assert.equal(JSON.stringify(session).includes("ghu_user_token"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("returning GitHub App users authorize without reopening installation settings", async () => {
  await withGitHubAppEnvironment(async () => {
    const authorizeResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=authorize", headers: {} }, authorizeResponse);
    assert.equal(authorizeResponse.statusCode, 302);
    const authorizeUrl = new URL(authorizeResponse.getHeader("location"));
    assert.equal(authorizeUrl.pathname, "/login/oauth/authorize");
    assert.equal(authorizeUrl.searchParams.get("scope"), null);
    assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    const oauthState = authorizeUrl.searchParams.get("state");
    const oauthCookie = authorizeResponse.getHeader("set-cookie")[0].split(";", 1)[0];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.origin === "https://github.com") {
        const body = JSON.parse(options.body);
        assert.match(body.code_verifier, /^[A-Za-z0-9_-]{64}$/u);
        return {
          ok: true,
          status: 200,
          async json() { return { access_token: "ghu_returning_token", expires_in: 28_800, scope: "" }; },
        };
      }
      if (requestUrl.pathname === "/user") {
        return { ok: true, status: 200, async json() { return { login: "returning-user" }; } };
      }
      if (requestUrl.pathname === "/user/installations") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              installations: [{
                id: 98765,
                app_slug: "changeplane-test",
                permissions: {
                  actions: "read",
                  administration: "write",
                  contents: "write",
                  pull_requests: "write",
                  workflows: "write",
                  checks: "write",
                },
              }],
            };
          },
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };
    try {
      const callbackResponse = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=callback&code=valid-code-456&state=${oauthState}`,
        headers: { cookie: oauthCookie },
      }, callbackResponse);
      assert.equal(callbackResponse.statusCode, 302);
      const sessionCookie = callbackResponse.getHeader("set-cookie")[1].split(";", 1)[0];
      const sessionResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=session",
        headers: { cookie: sessionCookie },
      }, sessionResponse);
      const session = JSON.parse(sessionResponse.body);
      assert.equal(session.authenticated, true);
      assert.equal(session.login, "returning-user");
      assert.equal(session.authMode, "github_app");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("returning users receive recoverable installation and permission states", async () => {
  for (const scenario of [
    { installations: [], expected: "installation_missing" },
    {
      installations: [{
        id: 98765,
        app_slug: "changeplane-test",
        permissions: { contents: "read", pull_requests: "read", workflows: "read", checks: "read" },
      }],
      expected: "permissions_required",
    },
  ]) {
    await withGitHubAppEnvironment(async () => {
      const authorizeResponse = responseRecorder();
      await handler({ method: "GET", url: "/api/github?action=authorize", headers: {} }, authorizeResponse);
      const authorizeUrl = new URL(authorizeResponse.getHeader("location"));
      const oauthState = authorizeUrl.searchParams.get("state");
      const oauthCookie = authorizeResponse.getHeader("set-cookie")[0].split(";", 1)[0];

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.origin === "https://github.com") {
          return { ok: true, status: 200, async json() { return { access_token: "ghu_recovery_token", expires_in: 28_800, scope: "" }; } };
        }
        if (requestUrl.pathname === "/user") {
          return { ok: true, status: 200, async json() { return { login: "returning-user" }; } };
        }
        if (requestUrl.pathname === "/user/installations") {
          return { ok: true, status: 200, async json() { return { installations: scenario.installations }; } };
        }
        throw new Error(`Unexpected request: ${requestUrl}`);
      };
      try {
        const callbackResponse = responseRecorder();
        await handler({
          method: "GET",
          url: `/api/github?action=callback&code=valid-code-456&state=${oauthState}`,
          headers: { cookie: oauthCookie },
        }, callbackResponse);
        assert.equal(callbackResponse.statusCode, 302);
        const location = new URL(callbackResponse.getHeader("location"));
        assert.equal(location.searchParams.get("github"), scenario.expected);
        assert.match(callbackResponse.getHeader("set-cookie")[0], /Max-Age=0/u);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test("returning authorization keeps every eligible personal and organization installation", async () => {
  await withGitHubAppEnvironment(async () => {
    const authorizeResponse = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=authorize", headers: {} }, authorizeResponse);
    const authorizeUrl = new URL(authorizeResponse.getHeader("location"));
    const oauthState = authorizeUrl.searchParams.get("state");
    const oauthCookie = authorizeResponse.getHeader("set-cookie")[0].split(";", 1)[0];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.origin === "https://github.com") {
        return { ok: true, status: 200, async json() { return { access_token: "ghu_returning_token", expires_in: 28_800, scope: "" }; } };
      }
      if (requestUrl.pathname === "/user") {
        return { ok: true, status: 200, async json() { return { login: "returning-user" }; } };
      }
      if (requestUrl.pathname === "/user/installations") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              installations: [
                {
                  id: 1,
                  app_slug: "changeplane-test",
                  permissions: { actions: "read", administration: "write", contents: "write", pull_requests: "write", workflows: "write", checks: "write", secrets: "write" },
                },
                {
                  id: 2,
                  app_slug: "changeplane-test",
                  permissions: { actions: "read", administration: "write", contents: "write", pull_requests: "write", workflows: "write", checks: "write", secrets: "write" },
                },
              ],
            };
          },
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };
    try {
      const callbackResponse = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=callback&code=valid-code-789&state=${oauthState}`,
        headers: { cookie: oauthCookie },
      }, callbackResponse);
      assert.equal(callbackResponse.statusCode, 302);
      const sessionCookie = callbackResponse.getHeader("set-cookie")[1].split(";", 1)[0];
      const sessionResponse = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=session",
        headers: { cookie: sessionCookie },
      }, sessionResponse);
      assert.equal(JSON.parse(sessionResponse.body).authenticated, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GitHub App repository picker is limited to the verified installation", async () => {
  await withGitHubAppEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "ghu_user_token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "github_app",
      installationId: "12345",
    }, SECRET);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      assert.equal(requestUrl.pathname, "/user/installations/12345/repositories");
      assert.equal(options.headers.authorization, "Bearer ghu_user_token");
      return {
        ok: true,
        status: 200,
        async json() {
          return { repositories: [{
            full_name: "alice/private-service",
            private: true,
            default_branch: "main",
            permissions: { push: true, admin: false },
          }] };
        },
      };
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=repos",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200);
      assert.equal(JSON.parse(response.body).repositories[0].fullName, "alice/private-service");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GitHub App repository picker combines eligible personal and organization installations", async () => {
  await withGitHubAppEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "ghu_user_token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "github_app",
      installationId: "12345",
      installationIds: ["12345", "67890"],
    }, SECRET);
    const requestedInstallations = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const requestUrl = new URL(String(url));
      const match = requestUrl.pathname.match(/^\/user\/installations\/(\d+)\/repositories$/u);
      assert.ok(match);
      requestedInstallations.push(match[1]);
      const fullName = match[1] === "12345" ? "alice/personal-service" : "acme/platform-service";
      return {
        ok: true,
        status: 200,
        async json() {
          return { repositories: [{ full_name: fullName, default_branch: "main", permissions: { push: true, admin: false } }] };
        },
      };
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=repos",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(requestedInstallations, ["12345", "67890"]);
      assert.deepEqual(JSON.parse(response.body).repositories.map(({ fullName }) => fullName), [
        "alice/personal-service",
        "acme/platform-service",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("public Origin boundary proof runs without a session or external request", async () => {
  await withOAuthEnvironment(async () => {
    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      externalCalls += 1;
      throw new Error("The synthetic Origin proof must not call an external service");
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=origin-proof",
        headers: {},
      }, response);

      assert.equal(response.statusCode, 200);
      const proof = JSON.parse(response.body);
      assert.equal(proof.type, "changeplane.cursor-origin-boundary-proof");
      assert.equal(proof.execution.fixtureKind, "SYNTHETIC");
      assert.equal(proof.execution.externalRequests, 0);
      assert.equal(proof.compatibility.githubMirroredOrigin, "CANDIDATE_THROUGH_GITHUB");
      assert.equal(proof.compatibility.standaloneOrigin, "UNSUPPORTED_NOT_TESTED");
      assert.equal(proof.summary.allPassed, true);
      assert.equal(proof.summary.originBoundaryCases, 3);
      assert.equal(proof.assertions.every(({ passed }) => passed), true);
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("OIDC-authenticated guard publication re-fetches authority and writes only through the dedicated App", async () => {
  await withOAuthEnvironment(async () => {
    const fixture = assuranceProofApiFixture();
    const passport = buildAssurancePassport(fixture.receipt);
    const policyContent = JSON.stringify(fixture.policy);
    const runtimeTree = managedRuntimeTreeFixture("verify-lite", policyContent);
    const { privateKey: appPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { privateKey: oidcPrivateKey, publicKey: oidcPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
    process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
    process.env.CHANGEPLANE_GUARD_APP_PRIVATE_KEY = appPrivateKey.export({ type: "pkcs8", format: "pem" });

    const nowSeconds = Math.floor(Date.now() / 1_000);
    const oidcHeader = Buffer.from(JSON.stringify({
      alg: "RS256",
      typ: "JWT",
      kid: "changeplane-api-test",
    })).toString("base64url");
    const oidcPayload = Buffer.from(JSON.stringify({
      iss: "https://token.actions.githubusercontent.com",
      aud: "https://changeplane.vercel.app/guard-publisher/v1",
      exp: nowSeconds + 300,
      nbf: nowSeconds - 10,
      iat: nowSeconds - 10,
      repository: fixture.repository,
      repository_id: String(fixture.repositoryId),
      workflow_ref: `${fixture.repository}/.github/workflows/changeplane.yml@refs/heads/main`,
      workflow_sha: fixture.baseSha,
      ref: "refs/heads/main",
      event_name: "pull_request_target",
      run_id: "8001",
      run_attempt: "1",
      jti: "changeplane-api-test-8001-1",
      sha: fixture.baseSha,
      base_ref: "main",
    })).toString("base64url");
    const oidcInput = `${oidcHeader}.${oidcPayload}`;
    const oidcSignature = sign("RSA-SHA256", Buffer.from(oidcInput), {
      key: oidcPrivateKey,
      padding: constants.RSA_PKCS1_PADDING,
    }).toString("base64url");
    const oidcToken = `${oidcInput}.${oidcSignature}`;
    const jwk = oidcPublicKey.export({ format: "jwk" });
    const calls = [];
    let latestEvidenceChecks = [fixture.evidenceCheck];
    let evidenceWorkflowPath = ".github/workflows/ci.yml@refs/heads/main";
    let associatedPullRequests = [fixture.pullRequest];
    let liveGuardCheck = null;
    let supersedeOnNextWriteToken = false;
    let rejectRestart = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      const method = options.method ?? "GET";
      calls.push({ method, path: url.pathname, search: url.search, options });
      if (url.origin === "https://token.actions.githubusercontent.com") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { keys: [{ ...jwk, kid: "changeplane-api-test", use: "sig", alg: "RS256", key_ops: ["verify"] }] };
          },
        };
      }
      if (url.pathname === `/repos/${fixture.repository}/installation`) {
        return githubJsonResponse({ id: 7007, app_id: 424242, app_slug: "changeplane-test" });
      }
      if (url.pathname === "/app/installations/7007/access_tokens") {
        const requested = JSON.parse(options.body);
        const kind = requested.permissions.checks;
        if (kind === "write" && supersedeOnNextWriteToken) {
          supersedeOnNextWriteToken = false;
          liveGuardCheck = {
            ...liveGuardCheck,
            output: {
              ...liveGuardCheck.output,
              text: liveGuardCheck.output.text.replace("run_id=8002", "run_id=8003"),
            },
          };
        }
        return githubJsonResponse({
          token: kind === "write" ? "ghs_guard_write_only" : "ghs_guard_read_only",
          expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          permissions: requested.permissions,
          repositories: [{ id: fixture.repositoryId }],
        }, 201);
      }
      if (url.pathname === `/repos/${fixture.repository}`) {
        return githubJsonResponse({
          id: fixture.repositoryId,
          full_name: fixture.repository,
          default_branch: "main",
        });
      }
      if (url.pathname.endsWith("/git/ref/heads/main")) {
        return githubJsonResponse({ object: { sha: fixture.baseSha } });
      }
      if (url.pathname.endsWith("/contents/.changeplane.json")) {
        return managedFileResponse(policyContent);
      }
      if (url.pathname.endsWith("/contents/changeplane/manifest.json")) {
        return managedManifestFileResponse("verify-lite");
      }
      if (url.pathname.endsWith(`/git/commits/${fixture.baseSha}`)) {
        return githubJsonResponse({ tree: { sha: runtimeTree.treeSha } });
      }
      if (url.pathname.endsWith(`/git/trees/${runtimeTree.treeSha}`)) {
        return githubJsonResponse(runtimeTree.payload);
      }
      if (url.pathname.endsWith(`/check-runs/${fixture.evidenceCheck.id}`)) {
        return githubJsonResponse(fixture.evidenceCheck);
      }
      if (url.pathname.endsWith("/actions/runs/7001")) {
        return githubJsonResponse({
          id: 7001,
          head_sha: fixture.headSha,
          path: evidenceWorkflowPath,
        });
      }
      if (url.pathname.endsWith(`/pulls/${fixture.pullRequestNumber}`)) {
        return githubJsonResponse(fixture.pullRequest);
      }
      if (url.pathname.endsWith(`/commits/${fixture.headSha}/pulls`)) {
        return githubJsonResponse(associatedPullRequests);
      }
      if (url.pathname.endsWith(`/commits/${fixture.headSha}/check-runs`) && method === "GET") {
        if (url.searchParams.get("check_name") === fixture.evidenceCheck.name) {
          return githubJsonResponse({
            total_count: latestEvidenceChecks.length,
            check_runs: latestEvidenceChecks,
          });
        }
        assert.equal(url.searchParams.get("check_name"), "ChangePlane / guard");
        return githubJsonResponse({
          total_count: liveGuardCheck ? 1 : 0,
          check_runs: liveGuardCheck ? [liveGuardCheck] : [],
        });
      }
      if (url.pathname === `/repos/${fixture.repository}/check-runs` && method === "POST") {
        const payload = JSON.parse(options.body);
        liveGuardCheck = {
          id: 919,
          ...payload,
          app: { id: 424242, slug: "changeplane-test" },
        };
        return githubJsonResponse(liveGuardCheck, 201);
      }
      if (url.pathname === `/repos/${fixture.repository}/check-runs/919` && method === "PATCH") {
        const payload = JSON.parse(options.body);
        if (Object.hasOwn(payload, "conclusion") && payload.conclusion === null) {
          return githubJsonResponse({ message: "Validation Failed" }, 422);
        }
        if (rejectRestart && payload.output?.text?.includes("phase=begin")) {
          return githubJsonResponse(liveGuardCheck);
        }
        liveGuardCheck = {
          ...liveGuardCheck,
          ...payload,
          // GitHub retains omitted terminal fields when a completed Check is patched.
          // A status-only restart did not clear success in the live same-SHA canary.
          status: (payload.conclusion ?? (Object.hasOwn(payload, "conclusion") ? null : liveGuardCheck.conclusion)) != null
            ? "completed" : payload.status,
          conclusion: Object.hasOwn(payload, "conclusion") ? payload.conclusion : liveGuardCheck.conclusion,
          output: payload.output ?? liveGuardCheck.output,
        };
        return githubJsonResponse(liveGuardCheck);
      }
      throw new Error(`Unexpected guard publication request: ${method} ${url.pathname}${url.search}`);
    };
    try {
      const prematureCompletion = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${oidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8001,
          workflowRunAttempt: 1,
          passport,
          summary: fixture.guardCheck.output.summary,
        },
      }, prematureCompletion);
      assert.equal(prematureCompletion.statusCode, 409, prematureCompletion.body);
      assert.match(JSON.parse(prematureCompletion.body).error, /not invalidated/iu);

      const beginResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${oidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-begin",
          repository: fixture.repository,
          repositoryId: fixture.repositoryId,
          defaultBranch: "main",
          controllerSha: fixture.baseSha,
          gitRef: "refs/heads/main",
          workflowRunId: 8001,
          workflowRunAttempt: 1,
          target: {
            type: "pull_request",
            pullRequestNumber: fixture.pullRequestNumber,
            baseSha: fixture.baseSha,
            headSha: fixture.headSha,
            baseRef: "main",
            headRef: "agent/retry-fix",
          },
        },
      }, beginResponse);
      assert.equal(beginResponse.statusCode, 200, beginResponse.body);
      assert.equal(JSON.parse(beginResponse.body).check.status, "in_progress");

      const writesBeforeIdempotentBegin = calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length;
      const writeTokensBeforeIdempotentBegin = calls.filter(({ path, options }) => (
        path === "/app/installations/7007/access_tokens"
        && JSON.parse(options.body).permissions.checks === "write"
      )).length;
      const idempotentBegin = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${oidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-begin",
          repository: fixture.repository,
          repositoryId: fixture.repositoryId,
          defaultBranch: "main",
          controllerSha: fixture.baseSha,
          gitRef: "refs/heads/main",
          workflowRunId: 8001,
          workflowRunAttempt: 1,
          target: {
            type: "pull_request",
            pullRequestNumber: fixture.pullRequestNumber,
            baseSha: fixture.baseSha,
            headSha: fixture.headSha,
            baseRef: "main",
            headRef: "agent/retry-fix",
          },
        },
      }, idempotentBegin);
      assert.equal(idempotentBegin.statusCode, 200, idempotentBegin.body);
      assert.equal(calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length, writesBeforeIdempotentBegin);
      assert.equal(calls.filter(({ path, options }) => (
        path === "/app/installations/7007/access_tokens"
        && JSON.parse(options.body).permissions.checks === "write"
      )).length, writeTokensBeforeIdempotentBegin);

      associatedPullRequests = [
        fixture.pullRequest,
        { ...fixture.pullRequest, number: fixture.pullRequestNumber + 1 },
      ];
      const writesBeforeAmbiguousHead = calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length;
      const writeTokensBeforeAmbiguousHead = calls.filter(({ path, options }) => (
        path === "/app/installations/7007/access_tokens"
        && JSON.parse(options.body).permissions.checks === "write"
      )).length;
      const ambiguousHeadCompletion = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${oidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8001,
          workflowRunAttempt: 1,
          passport,
          summary: fixture.guardCheck.output.summary,
        },
      }, ambiguousHeadCompletion);
      assert.equal(ambiguousHeadCompletion.statusCode, 409, ambiguousHeadCompletion.body);
      assert.match(JSON.parse(ambiguousHeadCompletion.body).error, /stale|trusted workflow boundary/iu);
      assert.equal(liveGuardCheck.status, "in_progress");
      assert.equal(calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length, writesBeforeAmbiguousHead);
      assert.equal(calls.filter(({ path, options }) => (
        path === "/app/installations/7007/access_tokens"
        && JSON.parse(options.body).permissions.checks === "write"
      )).length, writeTokensBeforeAmbiguousHead);
      associatedPullRequests = [fixture.pullRequest];

      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${oidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8001,
          workflowRunAttempt: 1,
          passport,
          summary: fixture.guardCheck.output.summary,
        },
      }, response);

      assert.equal(response.statusCode, 200, response.body);
      const result = JSON.parse(response.body);
      assert.equal(result.type, "changeplane.guard-publication");
      assert.equal(result.passportDigest, passport.digest);
      assert.deepEqual(result.check, {
        id: 919,
        name: "ChangePlane / guard",
        headSha: fixture.headSha,
        conclusion: "success",
        publisherAppId: 424242,
        publisherAppSlug: "changeplane-test",
      });
      const writesBeforeCompletionReplay = calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length;
      const writeTokensBeforeCompletionReplay = calls.filter(({ path, options }) => (
        path === "/app/installations/7007/access_tokens"
        && JSON.parse(options.body).permissions.checks === "write"
      )).length;
      const completionReplay = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${oidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8001,
          workflowRunAttempt: 1,
          passport,
          summary: fixture.guardCheck.output.summary,
        },
      }, completionReplay);
      assert.equal(completionReplay.statusCode, 200, completionReplay.body);
      assert.equal(JSON.parse(completionReplay.body).passportDigest, passport.digest);
      assert.equal(calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length, writesBeforeCompletionReplay);
      assert.equal(calls.filter(({ path, options }) => (
        path === "/app/installations/7007/access_tokens"
        && JSON.parse(options.body).permissions.checks === "write"
      )).length, writeTokensBeforeCompletionReplay);
      const tokenRequests = calls.filter(({ path }) => path === "/app/installations/7007/access_tokens")
        .map(({ options }) => JSON.parse(options.body).permissions);
      assert.deepEqual(tokenRequests, [
        { actions: "read", checks: "read", contents: "read", pull_requests: "read" },
        { actions: "read", checks: "read", contents: "read", pull_requests: "read" },
        { checks: "write" },
        { actions: "read", checks: "read", contents: "read", pull_requests: "read" },
        { actions: "read", checks: "read", contents: "read", pull_requests: "read" },
        { actions: "read", checks: "read", contents: "read", pull_requests: "read" },
        { checks: "write" },
        { actions: "read", checks: "read", contents: "read", pull_requests: "read" },
      ]);
      assert.equal(calls.some(({ method, path }) => method === "PATCH" && path === `/repos/${fixture.repository}/check-runs/919`), true);
      assert.equal(calls.some(({ options }) => options.headers?.authorization === "Bearer alice-token"), false);

      const writesBeforeNextGeneration = calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length;
      const nextClaims = {
        ...JSON.parse(Buffer.from(oidcPayload, "base64url").toString("utf8")),
        run_id: "8002",
        jti: "changeplane-api-test-8002-1",
      };
      const nextPayload = Buffer.from(JSON.stringify(nextClaims)).toString("base64url");
      const nextInput = `${oidcHeader}.${nextPayload}`;
      const nextSignature = sign("RSA-SHA256", Buffer.from(nextInput), {
        key: oidcPrivateKey,
        padding: constants.RSA_PKCS1_PADDING,
      }).toString("base64url");
      const nextOidcToken = `${nextInput}.${nextSignature}`;
      const nextBegin = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${nextOidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-begin",
          repository: fixture.repository,
          repositoryId: fixture.repositoryId,
          defaultBranch: "main",
          controllerSha: fixture.baseSha,
          gitRef: "refs/heads/main",
          workflowRunId: 8002,
          workflowRunAttempt: 1,
          target: {
            type: "pull_request",
            pullRequestNumber: fixture.pullRequestNumber,
            baseSha: fixture.baseSha,
            headSha: fixture.headSha,
            baseRef: "main",
            headRef: "agent/retry-fix",
          },
        },
      }, nextBegin);
      assert.equal(nextBegin.statusCode, 200, nextBegin.body);
      assert.deepEqual(JSON.parse(nextBegin.body).run, { id: 8002, attempt: 1 });
      assert.equal(JSON.parse(nextBegin.body).previousContractDigest, passport.binding.contractDigest);
      assert.equal(calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length, writesBeforeNextGeneration + 2);
      assert.equal(liveGuardCheck.status, "completed");
      assert.equal(liveGuardCheck.conclusion, "action_required");
      assert.ok(Number.isFinite(Date.parse(liveGuardCheck.completed_at)));
      assert.ok(Number.isFinite(Date.parse(liveGuardCheck.started_at)));
      assert.equal(
        liveGuardCheck.output.text,
        `changeplane.guard-run/v1;run_id=8002;run_attempt=1;phase=begin;contract_digest=${passport.binding.contractDigest};pull_request_number=42`,
      );

      const staleGenerationCompletion = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${oidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8001,
          workflowRunAttempt: 1,
          passport,
          summary: fixture.guardCheck.output.summary,
        },
      }, staleGenerationCompletion);
      assert.equal(staleGenerationCompletion.statusCode, 409, staleGenerationCompletion.body);
      assert.match(JSON.parse(staleGenerationCompletion.body).error, /lease/iu);
      assert.equal(liveGuardCheck.status, "completed");

      const nextGenerationRequest = (body) => ({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: { authorization: `Bearer ${nextOidcToken}`, "content-type": "application/json" },
        body: {
          schemaVersion: 1,
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8002,
          workflowRunAttempt: 1,
          ...body,
        },
      });
      const resumedBegin = responseRecorder();
      await handler(nextGenerationRequest({
        type: "changeplane.guard-publication-begin",
        repositoryId: fixture.repositoryId,
        controllerSha: fixture.baseSha,
        target: {
          type: "pull_request",
          pullRequestNumber: fixture.pullRequestNumber,
          baseSha: fixture.baseSha,
          headSha: fixture.headSha,
          baseRef: "main",
          headRef: "agent/retry-fix",
        },
      }), resumedBegin);
      assert.equal(resumedBegin.statusCode, 200, resumedBegin.body);
      assert.equal(JSON.parse(resumedBegin.body).previousContractDigest, passport.binding.contractDigest);

      const changedReceipt = { ...fixture.receipt, contractDigest: "c".repeat(64), boundContractDigest: "c".repeat(64) };
      const changedContractResponse = responseRecorder();
      const writesBeforeChangedContract = calls.filter(({ method }) => method === "PATCH").length;
      await handler(nextGenerationRequest({
        type: "changeplane.guard-publication-request",
        passport: buildAssurancePassport(changedReceipt),
        summary: renderReceiptComment(changedReceipt),
      }), changedContractResponse);
      assert.equal(changedContractResponse.statusCode, 409, changedContractResponse.body);
      assert.match(JSON.parse(changedContractResponse.body).error, /frozen exact-head contract/iu);
      assert.equal(calls.filter(({ method }) => method === "PATCH").length, writesBeforeChangedContract);

      const beforeSupersession = structuredClone(liveGuardCheck);
      supersedeOnNextWriteToken = true;
      const delayedCompletion = responseRecorder();
      const writesBeforeDelayedCompletion = calls.filter(({ method }) => method === "PATCH").length;
      await handler(nextGenerationRequest({
        type: "changeplane.guard-publication-request",
        passport,
        summary: fixture.guardCheck.output.summary,
      }), delayedCompletion);
      assert.equal(delayedCompletion.statusCode, 409, delayedCompletion.body);
      assert.match(JSON.parse(delayedCompletion.body).error, /lease/iu);
      assert.equal(calls.filter(({ method }) => method === "PATCH").length, writesBeforeDelayedCompletion);
      assert.match(liveGuardCheck.output.text, /run_id=8003/u);
      assert.equal(liveGuardCheck.status, "completed");
      liveGuardCheck = beforeSupersession;

      const nextCompletion = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${nextOidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8002,
          workflowRunAttempt: 1,
          passport,
          summary: fixture.guardCheck.output.summary,
        },
      }, nextCompletion);
      assert.equal(nextCompletion.statusCode, 200, nextCompletion.body);
      const completionPayload = JSON.parse(calls.filter(({ method, path }) => method === "PATCH"
        && path.endsWith("/check-runs/919")).at(-1).options.body);
      assert.ok(Number.isFinite(Date.parse(completionPayload.completed_at)));
      assert.equal(liveGuardCheck.completed_at, completionPayload.completed_at);
      assert.equal(liveGuardCheck.status, "completed");
      assert.equal(liveGuardCheck.conclusion, "success");

      const writesBeforeWorkflowMismatch = calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length;
      evidenceWorkflowPath = ".github/workflows/spoof.yml@refs/heads/main";
      const workflowMismatchResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${nextOidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8002,
          workflowRunAttempt: 1,
          passport,
          summary: fixture.guardCheck.output.summary,
        },
      }, workflowMismatchResponse);
      assert.equal(workflowMismatchResponse.statusCode, 409, workflowMismatchResponse.body);
      assert.match(JSON.parse(workflowMismatchResponse.body).error, /evidence changed/iu);
      assert.equal(calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length, writesBeforeWorkflowMismatch);
      evidenceWorkflowPath = ".github/workflows/ci.yml@refs/heads/main";

      const guardWritesBeforeStaleAttempt = calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length;
      latestEvidenceChecks = [
        fixture.evidenceCheck,
        {
          ...fixture.evidenceCheck,
          id: fixture.evidenceCheck.id + 1,
          status: "completed",
          conclusion: "failure",
          started_at: "2026-08-31T00:01:00Z",
          completed_at: "2026-08-31T00:02:00Z",
        },
      ];
      const staleResponse = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${nextOidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8002,
          workflowRunAttempt: 1,
          passport,
          summary: fixture.guardCheck.output.summary,
        },
      }, staleResponse);
      assert.equal(staleResponse.statusCode, 409, staleResponse.body);
      assert.match(JSON.parse(staleResponse.body).error, /evidence changed/iu);
      const guardWritesAfterStaleAttempt = calls.filter(({ method, path }) => (
        ["POST", "PATCH"].includes(method) && path.includes("/check-runs")
      )).length;
      assert.equal(guardWritesAfterStaleAttempt, guardWritesBeforeStaleAttempt);

      // A different PR can reuse the same commit after the old PR closes. Its
      // authenticated old PASS must be invalidated without inheriting PR42's contract.
      const closedPullRequest = { ...fixture.pullRequest, state: "closed" };
      fixture.pullRequestNumber = 43;
      fixture.pullRequest = { ...fixture.pullRequest, number: 43 };
      associatedPullRequests = [closedPullRequest, fixture.pullRequest];
      const replacementPayload = Buffer.from(JSON.stringify({
        ...nextClaims,
        run_id: "8003",
        jti: "changeplane-api-test-8003-1",
      })).toString("base64url");
      const replacementInput = `${oidcHeader}.${replacementPayload}`;
      const replacementSignature = sign("RSA-SHA256", Buffer.from(replacementInput), {
        key: oidcPrivateKey,
        padding: constants.RSA_PKCS1_PADDING,
      }).toString("base64url");
      const replacementRequest = nextGenerationRequest({
        type: "changeplane.guard-publication-begin",
        workflowRunId: 8003,
        repositoryId: fixture.repositoryId,
        controllerSha: fixture.baseSha,
        target: {
          type: "pull_request",
          pullRequestNumber: 43,
          baseSha: fixture.baseSha,
          headSha: fixture.headSha,
          baseRef: "main",
          headRef: "agent/retry-fix",
        },
      });
      replacementRequest.headers.authorization = `Bearer ${replacementInput}.${replacementSignature}`;
      const replacementBegin = responseRecorder();
      const beforeReplacement = structuredClone(liveGuardCheck);
      assert.equal(liveGuardCheck.conclusion, "success");
      await handler(replacementRequest, replacementBegin);
      assert.equal(replacementBegin.statusCode, 200, replacementBegin.body);
      assert.equal(JSON.parse(replacementBegin.body).previousContractDigest, null);
      assert.equal(liveGuardCheck.id, 919);
      assert.equal(liveGuardCheck.status, "completed");
      assert.equal(liveGuardCheck.conclusion, "action_required");
      assert.equal(liveGuardCheck.output.text, "changeplane.guard-run/v1;run_id=8003;run_attempt=1;phase=begin;pull_request_number=43");
      assert.notEqual(liveGuardCheck.output.summary, fixture.guardCheck.output.summary);

      // Even if GitHub refuses to reopen the Check, the prior PASS must be gone.
      liveGuardCheck = beforeReplacement;
      rejectRestart = true;
      const refusedRestart = responseRecorder();
      await handler(replacementRequest, refusedRestart);
      assert.equal(refusedRestart.statusCode, 502, refusedRestart.body);
      assert.equal(liveGuardCheck.status, "completed");
      assert.equal(liveGuardCheck.conclusion, "action_required");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("scheduled OIDC reconciliation shortens Verify recovery only after the exact owning run attempt completes", async () => {
  await withOAuthEnvironment(async () => {
    const fixture = assuranceProofApiFixture();
    fixture.policy.harness = { mode: "verify", maxAttempts: 2, budgetMinutes: 15 };
    const policyContent = JSON.stringify(fixture.policy);
    const runtimeTree = managedRuntimeTreeFixture("verify-lite", policyContent);
    const { privateKey: appPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { privateKey: oidcPrivateKey, publicKey: oidcPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
    process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
    process.env.CHANGEPLANE_GUARD_APP_PRIVATE_KEY = appPrivateKey.export({ type: "pkcs8", format: "pem" });

    const nowSeconds = Math.floor(Date.now() / 1_000);
    const header = Buffer.from(JSON.stringify({
      alg: "RS256",
      typ: "JWT",
      kid: "changeplane-reconcile-test",
    })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: "https://token.actions.githubusercontent.com",
      aud: "https://changeplane.vercel.app/guard-publisher/v1",
      exp: nowSeconds + 300,
      nbf: nowSeconds - 10,
      iat: nowSeconds - 10,
      repository: fixture.repository,
      repository_id: String(fixture.repositoryId),
      workflow_ref: `${fixture.repository}/.github/workflows/changeplane.yml@refs/heads/main`,
      workflow_sha: fixture.baseSha,
      ref: "refs/heads/main",
      event_name: "schedule",
      run_id: "9100",
      run_attempt: "1",
      jti: "changeplane-reconcile-test-9100-1",
      sha: fixture.baseSha,
      base_ref: "",
    })).toString("base64url");
    const input = `${header}.${payload}`;
    const signature = sign("RSA-SHA256", Buffer.from(input), {
      key: oidcPrivateKey,
      padding: constants.RSA_PKCS1_PADDING,
    }).toString("base64url");
    const oidcToken = `${input}.${signature}`;
    const jwk = oidcPublicKey.export({ format: "jwk" });
    const startedAt = new Date(Date.now() - (6 * 60 * 1_000)).toISOString();
    const liveGuard = {
      id: 919,
      name: "ChangePlane / guard",
      head_sha: fixture.headSha,
      status: "in_progress",
      conclusion: null,
      started_at: startedAt,
      external_id: `changeplane.guard/v1:${fixture.repositoryId}:pull_request:${fixture.headSha}`,
      output: {
        title: "Evaluation in progress",
        summary: "Waiting for exact-head evidence.",
        text: "changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=begin",
      },
      app: { id: 424242, slug: "changeplane-test" },
    };
    const legacyGuard = {
      ...structuredClone(liveGuard),
      id: 918,
      external_id: `${fixture.repositoryId}:pull_request:${fixture.headSha}`,
    };
    let sourceRunResponses = [{}];
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (request, options = {}) => {
      const url = new URL(String(request));
      const method = options.method ?? "GET";
      calls.push({ method, path: url.pathname, search: url.search, options });
      if (url.origin === "https://token.actions.githubusercontent.com") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { keys: [{ ...jwk, kid: "changeplane-reconcile-test", use: "sig", alg: "RS256", key_ops: ["verify"] }] };
          },
        };
      }
      if (url.pathname === `/repos/${fixture.repository}/installation`) {
        return githubJsonResponse({ id: 7007, app_id: 424242, app_slug: "changeplane-test" });
      }
      if (url.pathname === "/app/installations/7007/access_tokens") {
        const requested = JSON.parse(options.body);
        return githubJsonResponse({
          token: requested.permissions.checks === "write" ? "ghs_guard_write_only" : "ghs_guard_read_only",
          expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          permissions: requested.permissions,
          repositories: [{ id: fixture.repositoryId }],
        }, 201);
      }
      if (url.pathname === `/repos/${fixture.repository}`) {
        return githubJsonResponse({ id: fixture.repositoryId, full_name: fixture.repository, default_branch: "main" });
      }
      if (url.pathname.endsWith("/git/ref/heads/main")) {
        return githubJsonResponse({ object: { sha: fixture.baseSha } });
      }
      if (url.pathname.endsWith("/contents/.changeplane.json")) return managedFileResponse(policyContent);
      if (url.pathname.endsWith("/contents/changeplane/manifest.json")) return managedManifestFileResponse("verify-lite");
      if (url.pathname.endsWith(`/git/commits/${fixture.baseSha}`)) {
        return githubJsonResponse({ tree: { sha: runtimeTree.treeSha } });
      }
      if (url.pathname.endsWith(`/git/trees/${runtimeTree.treeSha}`)) return githubJsonResponse(runtimeTree.payload);
      if (url.pathname.endsWith("/pulls") && url.searchParams.get("state") === "open") {
        return githubJsonResponse([fixture.pullRequest]);
      }
      if (url.pathname.endsWith(`/pulls/${fixture.pullRequestNumber}`)) {
        return githubJsonResponse(fixture.pullRequest);
      }
      if (url.pathname.endsWith(`/commits/${fixture.headSha}/check-runs`)) {
        return githubJsonResponse({ check_runs: [legacyGuard, liveGuard] });
      }
      if (url.pathname.endsWith("/actions/runs/8001/attempts/1")) {
        const override = sourceRunResponses.length > 1 ? sourceRunResponses.shift() : sourceRunResponses[0];
        if (override.missing) return githubJsonResponse({ message: "Not Found" }, 404);
        return githubJsonResponse({ id: 8001, run_attempt: 1,
          repository: { id: fixture.repositoryId, full_name: fixture.repository },
          path: ".github/workflows/changeplane.yml", status: "completed", conclusion: "failure", ...override });
      }
      if (url.pathname.endsWith("/check-runs/919") && method === "GET") return githubJsonResponse(liveGuard);
      if (url.pathname.endsWith("/check-runs/919") && method === "PATCH") {
        Object.assign(liveGuard, JSON.parse(options.body));
        return githubJsonResponse(liveGuard);
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}${url.search}`);
    };
    try {
      const sweepRequest = {
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${oidcToken}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-reconciliation-sweep",
          repository: fixture.repository,
          repositoryId: fixture.repositoryId,
          defaultBranch: "main",
          controllerSha: fixture.baseSha,
          gitRef: "refs/heads/main",
          workflowRunId: 9100,
          workflowRunAttempt: 1,
        },
      };

      for (const scenario of [
        { responses: [{ status: "in_progress", conclusion: null }], status: 200 },
        { responses: [{ missing: true }], status: 200 },
        { responses: [{ run_attempt: 2 }], status: 200 },
        { responses: [{}, { status: "in_progress", conclusion: null }], status: 409 },
      ]) {
        sourceRunResponses = scenario.responses;
        const pendingResponse = responseRecorder();
        await handler(sweepRequest, pendingResponse);
        assert.equal(pendingResponse.statusCode, scenario.status, pendingResponse.body);
        if (scenario.status === 200) {
          assert.equal(JSON.parse(pendingResponse.body).withinWindow, 1);
          assert.equal(JSON.parse(pendingResponse.body).reconciled, 0);
        }
        assert.equal(liveGuard.status, "in_progress");
        assert.equal(calls.some(({ path, options }) => path === "/app/installations/7007/access_tokens"
          && JSON.parse(options.body).permissions.checks === "write"), false);
      }

      sourceRunResponses = [{}];
      const response = responseRecorder();
      await handler(sweepRequest, response);

      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(JSON.parse(response.body), {
        schemaVersion: 1,
        type: "changeplane.guard-reconciliation-sweep",
        scannedHeads: 1,
        inProgress: 1,
        reconciled: 1,
        withinWindow: 0,
      });
      assert.equal(liveGuard.status, "completed");
      assert.equal(liveGuard.conclusion, "action_required");
      assert.equal(calls.some(({ path, options }) => (
        path === "/app/installations/7007/access_tokens"
        && JSON.parse(options.body).permissions.checks === "write"
      )), true);
      assert.equal(calls.some(({ options }) => options.headers?.authorization === "Bearer alice-token"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("guard publication rejects an unauthenticated workflow before any GitHub App request", async () => {
  await withOAuthEnvironment(async () => {
    const fixture = assuranceProofApiFixture();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
    process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
    process.env.CHANGEPLANE_GUARD_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      externalCalls += 1;
      throw new Error("Unverified publication must not reach GitHub");
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=guard-publish",
        headers: {
          authorization: `Bearer ${"x".repeat(120)}`,
          "content-type": "application/json",
        },
        body: {
          schemaVersion: 1,
          type: "changeplane.guard-publication-request",
          repository: fixture.repository,
          defaultBranch: "main",
          gitRef: "refs/heads/main",
          workflowRunId: 8001,
          workflowRunAttempt: 1,
          passport: buildAssurancePassport(fixture.receipt),
          summary: fixture.guardCheck.output.summary,
        },
      }, response);

      assert.equal(response.statusCode, 403);
      assert.match(JSON.parse(response.body).error, /OIDC.*authentication failed/iu);
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("controlled-canary guard publication rejects missing, invalid, or mismatched scope before any external request", async (t) => {
  for (const scenario of [
    { name: "missing canary repository", repository: null, vercel: true, status: 503 },
    { name: "invalid canary repository", repository: "not-a-repository", vercel: false, status: 503 },
    { name: "different repository", repository: "acme/approved-canary", vercel: false, status: 403 },
  ]) {
    await t.test(scenario.name, async () => {
      await withOAuthEnvironment(async () => {
        const fixture = assuranceProofApiFixture();
        const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
        process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
        process.env.CHANGEPLANE_GUARD_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
        if (scenario.repository === null) delete process.env.CHANGEPLANE_CANARY_REPOSITORY;
        else process.env.CHANGEPLANE_CANARY_REPOSITORY = scenario.repository;
        if (scenario.vercel) {
          Object.assign(process.env, {
            VERCEL: "1",
            VERCEL_ENV: "production",
            VERCEL_GIT_PROVIDER: "github",
            VERCEL_GIT_REPO_OWNER: "LeChiffreVol2",
            VERCEL_GIT_REPO_SLUG: "changeplane",
            VERCEL_GIT_COMMIT_REF: "main",
            VERCEL_GIT_COMMIT_SHA: "c".repeat(40),
          });
        } else delete process.env.VERCEL;
        let externalCalls = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => {
          externalCalls += 1;
          throw new Error("Out-of-scope publication must not call GitHub or the OIDC issuer");
        };
        try {
          const response = responseRecorder();
          await handler({
            method: "POST",
            url: "/api/github?action=guard-publish",
            headers: {
              authorization: `Bearer ${"x".repeat(120)}`,
              "content-type": "application/json",
            },
            body: {
              schemaVersion: 1,
              type: "changeplane.guard-publication-request",
              repository: fixture.repository,
              defaultBranch: "main",
              gitRef: "refs/heads/main",
              workflowRunId: 8001,
              workflowRunAttempt: 1,
              passport: buildAssurancePassport(fixture.receipt),
              summary: fixture.guardCheck.output.summary,
            },
          }, response);

          assert.equal(response.statusCode, scenario.status, response.body);
          if (scenario.vercel) assert.equal(JSON.parse(response.body).code, "GUARD_PUBLICATION_AUTHORITY");
          else assert.match(JSON.parse(response.body).error, /canary|CHANGEPLANE_CANARY_REPOSITORY/iu);
          assert.equal(externalCalls, 0);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });
  }
});

test("live assurance proof denies unauthenticated access before GitHub", async () => {
  await withOAuthEnvironment(async () => {
    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      externalCalls += 1;
      throw new Error("GitHub must not be called without a connected session");
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=proof&repository=acme%2Fpayments&checkRunId=909",
        headers: {},
      }, response);

      assert.equal(response.statusCode, 401);
      assert.match(JSON.parse(response.body).error, /connect github first/iu);
      assert.equal(externalCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("authenticated live assurance proof re-fetches exact-head GitHub evidence", async () => {
  await withOAuthEnvironment(async () => {
    process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
    process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
    const fixture = assuranceProofApiFixture();
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "oauth",
    }, SECRET);
    const originalFetch = globalThis.fetch;
    const proofFetch = assuranceProofFetch(fixture);
    globalThis.fetch = proofFetch;
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=proof&repository=${encodeURIComponent(fixture.repository)}&checkRunId=${fixture.guardCheck.id}&passportDigest=${fixture.passportDigest}`,
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);

      assert.equal(response.statusCode, 200, response.body);
      const proof = JSON.parse(response.body);
      assert.equal(proof.type, "changeplane.live-assurance-proof");
      assert.equal(proof.verdict, "VERIFIED_CURRENT");
      assert.equal(proof.currentness, "CURRENT");
      assert.equal(proof.claimLevel, "BEHAVIORAL_PASS");
      assert.equal(proof.decision.currentBehavioralPass, true);
      assert.deepEqual(proof.target, {
        type: "pull_request",
        repositoryId: fixture.repositoryId,
        pullRequestNumber: fixture.pullRequestNumber,
        headSha: fixture.headSha,
        baseSha: fixture.baseSha,
      });
      assert.equal(proof.guard.checkRunId, fixture.guardCheck.id);
      assert.equal(proof.guard.publisherAppId, 424242);
      assert.equal(proof.guard.publisherTrust, "DEDICATED_CHANGEPLANE_APP");
      assert.equal(proof.checks.every(({ state }) => state === "PASS"), true);
      assert.deepEqual(proofFetch.calls.map(({ path }) => path), [
        `/repos/${fixture.repository}`,
        `/repos/${fixture.repository}/check-runs/${fixture.guardCheck.id}`,
        `/repos/${fixture.repository}/contents/.changeplane.json`,
        `/repos/${fixture.repository}/pulls/${fixture.pullRequestNumber}`,
        `/repos/${fixture.repository}/commits/${fixture.headSha}/pulls`,
        `/repos/${fixture.repository}/check-runs/${fixture.evidenceCheck.id}`,
        `/repos/${fixture.repository}/commits/${fixture.headSha}/check-runs`,
        `/repos/${fixture.repository}/actions/runs/7001`,
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("live assurance proof rejects a head shared by multiple open pull requests", async () => {
  await withOAuthEnvironment(async () => {
    process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
    process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
    const fixture = assuranceProofApiFixture();
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "oauth",
    }, SECRET);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = assuranceProofFetch(fixture, {
      associatedPullRequests: [
        fixture.pullRequest,
        { ...fixture.pullRequest, number: fixture.pullRequestNumber + 1 },
      ],
    });
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=proof&repository=${encodeURIComponent(fixture.repository)}&checkRunId=${fixture.guardCheck.id}&passportDigest=${fixture.passportDigest}`,
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 200, response.body);
      const proof = JSON.parse(response.body);
      assert.equal(proof.verdict, "INVALID");
      assert.equal(proof.decision.currentBehavioralPass, false);
      assert.equal(proof.checks.find(({ id }) => id === "current-target")?.state, "FAIL");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("live assurance proof invalidates policy or evidence drift", async (t) => {
  for (const scenario of [
    {
      name: "trusted-base policy drift",
      overrides: {
        policy: {
          version: 1,
          evidence: { requiredChecks: [{
            name: "CI / changed",
            appSlug: "github-actions",
            workflowPath: ".github/workflows/ci.yml",
          }] },
        },
      },
      failedCheck: "trusted-policy",
    },
    {
      name: "live evidence drift",
      overrides: (fixture) => ({
        evidenceCheck: { ...fixture.evidenceCheck, conclusion: "failure" },
      }),
      failedCheck: "live-evidence",
    },
    {
      name: "GitHub Actions workflow provenance drift",
      overrides: { workflowPath: ".github/workflows/spoof.yml" },
      failedCheck: "live-evidence",
    },
  ]) {
    await t.test(scenario.name, async () => {
      await withOAuthEnvironment(async () => {
        process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
        process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
        const fixture = assuranceProofApiFixture();
        const session = seal({
          kind: "session",
          token: "alice-token",
          login: "alice",
          csrf: "alice-csrf",
          authMode: "oauth",
        }, SECRET);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = assuranceProofFetch(
          fixture,
          typeof scenario.overrides === "function" ? scenario.overrides(fixture) : scenario.overrides,
        );
        try {
          const response = responseRecorder();
          await handler({
            method: "GET",
            url: `/api/github?action=proof&repository=${encodeURIComponent(fixture.repository)}&checkRunId=${fixture.guardCheck.id}&passportDigest=${fixture.passportDigest}`,
            headers: { cookie: `__Host-changeplane_session=${session}` },
          }, response);

          assert.equal(response.statusCode, 200, response.body);
          const proof = JSON.parse(response.body);
          assert.equal(proof.verdict, "INVALID");
          assert.equal(proof.decision.currentBehavioralPass, false);
          assert.equal(proof.checks.find(({ id }) => id === scenario.failedCheck)?.state, "FAIL");
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });
  }
});

test("live assurance proof requires the passport Check Run to remain the latest publisher-bound evidence", async (t) => {
  const scenarios = [
    {
      name: "newer failing rerun",
      newer: (fixture) => ({
        ...fixture.evidenceCheck,
        id: fixture.evidenceCheck.id + 1,
        conclusion: "failure",
        started_at: "2026-08-31T00:01:00Z",
        completed_at: "2026-08-31T00:02:00Z",
      }),
      verdict: "INVALID",
    },
    {
      name: "in-progress rerun wins an equal timestamp by higher Check Run id",
      newer: (fixture) => ({
        ...fixture.evidenceCheck,
        id: fixture.evidenceCheck.id + 1,
        status: "in_progress",
        conclusion: null,
        started_at: fixture.evidenceCheck.started_at,
        completed_at: null,
      }),
      verdict: "INVALID",
    },
    {
      name: "newer successful rerun still invalidates the older receipt id",
      newer: (fixture) => ({
        ...fixture.evidenceCheck,
        id: fixture.evidenceCheck.id + 1,
        started_at: "2026-08-31T00:01:00Z",
        completed_at: "2026-08-31T00:02:00Z",
      }),
      verdict: "INVALID",
    },
    {
      name: "same-name Check from another publisher is not eligible",
      newer: (fixture) => ({
        ...fixture.evidenceCheck,
        id: fixture.evidenceCheck.id + 1,
        app: { id: 999999, slug: "lookalike-ci" },
        conclusion: "failure",
        started_at: "2026-08-31T00:01:00Z",
        completed_at: "2026-08-31T00:02:00Z",
      }),
      verdict: "VERIFIED_CURRENT",
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      await withOAuthEnvironment(async () => {
        process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
        process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
        const fixture = assuranceProofApiFixture();
        const session = seal({
          kind: "session",
          token: "alice-token",
          login: "alice",
          csrf: "alice-csrf",
          authMode: "oauth",
        }, SECRET);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = assuranceProofFetch(fixture, {
          evidenceCheckRuns: [fixture.evidenceCheck, scenario.newer(fixture)],
        });
        try {
          const response = responseRecorder();
          await handler({
            method: "GET",
            url: `/api/github?action=proof&repository=${encodeURIComponent(fixture.repository)}&checkRunId=${fixture.guardCheck.id}&passportDigest=${fixture.passportDigest}`,
            headers: { cookie: `__Host-changeplane_session=${session}` },
          }, response);

          assert.equal(response.statusCode, 200, response.body);
          const proof = JSON.parse(response.body);
          assert.equal(proof.verdict, scenario.verdict);
          assert.equal(proof.decision.currentBehavioralPass, scenario.verdict === "VERIFIED_CURRENT");
          assert.equal(
            proof.checks.find(({ id }) => id === "live-evidence")?.state,
            scenario.verdict === "VERIFIED_CURRENT" ? "PASS" : "FAIL",
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });
  }
});

test("live assurance proof rejects a green Check that is unrelated to the trusted policy", async () => {
  await withOAuthEnvironment(async () => {
    process.env.CHANGEPLANE_GUARD_APP_ID = "424242";
    process.env.CHANGEPLANE_GUARD_APP_SLUG = "changeplane-test";
    const fixture = assuranceProofApiFixture({
      evidence: { name: "CI / unrelated" },
    });
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "oauth",
    }, SECRET);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = assuranceProofFetch(fixture);
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=proof&repository=${encodeURIComponent(fixture.repository)}&checkRunId=${fixture.guardCheck.id}&passportDigest=${fixture.passportDigest}`,
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);

      assert.equal(response.statusCode, 200, response.body);
      const proof = JSON.parse(response.body);
      assert.equal(proof.verdict, "INVALID");
      assert.equal(proof.claimLevel, "NON_PASS");
      assert.equal(proof.checks.find(({ id }) => id === "policy-evidence-contract")?.state, "FAIL");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("v14 profiles retain their exact catalog and offer a protected v15 upgrade", () => {
  const pinned = {
  "full": {
    "changeplane/action.yml": "33100f509832d7dd3eefdfe81d30497cda4649848420017b790b9932e2d6c3d3",
    "changeplane/action/index.js": "40306f7218fee182cdc9b14ea49780718af692220933f0e211fcda8ba5e8b937",
    "changeplane/src/lib/changeplane.js": "58af3209cbc0fb52d354a4984fca3f752bbb26241d3f403c3f5d783fe2e0c8ab",
    "changeplane/src/lib/harness.js": "c377b11f0ee668dab1b894cb92d45787e5f7d5e68a015569f3326f18ad65a023",
    "changeplane/src/lib/review.js": "77b6e85321827a18a305bf4a952d6493d831374e8208eeca0e0987d1fd95023d",
    "changeplane/src/lib/runtime.js": "e4fcb217c60f23217023c52b56c5c195c4a4442d86ae78301f81d7c537c80e7c",
    "changeplane/server/github-repair-controller.js": "b67e56892908874717771a114adb378b7c2243ac6e2c364951d1034fd9fc1ddd",
    "changeplane/server/repair-ledger.js": "7536a8cf40d51e9606434d07da5874aac500a5b4bdae0daf59f338a1e5289ebc",
    "changeplane/examples/changeplane-claim.js": "b391de111c6c5e4bb33991e6624db4f4347862ecee3c3478ecc8dbfc85997f83",
    "changeplane/examples/changeplane-grant.js": "648037cd2f18d4161f75c7dc7fedbc1317a5b78f6b53ac3df121f9b3eb76b9a1",
    "changeplane/examples/changeplane-evidence-policy.js": "f187c979276501f2f7e8435c479e6ae94df6c5496ef1aec8e5afc4a71ebaf4a3",
    "changeplane/examples/changeplane-proposal.js": "e43d6f6809db1bc2d73516184be611565c77ce47f7b8c064188ea8fa83d6d8e5",
    "changeplane/examples/changeplane-provider-openai.js": "f217665808dadfd180c960e6a1ab583b1e0d9d3c217578575e3cbf423eb348f8",
    "changeplane/examples/changeplane-review-openai.js": "5be177e0c93b8e68df59de57d5d29686552312caa5705ba7e710a6f2501f339d",
    "changeplane/examples/changeplane-review-run.js": "5dcdb7204c3a090d3aec88af6e82153f7f447389136c0c84d41f08895ea08d2e",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "246da05f00127fd8ca64cfec549921f9b06b2f332ce53d148fb4446daf8d1d39",
    ".github/workflows/changeplane-repair.yml": "7d18ee493de579c22d2b7093f834d0bdb20d4d60fe7219dfad2eb85e60f2d45f"
  },
  "verify-lite": {
    "changeplane/action.yml": "33100f509832d7dd3eefdfe81d30497cda4649848420017b790b9932e2d6c3d3",
    "changeplane/action/index.js": "40306f7218fee182cdc9b14ea49780718af692220933f0e211fcda8ba5e8b937",
    "changeplane/src/lib/changeplane.js": "58af3209cbc0fb52d354a4984fca3f752bbb26241d3f403c3f5d783fe2e0c8ab",
    "changeplane/src/lib/harness.js": "c377b11f0ee668dab1b894cb92d45787e5f7d5e68a015569f3326f18ad65a023",
    "changeplane/examples/changeplane-evidence-policy.js": "f187c979276501f2f7e8435c479e6ae94df6c5496ef1aec8e5afc4a71ebaf4a3",
    "changeplane/package.json": "609158e6c5fbc237939fa3ddf7faab80ab690bdc0c8d584414a885130103c4e8",
    ".github/workflows/changeplane.yml": "a631d3ea6f375513db25c6635c7bab429c2623c1d2fbee0a2c55528645e0d2bc"
  }
};
  for (const profile of ["full", "verify-lite"]) {
    const prior = managedVersionSnapshot(14, profile);
    assert.deepEqual(prior.managedHashes, pinned[profile]);
    const result = classifyManagedInstallationDigests({
      digests: prior.managedHashes, manifest: prior.manifest, policyPresent: true,
      reservedEntries: Object.keys(prior.managedHashes),
    });
    assert.equal(result.state, "outdated");
    assert.equal(result.targetVersion, 15);
  }
});
