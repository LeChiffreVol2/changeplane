// Isolated local PostgreSQL + ephemeral certificates. No provider connection,
// deployment environment, credential or existing database is used.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { postgresConnectionOptions } from "../server/postgres-connection.js";
import { createPostgresGuardJournal } from "../server/guard-publication-journal.js";
import { createPostgresPilotAdmission } from "../server/pilot-admission.js";

const root = await mkdtemp(join(tmpdir(), "changeplane-postgres-tls-"));
await chmod(root, 0o700);
const data = join(root, "data"), socket = join(root, "socket");
await mkdir(socket, { mode: 0o700 });
const binaries = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" }).stdout?.trim();
if (!binaries) throw new Error("Install PostgreSQL server tools before this test.");
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error("LOCAL_FIXTURE_COMMAND_FAILED");
};
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const adminPassword = randomBytes(24).toString("hex"), runtimePassword = randomBytes(24).toString("hex");
const epoch = randomUUID(), releaseSha = "a".repeat(40);
let started = false, admin, phase = "setup";
const adapters = [];
const url = (user, host = "localhost") => `postgresql://${user}:${runtimePassword}@${host}:${port}/postgres?sslmode=verify-full`;
const guardScope = { tenantId: 10, repositoryId: 20, installationId: 30, guardAppId: 40,
  epoch, releaseSha, revisionFingerprint: "b".repeat(64), operation: "complete" };
