import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import {
  buildTrustedRepairCandidate,
  claimDeliveryId,
  claimTrustedRepair,
  createGitHubAppJwt,
  createInstallationAccessToken,
  createSecretsWriteInstallationAccessToken,
  deriveControllerSecret,
  issueTrustedRepairPushToken,
  publishTrustedRepair,
  repairLedgerReference,
  signClaimRequest,
  validateTrustedRepair,
  signControllerRequest,
  verifyClaimRequest,
  verifyControllerRequest,
} from "../server/github-repair-controller.js";
import {
  canonicalJson,
  repairLedgerKeyId,
  repairLedgerPublicKeyValue,
} from "../server/repair-ledger.js";
import { authorizeRepairGrant } from "../examples/changeplane-claim.js";

const APP_ID = 101;
const INSTALLATION_ID = 202;
const REPOSITORY_ID = 303;
const PULL_REQUEST_ID = 404;
const PULL_REQUEST_NUMBER = 42;
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const NEXT_HEAD_SHA = "f".repeat(40);
const RELEASE_SHA = "c".repeat(40);
const REPOSITORY = "acme/payments";

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function fixtureRequest() {
  const contract = { scope: ["src/payments/**"], goal: null };
  const plan = { scope: contract.scope };
  const files = [{ path: "docs/oops.md" }];
  const policy = {
    version: 1,
    protectedPaths: { requireApproval: [".github/**"], block: ["secrets/**"] },
    evidence: { requiredChecks: [] },
  };
  const authority = {
    contractDigest: digest(plan),
    policyDigest: digest(policy),
    evaluatorVersion: "0.4.0",
    inputDigest: digest({ plan, files }),
    controllerSha: BASE_SHA,
    policyPath: ".changeplane.json",
  };
  const idempotencyKey = digest({
    repository: REPOSITORY,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    headSha: HEAD_SHA,
    inputDigest: authority.inputDigest,
    attempt: 1,
  });
  return {
    policy,
    request: {
      schemaVersion: 3,
      issuer: "changeplane-guard",
      idempotencyKey,
      change: {
        repository: REPOSITORY,
        repositoryId: REPOSITORY_ID,
        installationId: INSTALLATION_ID,
        pullRequestNumber: PULL_REQUEST_NUMBER,
        baseRef: "main",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        headRef: "agent/fix",
        headRepository: REPOSITORY,
      },
      authority,
      contract,
      attempt: 1,
      repairKind: "scope",
      allowedPaths: ["docs/oops.md"],
      instructions: [{
        code: "OUTSIDE_PLANNED_SCOPE",
        path: "docs/oops.md",
        pathKind: "current",
        action: "REVERT_OR_MOVE_INTO_DECLARED_SCOPE",
      }],
    },
  };
}

function automaticFixture({
  contract,
  files,
  policy,
  repairKind,
  allowedPaths,
  instructions,
  attempt = 1,
  headSha = HEAD_SHA,
}) {
  const plan = { scope: contract.scope, ...(contract.goal ? { goal: contract.goal } : {}) };
  const authority = {
    contractDigest: digest(plan),
    policyDigest: digest(policy),
    evaluatorVersion: "0.4.0",
    inputDigest: digest({ plan, files }),
    controllerSha: BASE_SHA,
    policyPath: ".changeplane.json",
  };
  const idempotencyKey = digest({
    repository: REPOSITORY,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    headSha,
    inputDigest: authority.inputDigest,
    attempt,
  });
  return {
    policy,
    request: {
      schemaVersion: 3,
      issuer: "changeplane-guard",
      idempotencyKey,
      change: {
        repository: REPOSITORY,
        repositoryId: REPOSITORY_ID,
        installationId: INSTALLATION_ID,
        pullRequestNumber: PULL_REQUEST_NUMBER,
        baseRef: "main",
        baseSha: BASE_SHA,
        headSha,
        headRef: "agent/fix",
        headRepository: REPOSITORY,
      },
      authority,
      contract,
      attempt,
      repairKind,
      allowedPaths,
      instructions,
    },
  };
}

function ledgerPublicKeys(privateKey) {
  const publicKey = createPublicKey(privateKey);
  const keyId = repairLedgerKeyId(publicKey);
  return { [keyId]: repairLedgerPublicKeyValue(publicKey) };
}

function sha(counter) {
  return counter.toString(16).padStart(40, "0");
}

