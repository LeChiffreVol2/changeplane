import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import sodium from "libsodium-wrappers";

import {
  buildPilotFiles,
  default as handler,
  githubRetryDelayMs,
  seal,
  unseal,
  validateByokKey,
  validateRepository,
  verifyDeepSeekKey,
} from "../api/github.js";

const SECRET = "test-secret-that-is-longer-than-thirty-two-characters";

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

async function withOAuthEnvironment(callback) {
  const names = [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITHUB_APP_SLUG",
    "CHANGEPLANE_SESSION_SECRET",
    "CHANGEPLANE_APP_ORIGIN",
    "CHANGEPLANE_CANARY_REPOSITORY",
    "CHANGEPLANE_REPAIR_REPOSITORY",
    "CHANGEPLANE_REPAIR_ENABLED",
    "CHANGEPLANE_REPAIR_GENERATION",
    "CHANGEPLANE_CONTROLLER_SECRET",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
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
  delete process.env.CHANGEPLANE_REPAIR_REPOSITORY;
  delete process.env.CHANGEPLANE_REPAIR_ENABLED;
  delete process.env.CHANGEPLANE_REPAIR_GENERATION;
  delete process.env.CHANGEPLANE_CONTROLLER_SECRET;
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
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

test("DeepSeek credential verification confirms the pinned model without returning the key", async () => {
  const apiKey = `provider-${"v".repeat(32)}`;
  let authorization;
  const result = await verifyDeepSeekKey(apiKey, {
    fetchImpl: async (url, options) => {
      assert.equal(String(url), "https://api.deepseek.com/models");
      authorization = options.headers.authorization;
      assert.equal(options.redirect, "error");
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: [{ id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" }] };
        },
      };
    },
  });
  assert.equal(authorization, `Bearer ${apiKey}`);
  assert.deepEqual(result, { provider: "deepseek", model: "deepseek-v4-flash", verified: true });
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test("DeepSeek credential verification fails closed before a secret can be saved", async () => {
  const apiKey = `provider-${"x".repeat(32)}`;
  await assert.rejects(
    verifyDeepSeekKey(apiKey, {
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    /rejected this API key/u,
  );
});

test("pilot payload vendors the action and installs a trusted observe workflow", () => {
  const files = new Map(buildPilotFiles().map((file) => [file.path, file.content]));
  for (const expected of [
    "changeplane/action.yml",
    "changeplane/action/index.js",
    "changeplane/src/lib/changeplane.js",
    ".changeplane.json",
    ".github/workflows/changeplane.yml",
  ]) assert.equal(files.has(expected), true, `missing ${expected}`);

  const workflow = files.get(".github/workflows/changeplane.yml");
  assert.match(workflow, /pull_request_target:/u);
  assert.match(workflow, /deployment_status:/u);
  assert.match(workflow, /repository_dispatch:\n    types: \[changeplane_recheck\]/u);
  assert.match(workflow, /uses: \.\/changeplane/u);
  assert.doesNotMatch(workflow, /mode:|agent_dispatch:|max_remediation_attempts:/u);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/u);
  assert.match(workflow, /checks: write/u);
  assert.match(workflow, /pull-requests: write/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /deployments: read/u);
  assert.match(workflow, /statuses: read/u);
  assert.match(workflow, /group: changeplane-pr-\$\{\{ github\.event\.pull_request\.number \|\| github\.event\.client_payload\.pullRequestNumber \|\| github\.event\.deployment\.sha \|\| github\.run_id \}\}/u);
  assert.match(workflow, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/u);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.repository\.default_branch \}\}/u);
  const actionMetadata = files.get("changeplane/action.yml");
  const actionInputs = actionMetadata.match(/inputs:\n([\s\S]*?)outputs:/u)?.[1] ?? "";
  assert.match(actionMetadata, /name: ChangePlane Guard — observe pilot/u);
  assert.match(actionMetadata, /Observe only; no enforcement or repair\./u);
  assert.doesNotMatch(actionInputs, /^  (mode|agent_dispatch|agent_webhook_url|agent_webhook_token|max_remediation_attempts):/mu);
  const installerSource = readFileSync(new URL("../api/github.js", import.meta.url), "utf8");
  assert.match(installerSource, /\*\*Behavior checks: none configured\*\*/u);
  assert.match(installerSource, /receipts prove the exact commit and file scope only/u);
  assert.match(installerSource, /\*\*Behavior check configured:\*\*/u);
  assert.match(installerSource, /The receipt will not claim that the code works/u);
  const policy = JSON.parse(files.get(".changeplane.json"));
  assert.equal(policy.version, 1);
  assert.deepEqual(policy.evidence, { requiredChecks: [], timeoutSeconds: 0 });
  assert.deepEqual(policy.runtime, {
    funding: "byok",
    provider: "deepseek",
    secretName: "DEEPSEEK_API_KEY",
    model: "deepseek-v4-flash",
    effort: "high",
    managedSubscription: "reserved",
  });

  const behaviorFiles = new Map(buildPilotFiles({
    name: "CI / test",
    appSlug: "github-actions",
  }).map((file) => [file.path, file.content]));
  assert.deepEqual(JSON.parse(behaviorFiles.get(".changeplane.json")).evidence, {
    requiredChecks: [{ name: "CI / test", appSlug: "github-actions" }],
    timeoutSeconds: 120,
  });
  for (const appSlug of ["not a valid slug", "bad.slug", "bad_slug", "bad-"]) {
    assert.throws(
      () => buildPilotFiles({ name: "test", appSlug }),
      /valid GitHub App slug/u,
    );
  }
  assert.throws(
    () => buildPilotFiles({ name: "ChangePlane / guard", appSlug: "github-actions" }),
    /cannot be ChangePlane \/ guard/u,
  );
});

test("observe setup retries reuse the one GitHub-native setup pull request without writes", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "oauth",
    }, SECRET);
    const configuredCheck = { name: "test", appSlug: "github-actions" };
    let files = buildPilotFiles(configuredCheck);
    let fileContents = new Map(files.map(({ path, content }) => [path, content]));
    const baseSha = "a".repeat(40);
    const headSha = "b".repeat(40);
    const treeSha = "c".repeat(40);
    let setupBranchHead = headSha;
    const blobSha = (content) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
    const scope = files.map(({ path }) => path === "changeplane/package.json" ? "changeplane/**" : path);
    let plan = {
      goal: "Install the ChangePlane observe-mode pilot",
      scope: [...new Set(scope)],
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
              title: "chore: install ChangePlane observe pilot",
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
        body: { repository: "alice/service", requiredCheck: null },
      }, conflictingScopeResponse);
      assert.equal(conflictingScopeResponse.statusCode, 409);
      assert.match(JSON.parse(conflictingScopeResponse.body).error, /different evidence choice/u);
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
      files = buildPilotFiles();
      fileContents = new Map(files.map(({ path, content }) => [path, content]));
      plan = { goal: "Install the ChangePlane observe-mode pilot", scope: [...new Set(scope)] };
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
      assert.match(JSON.parse(conflictingBehaviorResponse.body).error, /different evidence choice/u);
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

