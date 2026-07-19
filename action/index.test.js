import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  canonicalJson,
  buildReceipt,
  checkDiagnostic,
  discoverPreview,
  discoverOpenPullRequestOverlaps,
  digest,
  eligibleReviewCandidates,
  headCheckPayload,
  inferPlan,
  githubRetryDelayMs,
  parseBoundReceipt,
  parseAgentDispatch,
  parseMode,
  parsePlan,
  parseRemediationComments,
  renderReceiptComment,
  resolvePullRequestNumber,
  sanitizePreviewUrl,
  validateAgentWebhookUrl,
} from "./index.js";

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

test("renders an exact revision-bound observe receipt with one next actor", () => {
  const receipt = buildReceipt({
    repository: "acme/payments",
    pullRequest: {
      number: 42,
      base: { sha: "a".repeat(40) },
      head: { sha: "b".repeat(40) },
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
    evidence: [{ name: "validate", status: "COMPLETED", conclusion: "SUCCESS" }],
    preview: {
      status: "READY",
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
  });
  const markdown = renderReceiptComment(receipt);
  assert.match(markdown, /changeplane-receipt:v2/);
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
  assert.match(markdown, /https:\/\/preview\.example\/pr\/42.*Preview.*exact head/);
  assert.match(markdown, /Preview provenance.*deployment.*11.*status.*101.*deploy-bot.*deploy:preview.*environment override.*Pull request 42.*informational only/s);
  assert.match(markdown, /Concurrent change risk.*#43.*Retry worker.*src\/payments\/retry\.js.*Advisory only/s);
  assert.equal(receipt.preview.deploymentId, 11);

  const check = headCheckPayload(receipt, markdown);
  assert.equal(check.head_sha, "b".repeat(40));
  assert.equal(check.conclusion, "neutral");
  assert.equal(check.name, "ChangePlane / guard");
  assert.match(check.output.summary, /https:\/\/preview\.example\/pr\/42/);
  assert.match(renderReceiptComment({ ...receipt, preview: { status: "MISSING" } }), /Not published for this revision \(advisory\)/);
});

test("reads only the trusted revision-bound receipt marker", () => {
  const body = `<!-- changeplane-receipt:v2 contract=${"a".repeat(64)} input=${"b".repeat(64)} head=${"c".repeat(40)} -->`;
  assert.deepEqual(parseBoundReceipt([
    { user: { login: "octocat" }, body },
    { user: { login: "github-actions[bot]" }, body },
  ]), {
    contractDigest: "a".repeat(64),
    inputDigest: "b".repeat(64),
    headSha: "c".repeat(40),
  });
});

test("labels an empty-evidence PASS as scope-only assurance", () => {
  const receipt = buildReceipt({
    repository: "acme/payments",
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
  assert.equal(headCheckPayload(receipt, markdown).output.title, "Revision and scope recorded · observe");
});

test("round-trips an automatic contract only from the trusted receipt author", () => {
  const plan = { goal: "Prevent duplicate charges", scope: ["src/payments/retry.js"] };
  const encoded = Buffer.from(canonicalJson(plan)).toString("base64url");
  const body = [
    `<!-- changeplane-receipt:v2 contract=${digest(plan)} input=${"b".repeat(64)} head=${"c".repeat(40)} -->`,
    `<!-- changeplane-contract:v1 source=first-head plan=${encoded} -->`,
  ].join("\n");
  assert.deepEqual(parseBoundReceipt([{ user: { login: "github-actions[bot]" }, body }]), {
    contractDigest: digest(plan),
    inputDigest: "b".repeat(64),
    headSha: "c".repeat(40),
    contractSource: "first-head",
    plan,
  });
});