function fakeGitHub(policy, {
  failDispatchResponseOnce = false,
  failDispatchBeforeAcceptOnce = false,
  failLedgerAnchorOnce = false,
  loseLedgerAnchorResponseOnce = false,
  losePushTokenResponseOnce = false,
  pullRequestBody = '<!-- changeplane\n{"scope":["src/payments/**"]}\n-->',
  pullRequestTitle = "Repair payment scope",
  pullRequestFiles = [{ filename: "docs/oops.md" }],
  pullRequestHeadSha = HEAD_SHA,
  issueComments = [],
  initialChecks = [],
} = {}) {
  let objectCounter = 1;
  let checkCounter = Math.max(0, ...initialChecks.map((check) => check.id ?? 0)) + 1;
  const refs = new Map();
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const checks = structuredClone(initialChecks);
  const dispatches = [];
  const tokenRequests = [];
  const workflowRuns = new Map();
  const requests = [];
  let livePullRequestBody = pullRequestBody;
  let livePullRequestTitle = pullRequestTitle;
  let livePullRequestFiles = structuredClone(pullRequestFiles);
  let livePullRequestHeadSha = pullRequestHeadSha;

  function error(status, message) {
    const value = new Error(message);
    value.status = status;
    return value;
  }

  const request = async (path, token, options = {}) => {
    const method = options.method ?? "GET";
    requests.push({ method, path });
    if (path === `/app/installations/${INSTALLATION_ID}/access_tokens` && method === "POST") {
      tokenRequests.push(structuredClone(options.body));
      const contentsOnly = canonicalJson(options.body.permissions) === canonicalJson({ contents: "write" });
      if (contentsOnly && losePushTokenResponseOnce) {
        losePushTokenResponseOnce = false;
        throw error(504, "push credential response lost");
      }
      return {
        token: contentsOnly ? "ghs_contents_only_secret_token" : "installation-token",
        expires_at: "2026-07-19T01:00:00.000Z",
        repositories: [{ id: REPOSITORY_ID }],
      };
    }
    if (path === `/repositories/${REPOSITORY_ID}`) {
      return { id: REPOSITORY_ID, full_name: REPOSITORY, default_branch: "main", archived: false, disabled: false };
    }
    if (path === `/repos/acme/payments/pulls/${PULL_REQUEST_NUMBER}`) {
      return {
        id: PULL_REQUEST_ID,
        number: PULL_REQUEST_NUMBER,
        state: "open",
        changed_files: livePullRequestFiles.length,
        body: livePullRequestBody,
        title: livePullRequestTitle,
        base: { ref: "main", sha: BASE_SHA },
        head: { ref: "agent/fix", sha: livePullRequestHeadSha, repo: { full_name: REPOSITORY } },
      };
    }
    if (path === "/repos/acme/payments/git/ref/heads/main") return { object: { sha: BASE_SHA } };
    if (path.startsWith("/repos/acme/payments/contents/.changeplane.json?")) {
      return { type: "file", encoding: "base64", content: Buffer.from(JSON.stringify(policy)).toString("base64") };
    }
    if (path === `/repos/acme/payments/pulls/${PULL_REQUEST_NUMBER}/files?per_page=100&page=1`) {
      return structuredClone(livePullRequestFiles);
    }
    if (path === `/repos/acme/payments/issues/${PULL_REQUEST_NUMBER}/comments?per_page=100&page=1`) {
      return structuredClone(issueComments);
    }
    if (path.includes("/commits/") && path.includes("/check-runs?")) {
      const head = path.split("/commits/")[1].split("/check-runs")[0];
      return { check_runs: checks.filter((check) => check.head_sha === head) };
    }
    if (path === `/repos/acme/payments/commits/${HEAD_SHA}/status?per_page=100`) return { statuses: [] };
    if (path === "/repos/acme/payments/check-runs" && method === "POST") {
      if (options.body.name === "ChangePlane / repair ledger" && failLedgerAnchorOnce) {
        failLedgerAnchorOnce = false;
        throw error(503, "ledger anchor unavailable");
      }
      const check = { id: checkCounter++, app: { id: APP_ID }, ...structuredClone(options.body) };
      checks.push(check);
      if (options.body.name === "ChangePlane / repair ledger" && loseLedgerAnchorResponseOnce) {
        loseLedgerAnchorResponseOnce = false;
        throw error(504, "ledger anchor response lost");
      }
      return check;
    }
    if (path === "/repos/acme/payments/git/blobs" && method === "POST") {
      const id = sha(objectCounter++);
      blobs.set(id, Buffer.from(options.body.content).toString("base64"));
      return { sha: id };
    }
    if (path === "/repos/acme/payments/git/trees" && method === "POST") {
      const id = sha(objectCounter++);
      trees.set(id, structuredClone(options.body.tree));
      return { sha: id };
    }
    if (path === "/repos/acme/payments/git/commits" && method === "POST") {
      const id = sha(objectCounter++);
      commits.set(id, { tree: { sha: options.body.tree }, parents: options.body.parents.map((parent) => ({ sha: parent })) });
      return { sha: id };
    }
    if (path === "/repos/acme/payments/git/refs" && method === "POST") {
      if (refs.has(options.body.ref)) throw error(422, "ref exists");
      refs.set(options.body.ref, options.body.sha);
      return { ref: options.body.ref, object: { sha: options.body.sha } };
    }
    if (path.startsWith("/repos/acme/payments/git/ref/") && method === "GET") {
      const reference = `refs/${decodeURIComponent(path.split("/git/ref/")[1])}`;
      if (!refs.has(reference)) throw error(404, "missing ref");
      return { ref: reference, object: { sha: refs.get(reference) } };
    }
    if (path.startsWith("/repos/acme/payments/git/refs/") && method === "PATCH") {
      const reference = `refs/${decodeURIComponent(path.split("/git/refs/")[1])}`;
      const current = refs.get(reference);
      const commit = commits.get(options.body.sha);
      if (!current || commit?.parents?.[0]?.sha !== current || options.body.force !== false) throw error(422, "CAS conflict");
      refs.set(reference, options.body.sha);
      return { ref: reference, object: { sha: options.body.sha } };
    }
    if (path.startsWith("/repos/acme/payments/git/commits/") && method === "GET") {
      const commit = commits.get(path.split("/git/commits/")[1]);
      if (!commit) throw error(404, "missing commit");
      return commit;
    }
    if (path.startsWith("/repos/acme/payments/git/trees/") && method === "GET") {
      const tree = trees.get(path.split("/git/trees/")[1]);
      return { tree };
    }
    if (path.startsWith("/repos/acme/payments/git/blobs/") && method === "GET") {
      return { encoding: "base64", content: blobs.get(path.split("/git/blobs/")[1]) };
    }
    if (path === "/repos/acme/payments/dispatches" && method === "POST") {
      if (failDispatchBeforeAcceptOnce) {
        failDispatchBeforeAcceptOnce = false;
        throw error(503, "dispatch unavailable before accept");
      }
      dispatches.push(structuredClone(options.body));
      if (failDispatchResponseOnce) {
        failDispatchResponseOnce = false;
        throw error(504, "dispatch response lost");
      }
      return null;
    }
    if (path.startsWith("/repos/acme/payments/actions/runs/")) {
      return workflowRuns.get(Number(path.split("/").at(-1)));
    }
    throw new Error(`Unhandled fake GitHub request: ${method} ${path}`);
  };
  const setPullRequest = ({ body, title, files, headSha } = {}) => {
    if (body !== undefined) livePullRequestBody = body;
    if (title !== undefined) livePullRequestTitle = title;
    if (files !== undefined) livePullRequestFiles = structuredClone(files);
    if (headSha !== undefined) livePullRequestHeadSha = headSha;
  };
  return { request, refs, commits, checks, dispatches, tokenRequests, workflowRuns, requests, setPullRequest };
}

