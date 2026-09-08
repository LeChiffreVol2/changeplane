import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createPostgresGuardJournal, GuardPublicationError } from "./guard-publication-journal.js";

const scope = Object.freeze({ tenantId: 10, repositoryId: 20, installationId: 30, guardAppId: 40,
  epoch: "11111111-1111-4111-8111-111111111111", releaseSha: "a".repeat(40),
  revisionFingerprint: "b".repeat(64), operation: "complete" });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const code = (expected) => (error) => error instanceof GuardPublicationError && error.code === expected;
const settings = "set local synchronous_commit = on; set local lock_timeout = '2s'; set local statement_timeout = '5s'";

// Protocol double only. Actual atomicity, role isolation, and restart persistence
// are exercised by scripts/test-guard-journal-postgres.mjs against PostgreSQL.
function fixture({ admission = "claimed", hook = async () => {} } = {}) {
  const lanes = new Map();
  const events = [];
  const pool = { async connect() {
    let lastAction;
    return Object.assign(new EventEmitter(), { async query(sql, values) {
      events.push(values?.[9] ?? sql);
      if (!values) { await hook(sql, lastAction); return { rows: [] }; }
      const [tenant, repo, installation, app, epoch, release, revision, operation, owner, action] = values;
      lastAction = action;
      const key = `${repo}:${revision}`;
      const row = lanes.get(key);
      let result;
      if (action === "claim") {
        result = row ? "busy" : admission;
        if (result === "claimed") lanes.set(key, { tenant, installation, app, epoch, release, operation, owner, phase: "reserved" });
      } else if (!row || row.owner !== owner || row.operation !== operation) result = "not_owner";
      else if (action === "write" && row.phase === "reserved") { row.phase = "writing"; result = "ok"; }
      else if (action === "poison" && row.phase === "writing") { row.phase = "poisoned"; result = "ok"; }
      else if ((action === "release_reserved" && row.phase === "reserved")
        || (action === "release_written" && row.phase === "writing")) { lanes.delete(key); result = "ok"; }
      else result = "not_owner";
      await hook(sql, action);
      return { rows: [{ result }] };
    }, release() { events.push("connection_released"); } });
  } };
  return { journal: createPostgresGuardJournal({ pool }), lanes, events };
}

test("claim and write commits are acknowledged before callback/HTTP, release before return", async () => {
  const f = fixture();
  const result = await f.journal.withPublication(scope, async ({ write }) => {
    assert.deepEqual(f.events, ["begin", settings, "claim", "commit", "connection_released"]);
    return await write(async () => {
      assert.deepEqual(f.events.slice(-5), ["begin", settings, "write", "commit", "connection_released"]);
      return { freshlyValidated: true };
    });
  });
  assert.deepEqual(result, { freshlyValidated: true });
  assert.deepEqual(f.events.slice(-5), ["begin", settings, "release_written", "commit", "connection_released"]);
  assert.equal(f.lanes.size, 0);
});

test("concurrent operation kinds cannot enter the same repository/revision lane", async () => {
  const f = fixture(); const entered = deferred(); const response = deferred();
  const old = f.journal.withPublication(scope, async ({ write }) => await write(async () => {
    entered.resolve(); await response.promise;
  }));
  await entered.promise;
  let callbacks = 0;
  await assert.rejects(f.journal.withPublication({ ...scope, operation: "begin" }, () => { callbacks++; }), code("GUARD_PUBLICATION_BUSY"));
  await assert.rejects(f.journal.withPublication({ ...scope, operation: "reconcile" }, () => { callbacks++; }), code("GUARD_PUBLICATION_BUSY"));
  assert.equal(callbacks, 0);
  response.resolve(); await old;
  assert.equal(f.lanes.size, 0);
});

test("every retry revalidates current state and never returns cached success", async () => {
  const f = fixture(); let current = "pass"; let reads = 0;
  const run = () => f.journal.withPublication(scope, async ({ write }) => { reads++; return await write(async () => current); });
  assert.equal(await run(), "pass"); current = "stale";
  assert.equal(await run(), "stale"); assert.equal(reads, 2);
});

test("pre-write validation failure and successful read-only callback release safely", async () => {
  const f = fixture(); const original = new Error("Current head is stale");
  await assert.rejects(f.journal.withPublication(scope, () => { throw original; }), (error) => error === original);
  assert.equal(f.lanes.size, 0);
  assert.equal(await f.journal.withPublication(scope, () => "fresh current state"), "fresh current state");
  assert.equal(f.lanes.size, 0);
});

