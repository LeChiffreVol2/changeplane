import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PublicationError, reportFailure, resolvePullRequestNumber, run, shouldFailAction } from "./index.js";
import { DECISION, evaluateEvidence } from "../src/lib/changeplane.js";

test("required deterministic evidence accepts success only", () => {
  assert.equal(evaluateEvidence({
    requiredChecks: ["race-reproduction"],
    checks: [{ name: "race-reproduction", status: "completed", conclusion: "success" }],
  }).decision, DECISION.PASS);

  for (const conclusion of ["neutral", "skipped", "failure", "cancelled"]) {
    const result = evaluateEvidence({
      requiredChecks: ["race-reproduction"],
      checks: [{ name: "race-reproduction", status: "completed", conclusion }],
    });
    assert.equal(result.decision, DECISION.REVIEW_REQUIRED);
    assert.deepEqual(result.reasons.map(({ code }) => code), ["EVIDENCE_FAILED"]);
  }
});

test("GitHub failures never include upstream response bodies", async () => {
  const headSha = "a".repeat(40);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    headers: { get: () => null },
    async text() { return "reflected-secret-token"; },
  });
  try {
    await assert.rejects(
      resolvePullRequestNumber({ deployment: { sha: headSha }, deployment_status: { id: 1 } }, "acme/payments", "token"),
      (error) => error instanceof Error
        && /GitHub API 401/u.test(error.message)
        && !error.message.includes("reflected-secret-token"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("enforce behavior requires the dedicated App controller", async () => {
  const originalMode = process.env.INPUT_MODE;
  process.env.INPUT_MODE = "enforce";
  try {
    await assert.rejects(run(), /Enforce mode requires the dedicated ChangePlane App controller/u);
  } finally {
    if (originalMode === undefined) delete process.env.INPUT_MODE;
    else process.env.INPUT_MODE = originalMode;
  }
});

test("observe fails closed when the exact-head audit surface cannot be published", () => {
  assert.equal(shouldFailAction(new PublicationError("check write failed"), "observe"), true);
  assert.equal(shouldFailAction(new Error("advisory lookup failed"), "observe"), false);
  assert.equal(shouldFailAction(new Error("evaluation failed"), "observe", false), true);
});

test("observe fallback publication failures are fatal for trusted rechecks, deployments, and merge groups", async () => {
  const original = {
    eventPath: process.env.GITHUB_EVENT_PATH,
    mode: process.env.INPUT_MODE,
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.INPUT_TOKEN,
    exitCode: process.exitCode,
    fetch: globalThis.fetch,
  };
  const headSha = "b".repeat(40);
  const eventPath = path.join(tmpdir(), `changeplane-fallback-${process.pid}.json`);
  Object.assign(process.env, {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: "acme/payments",
    INPUT_MODE: "observe",
    INPUT_TOKEN: "token",
  });
  try {
    for (const event of [{
      action: "changeplane_recheck",
      client_payload: { pullRequestNumber: 42, headSha },
    }, {
      deployment: { sha: headSha },
      deployment_status: { id: 7 },
    }, {
      action: "checks_requested",
      merge_group: { head_sha: headSha },
    }]) {
      writeFileSync(eventPath, JSON.stringify(event));
      process.exitCode = undefined;
      globalThis.fetch = async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith(`/commits/${headSha}/pulls`)) {
          return {
            ok: true,
            status: 200,
            async json() {
              return [{
                number: 42,
                state: "open",
                head: { sha: headSha, repo: { full_name: "acme/payments" } },
                base: { repo: { full_name: "acme/payments" } },
              }];
            },
          };
        }
        return { ok: false, status: 401, headers: { get: () => null } };
      };
      await reportFailure(new Error("evaluation failed"));
      assert.equal(process.exitCode, 1);
    }

    writeFileSync(eventPath, JSON.stringify({
      action: "changeplane_recheck",
      client_payload: { pullRequestNumber: 42, headSha },
    }));
    process.exitCode = undefined;
    globalThis.fetch = async (_input, options = {}) => (
      (options.method ?? "GET") === "GET"
        ? { ok: true, status: 200, async json() { return { check_runs: [] }; } }
        : { ok: true, status: 201, async json() { return { id: 9 }; } }
    );
    await reportFailure(new PublicationError("receipt publication failed"));
    assert.equal(process.exitCode, 1);

    writeFileSync(eventPath, "{}");
    process.exitCode = undefined;
    globalThis.fetch = async () => { throw new Error("unexpected fetch"); };
    await reportFailure(new Error("evaluation failed before target binding"));
    assert.equal(process.exitCode, 1);
  } finally {
    unlinkSync(eventPath);
    globalThis.fetch = original.fetch;
    process.exitCode = original.exitCode;
    for (const [name, value] of [
      ["GITHUB_EVENT_PATH", original.eventPath],
      ["INPUT_MODE", original.mode],
      ["GITHUB_REPOSITORY", original.repository],
      ["INPUT_TOKEN", original.token],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