async function claimedRepairFixture({ claimGrant = true, ...githubOptions } = {}) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { policy, request } = fixtureRequest();
  const github = fakeGitHub(policy, githubOptions);
  const published = await publishTrustedRepair({
    controllerRequest: request,
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
    now: new Date("2026-07-19T00:00:00.000Z"),
  });
  github.workflowRuns.set(9001, {
    id: 9001,
    run_attempt: 1,
    event: "repository_dispatch",
    head_sha: BASE_SHA,
    repository: { id: REPOSITORY_ID },
    path: ".github/workflows/changeplane-repair.yml@refs/heads/main",
    status: "in_progress",
    actor: { login: "changeplane-test[bot]" },
    triggering_actor: { login: "changeplane-test[bot]" },
  });
  const envelope = github.dispatches[0].client_payload;
  const claim = {
    schemaVersion: 1,
    issuer: "changeplane-repair-worker",
    authorizationId: envelope.entry.authorizationId,
    grantDigest: published.grantDigest,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    installationId: INSTALLATION_ID,
    pullRequestId: PULL_REQUEST_ID,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    contractDigest: request.authority.contractDigest,
    generation: 1,
    baseSha: BASE_SHA,
    workflowRunId: 9001,
    workflowRunAttempt: 1,
  };
  if (claimGrant) {
    await claimTrustedRepair({
      claimRequest: claim,
      appId: APP_ID,
      privateKey,
      generation: 1,
      enabled: true,
      expectedRepository: REPOSITORY,
      expectedPublisherReleaseSha: RELEASE_SHA,
      expectedActorLogin: "changeplane-test[bot]",
      request: github.request,
      now: new Date("2026-07-19T00:01:00.000Z"),
    });
  }
  return { claim, github, privateKey, published, request };
}

test("GitHub App JWT and repository token stay narrowly scoped", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = createGitHubAppJwt({ appId: APP_ID, privateKey, now: Date.parse("2026-07-19T00:00:00.000Z") });
  const [header, payload, signature] = jwt.split(".");
  assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).iss, String(APP_ID));

  const { policy } = fixtureRequest();
  const github = fakeGitHub(policy);
  await createInstallationAccessToken({
    appId: APP_ID,
    privateKey,
    installationId: INSTALLATION_ID,
    repositoryId: REPOSITORY_ID,
    request: github.request,
    now: Date.parse("2026-07-19T00:00:00.000Z"),
  });
  assert.deepEqual(github.tokenRequests[0].repository_ids, [REPOSITORY_ID]);
  assert.deepEqual(github.tokenRequests[0].permissions, {
    actions: "read",
    checks: "write",
    contents: "write",
    pull_requests: "read",
  });

  await createSecretsWriteInstallationAccessToken({
    appId: APP_ID,
    privateKey,
    installationId: INSTALLATION_ID,
    repositoryId: REPOSITORY_ID,
    request: github.request,
    now: Date.parse("2026-07-19T00:00:00.000Z"),
  });
  assert.deepEqual(github.tokenRequests[1], {
    repository_ids: [REPOSITORY_ID],
    permissions: { secrets: "write" },
  });
});