let passed = 0;
const pass = (message) => { passed++; console.log(`PASS: ${message}`); };
try {
  for (const name of ["ca", "other-ca"]) {
    run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-noenc", "-days", "2", "-subj", `/CN=${name}`,
      "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", join(root, `${name}.key`), "-out", join(root, `${name}.crt`)]);
  }
  run("openssl", ["req", "-new", "-newkey", "rsa:2048", "-noenc", "-subj", "/CN=localhost",
    "-keyout", join(root, "server.key"), "-out", join(root, "server.csr")]);
  await chmod(join(root, "server.key"), 0o600);
  await writeFile(join(root, "server.ext"), "basicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n");
  run("openssl", ["x509", "-req", "-in", join(root, "server.csr"), "-CA", join(root, "ca.crt"),
    "-CAkey", join(root, "ca.key"), "-set_serial", "1", "-days", "2", "-extfile", join(root, "server.ext"), "-out", join(root, "server.crt")]);
  const caCertificate = await readFile(join(root, "ca.crt"), "utf8");
  const wrongCa = await readFile(join(root, "other-ca.crt"), "utf8");
  const leaf = await readFile(join(root, "server.crt"), "utf8");
  for (const invalid of [leaf, `${caCertificate}\nprivate material`, caCertificate.repeat(5)]) {
    assert.throws(() => postgresConnectionOptions({ connectionString: url("tls_guard"), caCertificate: invalid }), TypeError);
  }
  pass("leaf certificates, appended data and oversized CA bundles fail configuration");
  await writeFile(join(root, "admin-password"), adminPassword, { mode: 0o600 });
  run(join(binaries, "initdb"), ["-D", data, "-U", "tls_admin", "-A", "scram-sha-256", "--pwfile", join(root, "admin-password"), "--no-locale", "-E", "UTF8"]);
  run(join(binaries, "pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o",
    `-k ${socket} -p ${port} -c listen_addresses=127.0.0.1 -c ssl=on -c ssl_cert_file=${join(root, "server.crt")} -c ssl_key_file=${join(root, "server.key")}`, "-w", "start"]);
  started = true;
  admin = new Client({ host: socket, port, user: "tls_admin", password: adminPassword, database: "postgres", ssl: false });
  await admin.connect();
  for (const migration of ["002_guard_publication_journal.sql", "003_pilot_admission.sql"]) {
    await admin.query(await readFile(new URL(`../database/${migration}`, import.meta.url), "utf8"));
  }
  await admin.query(`create role tls_guard login password '${runtimePassword}' in role changeplane_guard_journal_runtime`);
  await admin.query(`create role tls_pilot login password '${runtimePassword}' in role changeplane_commercial_runtime`);
  await admin.query(`insert into changeplane_guard.enrollments
    (tenant_id,repository_id,installation_id,guard_app_id,epoch,release_sha,enabled,max_lanes)
    values(10,20,30,40,$1,$2,true,4)`, [epoch, releaseSha]);
  await admin.query(`insert into changeplane_commercial.contracts
    (tenant_id,contract_id,contract_version,active,starts_at,expires_at,included_monthly,grace,max_repositories)
    values(10,$1,1,true,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',2,0,1)`, [randomUUID()]);
  await admin.query("insert into changeplane_commercial.enrollments(tenant_id,repository_id,installation_id,guard_app_id,enabled) values(10,20,30,40,true)");
  phase = "tls-authentication";
  const client = new Client({ ...postgresConnectionOptions({ connectionString: url("tls_guard"), caCertificate }), connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    assert.equal(client.connection.stream.authorized, true);
    assert.equal((await client.query("select current_user as role")).rows[0].role, "tls_guard");
  } finally { await client.end(); }
  pass("explicit CA authenticates the actual TLS PostgreSQL runtime with full hostname validation");
  for (const [certificate, host] of [[undefined, "localhost"], [wrongCa, "localhost"], [caCertificate, "127.0.0.1"]]) {
    const rejected = new Client({ ...postgresConnectionOptions({ connectionString: url("tls_guard", host), caCertificate: certificate }), connectionTimeoutMillis: 3000 });
    try { await assert.rejects(rejected.connect(), (e) => host === "127.0.0.1"
      ? e.code === "ERR_TLS_CERT_ALTNAME_INVALID"
      : ["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(e.code)); }
    finally { await rejected.end().catch(() => {}); }
  }
  pass("missing/wrong trust anchors and a mismatched hostname reject real TLS connections");
  phase = "adapter-wiring";
  const journal = createPostgresGuardJournal({ connectionString: url("tls_guard"), caCertificate }); adapters.push(journal);
  assert.equal(await journal.withPublication(guardScope, async ({ write }) => await write(async () => "synthetic acknowledgment")), "synthetic acknowledgment");
  const pilot = createPostgresPilotAdmission({ connectionString: url("tls_pilot"), caCertificate }); adapters.push(pilot);
  assert.equal((await pilot.admitEvaluation({ tenantId: 10, repositoryId: 20, installationId: 30, guardAppId: 40,
    revisionFingerprint: "c".repeat(64), evaluationGeneration: "8001.1", workflowStartedAt: new Date().toISOString(),
    capability: "verify", targetType: "pull_request" })).admitted, true);
  pass("both production adapters forward their own CA into authenticated pools and execute real transitions");
  const rejectedJournal = createPostgresGuardJournal({ connectionString: url("tls_guard"), caCertificate: wrongCa }); adapters.push(rejectedJournal);
  await assert.rejects(rejectedJournal.withPublication(guardScope, () => assert.fail()), (e) => e.code === "GUARD_PUBLICATION_UNAVAILABLE" && !e.message.includes(runtimePassword));
  const rejectedPilot = createPostgresPilotAdmission({ connectionString: url("tls_pilot"), caCertificate: wrongCa }); adapters.push(rejectedPilot);
  await assert.rejects(rejectedPilot.readUsage({ tenantId: 10, period: new Date().toISOString().slice(0,7) }), (e) => e.code === "PILOT_ADMISSION_UNAVAILABLE" && !e.message.includes(runtimePassword));
  pass("TLS failure stays redacted and prevents Guard callbacks and pilot reads");
  const overlap = createPostgresGuardJournal({ connectionString: url("tls_guard"), caCertificate: `${wrongCa}\n${caCertificate}` }); adapters.push(overlap);
  await overlap.withPublication(guardScope, () => {});
  pass("a bounded rotation bundle accepts the currently trusted server without changing global trust");
  console.log(JSON.stringify({ passed: true, checks: passed, externalRequests: 0, productionQualification: false }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, phase, code: error.code ?? "LOCAL_TLS_QUALIFICATION_FAILED" }));
  process.exitCode = 1;
} finally {
  await Promise.allSettled(adapters.map((adapter) => adapter.close()));
  await admin?.end().catch(() => {});
  const serverPidFileExists = await readFile(join(data, "postmaster.pid")).then(() => true, () => false);
  if (started || serverPidFileExists) run(join(binaries, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
  await rm(root, { recursive: true, force: true });
}
