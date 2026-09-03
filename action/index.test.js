import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_ASSURANCE_PASSPORT_ENCODED_LENGTH,
  assertUniqueOpenPullRequestHead,
  canonicalJson,
  assertTrustedPullRequestBase,
  assurancePassportOutputs,
  beginDedicatedGuard,
  bindPreview,
  buildAgentHandback,
  buildAssurancePassport,
  buildProofLocator,
  buildMergeGroupReceipt,
  buildReceipt,
  checkDiagnostic,
  discoverPreview,
  discoverOpenPullRequestOverlaps,
  digest,
  eligibleReviewCandidates,
  evidenceSnapshot,
  headCheckPayload,
  inferPlan,
  githubRetryDelayMs,
  findCurrentRemediationRequest,
  parseAssurancePassportIntegrity,
  parseAgentDispatch,
  parseMode,
  parsePlan,
  parseRemediationComments,
  publishDedicatedGuard,
  requestGuardReconciliationSweep,
  remediationIdempotencyKey,
  renderReceiptComment,
  renderMergeGroupReceipt,
  resolveMergeGroup,
  resolvePullRequestNumber,
  resolveRevisionContract,
  sanitizePreviewUrl,
  shouldDispatchAgentWebhook,
  shouldFailDecision,
  validateAgentWebhookUrl,
  verifyAssurancePassportAgainstCheck,
  verifyAssurancePassportIntegrity,
  validateActionEvidencePolicy,
} from "./index.js";

function passportReceipt(overrides = {}) {
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  return {
    repository: "acme/payments",
    repositoryId: 4242,
    pullRequestNumber: 42,
    baseSha,
    headSha,
    inputDigest: "c".repeat(64),
    boundContractDigest: "d".repeat(64),
    policy: { path: ".changeplane.json", digest: "e".repeat(64), sourceRevision: baseSha },
    approvalDigest: "f".repeat(64),
    evaluatorVersion: "0.4.0",
    mode: "observe",
    decision: "PASS",
    reason: "ELIGIBLE",
    evidence: [],
    ...overrides,
  };
}

function passingPassportEvidence(overrides = {}) {
  return {
    name: "CI / verify",
    expectedSource: "github-actions",
    source: "github-actions",
    checkRunId: 808,
    publisherAppId: 15368,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    completedAt: "2026-08-20T00:01:00Z",
    ...overrides,
  };
}