test("automatic first-head contract authorizes bounded evidence repair before its receipt exists", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const title = "Make checkout retries idempotent";
  const contract = { scope: ["src/payments/retry.js"], goal: title };
  const files = [{ path: "src/payments/retry.js" }];
  const policy = {
    version: 1,
    protectedPaths: { requireApproval: [".github/**"], block: ["secrets/**"] },
    evidence: { requiredChecks: [{ name: "checkout-race", appSlug: "github-actions" }] },
  };
  const diagnostic = "Checkout race failed\nExpected one charge, observed two";
  const { request } = automaticFixture({
    contract,
    files,
    policy,
    repairKind: "evidence",
    allowedPaths: contract.scope,
    instructions: [{
      code: "EVIDENCE_FAILED",
      path: "check:checkout-race",
      pathKind: "evidence",
      action: "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE",
      diagnostic,
    }],
  });
  const github = fakeGitHub(policy, {
    pullRequestBody: "",
    pullRequestTitle: title,
    pullRequestFiles: [{ filename: "src/payments/retry.js" }],
    initialChecks: [{
      id: 91,
      name: "checkout-race",
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "failure",
      app: { slug: "github-actions" },
      output: {
        title: "Checkout race failed",
        summary: "Expected one charge, observed two",
        annotations_count: 0,
      },
    }],
  });

  const candidate = await buildTrustedRepairCandidate({
    controllerRequest: request,
    installationToken: "installation-token",
    appId: APP_ID,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    publicKeys: ledgerPublicKeys(privateKey),
    expectedRepository: REPOSITORY,
    request: github.request,
  });

  assert.equal(candidate.repairKind, "evidence");
  assert.deepEqual(candidate.declaredScope, contract.scope);
  assert.deepEqual(candidate.allowedPaths, contract.scope);
  assert.deepEqual(candidate.instructions, [{
    code: "EVIDENCE_FAILED",
    path: "check:checkout-race",
    pathKind: "evidence",
    action: "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE",
    diagnostic,
  }]);
  assert.equal(github.requests.some(({ path }) => path.includes("/comments?")), false);
});

test("automatic repair fails closed when the contract includes protected evidence source", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const title = "Update checkout evidence";
  const contract = { scope: ["tests/checkout-race.test.js"], goal: title };
  const files = [{ path: "tests/checkout-race.test.js" }];
  const policy = {
    version: 1,
    protectedPaths: { requireApproval: [".github/**"], block: ["secrets/**"] },
    evidence: { requiredChecks: [{ name: "checkout-race", appSlug: "github-actions" }] },
  };
  const { request } = automaticFixture({
    contract,
    files,
    policy,
    repairKind: "evidence",
    allowedPaths: contract.scope,
    instructions: [{
      code: "EVIDENCE_FAILED",
      path: "check:checkout-race",
      pathKind: "evidence",
      action: "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE",
      diagnostic: "Checkout race failed",
    }],
  });
  const github = fakeGitHub(policy, {
    pullRequestBody: "",
    pullRequestTitle: title,
    pullRequestFiles: [{ filename: "tests/checkout-race.test.js" }],
    initialChecks: [{
      id: 95,
      name: "checkout-race",
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "failure",
      app: { slug: "github-actions" },
      output: { title: "Checkout race failed", annotations_count: 0 },
    }],
  });

  await assert.rejects(buildTrustedRepairCandidate({
    controllerRequest: request,
    installationToken: "installation-token",
    appId: APP_ID,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    publicKeys: ledgerPublicKeys(privateKey),
    expectedRepository: REPOSITORY,
    request: github.request,
  }), /no longer authorizes autonomous repair/u);
});

test("github-actions bot comments cannot authorize an automatic contract", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const title = "Make checkout retries idempotent";
  const plan = { scope: ["src/payments/retry.js"], goal: title };
  const files = [{ path: "src/payments/retry.js" }, { path: "docs/oops.md" }];
  const policy = {
    version: 1,
    protectedPaths: { requireApproval: [".github/**"], block: ["secrets/**"] },
    evidence: { requiredChecks: [] },
  };
  const { request } = automaticFixture({
    contract: plan,
    files,
    policy,
    repairKind: "scope",
    allowedPaths: ["docs/oops.md"],
    instructions: [{
      code: "OUTSIDE_PLANNED_SCOPE",
      path: "docs/oops.md",
      pathKind: "current",
      action: "REVERT_OR_MOVE_INTO_DECLARED_SCOPE",
    }],
  });
  const github = fakeGitHub(policy, {
    pullRequestBody: "",
    pullRequestTitle: title,
    pullRequestFiles: [{ filename: "src/payments/retry.js" }, { filename: "docs/oops.md" }],
    issueComments: [{
      user: { login: "github-actions[bot]" },
      body: [
        `<!-- changeplane-receipt:v2 contract=${digest(plan)} input=${"d".repeat(64)} head=${"e".repeat(40)} -->`,
        `<!-- changeplane-contract:v1 source=first-head plan=${Buffer.from(canonicalJson(plan)).toString("base64url")} -->`,
      ].join("\n"),
    }],
  });

  await assert.rejects(buildTrustedRepairCandidate({
    controllerRequest: request,
    installationToken: "installation-token",
    appId: APP_ID,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    publicKeys: ledgerPublicKeys(privateKey),
    expectedRepository: REPOSITORY,
    request: github.request,
  }), /first-head automatic contract/u);
  assert.equal(github.requests.some(({ path }) => path.includes("/comments?")), false);
});

