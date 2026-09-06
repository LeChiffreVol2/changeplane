import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import handler from "../api/github.js";

const SOURCE_SHA = "c".repeat(40);
const PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" }).toString();

async function request(action, method = "GET") {
  const headers = new Map();
  const response = {
    statusCode: 0,
    body: "",
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = "") { this.body = String(value); },
  };
  await handler({ method, url: `/api/github?action=${action}`, headers: {} }, response);
  return { ...response, headers, payload: response.body ? JSON.parse(response.body) : null };
}

async function withProduction(callback) {
  const prefix = /^(?:GITHUB_|CHANGEPLANE_|VERCEL(?:_|$))/u;
  const original = Object.fromEntries(Object.entries(process.env).filter(([name]) => prefix.test(name)));
  for (const name of Object.keys(original)) delete process.env[name];
  Object.assign(process.env, {
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    GITHUB_APP_ID: "111111",
    GITHUB_APP_SLUG: "changeplane-installer",
    CHANGEPLANE_GUARD_APP_ID: "222222",
    CHANGEPLANE_GUARD_APP_SLUG: "changeplane-guard",
    CHANGEPLANE_GUARD_APP_PRIVATE_KEY: PRIVATE_KEY,
    CHANGEPLANE_SESSION_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
    CHANGEPLANE_APP_ORIGIN: "https://changeplane.example",
    CHANGEPLANE_ALPHA_REPOSITORIES_JSON: JSON.stringify(["acme/service"]),
    CHANGEPLANE_LEGAL_RELEASE_APPROVED: "true",
    CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE: SOURCE_SHA,
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_OWNER: "LeChiffreVol2",
    VERCEL_GIT_REPO_SLUG: "changeplane",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_COMMIT_SHA: SOURCE_SHA,
  });
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error("No external request expected"); };
  try {
    await callback();
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (prefix.test(name)) delete process.env[name];
    Object.assign(process.env, original);
  }
}

test("private alpha blocks missing legal approval, shared principals, and unserialized publication before every external route", async () => {
  const cases = [
    { change: () => { delete process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED; }, reason: "legal_release_required" },
    { change: () => { process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE = "b".repeat(40); }, reason: "legal_release_required" },
    { change: () => { process.env.CHANGEPLANE_GUARD_APP_ID = process.env.GITHUB_APP_ID; }, reason: "separate_guard_required" },
    { change: () => { process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON = "not-json"; }, reason: "alpha_scope_required" },
    { change: () => {}, reason: "publication_serialization_required" },
  ];
  for (const scenario of cases) {
    await withProduction(async () => {
      scenario.change();
      const readiness = await request("readiness");
      assert.equal(readiness.statusCode, 503);
      assert.equal(readiness.payload.rolloutMode, "private_alpha");
      assert.equal(readiness.payload.checks.rolloutAuthorized, false);
      const session = await request("session");
      assert.equal(session.payload.configured, false);
      assert.equal(session.payload.authenticated, false);
      assert.equal(session.payload.accessBlock.reason, scenario.reason);
      assert.match(session.payload.accessBlock.message, /No repository was accessed or changed/u);
      assert.ok(session.payload.accessBlock.nextAction);
      for (const action of ["login", "authorize", "installation", "callback", "repos", "preflight", "ruleset-plan", "runtime", "proof", "byok"]) {
        const response = await request(action);
        assert.equal(response.statusCode, 503, action);
        assert.equal(response.headers.get("location"), undefined);
      }
      for (const action of ["ruleset-apply", "reconcile", "guard-publish", "byok", "install", "repair", "repair-claim", "repair-push-token", "repair-validate"]) {
        assert.equal((await request(action, "POST")).statusCode, 503, action);
      }
    });
  }
});

