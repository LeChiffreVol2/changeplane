// Scratch PostgreSQL only. A child process makes an unhandled driver error a
// test failure without killing the parent before it can stop its test cluster.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export function assertPostgresDisconnect({ configuration, adminConfiguration, adapter, scope }) {
  const program = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { Pool, Client } from ${JSON.stringify(import.meta.resolve("pg"))};
    import { createPostgresGuardJournal } from ${JSON.stringify(new URL("../server/guard-publication-journal.js", import.meta.url).href)};
    import { createPostgresPilotAdmission } from ${JSON.stringify(new URL("../server/pilot-admission.js", import.meta.url).href)};
    const { configuration, adminConfiguration, adapter, scope, boundary } = JSON.parse(readFileSync(0, 'utf8'));
    const admin = new Client(adminConfiguration);
    admin.on('error', () => {});
    await admin.connect();
    const pool = new Pool({ ...configuration, max: 1, connectionTimeoutMillis: 2000 });
    pool.on('error', () => {});
    const connect = pool.connect.bind(pool);
    let terminated = false;
    let callbacks = 0;
    pool.connect = async () => {
      const client = await connect();
      const query = client.query.bind(client);
      client.query = async (...args) => {
        const result = await query(...args);
        if (!terminated && (boundary === 'begin' ? args[0] === 'begin' : args[1]?.length === 10)) {
          terminated = true;
          const ended = new Promise(resolve => client.once('end', resolve));
          await admin.query('select pg_terminate_backend($1)', [client.processID]);
          await ended;
        }
        return result;
      };
      return client;
    };
    try {
      if (adapter === 'guard') {
        await assert.rejects(createPostgresGuardJournal({ pool }).withPublication(scope, () => callbacks++),
          error => error.code === 'GUARD_PUBLICATION_UNAVAILABLE');
      } else {
        await assert.rejects(createPostgresPilotAdmission({ pool }).admitEvaluation(scope),
          error => error.code === 'PILOT_ADMISSION_UNAVAILABLE');
      }
      assert.equal(terminated, true);
      assert.equal(callbacks, 0);
      console.log(JSON.stringify({ passed: true, callbacks, terminated }));
    } finally { await pool.end(); await admin.end(); }
  `;
  for (const boundary of ["begin", "operation"]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      input: JSON.stringify({ configuration, adminConfiguration, adapter, scope, boundary }),
      encoding: "utf8", timeout: 10000,
    });
    assert.equal(child.status, 0, `${adapter} disconnect after ${boundary}: ${child.stderr}`);
    assert.deepEqual(JSON.parse(child.stdout), { passed: true, callbacks: 0, terminated: true });
  }
}
