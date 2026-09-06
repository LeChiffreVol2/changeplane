import assert from "node:assert/strict";
import {
  constants,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import test from "node:test";

import {
  buildAssurancePassport,
  buildMergeGroupReceipt,
  buildReceipt,
  digest,
  renderMergeGroupReceipt,
  renderReceiptComment,
  resolveRevisionContract,
} from "../action/index.js";
import {
  GITHUB_GUARD_OIDC,
  compareGuardRunOrder,
  createChecksWriteInstallationAccessToken,
  createGuardReadInstallationAccessToken,
  decodeGuardRunMarker,
  encodeGuardRunMarker,
  guardBoundContractDigest,
  stableGuardCheckExternalId,
  validateGuardBeginBody,
  validateGuardPublishBody,
  verifyGitHubActionsOidcToken,
} from "../server/github-guard-controller.js";

const NOW = Date.parse("2026-08-31T00:00:00.000Z");
const REPOSITORY = "acme/payments";
const REPOSITORY_ID = 4242;
const INSTALLATION_ID = 4343;
const RUN_ID = 4444;
const RUN_ATTEMPT = 2;
const DEFAULT_BRANCH = "main";
const WORKFLOW_PATH = ".github/workflows/changeplane.yml";
const BASE_SHA = "a".repeat(40);
const HEAD_SHA = "b".repeat(40);
const AUDIENCE = "https://changeplane.vercel.app/guard-publisher/v1";
const EXPECTED_REF = "refs/heads/main";
const OIDC_KEY_ID = "github-actions-test-key";
const { privateKey: oidcPrivateKey, publicKey: oidcPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: otherPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

function oidcClaims(overrides = {}) {
  const nowSeconds = Math.floor(NOW / 1_000);
  return {
    iss: GITHUB_GUARD_OIDC.issuer,
    aud: AUDIENCE,
    exp: nowSeconds + 5 * 60,
    nbf: nowSeconds - 10,
    iat: nowSeconds - 10,
    repository: REPOSITORY,
    repository_id: String(REPOSITORY_ID),
    workflow_ref: `${REPOSITORY}/${WORKFLOW_PATH}@refs/heads/${DEFAULT_BRANCH}`,
    workflow_sha: BASE_SHA,
    ref: EXPECTED_REF,
    event_name: "pull_request_target",
    run_id: String(RUN_ID),
    run_attempt: String(RUN_ATTEMPT),
    jti: "d8d9d468-f55e-4bf2-87d1-3e46f6b71234",
    actor: "octocat",
    actor_id: "7",
    repository_owner: "acme",
    repository_owner_id: "8",
    repository_visibility: "private",
    ref_type: "branch",
    ref_protected: "true",
    runner_environment: "github-hosted",
    sha: BASE_SHA,
    base_ref: DEFAULT_BRANCH,
    head_ref: "agent/retry-fix",
    environment_node_id: "EN_kwDOExample",
    issuer_scope: "repository",
    repo_property_release_tier: "controlled-canary",
    sub: `repo:${REPOSITORY}:pull_request`,
    workflow: "ChangePlane",
    ...overrides,
  };
}

function jwt(payload = oidcClaims(), {
  privateKey = oidcPrivateKey,
  header = { alg: "RS256", typ: "JWT", kid: OIDC_KEY_ID },
} = {}) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PADDING,
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

function jwksFetch(publicKey = oidcPublicKey) {
  const jwk = publicKey.export({ format: "jwk" });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      async json() {
        return { keys: [{ ...jwk, kid: OIDC_KEY_ID, use: "sig", alg: "RS256", key_ops: ["verify"] }] };
      },
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function verifierInput(overrides = {}) {
  return {
    token: jwt(),
    audience: AUDIENCE,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    defaultBranch: DEFAULT_BRANCH,
    workflowPath: WORKFLOW_PATH,
    workflowSha: BASE_SHA,
    ref: EXPECTED_REF,
    allowedEventNames: ["pull_request_target", "merge_group"],
    now: NOW,
    fetchImpl: jwksFetch(),
    ...overrides,
  };
}

test("verifies an exact GitHub Actions OIDC workflow identity", async () => {
  const fetchImpl = jwksFetch();
  const claims = await verifyGitHubActionsOidcToken(verifierInput({ fetchImpl }));

  assert.deepEqual(claims, {
    issuer: GITHUB_GUARD_OIDC.issuer,
    audience: AUDIENCE,
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    workflowRef: `${REPOSITORY}/${WORKFLOW_PATH}@refs/heads/${DEFAULT_BRANCH}`,
    workflowSha: BASE_SHA,
    ref: EXPECTED_REF,
    eventName: "pull_request_target",
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    sha: BASE_SHA,
    jti: "d8d9d468-f55e-4bf2-87d1-3e46f6b71234",
    headRef: "agent/retry-fix",
    baseRef: DEFAULT_BRANCH,
  });
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, GITHUB_GUARD_OIDC.jwksUrl);
  assert.deepEqual(fetchImpl.calls[0].options, {
    headers: { accept: "application/json" },
    redirect: "error",
  });
});

test("fails closed on mismatched GitHub OIDC authority claims", async (t) => {
  const cases = [
    ["issuer", { token: jwt(oidcClaims({ iss: "https://issuer.example" })) }],
    ["audience", { token: jwt(oidcClaims({ aud: "https://attacker.example" })) }],
    ["repository", { token: jwt(oidcClaims({ repository: "evil/fork" })) }],
    ["repository id", { token: jwt(oidcClaims({ repository_id: "999" })) }],
    ["workflow branch", { token: jwt(oidcClaims({ workflow_ref: `${REPOSITORY}/${WORKFLOW_PATH}@refs/heads/feature` })) }],
    ["workflow SHA", { token: jwt(oidcClaims({ workflow_sha: "c".repeat(40) })) }],
    ["ref", { token: jwt(oidcClaims({ ref: "refs/heads/feature" })) }],
    ["event", { token: jwt(oidcClaims({ event_name: "workflow_dispatch" })) }],
    ["expired", { token: jwt(oidcClaims({ exp: Math.floor(NOW / 1_000) })) }],
    ["future", { token: jwt(oidcClaims({ iat: Math.floor(NOW / 1_000) + 120 })) }],
    ["signature", { token: jwt(oidcClaims(), { privateKey: otherPrivateKey }) }],
    ["algorithm", { token: jwt(oidcClaims(), { header: { alg: "PS256", typ: "JWT", kid: OIDC_KEY_ID } }) }],
    ["key id", { token: jwt(oidcClaims(), { header: { alg: "RS256", typ: "JWT", kid: "unknown" } }) }],
    ["unknown header", { token: jwt(oidcClaims(), { header: { alg: "RS256", typ: "JWT", kid: OIDC_KEY_ID, jku: "https://evil.example" } }) }],
    ["unknown claim", { token: jwt(oidcClaims({ attacker_claim: "ignored" })) }],
  ];

  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        verifyGitHubActionsOidcToken(verifierInput(overrides)),
        /GitHub OIDC/u,
      );
    });
  }
});