test("controlled repair canary keeps DeepSeek proposal access separate from forge write", () => {
  const workflow = readFileSync(new URL("../examples/changeplane-repair.yml", import.meta.url), "utf8");
  const guardWorkflow = readFileSync(new URL("../examples/changeplane-repair-guard.yml", import.meta.url), "utf8");
  const grantVerifier = readFileSync(new URL("../examples/changeplane-grant.js", import.meta.url), "utf8");
  const claimClient = readFileSync(new URL("../examples/changeplane-claim.js", import.meta.url), "utf8");
  const repairLedger = readFileSync(new URL("../server/repair-ledger.js", import.meta.url), "utf8");
  assert.match(workflow, /Inactive controlled-canary template/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /CHANGEPLANE_REPAIR_ENABLED/u);
  assert.match(workflow, /CHANGEPLANE_REPAIR_GENERATION/u);
  assert.match(workflow, /CHANGEPLANE_REPAIR_PUBLIC_KEYS/u);
  assert.match(workflow, /CHANGEPLANE_CONTROLLER_SHA: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /CHANGEPLANE_BASE_REF: \$\{\{ github\.event\.repository\.default_branch \}\}/u);
  assert.equal((workflow.match(/ref: __CHANGEPLANE_RELEASE_SHA__/gu) ?? []).length, 2);
  assert.equal((workflow.match(/repository: LeChiffreVol2\/changeplane/gu) ?? []).length, 2);
  assert.match(workflow, /CHANGEPLANE_PUBLISHER_RELEASE_SHA: __CHANGEPLANE_RELEASE_SHA__/u);
  assert.equal((workflow.match(/changeplane-grant\.js verify/gu) ?? []).length, 3);
  assert.match(workflow, /changeplane-grant\.js verify/u);
  assert.match(workflow, /grant-digest/u);
  assert.match(workflow, /listArtifactsForRepo/u);
  assert.match(grantVerifier, /changeplane-claim-/u);
  assert.match(claimClient, /signClaimRequest/u);
  const repairEndpoint = "https://changeplane.vercel.app/api/github?action=repair";
  const claimEndpoint = "https://changeplane.vercel.app/api/github?action=repair-claim";
  const validateEndpoint = "https://changeplane.vercel.app/api/github?action=repair-validate";
  assert.equal(guardWorkflow.includes(`INPUT_AGENT_WEBHOOK_URL: "${repairEndpoint}"`), true);
  assert.doesNotMatch(guardWorkflow, /CHANGEPLANE_REPAIR_URL/u);
  assert.equal(workflow.split(claimEndpoint).length - 1, 1);
  assert.equal(workflow.split(validateEndpoint).length - 1, 3);
  assert.equal((workflow.match(/changeplane-claim\.js claim/gu) ?? []).length, 1);
  assert.equal((workflow.match(/changeplane-claim\.js validate/gu) ?? []).length, 3);
  assert.doesNotMatch(workflow, /vars\.CHANGEPLANE_CLAIM_URL/u);
  const controllerClaimIndex = workflow.indexOf("Claim the App-authored grant before provider access");
  const claimIndex = workflow.indexOf("Reserve the one-time claim before provider access");
  const providerValidateIndex = workflow.indexOf("Revalidate server authority immediately before provider access");
  const providerHeadIndex = workflow.indexOf("Re-check the exact pull-request head immediately before DeepSeek");
  const providerIndex = workflow.indexOf("Ask DeepSeek V4 Flash for a patch proposal");
  assert.ok(controllerClaimIndex > 0 && claimIndex > controllerClaimIndex
    && providerValidateIndex > claimIndex && providerHeadIndex > providerValidateIndex
    && providerIndex > providerHeadIndex,
  "server authority and the exact head must be rechecked immediately before provider access");
  assert.match(workflow, /CHANGEPLANE_PROPOSAL_MODEL: deepseek-v4-flash/u);
  assert.match(workflow, /DEEPSEEK_API_KEY: \$\{\{ secrets\.DEEPSEEK_API_KEY \}\}/u);
  assert.match(workflow, /ref: \$\{\{ steps\.grant\.outputs\.base-sha \}\}[\s\S]*?path: trusted/u);
  assert.match(workflow, /ref: \$\{\{ steps\.grant\.outputs\.head-sha \}\}[\s\S]*?path: workspace/u);
  assert.match(workflow, /working-directory: workspace[\s\S]*?\.\.\/controller\/examples\/changeplane-proposal\.js propose/u);
  assert.doesNotMatch(workflow, /run: \/usr\/bin\/node examples\/changeplane-proposal\.js/u);
  assert.match(workflow, /jobs:\n  repair:[\s\S]*?permissions:\n      actions: read\n      contents: read/u);
  assert.match(workflow, /\n  apply:[\s\S]*?permissions:\n      contents: write/u);
  assert.doesNotMatch(workflow.match(/jobs:\n  repair:[\s\S]*?\n  apply:/u)?.[0] ?? "", /contents: write/u);
  assert.doesNotMatch(workflow.match(/\n  apply:[\s\S]*/u)?.[0] ?? "", /DEEPSEEK_API_KEY/u);
  assert.match(workflow.match(/\n  apply:[\s\S]*/u)?.[0] ?? "", /\.\.\/controller\/examples\/changeplane-proposal\.js validate/u);
  assert.doesNotMatch(workflow, /uses: [^\n]+@(v\d+|main|master)$/mu);
  assert.match(workflow, /git apply --check --index/u);
  const finalVerifyIndex = workflow.lastIndexOf("changeplane-grant.js verify");
  const applyValidateIndex = workflow.indexOf("Revalidate server authority immediately before clean apply");
  const applyIndex = workflow.indexOf("Apply and independently validate only the granted paths");
  const finalValidateIndex = workflow.lastIndexOf("changeplane-claim.js validate");
  const pushIndex = workflow.indexOf("git -c core.hooksPath=/dev/null push");
  assert.ok(finalVerifyIndex > 0 && pushIndex > finalVerifyIndex, "grant deadline must be rechecked at the write boundary");
  assert.ok(applyValidateIndex > 0 && applyIndex > applyValidateIndex, "server authority must be rechecked before clean apply");
  assert.ok(finalValidateIndex > finalVerifyIndex && pushIndex > finalValidateIndex, "the server kill switch must be rechecked immediately before push");
  assert.match(workflow, /Clean apply did not restore granted paths to the trusted merge base/u);
  assert.match(repairLedger, /RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE/u);
  assert.match(workflow, /CHANGEPLANE_REPAIR_KIND/u);
  assert.match(workflow, /allowedPaths/u);
  assert.match(workflow, /event_type: 'changeplane_recheck'/u);
  assert.equal(workflow.includes("github.event.client_payload.change."), false);
  assert.match(guardWorkflow, /INPUT_MODE: enforce/u);
  assert.match(guardWorkflow, /INPUT_AGENT_DISPATCH: webhook/u);
  assert.match(guardWorkflow, /ref: __CHANGEPLANE_RELEASE_SHA__/u);
  assert.doesNotMatch(guardWorkflow, /statuses: read/u);
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
    process.env.VERCEL = "1";
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_test_release_identifier";
    const response = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=readiness", headers: {} }, response);
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), {
      status: "configuration_required",
      checks: {
        githubClientId: true,
        githubClientSecret: true,
        githubAppSlug: true,
        sessionSecret: true,
        appOrigin: true,
        sourceProvenance: false,
        canaryRepository: true,
      },
      authMode: "oauth",
      rolloutMode: "self_serve",
      release: "dpl_test_release_identifier",
      managedRuntime: "reserved",
      repairController: {
        enabled: false,
        configured: false,
        checks: {
          enabled: false,
          repository: false,
          canaryBound: false,
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
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      status: "ready",
      checks: {
        githubClientId: true,
        githubClientSecret: true,
        githubAppSlug: true,
        sessionSecret: true,
        appOrigin: true,
        sourceProvenance: true,
        canaryRepository: true,
      },
      authMode: "oauth",
      rolloutMode: "self_serve",
      release: "aaaaaaaaaaaa",
      managedRuntime: "reserved",
      repairController: {
        enabled: false,
        configured: false,
        checks: {
          enabled: false,
          repository: false,
          canaryBound: false,
          appId: false,
          appPrivateKey: false,
          controllerSecret: false,
          generation: false,
        },
      },
    });
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
    assert.equal(readinessBody.repairController.checks.canaryBound, false);

    let externalCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      externalCalls += 1;
      throw new Error("GitHub must not be called");
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=repair",
        headers: { "content-type": "application/json" },
      }, response);
      assert.equal(response.statusCode, 503);
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

