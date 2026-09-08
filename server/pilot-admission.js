import { Pool } from "pg";
import { postgresConnectionOptions } from "./postgres-connection.js";

const SCOPE_FIELDS = new Set(["tenantId", "repositoryId", "installationId", "guardAppId",
  "revisionFingerprint", "evaluationGeneration", "workflowStartedAt", "capability", "targetType"]);
const RESULT_FIELDS = new Set(["admitted", "duplicate", "reason", "period", "evaluations", "included", "graceRemaining", "admittedAt"]);
const DENIALS = new Set(["not_enrolled", "contract_inactive", "contract_not_started", "contract_expired",
  "repository_limit", "unsupported_capability", "quota_exhausted", "workflow_outside_contract"]);
const PERIOD = /^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$/u;
const EVALUATION = "select changeplane_commercial.evaluation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result";
const USAGE = "select changeplane_commercial.read_usage($1,$2) as result";
const SETTINGS = "set local synchronous_commit = on; set local lock_timeout = '2s'; set local statement_timeout = '5s'";

export class PilotAdmissionError extends Error {
  constructor(code) {
    super("Pilot evaluation requires a verified admission contract.");
    this.name = "PilotAdmissionError";
    this.code = code;
  }
}

class DatabaseFailure extends Error {
  constructor(commitUnknown) { super("Pilot admission database is unavailable."); this.commitUnknown = commitUnknown; }
}
const authority = () => new PilotAdmissionError("PILOT_ADMISSION_AUTHORITY");
const unavailable = () => new PilotAdmissionError("PILOT_ADMISSION_UNAVAILABLE");
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const boundedInteger = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
function canonicalTime(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}
function normalizeScope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !SCOPE_FIELDS.has(key))) throw authority();
  const scope = { ...input };
  if (![scope.tenantId, scope.repositoryId, scope.installationId, scope.guardAppId].every(positiveId)
    || !/^[a-f0-9]{64}$/u.test(scope.revisionFingerprint ?? "")
    || !/^[1-9][0-9]{0,19}\.[1-9][0-9]{0,9}$/u.test(scope.evaluationGeneration ?? "")
    || !canonicalTime(scope.workflowStartedAt)
    || !/^[a-z][a-z_]{0,31}$/u.test(scope.capability ?? "")
    || !/^[a-z][a-z_]{0,31}$/u.test(scope.targetType ?? "")) throw authority();
  return Object.freeze(scope);
}
function admissionResult(result, allowNull = false) {
  if (result === null && allowNull) return null;
  if (result?.error === "authority") throw authority();
  if (!result || typeof result !== "object" || Array.isArray(result)
    || Object.keys(result).length !== RESULT_FIELDS.size
    || Object.keys(result).some((key) => !RESULT_FIELDS.has(key))
    || typeof result.admitted !== "boolean" || typeof result.duplicate !== "boolean"
    || !PERIOD.test(result.period ?? "")
    || !boundedInteger(result.evaluations, 1010000) || !boundedInteger(result.included, 1000000)
    || !boundedInteger(result.graceRemaining, Math.max(10, Math.ceil(result.included * 0.01)))
    || (result.admitted
      ? result.reason !== (result.duplicate ? "already_admitted" : "admitted")
        || result.included < 1 || result.evaluations < 1
        || result.evaluations > result.included + Math.max(10, Math.ceil(result.included * 0.01))
        || !canonicalTime(result.admittedAt) || result.admittedAt.slice(0, 7) !== result.period
      : result.duplicate || !DENIALS.has(result.reason) || result.admittedAt !== null)) throw unavailable();
  return Object.freeze({ ...result });
}

/** Finite operator-enrolled pilot accounting only; never telemetry or PASS evidence.
 * Scope must come from authenticated GitHub metadata, including exact target
 * fingerprint and the live workflow-attempt start time. No customer clocks.
 * This adapter never provisions contracts, refunds, prunes, or changes limits.
 */
export function createPostgresPilotAdmission({ connectionString, caCertificate, pool } = {}) {
  let connection;
  if (!pool) {
    try { connection = postgresConnectionOptions({ connectionString, caCertificate }); }
    catch { throw unavailable(); }
  }
  const database = pool ?? new Pool({ ...connection, max: 4, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, application_name: "changeplane_pilot_admission" });
  if (!pool) database.on("error", () => {});

  async function transaction(query, parameters, validate) {
    let client;
    let commitUnknown = false;
    try {
      client = await database.connect();
      await client.query("begin");
      await client.query(SETTINGS);
      const reply = await client.query(query, parameters);
      if (reply.rows?.length !== 1) throw unavailable();
      const result = validate(reply.rows[0].result);
      commitUnknown = true;
      await client.query("commit");
      return result;
    } catch (error) {
      await client?.query("rollback").catch(() => {});
      if (error instanceof PilotAdmissionError) throw error;
      throw new DatabaseFailure(commitUnknown);
    } finally { client?.release(); }
  }
  const parameters = (scope, action) => [scope.tenantId, scope.repositoryId, scope.installationId, scope.guardAppId,
    scope.revisionFingerprint, scope.evaluationGeneration, scope.workflowStartedAt, scope.capability, scope.targetType, action];
  async function read(scope) {
    try { return await transaction(EVALUATION, parameters(scope, "read"), (result) => {
      const receipt = admissionResult(result, true);
      if (receipt !== null && (!receipt.admitted || !receipt.duplicate)) throw unavailable();
      return receipt;
    }); }
    catch (error) { if (error instanceof PilotAdmissionError) throw error; throw unavailable(); }
  }
  return Object.freeze({
    async admitEvaluation(input) {
      const scope = normalizeScope(input);
      try { return await transaction(EVALUATION, parameters(scope, "admit"), admissionResult); }
      catch (error) {
        // A lost COMMIT acknowledgment is resolved only by reading the immutable
        // receipt. Never retry the mutation inside this adapter or refund it.
        if (error instanceof DatabaseFailure && error.commitUnknown) {
          const receipt = await read(scope);
          if (receipt !== null) return receipt;
        }
        if (error instanceof PilotAdmissionError) throw error;
        throw unavailable();
      }
    },
    async readAdmission(input) { return read(normalizeScope(input)); },
    async readUsage(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some((key) => !["tenantId", "period"].includes(key))
        || !positiveId(input.tenantId) || !PERIOD.test(input.period ?? "")) throw authority();
      try {
        return await transaction(USAGE, [input.tenantId, input.period], (result) => {
          if (!result || typeof result !== "object" || Array.isArray(result)
            || Object.keys(result).length !== 3 || result.tenantId !== input.tenantId
            || result.period !== input.period || !boundedInteger(result.evaluations, 1010000)) throw unavailable();
          return Object.freeze({ tenantId: result.tenantId, period: result.period, evaluations: result.evaluations });
        });
      } catch (error) { if (error instanceof PilotAdmissionError) throw error; throw unavailable(); }
    },
    async close() { if (!pool) await database.end(); },
  });
}