test("accepts bounded documented repository-property claims and rejects malformed signed binding claims", async (t) => {
  const accepted = await verifyGitHubActionsOidcToken(verifierInput({
    token: jwt(oidcClaims({
      environment_node_id: "EN_kwDOExample",
      issuer_scope: "repository",
      "repo_property_release tier": "production",
    })),
  }));
  assert.equal(accepted.sha, BASE_SHA);
  assert.equal(accepted.jti, "d8d9d468-f55e-4bf2-87d1-3e46f6b71234");
  assert.equal(accepted.headRef, "agent/retry-fix");
  assert.equal(accepted.baseRef, DEFAULT_BRANCH);

  const tooManyProperties = Object.fromEntries(Array.from(
    { length: 101 },
    (_, index) => [`repo_property_p${index}`, "x"],
  ));
  const cases = [
    ["missing signed SHA", { sha: undefined }],
    ["short signed SHA", { sha: "a".repeat(39) }],
    ["unsafe JTI", { jti: "unsafe jti" }],
    ["oversized JTI", { jti: "a".repeat(201) }],
    ["malformed head ref", { head_ref: "feature//unsafe" }],
    ["non-string base ref", { base_ref: 42 }],
    ["empty repository property name", { repo_property_: "x" }],
    ["oversized repository property name", { [`repo_property_${"a".repeat(76)}`]: "x" }],
    ["non-scalar repository property", { repo_property_tier: { nested: true } }],
    ["too many repository properties", tooManyProperties],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const claims = oidcClaims(overrides);
      if (overrides.sha === undefined) delete claims.sha;
      await assert.rejects(
        verifyGitHubActionsOidcToken(verifierInput({ token: jwt(claims) })),
        /GitHub OIDC/u,
      );
    });
  }
});

