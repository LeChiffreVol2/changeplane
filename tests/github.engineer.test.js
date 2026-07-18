import assert from "node:assert/strict";
import test from "node:test";

import handler, { seal } from "../api/github.js";

const SECRET = "engineer-test-secret-that-is-longer-than-thirty-two-characters";
const ENVIRONMENT_NAMES = [
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_SLUG",
  "CHANGEPLANE_SESSION_SECRET",
  "CHANGEPLANE_APP_ORIGIN",
  "CHANGEPLANE_CANARY_REPOSITORY",
];

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

async function withEnvironment(values, callback) {
  const original = Object.fromEntries(ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    CHANGEPLANE_SESSION_SECRET: SECRET,
    CHANGEPLANE_APP_ORIGIN: "https://changeplane.example",
    ...values,
  });
  if (values.GITHUB_APP_SLUG == null) delete process.env.GITHUB_APP_SLUG;
  if (values.CHANGEPLANE_CANARY_REPOSITORY == null) delete process.env.CHANGEPLANE_CANARY_REPOSITORY;
  try {
    return await callback();
  } finally {
    for (const name of ENVIRONMENT_NAMES) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
}

test("GitHub App repository routes reject targets outside the verified installation", async () => {
  await withEnvironment({ GITHUB_APP_SLUG: "changeplane-test" }, async () => {
    const session = seal({
      kind: "session",
      token: "ghu-user-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "github_app",
      installationId: "12345",
    }, SECRET);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      calls.push(url.pathname);
      assert.equal(url.pathname, "/user/installations/12345/repositories");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            repositories: [{
              full_name: "alice/allowed-service",
              permissions: { push: true, admin: false },
            }],
          };
        },
      };
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=preflight&repository=alice%2Foutside-service",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 404);
      assert.equal(JSON.parse(response.body).error, "Repository not found.");
      assert.deepEqual(calls, ["/user/installations/12345/repositories"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("controlled canary remains bound to the verified GitHub App installation", async () => {
  await withEnvironment({
    GITHUB_APP_SLUG: "changeplane-test",
    CHANGEPLANE_CANARY_REPOSITORY: "alice/disposable-canary",
  }, async () => {
    const session = seal({
      kind: "session",
      token: "ghu-user-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "github_app",
      installationId: "12345",
    }, SECRET);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      calls.push(url.pathname);
      assert.equal(url.pathname, "/user/installations/12345/repositories");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            repositories: [{
              full_name: "alice/other-installed-repository",
              permissions: { push: true, admin: false },
            }],
          };
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
      assert.equal(response.statusCode, 404);
      assert.equal(JSON.parse(response.body).error, "Repository not found.");
      assert.deepEqual(calls, ["/user/installations/12345/repositories"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("observe onboarding does not require optional Checks or Actions Secrets permissions", async () => {
  await withEnvironment({ GITHUB_APP_SLUG: "changeplane-test" }, async () => {
    const state = "s".repeat(32);
    const oauthCookie = seal({
      kind: "oauth",
      state,
      redirectUri: "https://changeplane.example/api/github?action=callback",
      authMode: "github_app",
      installationId: "12345",
      verifier: "v".repeat(64),
    }, SECRET, { purpose: "oauth" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.origin === "https://github.com") {
        return { ok: true, status: 200, async json() { return { access_token: "ghu-user-token", expires_in: 3600 }; } };
      }
      if (url.pathname === "/user") {
        return { ok: true, status: 200, async json() { return { login: "alice" }; } };
      }
      if (url.pathname === "/user/installations") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              installations: [{
                id: 12345,
                permissions: { contents: "write", pull_requests: "write", workflows: "write" },
              }],
            };
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: `/api/github?action=callback&code=valid-code-123&state=${state}`,
        headers: { cookie: `__Host-changeplane_oauth=${oauthCookie}` },
      }, response);
      assert.equal(response.statusCode, 302);
      assert.equal(response.getHeader("location"), "https://changeplane.example/?github=connected");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("GitHub App BYOK fails before provider access when Actions Secrets write is absent", async () => {
  await withEnvironment({ GITHUB_APP_SLUG: "changeplane-test" }, async () => {
    const session = seal({
      kind: "session",
      token: "ghu-user-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "github_app",
      installationId: "12345",
      byokSecretWrite: false,
    }, SECRET);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      calls.push(url);
      if (url.pathname === "/user/installations/12345/repositories") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { repositories: [{ full_name: "alice/service", permissions: { push: true } }] };
          },
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "POST",
        url: "/api/github?action=byok",
        headers: {
          cookie: `__Host-changeplane_session=${session}`,
          origin: "https://changeplane.example",
          "content-type": "application/json",
          "x-changeplane-csrf": "alice-csrf",
        },
        body: { repository: "alice/service", apiKey: `provider-${"s".repeat(40)}` },
      }, response);
      assert.equal(response.statusCode, 403);
      assert.match(JSON.parse(response.body).error, /No provider request was made/u);
      assert.equal(calls.some((url) => url.origin === "https://api.deepseek.com"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("serverless GitHub routes fail fast on a long rate limit and preserve Retry-After", async () => {
  await withEnvironment({}, async () => {
    const session = seal({
      kind: "session",
      token: "alice-token",
      login: "alice",
      csrf: "alice-csrf",
      authMode: "oauth",
    }, SECRET);
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        headers: { get: (name) => name === "retry-after" ? "60" : null },
      };
    };
    try {
      const response = responseRecorder();
      await handler({
        method: "GET",
        url: "/api/github?action=repos",
        headers: { cookie: `__Host-changeplane_session=${session}` },
      }, response);
      assert.equal(response.statusCode, 429);
      assert.equal(response.getHeader("retry-after"), "60");
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("connector stays disabled without an explicit production origin", async () => {
  await withEnvironment({}, async () => {
    delete process.env.CHANGEPLANE_APP_ORIGIN;
    const response = responseRecorder();
    await handler({ method: "GET", url: "/api/github?action=session", headers: {} }, response);
    assert.equal(JSON.parse(response.body).configured, false);
  });
});
