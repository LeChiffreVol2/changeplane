// Independent local COMMERCIAL database integration test. Never reads deployment
// connection strings. Creates one empty Unix-socket-only cluster and stops it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client, Pool } from "pg";
import { createPostgresPilotAdmission } from "../server/pilot-admission.js";
import { assertManagedMigration } from "./assert-managed-migration.mjs";

// Keep the socket path below macOS's 103-byte Unix socket limit.
const root = await mkdtemp(join(tmpdir(), "cp-pilot-"));
const data = join(root, "data");
const socket = join(root, "socket");
await mkdir(socket, { mode: 0o700 }); await chmod(root, 0o700);
const port = 15494;
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
const stop = () => command("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
const config = (user) => ({ host: socket, port, user, database: "postgres", password: "isolated-local-placeholder", ssl: false });
const connect = async (user) => { const client = new Client(config(user)); client.on("error", () => {}); await client.connect(); return client; };
const evaluationSql = "select changeplane_commercial.evaluation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result";
const parameters = (s, action = "admit") => [s.tenantId, s.repositoryId, s.installationId, s.guardAppId,
  s.revisionFingerprint, s.evaluationGeneration, s.workflowStartedAt, s.capability, s.targetType, action];
const evaluate = async (client, scope, action) => (await client.query(evaluationSql, parameters(scope, action))).rows[0].result;
const reports = [];
const pass = (name) => { reports.push(name); console.log(`PASS: ${name}`); };
let admin; let a; let b; let pool; let started = false;
try {
  command("initdb", ["-D", data, "-U", "pilot_admin", "-A", "trust", "--no-locale", "-E", "UTF8"]);
  start(); started = true;
  admin = await connect("pilot_admin");
  const migration = await readFile(new URL("../database/003_pilot_admission.sql", import.meta.url), "utf8");
  for (const [name, inheritance, grant] of [
    ["changeplane_commercial_runtime", "inherit", null],
    ["changeplane_commercial_runtime", "noinherit", "pg_write_all_data"],
    ["changeplane_commercial_owner", "noinherit", "pg_read_all_data"],
  ]) {
    await admin.query(`create role ${name} nologin nosuperuser nocreatedb nocreaterole nobypassrls ${inheritance}`);
    if (grant) await admin.query(`grant ${grant} to ${name}`);
    await assert.rejects(admin.query(migration), /Pilot admission roles require/u);
    await admin.query("rollback");
    assert.equal((await admin.query("select to_regnamespace('changeplane_commercial') as namespace")).rows[0].namespace, null);
    await admin.query(`drop role ${name}`);
  }
  await assertManagedMigration({ admin, connect, migration, operator: "pilot_migrator",
    owner: "changeplane_commercial_owner", runtime: "changeplane_commercial_runtime", schema: "changeplane_commercial" });
  pass("non-superuser migration supports fresh/precreated roles, rolls back missing privileges, and restores caller session without runtime escalation");
  await admin.query("create role pilot_test_runtime login nosuperuser nocreatedb nocreaterole nobypassrls in role changeplane_commercial_runtime");
  // All runtime connections use a non-UTC timezone; accounting must still be UTC.
  await admin.query("alter role pilot_test_runtime set timezone='Pacific/Kiritimati'");
  pass("fresh isolated roles migrate; inherited privileges and owner/runtime memberships reject and roll back");

  const instant = (await admin.query("select clock_timestamp() as instant")).rows[0].instant;
  const workflowStartedAt = new Date(instant.valueOf() - 30000).toISOString();
  const currentPeriod = instant.toISOString().slice(0, 7);
  const scope = (tenantId, repositoryId, generation, overrides = {}) => ({ tenantId, repositoryId,
    installationId: tenantId * 10, guardAppId: 40, revisionFingerprint: "b".repeat(64),
    evaluationGeneration: generation, workflowStartedAt, capability: "verify", targetType: "pull_request", ...overrides });
  async function enroll(tenant, repositories, included = 10, grace = 0, maximum = repositories.length) {
    await admin.query(`insert into changeplane_commercial.contracts
      (tenant_id,contract_id,contract_version,active,starts_at,expires_at,included_monthly,grace,max_repositories)
      values($1,$2,1,true,clock_timestamp()-interval '1 day',clock_timestamp()+interval '5 days',$3,$4,$5)`,
    [tenant, randomUUID(), included, grace, maximum]);
    for (const repository of repositories) await admin.query(`insert into changeplane_commercial.enrollments
      (tenant_id,repository_id,installation_id,guard_app_id,enabled) values($1,$2,$3,40,true)`, [tenant, repository, tenant * 10]);
  }
  await enroll(10, [20, 21], 1);
  await enroll(99, [99], 10);
  await enroll(11, [110], 1, 1);
  await enroll(12, [120, 121], 10, 0, 1);
  await enroll(13, [130], 10);
  await enroll(14, [140], 10);
  await enroll(16, [160], 10);
  a = await connect("pilot_test_runtime"); b = await connect("pilot_test_runtime");
  pool = new Pool({ ...config("pilot_test_runtime"), max: 4, connectionTimeoutMillis: 3000 });
  pool.on("error", () => {});
  const store = createPostgresPilotAdmission({ pool });
  const pids = await Promise.all([a, b].map(async (client) => (await client.query("select pg_backend_pid() as pid")).rows[0].pid));
  assert.notEqual(pids[0], pids[1]);
  assert.deepEqual((await a.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0], { rolsuper: false, rolbypassrls: false });
  for (const query of ["select * from changeplane_commercial.admission_receipts",
    "delete from changeplane_commercial.admission_receipts", "update changeplane_commercial.monthly_usage set evaluations=0",
    "update changeplane_commercial.contracts set included_monthly=1000", "delete from changeplane_commercial.enrollments",
    "set role changeplane_commercial_owner"])
    await assert.rejects(a.query(query), (error) => error.code === "42501");
  const policies = (await admin.query("select relforcerowsecurity,relrowsecurity from pg_class where relnamespace='changeplane_commercial'::regnamespace and relkind='r'")).rows;
  assert.equal(policies.length, 4); assert.ok(policies.every((row) => row.relforcerowsecurity && row.relrowsecurity));
  await admin.query("set role changeplane_commercial_owner");
  await admin.query("select set_config('changeplane.commercial_tenant_id','10',false)");
  assert.equal((await admin.query("select * from changeplane_commercial.contracts where tenant_id=99")).rowCount, 0);
  await admin.query("reset role");
  pass("runtime has RPC-only privileges and no enrollment/refund/prune authority; FORCE RLS also binds table owner");

  const contenders = [scope(10, 20, "8001.1"), scope(10, 21, "8002.1")];
  const decisions = await Promise.all([evaluate(a, contenders[0]), evaluate(b, contenders[1])]);
  assert.equal(decisions.filter((result) => result.admitted).length, 1);
  assert.equal(decisions.find((result) => !result.admitted).reason, "quota_exhausted");
  const acceptedScope = contenders[decisions.findIndex((result) => result.admitted)];
  const acceptedReceipt = decisions.find((result) => result.admitted);
  assert.equal(acceptedReceipt.period, currentPeriod);
  assert.equal(acceptedReceipt.admittedAt.slice(0, 7), currentPeriod);
  assert.equal((await store.readUsage({ tenantId: 10, period: currentPeriod })).evaluations, 1);
  const duplicate = await store.admitEvaluation(acceptedScope);
  assert.deepEqual(duplicate, { ...acceptedReceipt, duplicate: true, reason: "already_admitted" });
  assert.equal((await store.readUsage({ tenantId: 10, period: currentPeriod })).evaluations, 1);
  assert.equal((await store.admitEvaluation(scope(99, 99, "9001.1"))).admitted, true);
  assert.equal((await store.readUsage({ tenantId: 99, period: currentPeriod })).evaluations, 1);
  assert.equal((await store.admitEvaluation(scope(99, 20, "9002.1"))).reason, "not_enrolled");
  pass("two PostgreSQL backends race for final tenant slot; one charges, exact duplicate does not, another tenant remains independent");

  for (const altered of [{ revisionFingerprint: "c".repeat(64) }, { workflowStartedAt: new Date(instant.valueOf() - 20000).toISOString() },
    { capability: "repair" }, { targetType: "merge_group" }]) {
    await assert.rejects(store.admitEvaluation({ ...acceptedScope, ...altered }), (error) => error.code === "PILOT_ADMISSION_AUTHORITY");
  }
  assert.equal((await store.admitEvaluation({ ...acceptedScope, installationId: 99999 })).reason, "not_enrolled");
  assert.equal(await store.readAdmission({ ...acceptedScope, guardAppId: 41 }), null);
  pass("generation cannot rebind target fingerprint, authenticated start, capability or principal");

  await admin.query("update changeplane_commercial.contracts set active=false,starts_at=clock_timestamp()-interval '10 days',expires_at=clock_timestamp()-interval '1 day' where tenant_id=10");
  await admin.query("update changeplane_commercial.enrollments set enabled=false where tenant_id=10");
  assert.deepEqual(await store.readAdmission(acceptedScope), duplicate);
  assert.deepEqual(await store.admitEvaluation(acceptedScope), duplicate);
  assert.equal((await store.admitEvaluation({ ...acceptedScope, evaluationGeneration: "8010.1" })).reason, "contract_inactive");
  await admin.query("update changeplane_commercial.contracts set active=true where tenant_id=10");
  assert.equal((await store.admitEvaluation({ ...acceptedScope, evaluationGeneration: "8011.1" })).reason, "contract_expired");
  pass("accepted receipt survives contract expiry, deactivation and disabled enrollment without consuming quota again");

  assert.equal((await store.admitEvaluation(scope(11, 110, "11001.1"))).graceRemaining, 1);
  const lastGrace = await store.admitEvaluation(scope(11, 110, "11002.1"));
  assert.equal(lastGrace.evaluations, 2); assert.equal(lastGrace.graceRemaining, 0);
  assert.equal((await store.admitEvaluation(scope(11, 110, "11003.1"))).reason, "quota_exhausted");
  assert.equal((await store.admitEvaluation(scope(12, 120, "12001.1"))).reason, "repository_limit");
  assert.equal((await store.admitEvaluation(scope(13, 130, "13001.1", { capability: "queue", targetType: "merge_group" }))).reason, "unsupported_capability");
  assert.equal((await store.readUsage({ tenantId: 12, period: currentPeriod })).evaluations, 0);
  pass("included plus finite explicit grace is enforced prospectively; over-enrolled repositories and Queue/repair do not charge");

  for (const timestamp of [new Date(instant.valueOf() - 2 * 86400000).toISOString(), new Date(instant.valueOf() + 86400000).toISOString()]) {
    assert.equal((await store.admitEvaluation(scope(13, 130, "13002.1", { workflowStartedAt: timestamp }))).reason, "workflow_outside_contract");
  }
  assert.deepEqual(await evaluate(a, scope(13, 130, "13003.1", { workflowStartedAt: "2026-02-30T00:00:00.000Z" })), { error: "authority" });
  await admin.query("update changeplane_commercial.contracts set starts_at=clock_timestamp()+interval '1 day',expires_at=clock_timestamp()+interval '2 days' where tenant_id=14");
  assert.equal((await store.admitEvaluation(scope(14, 140, "14001.1"))).reason, "contract_not_started");
  for (const update of ["expires_at=starts_at+interval '31 days'", "included_monthly=0", "included_monthly=1000001", "grace=11", "max_repositories=51", "starts_at='-infinity'"]) {
    await assert.rejects(admin.query(`update changeplane_commercial.contracts set ${update} where tenant_id=13`), (error) => error.code === "23514");
  }
  pass("DB clock and authenticated workflow time enforce <=30-day contracts; malformed times and unbounded limits reject");

  let lost = false;
  const observedActions = [];
  const uncertainStore = createPostgresPilotAdmission({ pool: { async connect() {
    const client = await pool.connect();
    return { async query(query, values) {
      if (values) observedActions.push(values[9]);
      const result = await client.query(query, values);
      if (query === "commit" && !lost) { lost = true; throw new Error("local simulated COMMIT reply loss"); }
      return result;
    }, release() { client.release(); } };
  } } });
  const recovered = await uncertainStore.admitEvaluation(scope(99, 99, "9003.1"));
  assert.equal(recovered.admitted, true); assert.equal(recovered.duplicate, true);
  assert.deepEqual(observedActions, ["admit", "read"]);
  assert.equal((await store.readUsage({ tenantId: 99, period: currentPeriod })).evaluations, 2);
  pass("lost COMMIT acknowledgment recovers via exact receipt read; no repeated mutation or double charge");

  // Seed a genuine-shaped historical receipt with the administrative fixture role.
  // It represents an expired contract, not a caller-selected current admission time.
  const oldAdmission = new Date(instant.valueOf() - 100 * 86400000);
  const oldWorkflow = new Date(instant.valueOf() - 101 * 86400000).toISOString();
  const oldPeriod = oldAdmission.toISOString().slice(0, 7);
  const oldScope = scope(16, 160, "16001.1", { workflowStartedAt: oldWorkflow });
  await admin.query("insert into changeplane_commercial.monthly_usage values(16,$1,1)", [`${oldPeriod}-01`]);
  await admin.query(`insert into changeplane_commercial.admission_receipts
    (tenant_id,repository_id,installation_id,guard_app_id,revision_fingerprint,evaluation_generation,workflow_started_at,
     capability,target_type,contract_id,contract_version,contract_starts_at,contract_expires_at,included_monthly,grace,max_repositories,period,evaluations,admitted_at)
    values(16,160,160,40,$1,'16001.1',$2,'verify','pull_request',$3,1,$4,$5,10,0,1,$6,1,$7)`,
  [oldScope.revisionFingerprint, oldWorkflow, randomUUID(), new Date(instant.valueOf() - 110 * 86400000),
    new Date(instant.valueOf() - 90 * 86400000), `${oldPeriod}-01`, oldAdmission]);
  const historical = await store.admitEvaluation(oldScope);
  assert.equal(historical.duplicate, true); assert.equal(historical.period, oldPeriod);
  assert.equal((await store.readUsage({ tenantId: 16, period: currentPeriod })).evaluations, 0);
  await admin.query("delete from changeplane_commercial.admission_receipts where tenant_id=16 and admitted_at < clock_timestamp()-interval '90 days'");
  assert.equal(await store.readAdmission(oldScope), null);
  assert.equal((await store.admitEvaluation(oldScope)).reason, "workflow_outside_contract");
  assert.deepEqual(await store.readUsage({ tenantId: 16, period: oldPeriod }), { tenantId: 16, period: oldPeriod, evaluations: 1 });
  assert.equal((await store.readUsage({ tenantId: 16, period: currentPeriod })).evaluations, 0);
  pass("duplicate keeps original UTC month; operator 90-day receipt pruning preserves counter and old generation cannot replay into renewed contract");

  await admin.query("begin");
  await admin.query("select tenant_id from changeplane_commercial.contracts where tenant_id=13 for update");
  try { await assert.rejects(store.admitEvaluation(scope(13, 130, "13004.1")), (error) => error.code === "PILOT_ADMISSION_UNAVAILABLE"); }
  finally { await admin.query("rollback"); }
  assert.equal((await store.readUsage({ tenantId: 13, period: currentPeriod })).evaluations, 0);
  pass("bounded contract lock timeout leaves no accepted receipt or usage charge");

  // Operator protocol: enrollment changes take the same tenant contract lock.
  // No runtime DML or alternate enrollment API exists in this candidate.
  await admin.query("begin");
  await admin.query("select tenant_id from changeplane_commercial.contracts where tenant_id=13 for update");
  await admin.query("update changeplane_commercial.enrollments set enabled=false where tenant_id=13");
  const waitingAdmission = store.admitEvaluation(scope(13, 130, "13005.1"));
  waitingAdmission.catch(() => {});
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 50 && !blocked; attempt++) {
      blocked = (await admin.query("select exists(select 1 from pg_stat_activity where usename='pilot_test_runtime' and wait_event_type='Lock') as blocked")).rows[0].blocked;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, "Runtime admission must wait on the operator's tenant contract lock");
  } finally { await admin.query("commit"); }
  assert.equal((await waitingAdmission).reason, "not_enrolled");
  assert.equal((await store.readUsage({ tenantId: 13, period: currentPeriod })).evaluations, 0);
  pass("operator holds tenant contract lock for enrollment change; blocked runtime admission observes committed disable and does not charge");

  await a.end(); a = null; await b.end(); b = null;
  await pool.end(); pool = null; await admin.end(); admin = null;
  stop(); started = false; start(); started = true;
  b = await connect("pilot_test_runtime");
  assert.deepEqual(await evaluate(b, acceptedScope, "read"), duplicate);
  assert.equal((await b.query("select changeplane_commercial.read_usage(99,$1) as result", [currentPeriod])).rows[0].result.evaluations, 2);
  pass("immediate PostgreSQL crash/restart preserves admitted receipts and monotonic monthly counters");
  await writeFile(join(root, "results.json"), JSON.stringify({ tests: reports, postgresBackends: pids,
    boundary: "Isolated commercial PostgreSQL only. No production provisioning, billing, live GitHub authorization, replication/failover or operational retention proof." }, null, 2));
  console.log(`${reports.length} PostgreSQL pilot checks passed. Evidence: ${join(root, "results.json")}`);
} finally {
  await Promise.allSettled([a?.end(), b?.end(), pool?.end(), admin?.end()]);
  if (started) { stop(); console.log("Isolated pilot PostgreSQL server stopped."); }
}