test("mints only a short-lived Checks-write token for one exact repository", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls = [];
  const result = await createChecksWriteInstallationAccessToken({
    appId: 101,
    privateKey,
    installationId: INSTALLATION_ID,
    repositoryId: REPOSITORY_ID,
    now: NOW,
    request: async (path, appJwt, options) => {
      calls.push({ path, appJwt, options });
      return {
        token: "ghs_checks_only_secret",
        expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
        repositories: [{ id: REPOSITORY_ID }],
        permissions: { checks: "write", metadata: "read" },
      };
    },
  });

  assert.deepEqual(result, {
    token: "ghs_checks_only_secret",
    expiresAt: new Date(NOW + 60 * 60 * 1_000).toISOString(),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/app/installations/${INSTALLATION_ID}/access_tokens`);
  assert.deepEqual(calls[0].options, {
    method: "POST",
    body: {
      repository_ids: [REPOSITORY_ID],
      permissions: { checks: "write" },
    },
  });
  const [encodedHeader, encodedPayload, encodedSignature] = calls[0].appJwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, "base64url")), { alg: "RS256", typ: "JWT" });
  assert.equal(JSON.parse(Buffer.from(encodedPayload, "base64url")).iss, "101");
  assert.equal(verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), {
    key: publicKey,
    padding: constants.RSA_PKCS1_PADDING,
  }, Buffer.from(encodedSignature, "base64url")), true);
});

test("uses a separate exact-repository read-only token for guard inputs", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const calls = [];
  const result = await createGuardReadInstallationAccessToken({
    appId: 101,
    privateKey,
    installationId: INSTALLATION_ID,
    repositoryId: REPOSITORY_ID,
    now: NOW,
    request: async (path, _appJwt, options) => {
      calls.push({ path, options });
      return {
        token: "ghs_guard_read_only",
        expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
        repositories: [{ id: REPOSITORY_ID }],
        permissions: {
          actions: "read",
          checks: "read",
          contents: "read",
          pull_requests: "read",
        },
      };
    },
  });
  assert.equal(result.token, "ghs_guard_read_only");
  assert.deepEqual(calls, [{
    path: `/app/installations/${INSTALLATION_ID}/access_tokens`,
    options: {
      method: "POST",
      body: {
        repository_ids: [REPOSITORY_ID],
        permissions: {
          actions: "read",
          checks: "read",
          contents: "read",
          pull_requests: "read",
        },
      },
    },
  }]);
});

test("rejects a widened or overlong GitHub App credential", async (t) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  for (const [name, response] of [
    ["multiple repositories", {
      token: "ghs_token",
      expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
      repositories: [{ id: REPOSITORY_ID }, { id: 999 }],
      permissions: { checks: "write" },
    }],
    ["wrong repository", {
      token: "ghs_token",
      expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
      repositories: [{ id: 999 }],
      permissions: { checks: "write" },
    }],
    ["overlong expiry", {
      token: "ghs_token",
      expires_at: new Date(NOW + 66 * 60 * 1_000).toISOString(),
      repositories: [{ id: REPOSITORY_ID }],
      permissions: { checks: "write" },
    }],
    ["missing permission response", {
      token: "ghs_token",
      expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
      repositories: [{ id: REPOSITORY_ID }],
    }],
    ["widened write permissions", {
      token: "ghs_token",
      expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
      repositories: [{ id: REPOSITORY_ID }],
      permissions: { checks: "write", contents: "write" },
    }],
    ["writable implicit metadata", {
      token: "ghs_token",
      expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
      repositories: [{ id: REPOSITORY_ID }],
      permissions: { checks: "write", metadata: "write" },
    }],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(createChecksWriteInstallationAccessToken({
        appId: 101,
        privateKey,
        installationId: INSTALLATION_ID,
        repositoryId: REPOSITORY_ID,
        now: NOW,
        request: async () => response,
      }), /Checks-only repository credential/u);
    });
  }
});

test("rejects any read credential permission wider than the requested guard inputs", async (t) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const baseline = {
    token: "ghs_guard_read_only",
    expires_at: new Date(NOW + 60 * 60 * 1_000).toISOString(),
    repositories: [{ id: REPOSITORY_ID }],
  };
  for (const [name, permissions] of [
    ["write escalation", { actions: "read", checks: "read", contents: "write", pull_requests: "read" }],
    ["extra read scope", { actions: "read", checks: "read", contents: "read", deployments: "read", pull_requests: "read" }],
    ["missing scope", { checks: "read", contents: "read", pull_requests: "read" }],
    ["metadata write", { actions: "read", checks: "read", contents: "read", metadata: "write", pull_requests: "read" }],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(createGuardReadInstallationAccessToken({
        appId: 101,
        privateKey,
        installationId: INSTALLATION_ID,
        repositoryId: REPOSITORY_ID,
        now: NOW,
        request: async () => ({ ...baseline, permissions }),
      }), /guard credential/u);
    });
  }
});

test("builds a stable guard identity and enforces canonical monotonic workflow markers", () => {
  const identity = stableGuardCheckExternalId({
    repositoryId: REPOSITORY_ID,
    targetType: "pull_request",
    headSha: HEAD_SHA,
  });
  assert.equal(identity, `changeplane.guard/v1:${REPOSITORY_ID}:pull_request:${HEAD_SHA}`);
  assert.equal(stableGuardCheckExternalId({
    repositoryId: REPOSITORY_ID,
    targetType: "pull_request",
    headSha: HEAD_SHA,
  }), identity);
  assert.notEqual(stableGuardCheckExternalId({
    repositoryId: REPOSITORY_ID,
    targetType: "merge_group",
    headSha: HEAD_SHA,
  }), identity);

  const marker = encodeGuardRunMarker({ runId: RUN_ID, runAttempt: RUN_ATTEMPT, phase: "begin" });
  assert.equal(marker, `changeplane.guard-run/v1;run_id=${RUN_ID};run_attempt=${RUN_ATTEMPT};phase=begin`);
  assert.deepEqual(decodeGuardRunMarker(marker), {
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    phase: "begin",
  });
  assert.equal(compareGuardRunOrder(
    { runId: RUN_ID, runAttempt: 1 },
    { runId: RUN_ID, runAttempt: 2 },
  ), -1);
  assert.equal(compareGuardRunOrder(
    { runId: RUN_ID + 1, runAttempt: 1 },
    { runId: RUN_ID, runAttempt: 99 },
  ), 1);
  assert.equal(compareGuardRunOrder(
    { runId: RUN_ID, runAttempt: RUN_ATTEMPT },
    { runId: RUN_ID, runAttempt: RUN_ATTEMPT },
  ), 0);
});

test("rejects malformed guard identities, markers, and run order inputs", () => {
  for (const input of [
    { repositoryId: 0, targetType: "pull_request", headSha: HEAD_SHA },
    { repositoryId: REPOSITORY_ID, targetType: "issue", headSha: HEAD_SHA },
    { repositoryId: REPOSITORY_ID, targetType: "pull_request", headSha: "a".repeat(39) },
  ]) {
    assert.throws(() => stableGuardCheckExternalId(input));
  }
  for (const input of [
    { runId: 0, runAttempt: 1, phase: "begin" },
    { runId: 1, runAttempt: 0, phase: "begin" },
    { runId: 1, runAttempt: 1, phase: "pending" },
  ]) {
    assert.throws(() => encodeGuardRunMarker(input));
  }
  for (const marker of [
    "changeplane.guard-run/v1;run_id=01;run_attempt=1;phase=begin",
    "changeplane.guard-run/v1;run_id=1;run_attempt=1;phase=completed",
    `changeplane.guard-run/v1;run_id=1;run_attempt=1;phase=begin${"x".repeat(200)}`,
    "prefix changeplane.guard-run/v1;run_id=1;run_attempt=1;phase=begin",
  ]) {
    assert.throws(() => decodeGuardRunMarker(marker));
  }
  assert.throws(() => compareGuardRunOrder(
    { runId: 2, runAttempt: 1 },
    { runId: 1, runAttempt: 0 },
  ));
});

function guardFixture() {
  const plan = { goal: "Keep payment retries idempotent", scope: ["src/payments/**"] };
  const policy = {
    version: 1,
    evidence: { requiredChecks: [{ name: "CI / verify", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml" }] },
  };
  const receipt = buildReceipt({
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    pullRequest: {
      number: 42,
      base: { sha: BASE_SHA },
      head: { sha: HEAD_SHA },
    },
    plan,
    policyPath: ".changeplane.json",
    policyDigest: digest(policy),
    inputDigest: digest({ plan, files: [{ path: "src/payments/retry.js" }] }),
    contractDigest: digest(plan),
    approvalDigest: "f".repeat(64),
    result: { approval: { status: "MISSING" }, reasons: [] },
    evidence: [{
      name: "CI / verify",
      expectedSource: "github-actions",
      source: "github-actions",
      checkRunId: 808,
      publisherAppId: 15368,
      status: "COMPLETED",
      conclusion: "SUCCESS",
      completedAt: "2026-08-31T00:00:00Z",
    }],
    autonomousPlan: {
      decision: "PASS",
      reason: "ALL_GUARANTEES_SATISFIED",
      humanRequired: false,
    },
    mode: "enforce",
    actualFiles: [{ path: "src/payments/retry.js" }],
    maxAttempts: 2,
  });
  const passport = buildAssurancePassport(receipt);
  return {
    body: {
      schemaVersion: 1,
      type: "changeplane.guard-publication-request",
      repository: REPOSITORY,
      defaultBranch: DEFAULT_BRANCH,
      gitRef: EXPECTED_REF,
      workflowRunId: RUN_ID,
      workflowRunAttempt: RUN_ATTEMPT,
      passport,
      summary: renderReceiptComment(receipt),
    },
    currentTarget: {
      type: "pull_request",
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      headRepositoryId: REPOSITORY_ID,
      baseRepositoryId: REPOSITORY_ID,
      pullRequestNumber: 42,
      headRef: "agent/retry-fix",
      baseRef: DEFAULT_BRANCH,
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      current: true,
    },
  };
}

test("keeps the authenticated contract frozen across same-head edits and interrupted generations", () => {
  const fixture = guardFixture();
  const authority = {
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    target: fixture.currentTarget,
    appId: 101,
    appSlug: "changeplane-guard",
  };
  const completed = {
    id: 919,
    name: "ChangePlane / guard",
    head_sha: HEAD_SHA,
    external_id: stableGuardCheckExternalId({ repositoryId: REPOSITORY_ID, targetType: "pull_request", headSha: HEAD_SHA }),
    status: "completed",
    conclusion: "success",
    app: { id: authority.appId, slug: authority.appSlug },
    output: {
      summary: fixture.body.summary,
      text: encodeGuardRunMarker({ runId: RUN_ID, runAttempt: 1, phase: "complete" }),
    },
  };
  const bound = guardBoundContractDigest(completed, authority);
  assert.equal(bound, fixture.body.passport.binding.contractDigest);
  const begin = {
    ...completed,
    status: "in_progress",
    conclusion: null,
    output: {
      summary: "A new evaluation is running.",
      text: encodeGuardRunMarker({ runId: RUN_ID + 1, runAttempt: 1, phase: "begin", boundContractDigest: bound, pullRequestNumber: 42 }),
    },
  };
  assert.equal(guardBoundContractDigest(begin, authority), bound);
  const superseded = {
    ...begin,
    output: {
      ...begin.output,
      text: encodeGuardRunMarker({ runId: RUN_ID + 2, runAttempt: 1, phase: "begin", boundContractDigest: guardBoundContractDigest(begin, authority), pullRequestNumber: 42 }),
    },
  };
  const edited = resolveRevisionContract({
    body: '<!-- changeplane {"scope":["src/edited.js"]} -->',
    actualFiles: [{ path: "src/edited.js" }],
    headSha: HEAD_SHA,
    boundContractDigest: guardBoundContractDigest(superseded, authority),
  });
  assert.equal(edited.boundContractDigest, bound);
  assert.notEqual(edited.contractDigest, bound);
  assert.equal(guardBoundContractDigest(null, authority), null);

  for (const check of [
    { ...completed, app: { id: 202, slug: authority.appSlug } },
    { ...completed, app: { id: authority.appId, slug: "spoofed" } },
    { ...completed, head_sha: "c".repeat(40) },
    { ...completed, external_id: "forged" },
    { ...completed, output: { ...completed.output, summary: "No passport" } },
    { ...completed, output: { ...completed.output, text: encodeGuardRunMarker({ runId: RUN_ID, runAttempt: 1, phase: "complete", boundContractDigest: "0".repeat(64) }) } },
  ]) {
    assert.throws(() => guardBoundContractDigest(check, authority));
  }
  assert.throws(() => guardBoundContractDigest(completed, { ...authority, repository: "acme/other" }));
  const differentPullRequest = { ...authority, target: { ...authority.target, pullRequestNumber: 43 } };
  assert.equal(guardBoundContractDigest(completed, differentPullRequest), null);
  assert.equal(guardBoundContractDigest(begin, differentPullRequest), null);
  assert.equal(guardBoundContractDigest(superseded, differentPullRequest), null);
  const reconciled = {
    ...begin,
    status: "completed",
    conclusion: "action_required",
    output: { ...begin.output, text: begin.output.text.replace("phase=begin", "phase=complete") },
  };
  assert.equal(guardBoundContractDigest(reconciled, authority), bound);
  assert.equal(guardBoundContractDigest(reconciled, differentPullRequest), null);
});

test("rejects noncanonical contract marker metadata", () => {
  for (const boundContractDigest of ["", "x".repeat(64), "A".repeat(64), "a".repeat(63), 123, {}]) {
    assert.throws(() => encodeGuardRunMarker({ runId: 1, runAttempt: 1, phase: "begin", boundContractDigest }));
  }
  const marker = encodeGuardRunMarker({ runId: 1, runAttempt: 1, phase: "begin", boundContractDigest: "a".repeat(64) });
  assert.equal(decodeGuardRunMarker(marker).boundContractDigest, "a".repeat(64));
  assert.throws(() => decodeGuardRunMarker(`${marker};contract_digest=${"b".repeat(64)}`));
  assert.throws(() => decodeGuardRunMarker(`${marker};pull_request_number=0`));
  assert.throws(() => decodeGuardRunMarker(`${marker};pull_request_number=01`));
});

test("validates a bounded guard request against OIDC, controller, and current target", async () => {
  const oidc = await verifyGitHubActionsOidcToken(verifierInput());
  const fixture = guardFixture();
  const result = validateGuardPublishBody(fixture.body, {
    oidcClaims: oidc,
    expectedWorkflowSha: BASE_SHA,
    expectedControllerSha: BASE_SHA,
    currentTarget: fixture.currentTarget,
  });

  assert.equal(result.repository, REPOSITORY);
  assert.equal(result.passport.digest, fixture.body.passport.digest);
  assert.deepEqual(result.check, {
    name: "ChangePlane / guard",
    head_sha: HEAD_SHA,
    status: "completed",
    conclusion: "success",
    external_id: `changeplane.guard/v1:${REPOSITORY_ID}:pull_request:${HEAD_SHA}`,
    output: {
      title: "PASS · enforce",
      summary: fixture.body.summary,
      text: `changeplane.guard-run/v1;run_id=${RUN_ID};run_attempt=${RUN_ATTEMPT};phase=complete`,
    },
  });
});

test("validates an exact target invalidation before evaluation starts", async () => {
  const oidc = await verifyGitHubActionsOidcToken(verifierInput());
  const fixture = guardFixture();
  const result = validateGuardBeginBody({
    schemaVersion: 1,
    type: "changeplane.guard-publication-begin",
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    defaultBranch: DEFAULT_BRANCH,
    controllerSha: BASE_SHA,
    gitRef: EXPECTED_REF,
    workflowRunId: RUN_ID,
    workflowRunAttempt: RUN_ATTEMPT,
    target: {
      type: "pull_request",
      pullRequestNumber: 42,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      baseRef: DEFAULT_BRANCH,
      headRef: "agent/retry-fix",
    },
  }, {
    oidcClaims: oidc,
    expectedWorkflowSha: BASE_SHA,
    currentTarget: fixture.currentTarget,
  });
  assert.equal(result.check.status, "in_progress");
  assert.equal(result.check.external_id, `changeplane.guard/v1:${REPOSITORY_ID}:pull_request:${HEAD_SHA}`);
  assert.equal(
    result.check.output.text,
    `changeplane.guard-run/v1;run_id=${RUN_ID};run_attempt=${RUN_ATTEMPT};phase=begin`,
  );
});

test("validates a merge-group guard only for its authenticated queue revision", async () => {
  const mergeRef = "refs/heads/gh-readonly-queue/main/pr-42-deadbeef";
  const oidc = await verifyGitHubActionsOidcToken(verifierInput({
    token: jwt(oidcClaims({
      event_name: "merge_group",
      ref: mergeRef,
      sha: HEAD_SHA,
      base_ref: "",
      head_ref: "",
    })),
    ref: mergeRef,
    allowedEventNames: ["merge_group"],
  }));
  const plan = { scope: ["src/payments/retry.js"] };
  const policy = {
    version: 1,
    evidence: { requiredChecks: [{ name: "CI / verify", appSlug: "github-actions", workflowPath: ".github/workflows/ci.yml" }] },
  };
  const receipt = buildMergeGroupReceipt({
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    target: {
      baseRef: "refs/heads/main",
      headRef: mergeRef,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      actualFiles: [{ path: "src/payments/retry.js" }],
    },
    plan,
    policyPath: ".changeplane.json",
    policyDigest: digest(policy),
    inputDigest: digest({ targetType: "merge_group", headSha: HEAD_SHA }),
    contractDigest: digest(plan),
    result: { approval: { status: "MISSING" }, reasons: [] },
    evidence: [{
      name: "CI / verify",
      expectedSource: "github-actions",
      source: "github-actions",
      checkRunId: 808,
      publisherAppId: 15368,
      status: "COMPLETED",
      conclusion: "SUCCESS",
      completedAt: "2026-08-31T00:00:00Z",
    }],
    autonomousPlan: {
      decision: "PASS",
      reason: "ALL_GUARANTEES_SATISFIED",
      humanRequired: false,
    },
    mode: "enforce",
  });
  const passport = buildAssurancePassport(receipt);
  const result = validateGuardPublishBody({
    schemaVersion: 1,
    type: "changeplane.guard-publication-request",
    repository: REPOSITORY,
    defaultBranch: DEFAULT_BRANCH,
    gitRef: mergeRef,
    workflowRunId: RUN_ID,
    workflowRunAttempt: RUN_ATTEMPT,
    passport,
    summary: renderMergeGroupReceipt(receipt),
  }, {
    oidcClaims: oidc,
    expectedWorkflowSha: BASE_SHA,
    expectedControllerSha: BASE_SHA,
    currentTarget: {
      type: "merge_group",
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      headRepositoryId: REPOSITORY_ID,
      baseRepositoryId: REPOSITORY_ID,
      pullRequestNumber: null,
      headRef: mergeRef,
      baseRef: "refs/heads/main",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      current: true,
    },
  });

  assert.equal(result.passport.target.type, "merge_group");
  assert.equal(result.gitRef, mergeRef);
  assert.equal(result.check.external_id, `changeplane.guard/v1:${REPOSITORY_ID}:merge_group:${HEAD_SHA}`);
  assert.equal(result.check.head_sha, HEAD_SHA);
  assert.equal(result.check.conclusion, "success");
});

test("rejects malformed, forked, or stale guard publication requests", async (t) => {
  const oidc = await verifyGitHubActionsOidcToken(verifierInput());
  const fixture = guardFixture();
  const cases = [
    ["unknown body field", { body: { ...fixture.body, extra: true } }],
    ["wrong repository", { body: { ...fixture.body, repository: "evil/fork" } }],
    ["wrong run", { body: { ...fixture.body, workflowRunId: RUN_ID + 1 } }],
    ["stale flag", { currentTarget: { ...fixture.currentTarget, current: false } }],
    ["stale head", { currentTarget: { ...fixture.currentTarget, headSha: "c".repeat(40) } }],
    ["fork", { currentTarget: { ...fixture.currentTarget, headRepositoryId: 999 } }],
    ["controller drift", { expectedControllerSha: "c".repeat(40) }],
    ["workflow drift", { expectedWorkflowSha: "c".repeat(40) }],
    ["passport tamper", {
      body: {
        ...fixture.body,
        passport: {
          ...fixture.body.passport,
          target: { ...fixture.body.passport.target, headSha: "c".repeat(40) },
        },
      },
    }],
    ["summary tamper", {
      body: {
        ...fixture.body,
        summary: fixture.body.summary.replace(fixture.body.passport.digest, "0".repeat(64)),
      },
    }],
  ];

  for (const [name, overrides] of cases) {
    await t.test(name, () => {
      assert.throws(() => validateGuardPublishBody(overrides.body ?? fixture.body, {
        oidcClaims: oidc,
        expectedWorkflowSha: overrides.expectedWorkflowSha ?? BASE_SHA,
        expectedControllerSha: overrides.expectedControllerSha ?? BASE_SHA,
        currentTarget: overrides.currentTarget ?? fixture.currentTarget,
      }));
    });
  }
});
