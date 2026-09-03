import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const EVENT_FIELDS = new Set([
  "organizationId",
  "installationId",
  "repositoryId",
  "revisionFingerprint",
  "evaluationGeneration",
  "assuranceLevel",
  "state",
  "reason",
  "latencyMs",
  "occurredAt",
  "customerConfirmedValuable",
]);
const ASSURANCE_LEVELS = new Set(["strict_head", "queue_certified"]);
const EVALUATION_STATES = new Set([
  "evaluating",
  "pass",
  "action_required",
  "error",
  "usage_action_required",
]);

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizeEvent(event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)
    || Object.keys(event).some((key) => !EVENT_FIELDS.has(key))) {
    throw new TypeError("Evaluation Event contains invalid fields.");
  }
  const occurredAt = new Date(event.occurredAt);
  if (!positiveId(event.organizationId)
    || !positiveId(event.installationId)
    || !positiveId(event.repositoryId)
    || !/^[a-f0-9]{64}$/u.test(event.revisionFingerprint ?? "")
    || !/^[1-9][0-9]{0,19}\.[1-9][0-9]{0,9}$/u.test(event.evaluationGeneration ?? "")
    || !ASSURANCE_LEVELS.has(event.assuranceLevel)
    || !EVALUATION_STATES.has(event.state)
    || !/^[a-z][a-z0-9_]{0,63}$/u.test(event.reason ?? "")
    || !Number.isSafeInteger(event.latencyMs)
    || event.latencyMs < 0
    || event.latencyMs > 86_400_000
    || Number.isNaN(occurredAt.valueOf())
    || occurredAt.toISOString() !== event.occurredAt
    || (event.customerConfirmedValuable != null && typeof event.customerConfirmedValuable !== "boolean")) {
    throw new TypeError("Evaluation Event contains invalid fields.");
  }
  return Object.freeze({
    organizationId: event.organizationId,
    installationId: event.installationId,
    repositoryId: event.repositoryId,
    revisionFingerprint: event.revisionFingerprint,
    evaluationGeneration: event.evaluationGeneration,
    assuranceLevel: event.assuranceLevel,
    state: event.state,
    reason: event.reason,
    latencyMs: event.latencyMs,
    occurredAt: event.occurredAt,
    customerConfirmedValuable: event.customerConfirmedValuable === true,
  });
}

function percentile95(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
}

function evaluationKey(event) {
  return `${event.repositoryId}\0${event.revisionFingerprint}\0${event.evaluationGeneration}`;
}

function tenantEvaluationKey(event) {
  return `${event.organizationId}\0${evaluationKey(event)}`;
}

function compareGeneration(left, right) {
  const [leftRun, leftAttempt] = left.split(".").map(BigInt);
  const [rightRun, rightAttempt] = right.split(".").map(BigInt);
  if (leftRun !== rightRun) return leftRun < rightRun ? -1 : 1;
  if (leftAttempt !== rightAttempt) return leftAttempt < rightAttempt ? -1 : 1;
  return 0;
}

function validateOrganizationId(organizationId) {
  if (!positiveId(organizationId)) throw new TypeError("organizationId must be a positive integer.");
}

export function createMemoryCommercialStore({ now = () => new Date() } = {}) {
  let events = [];
  return Object.freeze({
    async recordEvaluationEvent(event) {
      const normalized = normalizeEvent(event);
      const sameGeneration = events.filter((candidate) => (
        tenantEvaluationKey(candidate) === tenantEvaluationKey(normalized)
      ));
      if (sameGeneration.some(({ state }) => state === normalized.state)
        || (normalized.state !== "evaluating"
          && sameGeneration.some(({ state }) => state !== "evaluating"))) {
        throw new TypeError("Evaluation Event conflicts with an existing immutable generation state.");
      }
      events = [...events, normalized];
      return normalized;
    },

    async readFleet({ organizationId }) {
      validateOrganizationId(organizationId);
      const currentTime = now();
      if (!(currentTime instanceof Date) || Number.isNaN(currentTime.valueOf())) {
        throw new TypeError("Commercial store clock is invalid.");
      }
      const weekStart = currentTime.valueOf() - (7 * 24 * 60 * 60 * 1_000);
      const tenantEvents = events.filter((event) => event.organizationId === organizationId);
      const repositories = new Map();
      for (const event of tenantEvents) {
        if (!repositories.has(event.repositoryId)) repositories.set(event.repositoryId, []);
        repositories.get(event.repositoryId).push(event);
      }
      return {
        organizationId,
        repositories: [...repositories.entries()]
          .sort(([left], [right]) => left - right)
          .map(([repositoryId, repositoryEvents]) => {
            const ordered = [...repositoryEvents].sort((left, right) => (
              left.occurredAt.localeCompare(right.occurredAt)
              || compareGeneration(left.evaluationGeneration, right.evaluationGeneration)
            ));
            const latest = ordered.at(-1);
            const weekly = ordered.filter(({ occurredAt }) => Date.parse(occurredAt) >= weekStart);
            const terminalWeekly = weekly.filter(({ state }) => state !== "evaluating");
            return {
              repositoryId,
              assuranceLevel: latest.assuranceLevel,
              latestState: latest.state,
              latestReason: latest.reason,
              lastEvaluatedAt: latest.occurredAt,
              weeklyEvaluations: new Set(weekly.map(evaluationKey)).size,
              weeklyAssuredPullRequests: new Set(terminalWeekly
                .filter(({ state }) => state === "pass")
                .map(({ revisionFingerprint }) => revisionFingerprint)).size,
              valuableBlocks: terminalWeekly.filter(({ customerConfirmedValuable }) => customerConfirmedValuable).length,
              p95LatencyMs: percentile95(terminalWeekly.map(({ latencyMs }) => latencyMs)),
            };
          }),
      };
    },

    async readUsage({ organizationId, period }) {
      validateOrganizationId(organizationId);
      if (typeof period !== "string" || !/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(period)) {
        throw new TypeError("period must use YYYY-MM.");
      }
      return {
        organizationId,
        period,
        evaluations: new Set(events.filter((event) => event.organizationId === organizationId
          && event.occurredAt.startsWith(`${period}-`)).map(evaluationKey)).size,
      };
    },

    async deleteOrganization({ organizationId }) {
      validateOrganizationId(organizationId);
      const before = events.length;
      events = events.filter((event) => event.organizationId !== organizationId);
      return before - events.length;
    },
  });
}