test("approved separated alpha remains blocked until Guard publication is serialized in code", async () => {
  await withProduction(async () => {
    Object.assign(process.env, {
      CHANGEPLANE_COMMERCIAL_STORE_ENABLED: "true",
      CHANGEPLANE_DATABASE_URL: "postgresql://test:password@db.example/changeplane?sslmode=require",
      CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE: SOURCE_SHA,
      CHANGEPLANE_GUARD_PUBLICATION_SERIALIZED: "true",
    });
    const readiness = await request("readiness");
    assert.equal(readiness.statusCode, 503);
    assert.equal(readiness.payload.checks.guardPublicationSerialized, false);
    assert.equal(readiness.payload.checks.commercialStoreVerified, true);
    assert.equal(readiness.payload.checks.commercialRuntimeIntegrated, false);
    assert.equal(readiness.payload.commercialReady, false);
    const session = await request("session");
    assert.equal(session.payload.configured, false);
    assert.equal(session.payload.accessBlock.reason, "publication_serialization_required");
    const login = await request("login");
    assert.equal(login.statusCode, 503);
    assert.equal(login.headers.get("location"), undefined);
    assert.equal((await request("guard-publish", "POST")).statusCode, 503);
  });
});

test("public self-service remains unavailable even with exact release configuration", async () => {
  await withProduction(async () => {
    delete process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON;
    Object.assign(process.env, {
      CHANGEPLANE_SELF_SERVE_ENABLED: "true",
      CHANGEPLANE_COMMERCIAL_STORE_ENABLED: "true",
      CHANGEPLANE_DATABASE_URL: "postgresql://test:password@db.example/changeplane?sslmode=require",
      CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE: SOURCE_SHA,
    });
    const session = await request("session");
    assert.equal(session.payload.rolloutMode, "self_serve");
    assert.equal(session.payload.configured, false);
    assert.equal(session.payload.accessBlock.reason, "publication_serialization_required");
    assert.equal((await request("readiness")).statusCode, 503);
    assert.equal((await request("login")).statusCode, 503);
    assert.equal((await request("guard-publish", "POST")).statusCode, 503);
  });
});

test("owner canary does not bypass mandatory publication journal configuration", async () => {
  await withProduction(async () => {
    delete process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON;
    delete process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED;
    process.env.CHANGEPLANE_CANARY_REPOSITORY = "owner/canary";
    process.env.CHANGEPLANE_GUARD_APP_ID = process.env.GITHUB_APP_ID;
    const readiness = await request("readiness");
    assert.equal(readiness.statusCode, 503);
    assert.equal(readiness.payload.rolloutMode, "controlled_canary");
    assert.equal(readiness.payload.checks.guardPublicationSerialized, false);
    assert.equal(readiness.payload.checks.guardJournalConfigured, false);
    assert.equal(readiness.payload.commercialReady, false);
    assert.equal((await request("session")).payload.configured, true);
    assert.equal((await request("authorize")).statusCode, 302);
    assert.equal((await request("login")).statusCode, 403);
    const publication = await request("guard-publish", "POST");
    assert.equal(publication.statusCode, 503);
    assert.equal(publication.payload.code, "GUARD_PUBLICATION_AUTHORITY");
  });
});

test("journal configuration is reported separately from live publication and commercial readiness", async () => {
  await withProduction(async () => {
    delete process.env.CHANGEPLANE_ALPHA_REPOSITORIES_JSON;
    delete process.env.CHANGEPLANE_LEGAL_RELEASE_APPROVED;
    Object.assign(process.env, {
      CHANGEPLANE_CANARY_REPOSITORY: "owner/canary",
      CHANGEPLANE_GUARD_JOURNAL_ENABLED: "true",
      CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL: "postgresql://runtime:fixture-only@db.example/journal?sslmode=verify-full",
      CHANGEPLANE_GUARD_JOURNAL_EPOCH: "11111111-1111-4111-8111-111111111111",
      CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE: SOURCE_SHA,
    });
    const readiness = await request("readiness");
    assert.equal(readiness.statusCode, 200);
    assert.equal(readiness.payload.checks.guardJournalConfigured, true);
    assert.equal(readiness.payload.checks.guardJournalConfiguration, true);
    assert.equal(readiness.payload.checks.guardPublicationSerialized, false);
    assert.equal(readiness.payload.commercialReady, false);
    assert.equal(readiness.body.includes("fixture-only"), false);
  });
});