test("unattributed Vercel deployments reject repository mutations before external access", async () => {
  await withOAuthEnvironment(async () => {
    process.env.VERCEL = "1";
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { calls += 1; throw new Error("External access must not occur"); };
    try {
      for (const [method, action] of [["POST", "install"], ["POST", "byok"], ["DELETE", "byok"]]) {
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
        rolloutMode: "self_serve",
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
            return { check_runs: [{ name: "unit tests", app: { slug: "github-actions" } }] };
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
      assert.equal(payload.setupFiles, 6);
      assert.deepEqual(payload.conflicts, []);
      assert.deepEqual(payload.setup, { state: "none" });
      assert.deepEqual(payload.evidenceOptions, [
        { name: "unit tests", appSlug: "github-actions", suggested: true },
        { name: "Vercel deployment", appSlug: "vercel", suggested: false },
      ]);
      assert.deepEqual(payload.evidenceDiscovery, { state: "found", checkedHeads: 2 });
      assert.deepEqual(payload.boundary, {
        defaultBranchWrite: false,
        pullRequestOnly: true,
        observeOnly: true,
        mergeBlocking: false,
        agentRepair: false,
        untrustedCodeExecution: false,
        providerSecretAccess: false,
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

test("Managed pilot verifies the server-side DeepSeek key without exposing or enabling execution", async () => {
  await withOAuthEnvironment(async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    const managedKey = `provider-${"m".repeat(40)}`;
    const originalManagedKey = process.env.CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY = managedKey;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      if (requestUrl.origin === "https://api.deepseek.com") {
        assert.equal(options.headers.authorization, `Bearer ${managedKey}`);
        return {
          ok: true,
          status: 200,
          async json() { return { data: [{ id: "deepseek-v4-flash" }] }; },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() { return { full_name: "alice/private-service", permissions: { push: true, admin: false } }; },
        };
      }
      if (requestUrl.pathname.endsWith("/actions/secrets/DEEPSEEK_API_KEY")) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => "github-request-runtime" },
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
      assert.equal(response.statusCode, 200);
      const payload = JSON.parse(response.body);
      assert.deepEqual(payload.managed, {
        state: "provider_verified",
        available: false,
        providerVerified: true,
        executionReady: false,
      });
      assert.equal(payload.model, "deepseek-v4-flash");
      assert.equal(response.body.includes(managedKey), false);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalManagedKey === undefined) delete process.env.CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY;
      else process.env.CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY = originalManagedKey;
    }
  });
});

test("Enterprise BYOK encrypts directly for GitHub Actions and never echoes plaintext", async () => {
  await withOAuthEnvironment(async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    const repositoryPublicKey = sodium.to_base64(keyPair.publicKey, sodium.base64_variants.ORIGINAL);
    const apiKey = `provider-${"s".repeat(40)}`;
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
    }, SECRET);
    let storedSecret;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = new URL(String(url));
      const method = options.method || "GET";
      if (requestUrl.origin === "https://api.deepseek.com" && requestUrl.pathname === "/models") {
        assert.equal(options.headers.authorization, `Bearer ${apiKey}`);
        return {
          ok: true,
          status: 200,
          async json() { return { data: [{ id: "deepseek-v4-flash" }] }; },
        };
      }
      if (requestUrl.pathname === "/repos/alice/private-service") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { full_name: "alice/private-service", permissions: { push: true, admin: false } };
          },
        };
      }
      if (requestUrl.pathname.endsWith("/actions/secrets/public-key")) {
        return {
          ok: true,
          status: 200,
          async json() { return { key_id: "github-key-1", key: repositoryPublicKey }; },
        };
      }
      if (requestUrl.pathname.endsWith("/actions/secrets/DEEPSEEK_API_KEY") && method === "PUT") {
        storedSecret = JSON.parse(options.body);
        return { ok: true, status: 201 };
      }
      if (requestUrl.pathname.endsWith("/actions/secrets/DEEPSEEK_API_KEY") && method === "GET") {
        return {
          ok: true,
          status: 200,
          async json() { return { name: "DEEPSEEK_API_KEY", updated_at: "2026-07-18T10:24:00Z" }; },
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
      assert.equal(storedSecret.key_id, "github-key-1");
      assert.equal(storedSecret.encrypted_value.includes(apiKey), false);

      const cipher = sodium.from_base64(storedSecret.encrypted_value, sodium.base64_variants.ORIGINAL);
      const plaintext = sodium.crypto_box_seal_open(cipher, keyPair.publicKey, keyPair.privateKey);
      assert.equal(sodium.to_string(plaintext), apiKey);
      sodium.memzero(cipher);
      sodium.memzero(plaintext);
    } finally {
      sodium.memzero(keyPair.publicKey);
      sodium.memzero(keyPair.privateKey);
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
                  contents: "write",
                  pull_requests: "write",
                  workflows: "write",
                  checks: "read",
                  secrets: "write",
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
                  contents: "write",
                  pull_requests: "write",
                  workflows: "write",
                  checks: "read",
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

test("returning authorization fails closed when the GitHub App installation is ambiguous", async () => {
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
                { id: 1, app_slug: "changeplane-test", permissions: {} },
                { id: 2, app_slug: "changeplane-test", permissions: {} },
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
      assert.equal(callbackResponse.statusCode, 409);
      assert.match(JSON.parse(callbackResponse.body).error, /More than one ChangePlane installation/u);
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