test("signed generation ledger preserves the first-head contract across a later head", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const title = "Make checkout retries idempotent";
  const contract = { scope: ["src/payments/retry.js"], goal: title };
  const files = [{ path: "src/payments/retry.js" }];
  const policy = {
    version: 1,
    protectedPaths: { requireApproval: [".github/**"], block: ["secrets/**"] },
    evidence: { requiredChecks: [{ name: "checkout-race", appSlug: "github-actions" }] },
  };
  const instructions = [{
    code: "EVIDENCE_FAILED",
    path: "check:checkout-race",
    pathKind: "evidence",
    action: "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE",
    diagnostic: "Checkout race failed",
  }];
  const first = automaticFixture({
    contract,
    files,
    policy,
    repairKind: "evidence",
    allowedPaths: contract.scope,
    instructions,
  });
  const github = fakeGitHub(policy, {
    pullRequestBody: "",
    pullRequestTitle: title,
    pullRequestFiles: [{ filename: "src/payments/retry.js" }],
    initialChecks: [{
      id: 92,
      name: "checkout-race",
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "failure",
      app: { slug: "github-actions" },
      output: { title: "Checkout race failed", annotations_count: 0 },
    }],
  });

  const options = {
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
  };
  const firstPublished = await publishTrustedRepair({
    ...options,
    controllerRequest: first.request,
    now: new Date("2026-07-19T00:00:00.000Z"),
  });
  assert.equal(firstPublished.attempt, 1);

  github.setPullRequest({ headSha: NEXT_HEAD_SHA });
  github.checks.push({
    id: 191,
    name: "checkout-race",
    head_sha: NEXT_HEAD_SHA,
    status: "completed",
    conclusion: "failure",
    app: { slug: "github-actions" },
    output: { title: "Checkout race failed", annotations_count: 0 },
  });
  const second = automaticFixture({
    contract,
    files,
    policy,
    repairKind: "evidence",
    allowedPaths: contract.scope,
    instructions,
    attempt: 2,
    headSha: NEXT_HEAD_SHA,
  });
  const secondPublished = await publishTrustedRepair({
    ...options,
    controllerRequest: second.request,
    now: new Date("2026-07-19T00:01:00.000Z"),
  });

  assert.equal(secondPublished.attempt, 2);
  assert.equal(github.dispatches.length, 2);
  assert.equal(github.requests.some(({ path }) => path.includes("/comments?")), false);
});

test("signed generation ledger rejects rebinding to an expanded contract", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const title = "Make checkout retries idempotent";
  const firstContract = { scope: ["src/payments/retry.js"], goal: title };
  const firstFiles = [{ path: "src/payments/retry.js" }];
  const policy = {
    version: 1,
    protectedPaths: { requireApproval: [".github/**"], block: ["secrets/**"] },
    evidence: { requiredChecks: [{ name: "checkout-race", appSlug: "github-actions" }] },
  };
  const evidenceInstruction = [{
    code: "EVIDENCE_FAILED",
    path: "check:checkout-race",
    pathKind: "evidence",
    action: "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE",
    diagnostic: "Checkout race failed",
  }];
  const first = automaticFixture({
    contract: firstContract,
    files: firstFiles,
    policy,
    repairKind: "evidence",
    allowedPaths: firstContract.scope,
    instructions: evidenceInstruction,
  });
  const github = fakeGitHub(policy, {
    pullRequestBody: "",
    pullRequestTitle: title,
    pullRequestFiles: [{ filename: "src/payments/retry.js" }],
    initialChecks: [{
      id: 93,
      name: "checkout-race",
      head_sha: HEAD_SHA,
      status: "completed",
      conclusion: "failure",
      app: { slug: "github-actions" },
      output: { title: "Checkout race failed", annotations_count: 0 },
    }],
  });
  const options = {
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
  };
  await publishTrustedRepair({
    ...options,
    controllerRequest: first.request,
    now: new Date("2026-07-19T00:00:00.000Z"),
  });

  const expandedContract = { scope: ["docs/oops.md", "src/payments/retry.js"], goal: title };
  const expandedFiles = [{ path: "src/payments/retry.js" }, { path: "docs/oops.md" }];
  github.setPullRequest({
    headSha: NEXT_HEAD_SHA,
    files: [{ filename: "src/payments/retry.js" }, { filename: "docs/oops.md" }],
  });
  github.checks.push({
    id: 192,
    name: "checkout-race",
    head_sha: NEXT_HEAD_SHA,
    status: "completed",
    conclusion: "failure",
    app: { slug: "github-actions" },
    output: { title: "Checkout race failed", annotations_count: 0 },
  });
  const expanded = automaticFixture({
    contract: expandedContract,
    files: expandedFiles,
    policy,
    repairKind: "evidence",
    allowedPaths: expandedContract.scope,
    instructions: evidenceInstruction,
    attempt: 2,
    headSha: NEXT_HEAD_SHA,
  });

  await assert.rejects(publishTrustedRepair({
    ...options,
    controllerRequest: expanded.request,
    now: new Date("2026-07-19T00:01:00.000Z"),
  }), /ledger document identity/u);
  assert.equal(github.dispatches.length, 1);
  assert.equal(github.requests.some(({ path }) => path.includes("/comments?")), false);
});

