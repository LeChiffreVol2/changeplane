import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const FIELDS = new Set([
  "tenantId", "repositoryId", "installationId", "guardAppId", "epoch", "releaseSha",
  "revisionFingerprint", "operation",
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const QUERY = "select changeplane_guard.transition($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result";
const TRANSACTION_SETTINGS = "set local synchronous_commit = on; set local lock_timeout = '2s'; set local statement_timeout = '5s'";

export class GuardPublicationError extends Error {
  constructor(code) {
    super("Guard publication requires a safe journal reservation.");
    this.name = "GuardPublicationError";
    this.code = code;
  }
}

function validateScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)
    || Object.keys(scope).some((field) => !FIELDS.has(field))
    || ["tenantId", "repositoryId", "installationId", "guardAppId"].some((field) => (
      !Number.isSafeInteger(scope[field]) || scope[field] <= 0
    ))
    || !UUID.test(scope.epoch ?? "")
    || !/^[a-f0-9]{40}$/u.test(scope.releaseSha ?? "")
    || !/^[a-f0-9]{64}$/u.test(scope.revisionFingerprint ?? "")
    || !["begin", "complete", "reconcile"].includes(scope.operation)) {
    throw new GuardPublicationError("GUARD_PUBLICATION_AUTHORITY");
  }
  return Object.freeze({ ...scope });
}

/**
 * Candidate authority adapter; no provisioning or enablement is performed here.
 * One authoritative durable DB history is required: no lost acknowledged claims,
 * replica reads, expiry, restored-epoch reuse, or unfenced administrative cleanup.
 * All mutable Guard reads and response validation belong inside callback. Every
 * external mutation belongs inside an awaited write thunk. No transport retries
 * or side effects may escape that thunk; GitHub has no fencing-token/CAS support.
 */
export function createPostgresGuardJournal({ connectionString, pool } = {}) {
  if (!pool && (typeof connectionString !== "string" || !connectionString)) {
    throw new GuardPublicationError("GUARD_PUBLICATION_UNAVAILABLE");
  }
  const database = pool ?? new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, application_name: "changeplane_guard_journal" });
  // Idle connection failures must not crash the host. They never release claims.
  if (!pool) database.on("error", () => {});

  async function transition(scope, owner, action) {
    let client;
    try {
      client = await database.connect();
      await client.query("begin");
      // Never inherit asynchronous commits from a connection/pool. Accepted
      // failover histories must additionally preserve these commits (ops gate).
      await client.query(TRANSACTION_SETTINGS);
      const reply = await client.query(QUERY, [scope.tenantId, scope.repositoryId,
        scope.installationId, scope.guardAppId, scope.epoch, scope.releaseSha,
        scope.revisionFingerprint, scope.operation, owner, action]);
      if (reply.rows?.length !== 1 || typeof reply.rows[0].result !== "string") {
        throw new Error("Invalid journal reply");
      }
      await client.query("commit");
      return reply.rows[0].result;
    } catch {
      await client?.query("rollback").catch(() => {});
      throw new GuardPublicationError("GUARD_PUBLICATION_UNAVAILABLE");
    } finally {
      client?.release();
    }
  }

  return Object.freeze({
    async withPublication(input, callback) {
      const scope = validateScope(input);
      if (typeof callback !== "function") throw new GuardPublicationError("GUARD_PUBLICATION_AUTHORITY");
      const owner = randomUUID();
      const claimed = await transition(scope, owner, "claim");
      if (claimed !== "claimed") {
        const codes = { busy: "BUSY", capacity: "UNAVAILABLE", not_enrolled: "AUTHORITY", invalid_scope: "AUTHORITY" };
        throw new GuardPublicationError(`GUARD_PUBLICATION_${codes[claimed] ?? "UNAVAILABLE"}`);
      }
      let closed = false;
      let writing = false;
      let failedWrite = false;
      let activeWrite = false;
      const writes = [];
      // Deliberately return a thenable, so a forgotten await is detectable even
      // when its HTTP promise happens to settle before callback returns.
      function write(mutateAndValidate) {
        if (closed || activeWrite || typeof mutateAndValidate !== "function") {
          failedWrite = true;
          throw new GuardPublicationError("GUARD_PUBLICATION_AUTHORITY");
        }
        activeWrite = true;
        const first = !writing;
        writing = true;
        const tracked = { observed: false, settled: false };
        writes.push(tracked);
        const pending = (async () => {
          try {
            if (first && await transition(scope, owner, "write") !== "ok") {
              throw new GuardPublicationError("GUARD_PUBLICATION_UNAVAILABLE");
            }
            if (closed) throw new GuardPublicationError("GUARD_PUBLICATION_AUTHORITY");
            return await mutateAndValidate();
          } catch (error) {
            failedWrite = true;
            throw error;
          } finally {
            tracked.settled = true;
            activeWrite = false;
          }
        })();
        // A discarded thenable cannot create an unhandled rejection. It still
        // poisons the reservation; this handler never converts failure to PASS.
        pending.catch(() => {});
        return { then(resolve, reject) { tracked.observed = true; return pending.then(resolve, reject); } };
      }

      let result;
      let failure;
      let callbackFailed = false;
      try { result = await callback(Object.freeze({ write })); } catch (error) { callbackFailed = true; failure = error; }
      closed = true;
      if (writing && (callbackFailed || failedWrite || writes.some((entry) => !entry.observed || !entry.settled))) {
        // Best effort annotation only. If DB is unreachable, its existing
        // reserved/writing row remains held just as strongly as poisoned.
        await transition(scope, owner, "poison").catch(() => {});
        throw new GuardPublicationError("GUARD_PUBLICATION_UNCERTAIN");
      }
      const released = await transition(scope, owner, writing ? "release_written" : "release_reserved");
      if (released !== "ok") throw new GuardPublicationError("GUARD_PUBLICATION_UNAVAILABLE");
      if (callbackFailed) throw failure;
      if (failedWrite) throw new GuardPublicationError("GUARD_PUBLICATION_AUTHORITY");
      return result;
    },
    async close() { if (!pool) await database.end(); },
  });
}
