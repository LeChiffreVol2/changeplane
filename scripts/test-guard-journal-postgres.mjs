// Local integration test only: creates its own empty PostgreSQL cluster, Unix
// socket only, and stops it in finally. Never reads deployment DB configuration.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client, Pool } from "pg";
import { createPostgresGuardJournal } from "../server/guard-publication-journal.js";
import { assertManagedMigration } from "./assert-managed-migration.mjs";
import { assertPostgresDisconnect } from "./assert-postgres-disconnect.mjs";

const root = await mkdtemp(join(tmpdir(), "changeplane-guard-journal-"));
const data = join(root, "data");
const socket = join(root, "socket");
await mkdir(socket, { mode: 0o700 });
await chmod(root, 0o700);
const port = 15493;
// pg_config resolves the locally installed server on both macOS and CI Linux.
// An explicit binary directory is supported; no deployment connection is read.
const discovery = process.argv[2] ? null : spawnSync("pg_config", ["--bindir"], { encoding: "utf8", timeout: 5000 });
const binaries = process.argv[2] ?? (discovery?.status === 0 ? discovery.stdout.trim() : null);
if (!binaries) throw new Error("Install PostgreSQL server tools or pass their binary directory as the first argument.");
const command = (binary, args) => {
  const result = spawnSync(join(binaries, binary), args, { encoding: "utf8", timeout: 30000,
    env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" } });
  if (result.status !== 0) throw new Error(`${binary} failed: ${result.stderr || result.stdout || result.error?.message}`);
  return result.stdout;
};
const start = () => command("pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-o",
  `-k ${socket} -p ${port} -c listen_addresses='' -c fsync=on -c synchronous_commit=on -c full_page_writes=on`, "-w", "start"]);
const stop = (mode = "fast") => command("pg_ctl", ["-D", data, "-m", mode, "-w", "stop"]);
const config = (user) => ({ host: socket, port, user, database: "postgres", password: "isolated-local-placeholder", ssl: false });
const connect = async (user) => { const c = new Client(config(user)); c.on("error", () => {}); await c.connect(); return c; };
const epoch = "11111111-1111-4111-8111-111111111111";
const release = "a".repeat(40);
const scope = (repositoryId, revision = "b".repeat(64), operation = "complete") => ({
  tenantId: 10, repositoryId, installationId: 30, guardAppId: 40,
  epoch, releaseSha: release, revisionFingerprint: revision, operation,
});
const params = (s, owner, action) => [s.tenantId, s.repositoryId, s.installationId, s.guardAppId,
  s.epoch, s.releaseSha, s.revisionFingerprint, s.operation, owner, action];
const transition = async (client, s, owner, action) => (await client.query(
  "select changeplane_guard.transition($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result", params(s, owner, action))).rows[0].result;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const reports = [];
const pass = (name) => { reports.push(name); console.log(`PASS: ${name}`); };
let admin;
let a;
let b;
let pool;
let started = false;
try {
  command("initdb", ["-D", data, "-U", "journal_admin", "-A", "trust", "--no-locale", "-E", "UTF8"]);
  start(); started = true;
  admin = await connect("journal_admin");
  const migration = await readFile(new URL("../database/002_guard_publication_journal.sql", import.meta.url), "utf8");
  // Precreated roles may be accepted only when bare and unprivileged. Direct
  // REVOKE cannot remove inherited pg_write_all_data or SET ROLE capabilities.
  for (const [name, inheritance, grant] of [
    ["changeplane_guard_journal_runtime", "inherit", null],
    ["changeplane_guard_journal_runtime", "noinherit", "pg_write_all_data"],
    ["changeplane_guard_journal_owner", "noinherit", "pg_read_all_data"],
  ]) {
    await admin.query(`create role ${name} nologin nosuperuser nocreatedb nocreaterole nobypassrls ${inheritance}`);
    if (grant) await admin.query(`grant ${grant} to ${name}`);
    await assert.rejects(admin.query(migration), /Guard journal roles require/u);
    await admin.query("rollback");
    assert.equal((await admin.query("select to_regnamespace('changeplane_guard') as namespace")).rows[0].namespace, null);
    assert.equal((await admin.query("select count(*)::int as n from pg_roles where rolname in ('changeplane_guard_journal_owner','changeplane_guard_journal_runtime')")).rows[0].n, 1);
    await admin.query(`drop role ${name}`);
  }
  pass("preexisting INHERIT and owner/runtime role memberships reject migration and roll back before schema creation");
  await assertManagedMigration({ admin, connect, migration, operator: "journal_migrator",
    owner: "changeplane_guard_journal_owner", runtime: "changeplane_guard_journal_runtime", schema: "changeplane_guard" });
  pass("non-superuser migration supports fresh/precreated roles, rolls back missing privileges, and restores caller session without runtime escalation");
  const catalogProbe = await readFile(new URL("../database/probes/guard_journal_catalog.sql", import.meta.url), "utf8");
  for (const role of ["anon", "authenticated", "service_role"]) await admin.query(`create role ${role} nologin`);
  const catalog = () => admin.query(catalogProbe).then((result) => result.rows[0].result);
  const initialCatalog = await catalog();
  assert.equal(initialCatalog.catalogChecksPassed, true);
  assert.equal(initialCatalog.apiRolesInspected, 3);
  assert.equal(initialCatalog.runtimeLoginVerified, false);
  assert.equal(initialCatalog.providerDurabilityVerified, false);
  for (const [drift, check] of [
    ["grant usage on schema changeplane_guard to anon", "api_role_grants_absent"],
    ["grant execute on all functions in schema changeplane_guard to public", "public_grants_absent"],
    ["grant update on changeplane_guard.enrollments to changeplane_guard_journal_runtime", "runtime_table_privileges"],
    ["alter table changeplane_guard.lanes disable row level security", "table_ownership_and_rls"],
  ]) {
    await admin.query("begin");
    try {
      await admin.query(drift);
      const changed = await catalog();
      assert.equal(changed.catalogChecksPassed, false);
      assert.equal(changed.checks[check], false);
    } finally { await admin.query("rollback"); }
  }
  assert.deepEqual(await catalog(), initialCatalog);
  pass("read-only provider catalog probe detects API/PUBLIC grants, runtime escalation and disabled RLS without claiming live qualification");
  await admin.query("create role journal_test_runtime login nosuperuser nocreatedb nocreaterole nobypassrls in role changeplane_guard_journal_runtime");
  for (const repository of [20, 21, 22, 23, 24, 25, 26, 27]) {
    await admin.query(`insert into changeplane_guard.enrollments
      (tenant_id,repository_id,installation_id,guard_app_id,epoch,release_sha,enabled,max_lanes)
      values(10,$1,30,40,$2,$3,true,$4)`, [repository, epoch, release, repository === 25 ? 1 : 4]);
  }
  await admin.query(`insert into changeplane_guard.enrollments
    (tenant_id,repository_id,installation_id,guard_app_id,epoch,release_sha,enabled,max_lanes)
    values(99,99,30,40,$1,$2,true,4)`, [epoch, release]);
  a = await connect("journal_test_runtime"); b = await connect("journal_test_runtime");
  pool = new Pool({ ...config("journal_test_runtime"), max: 4, connectionTimeoutMillis: 3000 });
  pool.on("error", () => {});
  const journal = createPostgresGuardJournal({ pool });
  const pids = await Promise.all([a, b].map(async (c) => (await c.query("select pg_backend_pid() as pid")).rows[0].pid));
  assert.notEqual(pids[0], pids[1]);
  const role = (await a.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
  const tables = (await admin.query("select relforcerowsecurity,relrowsecurity from pg_class where oid in ('changeplane_guard.enrollments'::regclass,'changeplane_guard.lanes'::regclass)")).rows;
  assert.ok(tables.every((row) => row.relforcerowsecurity && row.relrowsecurity));
  await a.query("select set_config('changeplane.guard_tenant_id','10',false)");
  assert.equal((await a.query("select * from changeplane_guard.enrollments where tenant_id=99")).rowCount, 0);
  for (const query of [
    "delete from changeplane_guard.lanes",
    "update changeplane_guard.enrollments set enabled=true",
    "insert into changeplane_guard.enrollments(tenant_id,repository_id,installation_id,guard_app_id,epoch,release_sha,max_lanes) values(10,100,30,40,'11111111-1111-4111-8111-111111111111',repeat('a',40),1)",
    "set role changeplane_guard_journal_owner",
  ]) await assert.rejects(a.query(query), (error) => error.code === "42501");
  await admin.query("set role changeplane_guard_journal_owner");
  await admin.query("select set_config('changeplane.guard_tenant_id','10',false)");
  assert.equal((await admin.query("select * from changeplane_guard.enrollments where tenant_id=99")).rowCount, 0);
  await admin.query("reset role");
  pass("runtime is nonowner/nonsuperuser/NOBYPASSRLS; FORCE RLS hides another tenant; enrollment/reset/delete denied");

  const preparedVisibility = { name: "guard_tenant_visibility",
    text: "select count(*)::int as n, min(tenant_id)::text as tenant from changeplane_guard.enrollments" };
  for (const [tenant, expected] of [["10", { n: 8, tenant: "10" }], ["99", { n: 1, tenant: "99" }],
    ["", { n: 0, tenant: null }], ["10", { n: 8, tenant: "10" }]]) {
    await a.query("select set_config('changeplane.guard_tenant_id',$1,false)", [tenant]);
    assert.deepEqual((await a.query(preparedVisibility)).rows[0], expected);
  }
  pass("prepared RLS queries refresh statement context across tenant switches and deny missing context on the same connection");

  assertPostgresDisconnect({ configuration: config("journal_test_runtime"),
    adminConfiguration: config("journal_admin"), adapter: "guard", scope: scope(20) });
  assert.equal((await admin.query("select count(*)::int as n from changeplane_guard.lanes where repository_id=20")).rows[0].n, 0);
  pass("checked-out client disconnect between queries fails closed without process crash or committed reservation");

  const owners = [randomUUID(), randomUUID()];
  const claims = await Promise.all([transition(a, scope(20), owners[0], "claim"), transition(b, scope(20), owners[1], "claim")]);
  assert.deepEqual([...claims].sort(), ["busy", "claimed"]);
  const winningOwner = owners[claims.indexOf("claimed")];
  assert.equal(await transition(b, scope(20), winningOwner, "release_reserved"), "ok");
  pass("two independent PostgreSQL backends atomically admit exactly one owner");

  const original = scope(21); const owner = randomUUID();
  assert.equal(await transition(a, original, owner, "claim"), "claimed");
  for (const override of [{ tenantId: 99 }, { installationId: 31 }, { guardAppId: 41 },
    { epoch: randomUUID() }, { releaseSha: "c".repeat(40) }]) {
    assert.equal(await transition(b, { ...original, ...override }, randomUUID(), "claim"), "not_enrolled");
  }
  assert.equal(await transition(b, { ...original, operation: "begin" }, randomUUID(), "claim"), "busy");
  assert.equal(await transition(b, original, randomUUID(), "release_reserved"), "not_owner");
  assert.equal(await transition(a, original, owner, "release_reserved"), "ok");
  const replacementOwner = randomUUID();
  assert.equal(await transition(b, original, replacementOwner, "claim"), "claimed");
  assert.equal(await transition(a, original, owner, "release_reserved"), "not_owner");
  assert.equal(await transition(a, original, owner, "write"), "not_owner");
  assert.equal(await transition(b, original, replacementOwner, "release_reserved"), "ok");
  pass("enrollment binds tenant/principal/epoch/release; operation kinds share lane; stale owner cannot write or release");

  const entered = deferred(); const response = deferred();
  let checkGeneration = 1; let mutableReads = 0;
  const old = journal.withPublication(scope(22), async ({ write }) => {
    mutableReads++;
    await write(async () => { entered.resolve(); await response.promise; checkGeneration = 1; return { generation: 1 }; });
  });
  await entered.promise;
  await assert.rejects(journal.withPublication(scope(22, "b".repeat(64), "begin"), () => { mutableReads++; }), (error) => error.code === "GUARD_PUBLICATION_BUSY");
  assert.equal(mutableReads, 1);
  response.resolve(); await old;
  await journal.withPublication(scope(22, "b".repeat(64), "begin"), async ({ write }) => {
    mutableReads++; await write(async () => { checkGeneration = 2; });
  });
  await journal.withPublication(scope(22), () => { mutableReads++; assert.equal(checkGeneration, 2); });
  assert.equal(mutableReads, 3);
  pass("delayed completion excludes newer begin; duplicate retry re-reads current generation without cached PASS");

  await assert.rejects(journal.withPublication(scope(23), async ({ write }) => {
    await write(async () => { throw new Error("HTTP response lost after local simulated external write"); });
  }), (error) => error.code === "GUARD_PUBLICATION_UNCERTAIN");
  assert.equal((await admin.query("select phase from changeplane_guard.lanes where repository_id=23")).rows[0].phase, "poisoned");
  await assert.rejects(journal.withPublication(scope(23), () => assert.fail()), (error) => error.code === "GUARD_PUBLICATION_BUSY");
  pass("unknown HTTP outcome leaves durable poison and excludes every duplicate");

  const quotaOwners = [randomUUID(), randomUUID()];
  const capacity = await Promise.all([
    transition(a, scope(25, "c".repeat(64)), quotaOwners[0], "claim"),
    transition(b, scope(25, "d".repeat(64)), quotaOwners[1], "claim"),
  ]);
  assert.deepEqual([...capacity].sort(), ["capacity", "claimed"]);
  assert.equal((await admin.query("select count(*)::int as n from changeplane_guard.lanes where repository_id=25")).rows[0].n, 1);
  pass("concurrent distinct revision claims respect the administrative per-enrollment cap");

  await admin.query("begin");
  await admin.query("select repository_id from changeplane_guard.enrollments where repository_id=26 for update");
  let blockedCallbackRan = false;
  try {
    await assert.rejects(journal.withPublication(scope(26), () => { blockedCallbackRan = true; }),
      (error) => error.code === "GUARD_PUBLICATION_UNAVAILABLE");
  } finally { await admin.query("rollback"); }
  assert.equal(blockedCallbackRan, false);
  assert.equal((await admin.query("select count(*)::int as n from changeplane_guard.lanes where repository_id=26")).rows[0].n, 0);
  pass("bounded SQL lock wait fails closed before callback or external mutation");

  const crashOwner = randomUUID();
  assert.equal(await transition(a, scope(24), crashOwner, "claim"), "claimed");
  assert.equal(await transition(a, scope(24), crashOwner, "write"), "ok");
  await admin.query("select pg_terminate_backend($1)", [pids[0]]);
  await a.end().catch(() => {}); a = null;
  assert.equal(await transition(b, scope(24), randomUUID(), "claim"), "busy");
  await admin.query("update changeplane_guard.lanes set claimed_at=clock_timestamp()-interval '100 years' where repository_id=24");
  assert.equal(await transition(b, scope(24), randomUUID(), "claim"), "busy");
  await assert.rejects(admin.query("update changeplane_guard.enrollments set epoch=$1 where repository_id=24", [randomUUID()]), (error) => error.code === "23503");
  pass("connection termination and age cannot free committed writing claim; active binding cannot change epoch");

  await b.end(); b = null;
  await pool.end(); pool = null;
  await admin.end(); admin = null;
  stop("immediate"); started = false;
  start(); started = true;
  b = await connect("journal_test_runtime");
  assert.equal(await transition(b, scope(24), randomUUID(), "claim"), "busy");
  assert.equal(await transition(b, scope(23), randomUUID(), "claim"), "busy");
  pass("PostgreSQL immediate-stop crash recovery preserves acknowledged writing and poisoned reservations");

  await writeFile(join(root, "results.json"), JSON.stringify({ tests: reports, postgresBackends: pids,
    boundary: "Local PostgreSQL only; external writes simulated. No GitHub proof, production provisioning, replication/failover/restore or service-capacity evidence." }, null, 2));
  console.log(`${reports.length} PostgreSQL checks passed. Evidence: ${join(root, "results.json")}`);
} finally {
  await Promise.allSettled([a?.end(), b?.end(), pool?.end(), admin?.end()]);
  if (started) { stop("immediate"); console.log("Isolated PostgreSQL server stopped."); }
}