test("controller and claim HMACs are repository-bound and tamper evident", () => {
  const { request } = fixtureRequest();
  const secret = deriveControllerSecret({
    masterSecret: "m".repeat(64),
    installationId: INSTALLATION_ID,
    repositoryId: REPOSITORY_ID,
    repository: REPOSITORY,
  });
  const deliveryId = request.idempotencyKey;
  const signature = signControllerRequest({ secret, deliveryId, request });
  assert.equal(verifyControllerRequest({ secret, deliveryId, signature, request }), request);
  assert.throws(() => verifyControllerRequest({ secret, deliveryId, signature, request: { ...request, attempt: 2 } }), /signature/u);

  const claim = {
    schemaVersion: 1,
    issuer: "changeplane-repair-worker",
    authorizationId: request.idempotencyKey,
    grantDigest: "9".repeat(64),
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    installationId: INSTALLATION_ID,
    pullRequestId: PULL_REQUEST_ID,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    contractDigest: request.authority.contractDigest,
    generation: 1,
    baseSha: BASE_SHA,
    workflowRunId: 9001,
    workflowRunAttempt: 1,
  };
  const claimDelivery = claimDeliveryId(claim);
  const claimSignature = signClaimRequest({ secret, deliveryId: claimDelivery, request: claim });
  assert.equal(verifyClaimRequest({ secret, deliveryId: claimDelivery, signature: claimSignature, request: claim }), claim);
});

test("publisher persists one signed grant, anchors every tip, and server-claims once", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { policy, request } = fixtureRequest();
  const github = fakeGitHub(policy);
  const now = new Date("2026-07-19T00:00:00.000Z");
  const published = await publishTrustedRepair({
    controllerRequest: request,
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
    now,
  });
  assert.equal(published.attempt, 1);
  assert.equal(published.dispatched, true);
  assert.equal(github.dispatches.length, 1);
  assert.equal(github.checks.some((check) => check.name === "ChangePlane / repair grant" && check.head_sha === HEAD_SHA), true);
  assert.equal(github.checks.filter((check) => check.name === "ChangePlane / repair ledger").length, 2);

  await assert.rejects(publishTrustedRepair({
    controllerRequest: request,
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
    now: new Date("2026-07-19T00:01:00.000Z"),
  }), /reservation is already consumed or ambiguous/u);
  assert.equal(github.dispatches.length, 1);

  github.workflowRuns.set(9001, {
    id: 9001,
    run_attempt: 1,
    event: "repository_dispatch",
    head_sha: BASE_SHA,
    repository: { id: REPOSITORY_ID },
    path: ".github/workflows/changeplane-repair.yml@refs/heads/main",
    status: "in_progress",
    actor: { login: "changeplane-test[bot]" },
    triggering_actor: { login: "changeplane-test[bot]" },
  });
  const envelope = github.dispatches[0].client_payload;
  const claim = {
    schemaVersion: 1,
    issuer: "changeplane-repair-worker",
    authorizationId: envelope.entry.authorizationId,
    grantDigest: published.grantDigest,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    installationId: INSTALLATION_ID,
    pullRequestId: PULL_REQUEST_ID,
    pullRequestNumber: PULL_REQUEST_NUMBER,
    contractDigest: request.authority.contractDigest,
    generation: 1,
    baseSha: BASE_SHA,
    workflowRunId: 9001,
    workflowRunAttempt: 1,
  };
  const claimed = await claimTrustedRepair({
    claimRequest: claim,
    appId: APP_ID,
    privateKey,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    expectedPublisherReleaseSha: RELEASE_SHA,
    expectedActorLogin: "changeplane-test[bot]",
    request: github.request,
    now: new Date("2026-07-19T00:02:00.000Z"),
  });
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.replayed, false);
  const validation = await validateTrustedRepair({
    claimRequest: claim,
    appId: APP_ID,
    privateKey,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    expectedPublisherReleaseSha: RELEASE_SHA,
    expectedActorLogin: "changeplane-test[bot]",
    request: github.request,
    now: new Date("2026-07-19T00:02:30.000Z"),
  });
  assert.equal(validation.valid, true);
  await assert.rejects(claimTrustedRepair({
    claimRequest: claim,
    appId: APP_ID,
    privateKey,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    expectedPublisherReleaseSha: RELEASE_SHA,
    expectedActorLogin: "changeplane-test[bot]",
    request: github.request,
    now: new Date("2026-07-19T00:03:00.000Z"),
  }), /already claimed/u);

  const reference = repairLedgerReference({ pullRequestId: PULL_REQUEST_ID, generation: 1 });
  const currentTip = github.refs.get(reference);
  github.refs.set(reference, github.commits.get(currentTip).parents[0].sha);
  await assert.rejects(publishTrustedRepair({
    controllerRequest: request,
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
    now: new Date("2026-07-19T00:04:00.000Z"),
  }), /App-authored anchor/u);
});

