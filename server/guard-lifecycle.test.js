import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createGuardLifecycle } from "./guard-lifecycle.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const configuration = { appId: 40, appSlug: "changeplane-guard", privateKey };
const repo = { id: 20, full_name: "example/project", default_branch: "main", owner: { id: 10 } };
const NOW = "2026-09-20T12:30:00.000Z";
const BASE = "a".repeat(40);

function fixture({ onWriteCredential = () => {}, onCheck = () => {}, acknowledge = value => value } = {}) {
  const events = [];
  let held = false;
  let writing = false;
  let checkReads = 0;
  const state = {
    base: BASE,
    check: { id: 44, name: "ChangePlane / guard", head_sha: "b".repeat(40),
      app: { id: 40, slug: "changeplane-guard" }, status: "in_progress", conclusion: null,
      started_at: "2026-09-20T12:00:00.000Z",
      output: { text: "changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=begin" } },
  };
  const lifecycle = createGuardLifecycle({
    clock: () => NOW,
    async readManagedRuntime(repository, branch, sha, token) {
      assert.equal(held, true);
      assert.equal(repository, repo.full_name);
      assert.equal(branch, "main");
      assert.equal(sha, BASE);
      assert.equal(token, "read-credential");
      return { workflowSha: BASE, managedProfile: "full",
        policyContent: JSON.stringify({ harness: { mode: "autonomous", maxAttempts: 2, budgetMinutes: 15 } }) };
    },
    async request(path, token, options = {}) {
      if (path.endsWith("/installation")) return { id: 30, app_id: 40, app_slug: "changeplane-guard", account: { id: 10 } };
      if (path === "/app/installations/30/access_tokens") {
        assert.equal(options.method, "POST");
        assert.deepEqual(options.body.repository_ids, [20]);
        const write = options.body.permissions.checks === "write";
        if (write) { assert.equal(held, true); onWriteCredential(state); }
        events.push(write ? "write-credential" : "read-credential");
        return { token: write ? "write-credential" : "read-credential", permissions: options.body.permissions,
          repositories: [{ id: 20 }], expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
      }
      if (path.endsWith("/git/ref/heads/main")) {
        assert.equal(held, true);
        assert.equal(token, "read-credential");
        return { object: { sha: state.base } };
      }
      if (path.endsWith("/check-runs/44") && options.method === "PATCH") {
        assert.equal(held && writing, true);
        assert.equal(token, "write-credential");
        assert.equal(options.body.conclusion, "action_required");
        assert.equal(options.body.completed_at, NOW);
        events.push("patch");
        state.check = { ...state.check, ...options.body };
        return acknowledge(structuredClone(state.check));
      }
      if (path.endsWith("/check-runs/44")) {
        assert.equal(token, "read-credential");
        onCheck(state, ++checkReads);
        return structuredClone(state.check);
      }
      assert.fail(`Unexpected request: ${path}`);
    },
  });
  const journalRuntime = { epoch: "11111111-1111-4111-8111-111111111111", releaseSha: "c".repeat(40),
    journal: { async withPublication(scope, callback) {
      assert.equal(scope.repositoryId, 20);
      assert.equal(scope.tenantId, 10);
      assert.equal(scope.installationId, 30);
      assert.equal(scope.operation, "reconcile");
      events.push("held"); held = true;
      try {
        const result = await callback({ async write(mutate) { writing = true; return mutate(); } });
        events.push("released");
        return result;
      } catch (error) {
        events.push(writing ? "uncertain-write" : "released-without-write");
        throw error;
      } finally { held = false; }
    } },
  };
  return { state, events, run: () => lifecycle.reconcile({ target: { repo, encodedRepository: repo.full_name },
    checkRunId: 44, configuration, journalRuntime }) };
}

test("recovery uses injected repository, trusted policy, clock and held publication lane", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { repository: repo.full_name, state: "reconciled", checkRunId: 44,
    generation: "8001.1", conclusion: "action_required" });
  assert.deepEqual(f.events, ["read-credential", "held", "write-credential", "patch", "released"]);
  assert.equal(f.state.check.output.text, "changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=complete");
});

test("terminal and newly active generations need no recovery write credential", async () => {
  for (const terminal of [true, false]) {
    const f = fixture();
    if (terminal) f.state.check = { ...f.state.check, status: "completed", conclusion: "success",
      output: { text: "changeplane.guard-run/v1;run_id=8001;run_attempt=1;phase=complete" } };
    else f.state.check.started_at = "2026-09-20T12:29:00.000Z";
    assert.equal((await f.run()).state, terminal ? "terminal" : "within_window");
    assert.deepEqual(f.events, ["read-credential", "held", "released"]);
  }
});

test("a changed policy or generation while requesting write authority prevents mutation", async () => {
  for (const drift of [
    state => { state.base = "d".repeat(40); },
    state => { state.check.output.text = "changeplane.guard-run/v1;run_id=8002;run_attempt=1;phase=begin"; },
  ]) {
    const f = fixture({ onWriteCredential: drift });
    await assert.rejects(f.run(), error => error.status === 409);
    assert.deepEqual(f.events, ["read-credential", "held", "write-credential", "released-without-write"]);
  }
});

test("a generation changed by the final eligibility read cannot acquire write authority", async () => {
  const f = fixture({ onCheck(state, read) {
    if (read === 3) state.check.output.text = "changeplane.guard-run/v1;run_id=8002;run_attempt=1;phase=begin";
  } });
  await assert.rejects(f.run(), error => error.status === 409);
  assert.deepEqual(f.events, ["read-credential", "held", "released-without-write"]);
});

test("an invalid mutation acknowledgement escapes the held callback without releasing success", async () => {
  const f = fixture({ acknowledge: value => ({ ...value, head_sha: "d".repeat(40) }) });
  await assert.rejects(f.run(), error => error.status === 502);
  assert.deepEqual(f.events, ["read-credential", "held", "write-credential", "patch", "uncertain-write"]);
});