test("GitHub Actions test imports do not execute the Action entrypoint", () => {
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `await import(${JSON.stringify(new URL("./index.js", import.meta.url).href)})`,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_PATH: "/changeplane/missing-test-event.json",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("trusted enforce action refuses PASS-capable evaluation without strict behavioral Check policy", () => {
  assert.equal(validateActionEvidencePolicy({
    evidence: { requiredChecks: [{ name: "test", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml" }] },
  }, "enforce"), true);
  assert.throws(
    () => validateActionEvidencePolicy({ evidence: { requiredChecks: [] } }, "enforce"),
    /at least one exact behavioral Check/u,
  );
  assert.throws(
    () => validateActionEvidencePolicy({
      evidence: { requiredChecks: [{ name: "test", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml", extra: true }] },
    }, "enforce"),
    /contain only/u,
  );
  assert.throws(
    () => validateActionEvidencePolicy({
      evidence: { requiredChecks: [{ name: "test", appSlug: "GitHub-Actions" }] },
    }, "enforce"),
    /lowercase GitHub App slug/u,
  );
  assert.throws(
    () => validateActionEvidencePolicy({
      evidence: { requiredChecks: [{ name: "test", appSlug: "github-actions" }] },
    }, "enforce"),
    /exact .*workflowPath/u,
  );
});

test("pinned guard workflows request merge-group checks on exact queue revisions", () => {
  for (const path of ["../examples/changeplane-observe.yml", "../examples/changeplane-repair-guard.yml"]) {
    const workflow = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(workflow, /merge_group:\n\s+types: \[checks_requested\]/u);
    assert.match(workflow, /github\.event\.merge_group\.head_sha/u);
    assert.match(workflow, /checks: read/u);
    assert.match(workflow, /actions: read/u);
    assert.match(workflow, /id-token: write/u);
    assert.doesNotMatch(workflow, /checks: write/u);
    const reconciliationJob = workflow.match(/\n  reconcile:\n([\s\S]*)$/u)?.[1] ?? "";
    assert.match(reconciliationJob, /if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/u);
    assert.match(reconciliationJob, /permissions:\n\s+contents: read\n\s+id-token: write/u);
    assert.doesNotMatch(reconciliationJob, /pull-requests: write|actions: write|checks: write/u);
  }
  const observe = readFileSync(new URL("../examples/changeplane-observe.yml", import.meta.url), "utf8");
  assert.match(observe, /types: \[opened, synchronize, reopened, edited\]/u);
  assert.match(observe, /schedule:\n\s+- cron: "\*\/5 \* \* \* \*"/u);
  assert.match(observe, /workflow_dispatch:/u);
  assert.match(observe, /operation: reconcile/u);
  assert.match(observe, /if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/u);
  assert.match(observe, /ref: \$\{\{ github\.event\.merge_group\.base_sha \|\| \(github\.event\.pull_request\.base\.ref == github\.event\.repository\.default_branch && github\.event\.pull_request\.base\.sha\) \|\| github\.event\.repository\.default_branch \}\}/u);
  assert.match(observe, /trusted_controller_sha: \$\{\{ steps\.controller\.outputs\.sha \}\}/u);
  const repair = readFileSync(new URL("../examples/changeplane-repair-guard.yml", import.meta.url), "utf8");
  assert.match(repair, /schedule:\n\s+- cron: "\*\/5 \* \* \* \*"/u);
  assert.match(repair, /INPUT_OPERATION: reconcile/u);
  assert.match(repair, /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/u);
  assert.match(repair, /INPUT_TRUSTED_CONTROLLER_SHA: \$\{\{ steps\.trusted\.outputs\.sha \}\}/u);
  const mergeQueueStep = repair.match(/- name: Evaluate the merge queue without repair authority\n([\s\S]*)$/u)?.[1] ?? "";
  assert.match(mergeQueueStep, /INPUT_AGENT_DISPATCH: none/u);
  assert.doesNotMatch(mergeQueueStep, /CONTROLLER_HMAC|CONTROLLER_INSTALLATION_ID|WEBHOOK/u);
});

test("dedicated guard publication exchanges GitHub OIDC and rejects shared Actions authority", async () => {
  const passport = buildAssurancePassport(passportReceipt({
    mode: "enforce",
    decision: "PASS",
    reason: "ALL_GUARANTEES_SATISFIED",
    evidence: [passingPassportEvidence()],
  }));
  const original = {
    requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    gitRef: process.env.GITHUB_REF,
  };
  Object.assign(process.env, {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/oidc/token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-oidc-request-token-long-enough",
    GITHUB_RUN_ID: "8001",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_REF: "refs/heads/main",
  });
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      assert.equal(url.searchParams.get("audience"), "https://changeplane.vercel.app/guard-publisher/v1");
      assert.equal(options.headers.authorization, "Bearer github-oidc-request-token-long-enough");
      return {
        ok: true,
        status: 200,
        async json() { return { value: "x".repeat(120) }; },
      };
    }
    const body = JSON.parse(options.body);
    assert.equal(body.passport.digest, passport.digest);
    assert.equal(body.defaultBranch, "main");
    assert.equal(body.gitRef, "refs/heads/main");
    assert.equal(body.workflowRunId, 8001);
    assert.equal(body.workflowRunAttempt, 2);
    assert.equal(options.headers.authorization, `Bearer ${"x".repeat(120)}`);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          schemaVersion: 1,
          type: "changeplane.guard-publication",
          passportDigest: passport.digest,
          check: {
            id: 909,
            name: "ChangePlane / guard",
            headSha: passport.target.headSha,
            conclusion: "success",
            publisherAppId: 424242,
            publisherAppSlug: "changeplane",
          },
        };
      },
    };
  };
  try {
    const published = await publishDedicatedGuard({
      repository: "acme/payments",
      defaultBranch: "main",
      passport,
      summary: "trusted summary",
      fetchImpl,
    });
    assert.equal(published.app.slug, "changeplane");
    assert.equal(calls.length, 2);

    const sharedPublisher = async (input, options) => {
      const response = await fetchImpl(input, options);
      if (new URL(String(input)).hostname === "changeplane.vercel.app") {
        const value = await response.json();
        return {
          ...response,
          async json() {
            return {
              ...value,
              check: {
                ...value.check,
                publisherAppId: 15368,
                publisherAppSlug: "github-actions",
              },
            };
          },
        };
      }
      return response;
    };
    await assert.rejects(
      () => publishDedicatedGuard({
        repository: "acme/payments",
        defaultBranch: "main",
        passport,
        summary: "trusted summary",
        fetchImpl: sharedPublisher,
      }),
      /invalid proof/u,
    );
  } finally {
    for (const [name, value] of Object.entries({
      ACTIONS_ID_TOKEN_REQUEST_URL: original.requestUrl,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: original.requestToken,
      GITHUB_RUN_ID: original.runId,
      GITHUB_RUN_ATTEMPT: original.runAttempt,
      GITHUB_REF: original.gitRef,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("dedicated guard begin invalidates the stable exact-head gate before evaluation", async () => {
  const original = {
    requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    gitRef: process.env.GITHUB_REF,
  };
  Object.assign(process.env, {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/oidc/token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-oidc-request-token-long-enough",
    GITHUB_RUN_ID: "8100",
    GITHUB_RUN_ATTEMPT: "3",
    GITHUB_REF: "refs/pull/42/merge",
  });
  const target = {
    type: "pull_request",
    pullRequestNumber: 42,
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    baseRef: "main",
    headRef: "agent/change",
  };
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return { ok: true, status: 200, async json() { return { value: "o".repeat(120) }; } };
    }
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      schemaVersion: 1,
      type: "changeplane.guard-publication-begin",
      repository: "acme/payments",
      repositoryId: 4242,
      defaultBranch: "main",
      controllerSha: "a".repeat(40),
      workflowRunId: 8100,
      workflowRunAttempt: 3,
      gitRef: "refs/pull/42/merge",
      target,
    });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          schemaVersion: 1,
          type: "changeplane.guard-publication-begin",
          check: {
            id: 1001,
            name: "ChangePlane / guard",
            headSha: target.headSha,
            status: "in_progress",
            publisherAppId: 424242,
            publisherAppSlug: "changeplane",
          },
          run: { id: 8100, attempt: 3 },
          previousContractDigest: null,
        };
      },
    };
  };
  try {
    const result = await beginDedicatedGuard({
      repository: "acme/payments",
      repositoryId: 4242,
      defaultBranch: "main",
      controllerSha: "a".repeat(40),
      target,
      fetchImpl,
    });
    assert.equal(result.check.status, "in_progress");
    assert.equal(calls.length, 2);
  } finally {
    for (const [name, value] of Object.entries({
      ACTIONS_ID_TOKEN_REQUEST_URL: original.requestUrl,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: original.requestToken,
      GITHUB_RUN_ID: original.runId,
      GITHUB_RUN_ATTEMPT: original.runAttempt,
      GITHUB_REF: original.gitRef,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("scheduled guard reconciliation authenticates one exact trusted repository without repository-write authority", async () => {
  const original = {
    requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    gitRef: process.env.GITHUB_REF,
    eventName: process.env.GITHUB_EVENT_NAME,
  };
  Object.assign(process.env, {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/oidc/token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-oidc-request-token-long-enough",
    GITHUB_RUN_ID: "9100",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "schedule",
  });
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return { ok: true, status: 200, async json() { return { value: "o".repeat(120) }; } };
    }
    assert.deepEqual(JSON.parse(options.body), {
      schemaVersion: 1,
      type: "changeplane.guard-reconciliation-sweep",
      repository: "acme/payments",
      repositoryId: 4242,
      defaultBranch: "main",
      controllerSha: "a".repeat(40),
      workflowRunId: 9100,
      workflowRunAttempt: 1,
      gitRef: "refs/heads/main",
    });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          schemaVersion: 1,
          type: "changeplane.guard-reconciliation-sweep",
          scannedHeads: 3,
          inProgress: 1,
          reconciled: 1,
          withinWindow: 0,
        };
      },
    };
  };
  try {
    assert.deepEqual(await requestGuardReconciliationSweep({
      repository: "acme/payments",
      repositoryId: 4242,
      defaultBranch: "main",
      controllerSha: "a".repeat(40),
      fetchImpl,
    }), {
      scannedHeads: 3,
      inProgress: 1,
      reconciled: 1,
      withinWindow: 0,
    });
    assert.equal(calls.length, 2);
  } finally {
    for (const [name, value] of Object.entries({
      ACTIONS_ID_TOKEN_REQUEST_URL: original.requestUrl,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: original.requestToken,
      GITHUB_RUN_ID: original.runId,
      GITHUB_RUN_ATTEMPT: original.runAttempt,
      GITHUB_REF: original.gitRef,
      GITHUB_EVENT_NAME: original.eventName,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("builds bounded exact-check diagnostics from output and annotations", () => {
  const diagnostic = checkDiagnostic({
    output: {
      title: "Checkout race failed",
      summary: "Expected one charge, observed two",
      text: "retry id=order-42",
    },
  }, [{ path: "src/payments/retry.js", start_line: 42, message: "duplicate charge" }]);
  assert.match(diagnostic, /Checkout race failed/u);
  assert.match(diagnostic, /src\/payments\/retry\.js:line 42 — duplicate charge/u);
  assert.equal(diagnostic.length <= 6_000, true);
});

test("enforce evidence excludes legacy commit statuses without querying them", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requested.push(url.pathname);
    return {
      ok: true,
      status: 200,
      async json() { return { check_runs: [] }; },
    };
  };
  try {
    const checks = await evidenceSnapshot(
      "acme/payments",
      "a".repeat(40),
      { evidence: { requiredChecks: [{ name: "test", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml" }] } },
      "token",
      { includeCommitStatuses: false },
    );
    assert.deepEqual(checks, []);
    assert.equal(requested.length, 1);
    assert.match(requested[0], /\/check-runs$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retains the exact Check Run and publisher identities for portable assurance", async () => {
  const originalFetch = globalThis.fetch;
  const headSha = "a".repeat(40);
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requested.push(url.pathname);
    return {
      ok: true,
      status: 200,
      async json() {
        if (url.pathname.endsWith("/check-runs")) {
          return {
            check_runs: [{
              id: 808,
              name: "validate",
              status: "completed",
              conclusion: "success",
              head_sha: headSha,
              details_url: "https://github.com/acme/payments/actions/runs/9001/job/7001",
              started_at: "2026-08-20T00:00:00Z",
              completed_at: "2026-08-20T00:01:00Z",
              app: { id: 15368, slug: "github-actions" },
            }],
          };
        }
        return {
          id: 9001,
          head_sha: headSha,
          path: ".github/workflows/ci.yml",
        };
      },
    };
  };
  try {
    assert.deepEqual(await evidenceSnapshot(
      "acme/payments",
      headSha,
      { evidence: { requiredChecks: [{ name: "validate", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml" }] } },
      "token",
      { includeCommitStatuses: false },
    ), [{
      name: "validate",
      status: "completed",
      conclusion: "success",
      createdAt: "2026-08-20T00:00:00Z",
      completedAt: "2026-08-20T00:01:00Z",
      source: "github-actions",
      workflowPath: ".github/workflows/ci.yml",
      checkRunId: 808,
      publisherAppId: 15368,
    }]);
    assert.deepEqual(requested, [
      `/repos/acme/payments/commits/${headSha}/check-runs`,
      "/repos/acme/payments/actions/runs/9001",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed when github-actions details URL or workflow-run head provenance is not exact", async () => {
  const originalFetch = globalThis.fetch;
  const headSha = "a".repeat(40);
  const policy = {
    evidence: {
      requiredChecks: [{
        name: "validate",
        appSlug: "github-actions",
        workflowPath: ".github/workflows/ci.yml",
      }],
    },
  };
  const cases = [
    {
      detailsUrl: "https://github.com/other/payments/actions/runs/9001/job/7001",
      runHeadSha: headSha,
      expectedRequests: 1,
    },
    {
      detailsUrl: "https://github.com/acme/payments/actions/runs/9001/job/7001",
      runHeadSha: "b".repeat(40),
      expectedRequests: 2,
    },
    {
      detailsUrl: "https://github.com/acme/payments/actions/runs/9001/job/7001?attempt=1",
      runHeadSha: headSha,
      expectedRequests: 1,
    },
  ];
  try {
    for (const scenario of cases) {
      const requested = [];
      globalThis.fetch = async (input) => {
        const url = new URL(input);
        requested.push(url.pathname);
        return {
          ok: true,
          status: 200,
          async json() {
            if (url.pathname.endsWith("/check-runs")) {
              return {
                check_runs: [{
                  id: 808,
                  name: "validate",
                  status: "completed",
                  conclusion: "success",
                  head_sha: headSha,
                  details_url: scenario.detailsUrl,
                  app: { id: 15368, slug: "github-actions" },
                }],
              };
            }
            return {
              id: 9001,
              head_sha: scenario.runHeadSha,
              path: ".github/workflows/ci.yml",
            };
          },
        };
      };
      const checks = await evidenceSnapshot(
        "acme/payments",
        headSha,
        policy,
        "token",
        { includeCommitStatuses: false },
      );
      assert.equal("workflowPath" in checks[0], false);
      assert.equal(requested.length, scenario.expectedRequests);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("observe evidence keeps legacy commit statuses during migration", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requested.push(url.pathname);
    return {
      ok: true,
      status: 200,
      async json() {
        return url.pathname.endsWith("/check-runs")
          ? { check_runs: [] }
          : {
              statuses: [{
                context: "legacy-ci",
                state: "success",
                creator: { login: "ci-user" },
              }],
            };
      },
    };
  };
  try {
    const checks = await evidenceSnapshot(
      "acme/payments",
      "a".repeat(40),
      { evidence: { requiredChecks: [{ name: "legacy-ci" }] } },
      "token",
    );
    assert.deepEqual(checks, [{
      name: "legacy-ci",
      status: "completed",
      conclusion: "success",
      createdAt: undefined,
      completedAt: undefined,
      source: "LEGACY_COMMIT_STATUS",
    }]);
    assert.doesNotMatch(canonicalJson(checks), /ci-user/u);
    assert.equal(requested.length, 2);
    assert.match(requested[0], /\/check-runs$/u);
    assert.match(requested[1], /\/status$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("round-trips a maximum-bound assurance passport within the shared encoded limit", () => {
  const appSlug = "a".repeat(100);
  const passport = buildAssurancePassport(passportReceipt({
    repository: "r".repeat(200),
    evaluatorVersion: "v".repeat(50),
    reason: "R".repeat(200),
    policy: {
      path: "p".repeat(300),
      digest: "e".repeat(64),
      sourceRevision: "a".repeat(40),
    },
    evidence: Array.from({ length: 20 }, (_, index) => ({
      name: `${String(index).padStart(2, "0")}${"n".repeat(98)}`,
      expectedSource: appSlug,
      source: appSlug,
      checkRunId: index + 1,
      publisherAppId: index + 101,
      status: "COMPLETED",
      conclusion: "SUCCESS",
      completedAt: "2026-08-20T00:01:00Z",
    })),
  }));
  const payload = Buffer.from(canonicalJson(passport)).toString("base64url");
  assert.equal(payload.length <= MAX_ASSURANCE_PASSPORT_ENCODED_LENGTH, true);
  const marker = `<!-- changeplane-assurance-passport:v1 digest=${passport.digest} payload=${payload} -->`;
  assert.deepEqual(parseAssurancePassportIntegrity(marker), passport);
  assert.deepEqual(assurancePassportOutputs(passport, false), {});
  assert.deepEqual(assurancePassportOutputs(passport, true), {
    assurance_passport: canonicalJson(passport),
    assurance_passport_digest: passport.digest,
  });
});

test("rejects enforce PASS passports that are not semantically backed by behavioral evidence", () => {
  assert.throws(
    () => buildAssurancePassport(passportReceipt({
      mode: "enforce",
      decision: "PASS",
      reason: "ALL_GUARANTEES_SATISFIED",
      evidence: [],
    })),
    /assurance passport is invalid/u,
  );
  assert.throws(
    () => buildAssurancePassport(passportReceipt({
      mode: "enforce",
      decision: "PASS",
      reason: "ALL_GUARANTEES_SATISFIED",
      evidence: [passingPassportEvidence({ conclusion: "FAILURE" })],
    })),
    /assurance passport is invalid/u,
  );
  assert.throws(
    () => buildAssurancePassport(passportReceipt({
      mode: "enforce",
      decision: "PASS",
      reason: "ELIGIBLE",
      evidence: [passingPassportEvidence()],
    })),
    /assurance passport is invalid/u,
  );
  assert.throws(
    () => buildAssurancePassport(passportReceipt({
      mode: "enforce",
      decision: "PASS",
      reason: "ALL_GUARANTEES_SATISFIED",
      evidence: [passingPassportEvidence({ expectedSource: "Any", source: "lookalike-ci" })],
    })),
    /assurance passport is invalid/u,
  );

  const passport = buildAssurancePassport(passportReceipt({
    mode: "enforce",
    decision: "PASS",
    reason: "ALL_GUARANTEES_SATISFIED",
    evidence: [passingPassportEvidence()],
  }));
  assert.equal(passport.decision.behavioralEvidencePassed, true);
});

test("requires one passport marker and matching receipt bindings before live authentication", () => {
  const passport = buildAssurancePassport(passportReceipt());
  const encoded = Buffer.from(canonicalJson(passport)).toString("base64url");
  const passportMarker = `<!-- changeplane-assurance-passport:v1 digest=${passport.digest} payload=${encoded} -->`;
  assert.throws(
    () => parseAssurancePassportIntegrity(`${passportMarker}\n${passportMarker}`),
    /assurance passport is invalid/u,
  );

  const mismatchedReceipt = `<!-- changeplane-receipt:v2 contract=${"0".repeat(64)} input=${passport.binding.inputDigest} head=${passport.target.headSha} -->\n${passportMarker}`;
  const liveCheck = {
    id: 909,
    name: "ChangePlane / guard",
    head_sha: passport.target.headSha,
    status: "completed",
    conclusion: "neutral",
    output: { summary: mismatchedReceipt },
    app: { id: 15368, slug: "github-actions" },
  };
  assert.throws(
    () => verifyAssurancePassportAgainstCheck(
      passport,
      liveCheck,
      { appId: 15368, appSlug: "github-actions" },
    ),
    /does not authenticate/u,
  );
});

test("builds a redacted proof locator only from the published exact-head guard", () => {
  const passport = buildAssurancePassport(passportReceipt());
  assert.deepEqual(buildProofLocator(passport, {
    id: 909,
    name: "ChangePlane / guard",
    head_sha: passport.target.headSha,
  }), {
    schemaVersion: 1,
    type: "changeplane.assurance-proof-locator",
    repositoryId: 4242,
    targetType: "pull_request",
    pullRequestNumber: 42,
    headSha: passport.target.headSha,
    checkRunId: 909,
    passportDigest: passport.digest,
  });
  assert.throws(
    () => buildProofLocator(passport, {
      id: 909,
      name: "ChangePlane / guard",
      head_sha: "9".repeat(40),
    }),
    /cannot locate/u,
  );
});

test("rejects policy paths and evidence states that cannot round-trip through the passport schema", () => {
  assert.throws(
    () => buildAssurancePassport(passportReceipt({
      policy: {
        path: "p".repeat(301),
        digest: "e".repeat(64),
        sourceRevision: "a".repeat(40),
      },
    })),
    /policy_path.*300/u,
  );

  const validEvidence = {
    name: "validate",
    expectedSource: "github-actions",
    source: "github-actions",
    checkRunId: 808,
    publisherAppId: 15368,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    completedAt: "2026-08-20T00:01:00Z",
  };
  assert.throws(
    () => buildAssurancePassport(passportReceipt({ evidence: [{ ...validEvidence, status: "COMPLETE" }] })),
    /assurance passport is invalid/u,
  );
  assert.throws(
    () => buildAssurancePassport(passportReceipt({ evidence: [{ ...validEvidence, completedAt: "yesterday" }] })),
    /assurance passport is invalid/u,
  );
  assert.throws(
    () => buildAssurancePassport(passportReceipt({ evidence: [{ ...validEvidence, publisherAppId: undefined }] })),
    /assurance passport is invalid/u,
  );
  assert.throws(
    () => buildAssurancePassport(passportReceipt({ evidence: [{ ...validEvidence, source: "another-app" }] })),
    /assurance passport is invalid/u,
  );

  const sourceMismatch = buildAssurancePassport(passportReceipt({
    evidence: [{
      name: "validate",
      expectedSource: "github-actions",
      source: null,
      status: "MISSING",
      conclusion: null,
    }],
  }));
  assert.equal(sourceMismatch.evidence[0].actualPublisher, "Unknown");
  assert.equal(sourceMismatch.decision.behavioralEvidencePassed, false);
  assert.deepEqual(verifyAssurancePassportIntegrity(sourceMismatch), sourceMismatch);
});

test("accepts observe and enforce modes and defaults to observe", () => {
  assert.equal(parseMode(), "observe");
  assert.equal(parseMode(""), "observe");
  assert.equal(parseMode(" OBSERVE "), "observe");
  assert.equal(parseMode("enforce"), "enforce");
  assert.throws(() => parseMode("shadow"), /observe or enforce/);
});

test("selects an explicit repair adapter and keeps remediation off by default", () => {
  assert.equal(parseAgentDispatch(), "none");
  assert.equal(parseAgentDispatch("", "https://agent.example/repair"), "webhook");
  assert.throws(() => parseAgentDispatch("webhook"), /agent_webhook_url/);
  assert.throws(() => parseAgentDispatch("repository"), /none or webhook/u);
});

test("webhook repair adapters reject local, IP-literal, and credential-bearing endpoints", () => {
  assert.equal(validateAgentWebhookUrl("https://agent.example/repair").hostname, "agent.example");
  for (const value of [
    "http://agent.example/repair",
    "https://localhost/repair",
    "https://worker.local/repair",
    "https://127.0.0.1/repair",
    "https://user:secret@agent.example/repair",
  ]) assert.throws(() => validateAgentWebhookUrl(value), /public HTTPS URL/u);
});

test("parses the smallest valid PR plan", () => {
  assert.deepEqual(parsePlan(`Goal\n<!-- changeplane\n{"scope":["src/payments/**"]}\n-->`), {
    scope: ["src/payments/**"],
  });
});

test("fails closed for missing, invalid, or empty plans", () => {
  assert.throws(() => parsePlan("No plan"), /Missing/);
  assert.equal(parsePlan("No plan", { optional: true }), null);
  assert.throws(() => parsePlan("<!-- changeplane nope -->"), /valid JSON/);
  assert.throws(() => parsePlan("<!-- changeplane {\"scope\":[]} -->"), /1–50/);
});

test("binds a zero-touch contract from the first observed head", () => {
  assert.deepEqual(inferPlan([
    { path: "src/payments/retry.js" },
    { path: "src/payments/idempotency.js", previousPath: "src/payments/legacy.js" },
  ], "Prevent duplicate charges"), {
    scope: ["src/payments/idempotency.js", "src/payments/legacy.js", "src/payments/retry.js"],
    goal: "Prevent duplicate charges",
  });
  assert.throws(() => inferPlan(Array.from({ length: 51 }, (_, index) => ({ path: `src/${index}.js` }))), /up to 50/u);
});

test("uses only the dedicated-App digest to freeze one exact-head contract", () => {
  const headSha = "a".repeat(40);
  const boundPlan = { scope: ["src/bound.js"], goal: "Bound once" };
  const sameHead = resolveRevisionContract({
    body: '<!-- changeplane {"scope":["src/edited.js"]} -->',
    title: "Edited later",
    actualFiles: [{ path: "src/edited.js" }],
    boundContractDigest: digest(boundPlan),
    headSha,
  });
  assert.deepEqual(sameHead.plan, { scope: ["src/edited.js"] });
  assert.equal(sameHead.boundContractDigest, digest(boundPlan));
  assert.notEqual(sameHead.boundContractDigest, sameHead.contractDigest);

  const newHead = resolveRevisionContract({
    body: '<!-- changeplane {"scope":["src/new.js"]} -->',
    title: "New revision",
    actualFiles: [{ path: "src/new.js" }],
    headSha: "b".repeat(40),
  });
  assert.deepEqual(newHead.plan, { scope: ["src/new.js"] });
  assert.equal(newHead.boundContractDigest, newHead.contractDigest);
  assert.throws(() => resolveRevisionContract({
    body: '<!-- changeplane {"scope":["src/new.js"]} -->',
    actualFiles: [{ path: "src/new.js" }],
    boundContractDigest: "forged",
    headSha,
  }), /authenticated exact-head contract binding/u);
});

test("canonical digest is stable across object key order", () => {
  assert.equal(canonicalJson({ b: 2, a: [1, 3] }), canonicalJson({ a: [1, 3], b: 2 }));
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
});

test("accepts only sanitized team-openable HTTPS preview URLs", () => {
  assert.equal(sanitizePreviewUrl(" https://preview.example./pr/42?token=secret#build-log "), "https://preview.example/pr/42");
  assert.equal(sanitizePreviewUrl("javascript:alert(1)"), null);
  assert.equal(sanitizePreviewUrl("http://preview.example/pr/42"), null);
  assert.equal(sanitizePreviewUrl("https://localhost:3000/pr/42"), null);
  assert.equal(sanitizePreviewUrl("https://app.localhost./pr/42"), null);
  assert.equal(sanitizePreviewUrl("https://127.0.0.1/pr/42"), null);
  assert.equal(sanitizePreviewUrl("https://8.8.8.8/pr/42"), null);
  assert.equal(sanitizePreviewUrl("https://[::1]/pr/42"), null);
  assert.equal(sanitizePreviewUrl("https://[2001:4860:4860::8888]/pr/42"), null);
  assert.equal(sanitizePreviewUrl("https://user:secret@preview.example/pr/42"), null);
  assert.equal(sanitizePreviewUrl(""), null);
});

test("resolves deployment status to exactly one open same-repository PR", async () => {
  const headSha = "d".repeat(40);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    assert.equal(url.pathname, `/repos/acme/payments/commits/${headSha}/pulls`);
    return {
      ok: true,
      status: 200,
      async json() {
        return [
          { number: 42, state: "open", head: { sha: headSha, repo: { full_name: "acme/payments" } }, base: { repo: { full_name: "acme/payments" } } },
          { number: 41, state: "closed", head: { sha: headSha, repo: { full_name: "acme/payments" } }, base: { repo: { full_name: "acme/payments" } } },
          { number: 40, state: "open", head: { sha: headSha, repo: { full_name: "someone/fork" } }, base: { repo: { full_name: "acme/payments" } } },
        ];
      },
    };
  };
  try {
    assert.deepEqual(await resolvePullRequestNumber({
      deployment: { sha: headSha },
      deployment_status: { id: 9 },
    }, "acme/payments", "token"), { number: 42, headSha });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deployment status skips when no unique open PR is associated", async () => {
  const headSha = "e".repeat(40);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      const pullRequest = { state: "open", head: { sha: headSha, repo: { full_name: "acme/payments" } }, base: { repo: { full_name: "acme/payments" } } };
      return [{ ...pullRequest, number: 1 }, { ...pullRequest, number: 2 }];
    },
  });
  try {
    assert.deepEqual(await resolvePullRequestNumber({
      deployment: { sha: headSha },
      deployment_status: { id: 9 },
    }, "acme/payments", "token"), {
      number: null,
      headSha,
      reason: "AMBIGUOUS_PULL_REQUEST",
    });
    globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return []; } });
    assert.deepEqual(await resolvePullRequestNumber({
      deployment: { sha: headSha },
      deployment_status: { id: 10 },
    }, "acme/payments", "token"), {
      number: null,
      headSha,
      reason: "NO_OPEN_PULL_REQUEST",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub reads retry a transient upstream failure without retrying mutations", async () => {
  const headSha = "f".repeat(40);
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 503, async text() { return "temporarily unavailable"; } };
    }
    return { ok: true, status: 200, async json() { return []; } };
  };
  try {
    assert.deepEqual(await resolvePullRequestNumber({
      deployment: { sha: headSha },
      deployment_status: { id: 11 },
    }, "acme/payments", "token"), {
      number: null,
      headSha,
      reason: "NO_OPEN_PULL_REQUEST",
    });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("action retries respect GitHub rate-limit headers", () => {
  const headers = (values) => ({ get: (name) => values[name] ?? null });
  assert.equal(githubRetryDelayMs(429, headers({ "retry-after": "1.5" }), 1, 1_000), 1_500);
  assert.equal(githubRetryDelayMs(403, headers({
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "21",
  }), 1, 1_000), 20_000);
  assert.equal(githubRetryDelayMs(403, headers({
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": "121",
  }), 1, 1_000), null);
});

test("standard pull-request events keep their direct number without lookup", async () => {
  const headSha = "1".repeat(40);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected lookup"); };
  try {
    assert.deepEqual(await resolvePullRequestNumber({ pull_request: { number: 42, head: { sha: headSha } } }, "acme/payments", "token"), { number: 42, headSha });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("trusted pull-request bases require the checked-out current default revision", () => {
  const defaultSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const pullRequest = {
    base: { ref: "main", sha: defaultSha },
    head: { sha: headSha },
  };
  assert.doesNotThrow(() => assertTrustedPullRequestBase({
    pullRequest,
    eventPullRequest: structuredClone(pullRequest),
    defaultBranch: "main",
    defaultSha,
    controllerSha: defaultSha,
  }));
  assert.throws(() => assertTrustedPullRequestBase({
    pullRequest: { ...pullRequest, base: { ...pullRequest.base, ref: "release" } },
    defaultBranch: "main",
    defaultSha,
    controllerSha: defaultSha,
  }), /current trusted default branch/u);
  assert.throws(() => assertTrustedPullRequestBase({
    pullRequest,
    defaultBranch: "main",
    defaultSha,
    controllerSha: "c".repeat(40),
  }), /current trusted default branch/u);
  assert.throws(() => assertTrustedPullRequestBase({
    pullRequest,
    eventPullRequest: { ...pullRequest, head: { sha: "d".repeat(40) } },
    defaultBranch: "main",
    defaultSha,
    controllerSha: defaultSha,
  }), /triggering pull-request revision is stale/u);
});

test("resolves a merge group as an exact default-branch revision", async () => {
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const originalFetch = globalThis.fetch;
  const paths = [];
  let changedFiles = [
    { filename: "src/payments/retry.js" },
    { filename: "src/payments/idempotency.js", previous_filename: "src/payments/legacy.js" },
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    paths.push(url.pathname);
    let value;
    if (url.pathname === "/repos/acme/payments") {
      value = { full_name: "acme/payments", default_branch: "main" };
    } else if (url.pathname === "/repos/acme/payments/git/ref/heads/main") {
      value = { object: { sha: baseSha } };
    } else if (url.pathname.startsWith("/repos/acme/payments/compare/")) {
      value = {
        status: "ahead",
        base_commit: { sha: baseSha },
        merge_base_commit: { sha: baseSha },
        head_commit: { sha: headSha },
        files: changedFiles,
      };
    } else {
      throw new Error(`Unexpected request ${url}`);
    }
    return { ok: true, status: 200, async json() { return value; } };
  };
  try {
    assert.deepEqual(await resolveMergeGroup({
      action: "checks_requested",
      merge_group: {
        base_sha: baseSha,
        head_sha: headSha,
        base_ref: "refs/heads/main",
        head_ref: "refs/heads/gh-readonly-queue/main/pr-42",
      },
    }, "acme/payments", "token"), {
      targetType: "merge_group",
      defaultBranch: "main",
      baseRef: "refs/heads/main",
      headRef: "refs/heads/gh-readonly-queue/main/pr-42",
      baseSha,
      headSha,
      actualFiles: [
        { path: "src/payments/retry.js" },
        { path: "src/payments/idempotency.js", previousPath: "src/payments/legacy.js" },
      ],
    });
    assert.equal(paths.some((path) => path.includes(`/compare/${baseSha}...${headSha}`)), true);
    changedFiles = Array.from({ length: 300 }, (_, index) => ({ filename: `src/${index}.js` }));
    await assert.rejects(resolveMergeGroup({
      action: "checks_requested",
      merge_group: {
        base_sha: baseSha,
        head_sha: headSha,
        base_ref: "refs/heads/main",
        head_ref: "refs/heads/gh-readonly-queue/main/pr-42",
      },
    }, "acme/payments", "token"), /300 or more changed files/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("merge groups fail closed when the trusted default branch moved", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const value = url.pathname === "/repos/acme/payments"
      ? { full_name: "acme/payments", default_branch: "main" }
      : { object: { sha: "f".repeat(40) } };
    return { ok: true, status: 200, async json() { return value; } };
  };
  try {
    await assert.rejects(resolveMergeGroup({
      action: "checks_requested",
      merge_group: {
        base_sha: "a".repeat(40),
        head_sha: "b".repeat(40),
        base_ref: "refs/heads/main",
        head_ref: "refs/heads/gh-readonly-queue/main/pr-42",
      },
    }, "acme/payments", "token"), /base is stale/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("trusted recheck dispatch binds a pull request to its exact new head", async () => {
  const headSha = "c".repeat(40);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected lookup"); };
  try {
    assert.deepEqual(await resolvePullRequestNumber({
      action: "changeplane_recheck",
      client_payload: { pullRequestNumber: 42, headSha },
    }, "acme/payments", "token"), { number: 42, headSha });
    await assert.rejects(resolvePullRequestNumber({
      action: "changeplane_recheck",
      client_payload: { pullRequestNumber: 42, headSha: "stale" },
    }, "acme/payments", "token"), /missing a pull request or exact head SHA/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discovers a successful preview only from the exact PR head", async () => {
  const headSha = "b".repeat(40);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    calls.push(url);
    let value;
    if (url.pathname === "/repos/acme/payments/deployments") {
      value = [
        { id: 11, sha: headSha, environment: " Preview\nPR 42 ", task: "deploy:preview", created_at: "2026-01-01T00:00:00Z" },
        { id: 12, sha: headSha, environment: "Production", created_at: "2026-01-02T00:00:00Z" },
        { id: 13, sha: "a".repeat(40), environment: "Stale" },
      ];
    } else if (url.pathname.endsWith("/deployments/11/statuses")) {
      value = [{
        id: 101,
        state: "success",
        environment: "Pull request 42",
        environment_url: "https://preview.example/pr/42?token=secret#build",
        creator: { login: "deploy-bot" },
        created_at: "2026-01-03T00:00:00Z",
      }];
    } else if (url.pathname.endsWith("/deployments/12/statuses")) {
      value = [
        { state: "failure", environment_url: "https://production.example", created_at: "2026-01-04T00:00:00Z" },
        { state: "success", environment_url: "https://production.example", created_at: "2026-01-02T00:00:00Z" },
      ];
    } else {
      throw new Error(`Unexpected request ${url}`);
    }
    return { ok: true, status: 200, async json() { return value; } };
  };

  try {
    assert.deepEqual(await discoverPreview("acme/payments", headSha, "token"), {
      status: "READY",
      headSha,
      url: "https://preview.example/pr/42",
      environment: "Pull request 42",
      deploymentId: 11,
      statusId: 101,
      statusCreator: "deploy-bot",
      task: "deploy:preview",
      environmentOverride: "Pull request 42",
      createdAt: "2026-01-03T00:00:00.000Z",
    });
    assert.equal(calls[0].searchParams.get("sha"), headSha);
    assert.equal(calls.some(({ pathname }) => pathname.endsWith("/deployments/13/statuses")), false);
    assert.deepEqual(bindPreview({ status: "READY", headSha, url: "https://preview.example/pr/42" }, headSha), {
      status: "READY",
      headSha,
      url: "https://preview.example/pr/42",
    });
    assert.deepEqual(bindPreview({ status: "READY", headSha: "a".repeat(40), url: "https://stale.example" }, headSha), {
      status: "REVISION_MISMATCH",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discovers concurrent open pull requests with shared files in one advisory query", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (input, options) => {
    assert.equal(new URL(input).pathname, "/graphql");
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  { number: 41, title: "Current", url: "https://github.com/acme/payments/pull/41", files: { nodes: [{ path: "src/current.js" }] } },
                  { number: 42, title: "Retry payments", url: "https://github.com/acme/payments/pull/42", files: { nodes: [{ path: "src/payments/retry.js" }, { path: "src/other.js" }] } },
                  { number: 43, title: "Docs", url: "https://github.com/acme/payments/pull/43", files: { nodes: [{ path: "README.md" }] } },
                ],
              },
            },
          },
        };
      },
    };
  };
  try {
    assert.deepEqual(await discoverOpenPullRequestOverlaps(
      "acme/payments",
      41,
      [{ path: "src/payments/retry.js" }],
      "token",
    ), [{
      code: "OPEN_PR_FILE_OVERLAP",
      severity: "ADVISORY",
      paths: ["src/payments/retry.js"],
      pullRequest: {
        number: 42,
        title: "Retry payments",
        url: "https://github.com/acme/payments/pull/42",
      },
    }]);
    assert.deepEqual(requestBody.variables, { owner: "acme", name: "payments" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refuses commit-scoped assurance when one exact head belongs to multiple open pull requests", async () => {
  const originalFetch = globalThis.fetch;
  const headSha = "a".repeat(40);
  const pull = {
    number: 41,
    state: "open",
    head: { sha: headSha, ref: "agent/fix", repo: { full_name: "acme/payments" } },
    base: { sha: "b".repeat(40), ref: "main", repo: { full_name: "acme/payments" } },
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return [pull, { ...pull, number: 42, head: { ...pull.head, ref: "agent/copy" } }]; },
  });
  try {
    await assert.rejects(
      () => assertUniqueOpenPullRequestHead("acme/payments", pull, "token"),
      /multiple or mismatched open pull requests/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps a missing or unreadable preview advisory", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return []; } });
  try {
    assert.deepEqual(await discoverPreview("acme/payments", "c".repeat(40), "token"), { status: "MISSING" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only a non-author approval on the current head is eligible", () => {
  const approvalDigest = "approval-1";
  const pullRequest = { user: { id: 1 }, head: { sha: "head-2" } };
  const reviews = [
    { state: "APPROVED", commit_id: "head-1", body: `ChangePlane approve ${approvalDigest}`, user: { id: 2 }, submitted_at: "2026-01-01T00:00:00Z" },
    { state: "APPROVED", commit_id: "head-2", body: `ChangePlane approve ${approvalDigest}`, user: { id: 1 }, submitted_at: "2026-01-03T00:00:00Z" },
    { state: "CHANGES_REQUESTED", commit_id: "head-2", user: { id: 3 }, submitted_at: "2026-01-04T00:00:00Z" },
    { state: "APPROVED", commit_id: "head-2", body: "Looks good", user: { id: 3 }, submitted_at: "2026-01-04T00:00:00Z" },
    { state: "APPROVED", commit_id: "head-2", body: `ChangePlane approve ${approvalDigest}`, user: { id: 4, login: "platform" }, submitted_at: "2026-01-02T00:00:00Z" },
    { state: "CHANGES_REQUESTED", commit_id: "head-2", body: "Please revise", user: { id: 4, login: "platform" }, submitted_at: "2026-01-05T00:00:00Z" },
    { state: "APPROVED", commit_id: "head-2", body: `ChangePlane approve ${approvalDigest}`, user: { id: 5, login: "owner" }, submitted_at: "2026-01-02T00:00:00Z" },
  ];
  assert.deepEqual(eligibleReviewCandidates(reviews, pullRequest, approvalDigest).map((review) => review.user.id), [5]);
});

test("accepts an optional bounded goal in the PR contract", () => {
  assert.deepEqual(parsePlan(`<!-- changeplane
{"goal":"Add idempotent payment retries","scope":["src/payments/**"]}
-->`), {
    goal: "Add idempotent payment retries",
    scope: ["src/payments/**"],
  });
  assert.throws(() => parsePlan(`<!-- changeplane
{"goal":"","scope":["src/payments/**"]}
-->`), /goal/);
});

test("extracts durable remediation attempts and ignores unrelated comments", () => {
  const input = "a".repeat(64);
  const id = "b".repeat(64);
  assert.deepEqual(parseRemediationComments([
    { user: { login: "github-actions[bot]" }, body: "Looks good" },
    { user: { login: "octocat" }, body: `<!-- changeplane-remediation:v1 input=${input} attempt=5 id=${id} -->` },
    { user: { login: "github-actions[bot]" }, body: `<!-- changeplane-remediation:v1 input=${input} attempt=2 id=${id} -->\nRequested` },
  ]), [{ inputDigest: input, attempt: 2, idempotencyKey: id }]);
});

test("binds remediation idempotency to the exact pull request head", () => {
  const context = {
    repository: "acme/payments",
    pullRequestNumber: 42,
    headSha: "a".repeat(40),
    inputDigest: "b".repeat(64),
  };
  const request = {
    inputDigest: context.inputDigest,
    attempt: 1,
    idempotencyKey: remediationIdempotencyKey({ ...context, attempt: 1 }),
  };

  assert.deepEqual(findCurrentRemediationRequest([request], context), request);
  assert.equal(findCurrentRemediationRequest([request], {
    ...context,
    headSha: "c".repeat(40),
  }), undefined);
});

test("builds a vendor-neutral proposal-only handback for fixable findings", () => {
  const handback = buildAgentHandback({
    repository: "acme/payments",
    pullRequest: {
      number: 42,
      base: { sha: "a".repeat(40) },
      head: { sha: "b".repeat(40) },
    },
    plan: { goal: "Make retries idempotent", scope: ["src/payments/**"] },
    policyDigest: "c".repeat(64),
    contractDigest: "d".repeat(64),
    inputDigest: "e".repeat(64),
    autonomousPlan: {
      decision: "REMEDIATION_REQUIRED",
      nextAttempt: 1,
      findings: [{
        code: "EVIDENCE_FAILED",
        path: "check:test",
        pathKind: "evidence",
        diagnostic: "Expected one charge, observed two",
      }],
    },
    maxAttempts: 2,
  });
  assert.equal(handback.type, "changeplane.agent-handback");
  assert.equal(handback.target.headSha, "b".repeat(40));
  assert.deepEqual(handback.proposal.allowedPaths, ["src/payments/**"]);
  assert.equal(handback.proposal.findings[0].action, "PROPOSE_SMALLEST_PATCH_WITHIN_CONTRACT");
  assert.deepEqual(handback.authority, {
    proposalOnly: true,
    gitWrite: false,
    checkWrite: false,
    pass: false,
    merge: false,
  });
  assert.match(handback.digest, /^[a-f0-9]{64}$/u);
});

test("renders enforce verify-only changes as an actionable, blocking-capable handback without webhook dispatch", () => {
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const plan = { goal: "Keep retry docs in scope", scope: ["src/payments/**"] };
  const finding = {
    code: "OUTSIDE_PLANNED_SCOPE",
    path: "docs/retries.md",
    pathKind: "current",
    resolved: false,
  };
  const autonomousPlan = {
    decision: "CHANGES_REQUIRED",
    reason: "FIXABLE_SCOPE_DRIFT",
    humanRequired: false,
    findings: [finding],
  };
  const agentHandback = buildAgentHandback({
    repository: "acme/payments",
    pullRequest: { number: 42, base: { sha: baseSha }, head: { sha: headSha } },
    plan,
    policyDigest: "c".repeat(64),
    contractDigest: "d".repeat(64),
    inputDigest: "e".repeat(64),
    autonomousPlan,
    maxAttempts: 2,
  });
  assert.equal(agentHandback.proposal.requestedAttempt, null);

  const receipt = buildReceipt({
    repository: "acme/payments",
    repositoryId: 4242,
    pullRequest: { number: 42, base: { sha: baseSha }, head: { sha: headSha } },
    plan,
    policyPath: ".changeplane.json",
    policyDigest: "c".repeat(64),
    inputDigest: "e".repeat(64),
    contractDigest: "d".repeat(64),
    approvalDigest: "f".repeat(64),
    result: { approval: { status: "MISSING" }, reasons: [finding] },
    autonomousPlan,
    mode: "enforce",
    actualFiles: [{ path: "docs/retries.md" }],
    maxAttempts: 2,
    agentHandback,
  });
  const markdown = renderReceiptComment(receipt);
  assert.match(markdown, /Changes are required before this revision can pass/);
  assert.match(markdown, /Who acts:.*PR author or coding agent.*Next action:.*proposal-only agent handback.*push a new commit/su);
  assert.match(markdown, /Blocking-capable guard.*blocks this exact-head result only when.*required by branch protection or a ruleset/su);
  assert.match(markdown, /Fixable finding.*OUTSIDE_PLANNED_SCOPE.*docs\/retries\.md.*PROPOSE_REVERT_OR_MOVE_INTO_CONTRACT/su);
  assert.doesNotMatch(markdown, /> \*\*Enforced\.\*\*/u);

  assert.equal(headCheckPayload(receipt, markdown).conclusion, "action_required");
  assert.equal(shouldFailDecision("enforce", autonomousPlan.decision), true);
  assert.equal(shouldFailDecision("observe", autonomousPlan.decision), false);
  assert.equal(shouldDispatchAgentWebhook({
    mode: "enforce",
    decision: autonomousPlan.decision,
    agentDispatch: "none",
  }), false);
  assert.equal(shouldDispatchAgentWebhook({
    mode: "enforce",
    decision: "REMEDIATION_REQUIRED",
    agentDispatch: "webhook",
  }), true);
});

test("renders an exact revision-bound observe receipt with one next actor", () => {
  const headSha = "b".repeat(40);
  const agentHandback = buildAgentHandback({
    repository: "acme/payments",
    pullRequest: { number: 42, base: { sha: "a".repeat(40) }, head: { sha: headSha } },
    plan: { goal: "Make retries idempotent", scope: ["src/payments/**"] },
    policyDigest: "c".repeat(64),
    contractDigest: "e".repeat(64),
    inputDigest: "d".repeat(64),
    autonomousPlan: {
      decision: "REMEDIATION_REQUIRED",
      nextAttempt: 1,
      findings: [{ code: "OUTSIDE_PLANNED_SCOPE", path: "docs/retries.md", pathKind: "current" }],
    },
    maxAttempts: 2,
  });
  const receipt = buildReceipt({
    repository: "acme/payments",
    repositoryId: 4242,
    pullRequest: {
      number: 42,
      base: { sha: "a".repeat(40) },
      head: { sha: headSha },
    },
    plan: { goal: "Make retries idempotent", scope: ["src/payments/**"] },
    contractSource: "first-head",
    policyPath: ".changeplane.json",
    policyDigest: "c".repeat(64),
    inputDigest: "d".repeat(64),
    contractDigest: "e".repeat(64),
    boundContractDigest: "9".repeat(64),
    approvalDigest: "f".repeat(64),
    result: {
      approval: { status: "MISSING" },
      reasons: [{ code: "OUTSIDE_PLANNED_SCOPE", path: "docs/retries.md", resolved: false }],
    },
    evidence: [{
      name: "validate",
      expectedSource: "github-actions",
      source: "github-actions",
      checkRunId: 808,
      publisherAppId: 15368,
      status: "COMPLETED",
      conclusion: "SUCCESS",
      completedAt: "2026-08-20T00:00:00Z",
    }],
    preview: {
      status: "READY",
      headSha,
      url: "https://preview.example/pr/42",
      environment: "Preview",
      deploymentId: 11,
      statusId: 101,
      statusCreator: "deploy-bot",
      task: "deploy:preview",
      environmentOverride: "Pull request 42",
    },
    approval: undefined,
    autonomousPlan: {
      decision: "REMEDIATION_REQUIRED",
      reason: "FIXABLE_SCOPE_DRIFT",
      humanRequired: false,
      nextAttempt: 1,
    },
    mode: "observe",
    actualFiles: [{ path: "src/payments/retry.js" }, { path: "docs/retries.md" }],
    advisories: [{
      code: "OPEN_PR_FILE_OVERLAP",
      severity: "ADVISORY",
      paths: ["src/payments/retry.js"],
      pullRequest: { number: 43, title: "Retry worker", url: "https://github.com/acme/payments/pull/43" },
    }],
    maxAttempts: 2,
    agentHandback,
  });
  const markdown = renderReceiptComment(receipt);
  assert.match(markdown, /changeplane-receipt:v2/);
  assert.match(markdown, /changeplane-assurance-passport:v1/);
  assert.match(markdown, /changeplane-contract:v1 source=first-head/);
  assert.match(markdown, /First observed head · automatic/);
  assert.match(markdown, new RegExp(`contract=${"9".repeat(64)}`));
  assert.match(markdown, /aaaaaaaaaaaa.*bbbbbbbbbbbb/);
  assert.match(markdown, /Observe only/);
  assert.match(markdown, /What happened:.*fixable issue.*Merge impact:.*does not block.*Who acts:.*Configured repair adapter.*Next action:.*no request was dispatched.*Current revision:.*bbbbbbbbbbbb/su);
  assert.match(markdown, /<details>.*Technical receipt and evidence.*Revision-bound input.*<\/details>/su);
  assert.match(markdown, /Configured repair adapter \(simulated in observe\)/);
  assert.match(markdown, /no request was dispatched/);
  assert.match(markdown, /ChangePlane false positive/);
  assert.match(markdown, /validate.*COMPLETED.*SUCCESS/s);
  assert.match(markdown, /https:\/\/preview\.example\/pr\/42.*Preview.*bound to.*bbbbbbbbbbbb/);
  assert.match(markdown, /Preview provenance.*revision.*bbbbbbbbbbbb.*deployment.*11.*status.*101.*deploy-bot.*deploy:preview.*environment override.*Pull request 42.*informational only/s);
  assert.match(markdown, /changeplane-agent-handback:v1.*Agent handback.*Proposal only.*docs\/retries\.md.*cannot push, merge, publish a Check, or issue PASS/su);
  assert.match(markdown, /Independent authority.*Assurance passport.*live correspondence requires the exact.*policy, evidence, and target on GitHub.*Authoring agent.*Deterministic harness.*Trusted controller.*GitHub/su);
  assert.match(markdown, /Concurrent change risk.*#43.*Retry worker.*src\/payments\/retry\.js.*Advisory only/s);
  assert.equal(receipt.preview.deploymentId, 11);

  const check = headCheckPayload(receipt, markdown);
  assert.equal(check.head_sha, "b".repeat(40));
  assert.equal(check.conclusion, "neutral");
  assert.equal(check.name, "ChangePlane / guard");
  assert.match(check.output.summary, /https:\/\/preview\.example\/pr\/42/);
  assert.match(renderReceiptComment({ ...receipt, preview: { status: "MISSING" } }), /Not published for this revision \(advisory\)/);

  const passport = parseAssurancePassportIntegrity(markdown);
  assert.equal(passport.type, "changeplane.assurance-passport");
  assert.equal(passport.target.repositoryId, 4242);
  assert.equal(passport.target.headSha, headSha);
  assert.equal(passport.binding.policySourceRevision, "a".repeat(40));
  assert.equal(passport.decision.assuranceLevel, "BEHAVIORAL");
  assert.equal(passport.decision.behavioralEvidencePassed, true);
  assert.equal(passport.evidence[0].checkRunId, 808);
  assert.equal(passport.evidence[0].publisherAppId, 15368);
  assert.equal(passport.evidence[0].headSha, headSha);
  assert.equal(passport.verification.authenticity, "REQUIRES_LIVE_GITHUB_CHECK");
  assert.equal(passport.verification.agentIdentityUsedForDecision, false);
  assert.equal(passport.authority.proposalModel.decide, false);
  assert.equal(passport.authority.deterministicHarness.decide, true);
  assert.equal(passport.authority.trustedController.apply, true);
  assert.equal(passport.authority.github.merge, true);
  const portableJson = canonicalJson(passport);
  assert.doesNotMatch(portableJson, /preview\.example|diagnostic|prompt|provider|token|docs\/retries\.md/u);

  const liveCheck = {
    id: 909,
    ...check,
    app: { id: 15368, slug: "github-actions" },
  };
  assert.deepEqual(
    verifyAssurancePassportAgainstCheck(passport, liveCheck, { appId: 15368, appSlug: "github-actions" }),
    {
      authenticity: "VERIFIED_LIVE_GITHUB_CHECK",
      passport,
      checkRunId: 909,
      publisherAppId: 15368,
      publisherAppSlug: "github-actions",
    },
  );
  for (const invalidCheck of [
    { ...liveCheck, head_sha: "7".repeat(40) },
    { ...liveCheck, name: "ChangePlane / review" },
    { ...liveCheck, status: "in_progress" },
    { ...liveCheck, conclusion: "success" },
    { ...liveCheck, app: { id: 999, slug: "github-actions" } },
    { ...liveCheck, app: { id: 15368, slug: "another-app" } },
    {
      ...liveCheck,
      output: {
        ...liveCheck.output,
        summary: liveCheck.output.summary.replace(passport.digest, "0".repeat(64)),
      },
    },
  ]) {
    assert.throws(
      () => verifyAssurancePassportAgainstCheck(passport, invalidCheck, { appId: 15368, appSlug: "github-actions" }),
      /does not authenticate/u,
    );
  }
  assert.throws(
    () => verifyAssurancePassportAgainstCheck(passport, liveCheck, { appId: 15368, appSlug: "another-app" }),
    /does not authenticate/u,
  );

  const nextHeadPassport = buildAssurancePassport({ ...receipt, headSha: "7".repeat(40) });
  assert.notEqual(nextHeadPassport.digest, passport.digest);
  const nextPolicyPassport = buildAssurancePassport({
    ...receipt,
    policy: { ...receipt.policy, digest: "6".repeat(64) },
  });
  assert.notEqual(nextPolicyPassport.digest, passport.digest);
  const failedEvidencePassport = buildAssurancePassport({
    ...receipt,
    evidence: receipt.evidence.map((item) => ({ ...item, conclusion: "FAILURE" })),
  });
  assert.notEqual(failedEvidencePassport.digest, passport.digest);
  assert.equal(failedEvidencePassport.decision.behavioralEvidencePassed, false);
  assert.equal(parseAssurancePassportIntegrity("No passport here"), undefined);

  const marker = markdown.match(/<!-- changeplane-assurance-passport:v1 digest=([a-f0-9]{64}) payload=([A-Za-z0-9_-]+) -->/u);
  const tampered = {
    ...passport,
    target: { ...passport.target, headSha: "8".repeat(40) },
  };
  const tamperedBody = markdown.replace(marker[2], Buffer.from(canonicalJson(tampered)).toString("base64url"));
  assert.throws(
    () => parseAssurancePassportIntegrity(tamperedBody),
    /assurance passport is invalid/u,
  );
});

test("labels an empty-evidence PASS as scope-only assurance", () => {
  const receipt = buildReceipt({
    repository: "acme/payments",
    repositoryId: 4242,
    pullRequest: {
      number: 42,
      base: { sha: "a".repeat(40) },
      head: { sha: "b".repeat(40) },
    },
    plan: { scope: ["src/payments/**"] },
    contractSource: "first-head",
    policyPath: ".changeplane.json",
    policyDigest: "c".repeat(64),
    inputDigest: "d".repeat(64),
    contractDigest: "e".repeat(64),
    boundContractDigest: "9".repeat(64),
    approvalDigest: "f".repeat(64),
    result: { approval: { status: "NOT_REQUIRED" }, reasons: [] },
    evidence: [],
    preview: { status: "MISSING" },
    approval: undefined,
    autonomousPlan: {
      decision: "PASS",
      reason: "ELIGIBLE",
      humanRequired: false,
    },
    mode: "observe",
    actualFiles: [{ path: "src/payments/retry.js" }],
    advisories: [],
    maxAttempts: 2,
  });
  const markdown = renderReceiptComment(receipt);
  assert.match(markdown, /ChangePlane · Revision and scope recorded/u);
  assert.match(markdown, /No automated test was required.*not evidence that the code works/su);
  assert.doesNotMatch(markdown, /All configured guarantees passed/u);
  const passport = buildAssurancePassport(receipt);
  assert.equal(passport.decision.assuranceLevel, "SCOPE_ONLY");
  assert.equal(passport.decision.behavioralEvidencePassed, false);
  assert.equal(headCheckPayload(receipt, markdown).output.title, "Revision and scope recorded · observe");
});

test("publishes merge-queue assurance on the merge-group SHA", () => {
  const baseSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const receipt = buildMergeGroupReceipt({
    repository: "acme/payments",
    repositoryId: 4242,
    target: {
      baseRef: "refs/heads/main",
      headRef: "refs/heads/gh-readonly-queue/main/pr-42",
      baseSha,
      headSha,
      actualFiles: [{ path: "src/payments/retry.js" }],
    },
    plan: { scope: ["src/payments/retry.js"] },
    policyPath: ".changeplane.json",
    policyDigest: "c".repeat(64),
    inputDigest: "d".repeat(64),
    contractDigest: "e".repeat(64),
    result: { approval: { status: "MISSING" }, reasons: [] },
    evidence: [{
      name: "test",
      expectedSource: "github-actions",
      source: "github-actions",
      checkRunId: 808,
      publisherAppId: 15368,
      status: "COMPLETED",
      conclusion: "SUCCESS",
      completedAt: "2026-08-20T00:01:00Z",
    }],
    autonomousPlan: { decision: "PASS", reason: "ALL_GUARANTEES_SATISFIED", humanRequired: false },
    mode: "enforce",
  });
  const markdown = renderMergeGroupReceipt(receipt);
  const check = headCheckPayload(receipt, markdown);
  assert.equal(receipt.policy.sourceRevision, baseSha);
  assert.equal(check.head_sha, headSha);
  assert.equal(check.name, "ChangePlane / guard");
  assert.equal(check.conclusion, "success");
  assert.match(check.external_id, /merge-group/u);
  assert.match(markdown, /Merge queue revision.*bbbbbbbbbbbb.*Trusted default-branch base.*aaaaaaaaaaaa.*No repair|GitHub still owns queue and merge decisions/su);
  assert.match(markdown, /changeplane-assurance-passport:v1.*Assurance passport.*integrity only until verified against this live GitHub Check/su);
  const passport = buildAssurancePassport(receipt);
  assert.equal(passport.target.type, "merge_group");
  assert.equal(passport.target.pullRequestNumber, null);
  assert.equal(passport.target.headSha, headSha);
});