test("claimed grant mints one exact-repository Contents-only push credential", async () => {
  const fixture = await claimedRepairFixture();
  const options = {
    claimRequest: fixture.claim,
    appId: APP_ID,
    privateKey: fixture.privateKey,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    expectedPublisherReleaseSha: RELEASE_SHA,
    expectedActorLogin: "changeplane-test[bot]",
    request: fixture.github.request,
  };
  const issued = await issueTrustedRepairPushToken({
    ...options,
    now: new Date("2026-07-19T00:02:00.000Z"),
  });

  assert.equal(issued.token, "ghs_contents_only_secret_token");
  assert.equal(issued.repository, REPOSITORY);
  assert.equal(issued.repositoryId, REPOSITORY_ID);
  assert.equal(issued.headSha, HEAD_SHA);
  assert.equal(issued.headRef, "agent/fix");
  assert.deepEqual(fixture.github.tokenRequests.at(-1), {
    repository_ids: [REPOSITORY_ID],
    permissions: { contents: "write" },
  });
  assert.equal(fixture.github.checks.filter((check) => check.name === "ChangePlane / repair ledger").length, 4);
  const reference = repairLedgerReference({ pullRequestId: PULL_REQUEST_ID, generation: 1 });
  const tip = fixture.github.commits.get(fixture.github.refs.get(reference));
  const tree = await fixture.github.request(`/repos/acme/payments/git/trees/${tip.tree.sha}`, "reader");
  const blobSha = tree.tree.find((item) => item.path === "ledger.json").sha;
  const blob = await fixture.github.request(`/repos/acme/payments/git/blobs/${blobSha}`, "reader");
  assert.equal(Buffer.from(blob.content, "base64").toString("utf8").includes(issued.token), false);

  await assert.rejects(issueTrustedRepairPushToken({
    ...options,
    now: new Date("2026-07-19T00:03:00.000Z"),
  }), /already reserved|refusing to re-mint/u);
  assert.equal(fixture.github.tokenRequests.filter(({ permissions }) => canonicalJson(permissions) === canonicalJson({ contents: "write" })).length, 1);
});

test("unclaimed signed grant cannot mint a push credential", async () => {
  const fixture = await claimedRepairFixture({ claimGrant: false });
  await assert.rejects(issueTrustedRepairPushToken({
    claimRequest: fixture.claim,
    appId: APP_ID,
    privateKey: fixture.privateKey,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    expectedPublisherReleaseSha: RELEASE_SHA,
    expectedActorLogin: "changeplane-test[bot]",
    request: fixture.github.request,
    now: new Date("2026-07-19T00:01:00.000Z"),
  }), /has not been claimed/u);
  assert.equal(fixture.github.tokenRequests.some(({ permissions }) => canonicalJson(permissions) === canonicalJson({ contents: "write" })), false);
});

test("push credential mint fails closed for disabled, wrong-generation, and stale grants", async () => {
  const fixture = await claimedRepairFixture();
  const options = {
    claimRequest: fixture.claim,
    appId: APP_ID,
    privateKey: fixture.privateKey,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    expectedPublisherReleaseSha: RELEASE_SHA,
    expectedActorLogin: "changeplane-test[bot]",
    request: fixture.github.request,
    now: new Date("2026-07-19T00:02:00.000Z"),
  };
  await assert.rejects(issueTrustedRepairPushToken({ ...options, enabled: false }), /kill switch/u);
  await assert.rejects(issueTrustedRepairPushToken({ ...options, generation: 2 }), /generation/u);
  fixture.github.setPullRequest({ headSha: NEXT_HEAD_SHA });
  await assert.rejects(issueTrustedRepairPushToken(options), /live pull-request revision/u);
  assert.equal(fixture.github.tokenRequests.some(({ permissions }) => canonicalJson(permissions) === canonicalJson({ contents: "write" })), false);
});

test("lost push-token response burns the signed reservation and cannot re-mint", async () => {
  const fixture = await claimedRepairFixture({ losePushTokenResponseOnce: true });
  const options = {
    claimRequest: fixture.claim,
    appId: APP_ID,
    privateKey: fixture.privateKey,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    expectedPublisherReleaseSha: RELEASE_SHA,
    expectedActorLogin: "changeplane-test[bot]",
    request: fixture.github.request,
  };
  await assert.rejects(issueTrustedRepairPushToken({
    ...options,
    now: new Date("2026-07-19T00:02:00.000Z"),
  }), /response lost/u);
  await assert.rejects(issueTrustedRepairPushToken({
    ...options,
    now: new Date("2026-07-19T00:03:00.000Z"),
  }), /already reserved|refusing to re-mint/u);
  assert.equal(fixture.github.tokenRequests.filter(({ permissions }) => canonicalJson(permissions) === canonicalJson({ contents: "write" })).length, 1);
});

test("push-token client keeps rejected response bodies and credentials out of errors", async () => {
  const fixture = await claimedRepairFixture();
  const leakedToken = "ghs_response_body_must_stay_redacted";
  let responseBodyRead = false;
  await assert.rejects(authorizeRepairGrant({
    operation: "push-token",
    envelope: fixture.github.dispatches[0].client_payload,
    runId: 9001,
    runAttempt: 1,
    endpoint: "https://changeplane.example/api/github?action=repair-push-token",
    secret: "repository-scoped-secret-that-is-longer-than-thirty-two-characters",
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async json() {
        responseBodyRead = true;
        return { token: leakedToken };
      },
    }),
  }), (error) => {
    assert.doesNotMatch(error.message, new RegExp(leakedToken, "u"));
    assert.match(error.message, /refused.*\(503\)/u);
    return true;
  });
  assert.equal(responseBodyRead, false);
});