async function withTenant(pool, organizationId, operation) {
  validateOrganizationId(organizationId);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('changeplane.organization_id', $1, true)", [String(organizationId)]);
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function createPostgresCommercialStore({ connectionString, pool: suppliedPool } = {}) {
  if (!suppliedPool && (typeof connectionString !== "string" || connectionString.length === 0)) {
    throw new TypeError("A PostgreSQL connection string or pool is required.");
  }
  const pool = suppliedPool ?? new Pool({ connectionString, max: 4 });
  return Object.freeze({
    async recordEvaluationEvent(event) {
      const normalized = normalizeEvent(event);
      return withTenant(pool, normalized.organizationId, async (client) => {
        await client.query(
          `insert into evaluation_events (
            event_id, github_organization_id, github_installation_id, github_repository_id,
            revision_fingerprint, evaluation_generation, assurance_level, state, reason,
            latency_ms, customer_confirmed_valuable, occurred_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            randomUUID(),
            normalized.organizationId,
            normalized.installationId,
            normalized.repositoryId,
            normalized.revisionFingerprint,
            normalized.evaluationGeneration,
            normalized.assuranceLevel,
            normalized.state,
            normalized.reason,
            normalized.latencyMs,
            normalized.customerConfirmedValuable,
            normalized.occurredAt,
          ],
        );
        return normalized;
      });
    },

    async readFleet({ organizationId }) {
      return withTenant(pool, organizationId, async (client) => {
        const result = await client.query(
          `with tenant_events as (
             select * from evaluation_events where github_organization_id = $1
           ), latest as (
             select distinct on (github_repository_id)
               github_repository_id, assurance_level, state, reason, occurred_at
             from tenant_events
             order by github_repository_id, occurred_at desc,
               split_part(evaluation_generation, '.', 1)::numeric desc,
               split_part(evaluation_generation, '.', 2)::numeric desc
           ), weekly as (
             select github_repository_id,
               count(distinct (github_repository_id, revision_fingerprint, evaluation_generation)) as weekly_evaluations,
               count(distinct revision_fingerprint) filter (where state = 'pass') as weekly_assured_pull_requests,
               count(*) filter (where customer_confirmed_valuable) as valuable_blocks,
               percentile_disc(0.95) within group (order by latency_ms)
                 filter (where state <> 'evaluating') as p95_latency_ms
             from tenant_events
             where occurred_at >= now() - interval '7 days'
             group by github_repository_id
           )
           select l.github_repository_id, l.assurance_level, l.state, l.reason, l.occurred_at,
             coalesce(w.weekly_evaluations, 0) as weekly_evaluations,
             coalesce(w.weekly_assured_pull_requests, 0) as weekly_assured_pull_requests,
             coalesce(w.valuable_blocks, 0) as valuable_blocks,
             w.p95_latency_ms
           from latest l left join weekly w using (github_repository_id)
           order by l.github_repository_id`,
          [organizationId],
        );
        return {
          organizationId,
          repositories: result.rows.map((row) => ({
            repositoryId: Number(row.github_repository_id),
            assuranceLevel: row.assurance_level,
            latestState: row.state,
            latestReason: row.reason,
            lastEvaluatedAt: new Date(row.occurred_at).toISOString(),
            weeklyEvaluations: Number(row.weekly_evaluations),
            weeklyAssuredPullRequests: Number(row.weekly_assured_pull_requests),
            valuableBlocks: Number(row.valuable_blocks),
            p95LatencyMs: row.p95_latency_ms == null ? null : Number(row.p95_latency_ms),
          })),
        };
      });
    },

    async readUsage({ organizationId, period }) {
      validateOrganizationId(organizationId);
      if (typeof period !== "string" || !/^[0-9]{4}-(?:0[1-9]|1[0-2])$/u.test(period)) {
        throw new TypeError("period must use YYYY-MM.");
      }
      return withTenant(pool, organizationId, async (client) => {
        const result = await client.query(
          `select count(distinct (github_repository_id, revision_fingerprint, evaluation_generation)) as evaluations
           from evaluation_events
           where github_organization_id = $1
             and occurred_at >= $2::date
             and occurred_at < ($2::date + interval '1 month')`,
          [organizationId, `${period}-01`],
        );
        return { organizationId, period, evaluations: Number(result.rows[0]?.evaluations ?? 0) };
      });
    },

    async deleteOrganization({ organizationId }) {
      return withTenant(pool, organizationId, async (client) => {
        const result = await client.query(
          "delete from customer_organizations where github_organization_id = $1",
          [organizationId],
        );
        return result.rowCount;
      });
    },

    async close() {
      if (!suppliedPool) await pool.end();
    },
  });
}