test("lost response and caught validation failure after writing keep durable poison", async () => {
  for (const caught of [false, true]) {
    const f = fixture();
    await assert.rejects(f.journal.withPublication(scope, async ({ write }) => {
      const request = write(async () => { throw new Error("secret remote response must not escape"); });
      if (caught) { try { await request; } catch {} return "false success"; }
      return await request;
    }), code("GUARD_PUBLICATION_UNCERTAIN"));
    assert.equal([...f.lanes.values()][0].phase, "poisoned");
    await assert.rejects(f.journal.withPublication(scope, () => assert.fail()), code("GUARD_PUBLICATION_BUSY"));
  }
});

test("callback failure even after definitive write response keeps poison", async () => {
  const f = fixture();
  await assert.rejects(f.journal.withPublication(scope, async ({ write }) => {
    await write(async () => "acknowledged"); throw undefined;
  }), code("GUARD_PUBLICATION_UNCERTAIN"));
  assert.equal([...f.lanes.values()][0].phase, "poisoned");
});

test("unawaited pending write cannot release and late HTTP completion cannot clear poison", async () => {
  const f = fixture(); const response = deferred(); const started = deferred();
  await assert.rejects(f.journal.withPublication(scope, async ({ write }) => {
    write(async () => { started.resolve(); await response.promise; });
    await started.promise;
  }), code("GUARD_PUBLICATION_UNCERTAIN"));
  assert.equal([...f.lanes.values()][0].phase, "poisoned");
  response.resolve(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal([...f.lanes.values()][0].phase, "poisoned");
});

test("unawaited already-settled write also poisons rather than timing-dependent success", async () => {
  const f = fixture(); const done = deferred();
  await assert.rejects(f.journal.withPublication(scope, async ({ write }) => {
    write(async () => { done.resolve(); return "acknowledged"; });
    await done.promise; await new Promise((resolve) => setImmediate(resolve));
  }), code("GUARD_PUBLICATION_UNCERTAIN"));
  assert.equal([...f.lanes.values()][0].phase, "poisoned");
});

test("sequential multiple writes keep one claim until every response validates", async () => {
  const f = fixture();
  await f.journal.withPublication(scope, async ({ write }) => {
    await write(async () => "invalidate old Check");
    assert.equal(f.lanes.size, 1);
    await write(async () => "publish current Check");
  });
  assert.equal(f.events.filter((event) => event === "claim").length, 1);
  assert.equal(f.events.filter((event) => event === "write").length, 1);
  assert.equal(f.lanes.size, 0);
});

test("failed poison annotation and later invocation never release the existing writing row", async () => {
  const f = fixture({ hook: async (_sql, action) => { if (action === "poison") throw new Error("database unavailable"); } });
  await assert.rejects(f.journal.withPublication(scope, async ({ write }) => await write(async () => { throw new Error("unknown"); })), code("GUARD_PUBLICATION_UNCERTAIN"));
  assert.equal(f.lanes.size, 1);
  await assert.rejects(f.journal.withPublication(scope, () => assert.fail()), code("GUARD_PUBLICATION_BUSY"));
});

test("invalid scope, missing enrollment, capacity and database failures expose only stable redacted errors", async () => {
  const f = fixture();
  for (const invalid of [{ ...scope, tenantId: "10" }, { ...scope, token: "secret" }, { ...scope, releaseSha: "main" }]) {
    await assert.rejects(f.journal.withPublication(invalid, () => assert.fail()), code("GUARD_PUBLICATION_AUTHORITY"));
  }
  assert.equal(f.events.length, 0);
  for (const [admission, expected] of [["not_enrolled", "AUTHORITY"], ["capacity", "UNAVAILABLE"]]) {
    await assert.rejects(fixture({ admission }).journal.withPublication(scope, () => assert.fail()), code(`GUARD_PUBLICATION_${expected}`));
  }
  const broken = createPostgresGuardJournal({ pool: { async connect() { throw new Error("postgres://secret@private-repository"); } } });
  await assert.rejects(broken.withPublication(scope, () => assert.fail()), (error) => {
    assert.equal(error.code, "GUARD_PUBLICATION_UNAVAILABLE");
    assert.equal(JSON.stringify(error).includes("secret"), false); return true;
  });
});