test("ledger references rotate by generation", () => {
  assert.equal(repairLedgerReference({ pullRequestId: PULL_REQUEST_ID, generation: 1 }), "refs/changeplane/repair/v3/g1/pr-404");
  assert.equal(repairLedgerReference({ pullRequestId: PULL_REQUEST_ID, generation: 2 }), "refs/changeplane/repair/v3/g2/pr-404");
});

test("dispatch reservation prevents a retry after GitHub accepts but loses the response", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { policy, request } = fixtureRequest();
  const github = fakeGitHub(policy, { failDispatchResponseOnce: true });
  const options = {
    controllerRequest: request,
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
  };
  await assert.rejects(publishTrustedRepair({ ...options, now: new Date("2026-07-19T00:00:00.000Z") }), /response lost/u);
  assert.equal(github.dispatches.length, 1);
  await assert.rejects(
    publishTrustedRepair({ ...options, now: new Date("2026-07-19T00:01:00.000Z") }),
    /reservation is already consumed or ambiguous/u,
  );
  assert.equal(github.dispatches.length, 1);
});

test("dispatch pre-accept failure burns the reservation instead of reporting success or redelivering", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { policy, request } = fixtureRequest();
  const github = fakeGitHub(policy, { failDispatchBeforeAcceptOnce: true });
  const options = {
    controllerRequest: request,
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
  };
  await assert.rejects(publishTrustedRepair({ ...options, now: new Date("2026-07-19T00:00:00.000Z") }), /before accept/u);
  assert.equal(github.dispatches.length, 0);
  await assert.rejects(
    publishTrustedRepair({ ...options, now: new Date("2026-07-19T00:01:00.000Z") }),
    /reservation is already consumed or ambiguous/u,
  );
  assert.equal(github.dispatches.length, 0);
});

test("missing-anchor reconciliation rejects a contents-writer forged claim transition", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { policy, request } = fixtureRequest();
  const github = fakeGitHub(policy);
  const options = {
    controllerRequest: request,
    appId: APP_ID,
    privateKey,
    publisherReleaseSha: RELEASE_SHA,
    generation: 1,
    enabled: true,
    expectedRepository: REPOSITORY,
    request: github.request,
  };
  const published = await publishTrustedRepair({ ...options, now: new Date("2026-07-19T00:00:00.000Z") });
  const reference = repairLedgerReference({ pullRequestId: PULL_REQUEST_ID, generation: 1 });
  const tipSha = github.refs.get(reference);
  const commit = await github.request(`/repos/acme/payments/git/commits/${tipSha}`, "writer-token");
  const tree = await github.request(`/repos/acme/payments/git/trees/${commit.tree.sha}`, "writer-token");
  const ledgerBlob = tree.tree.find((item) => item.path === "ledger.json");
  const blob = await github.request(`/repos/acme/payments/git/blobs/${ledgerBlob.sha}`, "writer-token");
  const document = JSON.parse(Buffer.from(blob.content, "base64").toString("utf8"));
  document.claims.push({
    authorizationId: published.authorizationId,
    grantDigest: published.grantDigest,
    workflowRunId: 9001,
    workflowRunAttempt: 1,
    claimedAt: "2026-07-19T00:00:30.000Z",
    signature: { algorithm: "PS256", keyId: "forged", value: "AA" },
  });
  const forgedBlob = await github.request("/repos/acme/payments/git/blobs", "writer-token", {
    method: "POST",
    body: { content: `${canonicalJson(document)}\n`, encoding: "utf-8" },
  });
  const forgedTree = await github.request("/repos/acme/payments/git/trees", "writer-token", {
    method: "POST",
    body: { tree: [{ path: "ledger.json", mode: "100644", type: "blob", sha: forgedBlob.sha }] },
  });
  const forgedCommit = await github.request("/repos/acme/payments/git/commits", "writer-token", {
    method: "POST",
    body: { message: "forged claim", tree: forgedTree.sha, parents: [tipSha] },
  });
  await github.request(`/repos/acme/payments/git/refs/${reference.replace(/^refs\//u, "")}`, "writer-token", {
    method: "PATCH",
    body: { sha: forgedCommit.sha, force: false },
  });
  await assert.rejects(
    publishTrustedRepair({ ...options, now: new Date("2026-07-19T00:01:00.000Z") }),
    /signing key is unavailable|signature verification failed/u,
  );
});

for (const [name, githubOptions, message] of [
  ["anchor creation failure", { failLedgerAnchorOnce: true }, /anchor unavailable/u],
  ["anchor response loss", { loseLedgerAnchorResponseOnce: true }, /anchor response lost/u],
]) {
  test(`publisher reconciles a valid ref after ${name}`, async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { policy, request } = fixtureRequest();
    const github = fakeGitHub(policy, githubOptions);
    const options = {
      controllerRequest: request,
      appId: APP_ID,
      privateKey,
      publisherReleaseSha: RELEASE_SHA,
      generation: 1,
      enabled: true,
      expectedRepository: REPOSITORY,
      request: github.request,
    };
    await assert.rejects(publishTrustedRepair({ ...options, now: new Date("2026-07-19T00:00:00.000Z") }), message);
    const retry = await publishTrustedRepair({ ...options, now: new Date("2026-07-19T00:01:00.000Z") });
    assert.equal(retry.dispatchReserved, true);
    assert.equal(github.dispatches.length, 1);
  });
}
