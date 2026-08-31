import { createHash, createHmac } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import {
  AUTONOMOUS_DECISION,
  DECISION,
  REMEDIATION_MAX_ATTEMPTS,
  buildRemediationRequest,
  detectFileOverlap,
  evaluateChange,
  evaluateEvidence,
  planAutonomousDecision,
} from "../src/lib/changeplane.js";
import { effectiveProtectedPaths } from "../examples/changeplane-evidence-policy.js";
import { githubWorkflowFilePath, validateRequiredChecks } from "../src/lib/harness.js";

const API_VERSION = "2022-11-28";
export const EVALUATOR_VERSION = "0.4.0";
const CHECK_NAME = "ChangePlane / guard";
export const MAX_ASSURANCE_PASSPORT_ENCODED_LENGTH = 20_000;
const MAX_ASSURANCE_EVIDENCE = 20;
const MAX_ASSURANCE_CHECK_NAME_LENGTH = 100;
const MAX_ASSURANCE_PUBLISHER_LENGTH = 100;
const MAX_ASSURANCE_POLICY_PATH_LENGTH = 300;
const MAX_ASSURANCE_TIMESTAMP_LENGTH = 40;
const LEGACY_COMMIT_STATUS = "LEGACY_COMMIT_STATUS";
const UNKNOWN_ASSURANCE_VALUE = "Unknown";
const ANY_ASSURANCE_PUBLISHER = "Any";
const ASSURANCE_EVIDENCE_STATUSES = new Set([
  "MISSING",
  "QUEUED",
  "IN_PROGRESS",
  "COMPLETED",
  "WAITING",
  "PENDING",
  "REQUESTED",
]);
const ASSURANCE_EVIDENCE_CONCLUSIONS = new Set([
  UNKNOWN_ASSURANCE_VALUE,
  "ACTION_REQUIRED",
  "CANCELLED",
  "ERROR",
  "FAILURE",
  "NEUTRAL",
  "SKIPPED",
  "STALE",
  "STARTUP_FAILURE",
  "SUCCESS",
  "TIMED_OUT",
]);
const GITHUB_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u;
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const TRANSIENT_GITHUB_STATUSES = new Set([502, 503, 504]);
const DEFAULT_GUARD_PUBLISHER_URL = "https://changeplane.vercel.app/api/github?action=guard-publish";
const GUARD_PUBLISHER_AUDIENCE = "https://changeplane.vercel.app/guard-publisher/v1";

export class PublicationError extends Error {}

export function shouldFailAction(error, mode, fallbackPublished = true) {
  return mode === "enforce" || error instanceof PublicationError || !fallbackPublished;
}

export function parseMode(value) {
  const mode = String(value ?? "").trim().toLowerCase() || "observe";
  if (mode !== "observe" && mode !== "enforce") {
    throw new Error("mode must be observe or enforce.");
  }
  return mode;
}

export function validateActionEvidencePolicy(policy, mode) {
  validateRequiredChecks(policy?.evidence?.requiredChecks, { mode });
  return true;
}

export function parseAgentDispatch(value, webhookUrl = "") {
  const adapter = String(value ?? "").trim().toLowerCase() || (webhookUrl ? "webhook" : "none");
  if (!["none", "webhook"].includes(adapter)) {
    throw new Error("agent_dispatch must be none or webhook.");
  }
  if (adapter === "webhook") validateAgentWebhookUrl(webhookUrl);
  return adapter;
}

export function shouldDispatchAgentWebhook({ mode, decision, agentDispatch, requestAlreadyPublished = false }) {
  return mode === "enforce"
    && decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED
    && agentDispatch === "webhook"
    && !requestAlreadyPublished;
}

export function shouldFailDecision(mode, decision) {
  return mode === "enforce" && decision !== AUTONOMOUS_DECISION.PASS;
}

export function validateAgentWebhookUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("agent_webhook_url must be a valid HTTPS URL.");
  }
  const hostname = parsed.hostname.toLowerCase().replaceAll(/\.+$/gu, "");
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || !hostname
    || isIP(hostname) !== 0
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
  ) {
    throw new Error("agent_webhook_url must be a public HTTPS URL without embedded credentials.");
  }
  parsed.hostname = hostname;
  return parsed;
}

function validatePlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The ChangePlane plan must be a JSON object.");
  }
  if (!Array.isArray(value.scope) || value.scope.length === 0 || value.scope.length > 50) {
    throw new Error("The ChangePlane plan needs 1–50 scope paths.");
  }
  if (value.scope.some((path) => typeof path !== "string" || !path.trim() || path.length > 300)) {
    throw new Error("Every scope path must be a non-empty string of at most 300 characters.");
  }
  if (value.goal != null && (typeof value.goal !== "string" || !value.goal.trim() || value.goal.length > 500)) {
    throw new Error("The optional ChangePlane goal must be a non-empty string of at most 500 characters.");
  }

  return {
    scope: [...new Set(value.scope.map((path) => path.trim()))].sort(),
    ...(value.goal ? { goal: value.goal.trim() } : {}),
  };
}

export function parsePlan(body, { optional = false } = {}) {
  const match = String(body ?? "").match(/<!--\s*changeplane\s*([\s\S]*?)-->/iu);
  if (!match) {
    if (optional) return null;
    throw new Error("Missing <!-- changeplane ... --> plan in the pull request body.");
  }

  let value;
  try {
    value = JSON.parse(match[1]);
  } catch {
    throw new Error("The ChangePlane plan is not valid JSON.");
  }

  return validatePlan(value);
}

export function inferPlan(actualFiles, title = "") {
  if (!Array.isArray(actualFiles) || actualFiles.length === 0) {
    throw new Error("ChangePlane could not bind an automatic contract because the pull request has no changed files.");
  }
  const scope = [...new Set(actualFiles.flatMap((file) => [file?.path, file?.previousPath])
    .filter((path) => typeof path === "string" && path.trim())
    .map((path) => path.trim()))].sort();
  if (scope.length === 0 || scope.length > 50) {
    throw new Error("Automatic contracts support up to 50 changed paths. Split this pull request or declare a scoped <!-- changeplane ... --> contract.");
  }
  const goal = String(title ?? "").trim().slice(0, 500);
  return validatePlan({ scope, ...(goal ? { goal } : {}) });
}

/**
 * Bind one contract to one exact pull-request head. Only a digest returned by
 * the dedicated-App guard lease can freeze an earlier contract; shared bot
 * comments are display-only and never authorize evaluation inputs.
 */
export function resolveRevisionContract({ body, title, actualFiles, boundContractDigest = null, headSha } = {}) {
  if (!exactSha(headSha)) throw new Error("The contract revision must be an exact full SHA.");
  const declaredPlan = parsePlan(body, { optional: true });
  const plan = declaredPlan ?? inferPlan(actualFiles, title);
  const contractSource = declaredPlan ? "declared" : "first-head";
  const contractDigest = digest(plan);
  if (boundContractDigest != null && !validSha256(boundContractDigest)) {
    throw new Error("The authenticated exact-head contract binding is invalid.");
  }
  return Object.freeze({
    plan,
    contractSource,
    contractDigest,
    boundContractDigest: boundContractDigest ?? contractDigest,
  });
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function githubRetryDelayMs(status, headers, attempt = 1, now = Date.now()) {
  const retryAfter = Number.parseFloat(headers?.get?.("retry-after") ?? "");
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(60_000, Math.ceil(retryAfter * 1000));
  }
  if (headers?.get?.("x-ratelimit-remaining") === "0") {
    const resetAt = Number.parseInt(headers?.get?.("x-ratelimit-reset") ?? "", 10) * 1000;
    const delay = resetAt - now;
    return Number.isFinite(delay) && delay >= 0 && delay <= 60_000 ? delay : null;
  }
  if (status === 429) return 60_000;
  if (TRANSIENT_GITHUB_STATUSES.has(status)) return Math.min(5_000, 250 * (2 ** (attempt - 1)));
  return null;
}

export function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function eligibleReviewCandidates(reviews, pullRequest, approvalDigest) {
  const authorId = pullRequest.user?.id;
  const headSha = pullRequest.head?.sha;
  const latestDecisiveReview = new Map();
  for (const review of reviews) {
    const reviewerId = review.user?.id;
    if (!reviewerId || !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) continue;
    const submittedAt = Date.parse(review.submitted_at) || 0;
    const current = latestDecisiveReview.get(reviewerId);
    if (!current || submittedAt >= current.submittedAt) {
      latestDecisiveReview.set(reviewerId, { review, submittedAt });
    }
  }

  return [...latestDecisiveReview.values()]
    .map(({ review }) => review)
    .filter((review) => (
      review.state === "APPROVED"
      && review.commit_id === headSha
      && review.user?.id
      && review.user.id !== authorId
      && String(review.body ?? "").trim() === `ChangePlane approve ${approvalDigest}`
    ))
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at));
}

async function api(path, token, { method = "GET", body } = {}) {
  const attempts = method === "GET" ? 3 : 1;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
          "user-agent": "changeplane-guard/0.2",
          "x-github-api-version": API_VERSION,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return response.status === 204 ? null : response.json();
      const error = new Error(`GitHub API ${response.status} for ${path}.`);
      error.retryDelayMs = githubRetryDelayMs(response.status, response.headers, attempt);
      error.retryable = error.retryDelayMs != null;
      if (!error.retryable || attempt === attempts) throw error;
      lastError = error;
    } catch (error) {
      if (error?.retryable === false || attempt === attempts) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, lastError?.retryDelayMs ?? Math.min(5_000, 250 * (2 ** (attempt - 1)))));
  }
  throw lastError;
}

async function listPages(path, token, expectedCount) {
  const values = [];
  for (let page = 1; page <= 31; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await api(`${path}${separator}per_page=100&page=${page}`, token);
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid paginated response.");
    if (page === 31 && batch.length > 0) {
      throw new Error(`GitHub pagination exceeded the 3,000-item ChangePlane safety limit for ${path}.`);
    }
    values.push(...batch);
    if (batch.length < 100 || (expectedCount != null && values.length >= expectedCount)) break;
  }
  return values;
}

export async function resolvePullRequestNumber(event, repository, token) {
  if (Number.isSafeInteger(event.pull_request?.number)) {
    const headSha = event.pull_request?.head?.sha;
    return {
      number: event.pull_request.number,
      ...(typeof headSha === "string" && /^[a-f0-9]{40}$/iu.test(headSha) ? { headSha } : {}),
    };
  }
  if (event.action === "changeplane_recheck") {
    const pullRequestNumber = event.client_payload?.pullRequestNumber;
    const headSha = event.client_payload?.headSha;
    if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1
      || typeof headSha !== "string" || !/^[a-f0-9]{40}$/iu.test(headSha)) {
      throw new Error("The ChangePlane recheck dispatch is missing a pull request or exact head SHA.");
    }
    return { number: pullRequestNumber, headSha };
  }
  const headSha = event.deployment?.sha;
  if (!event.deployment_status || typeof headSha !== "string" || !/^[a-f0-9]{40}$/iu.test(headSha)) {
    throw new Error("ChangePlane Guard only supports pull-request, review, deployment-status, and trusted recheck events.");
  }
  const repositoryName = repository.toLowerCase();
  const pulls = await listPages(`/repos/${repository}/commits/${encodeURIComponent(headSha)}/pulls`, token);
  const candidates = pulls.filter((pullRequest) => (
    pullRequest?.state === "open"
    && pullRequest.head?.sha === headSha
    && pullRequest.head?.repo?.full_name?.toLowerCase() === repositoryName
    && pullRequest.base?.repo?.full_name?.toLowerCase() === repositoryName
    && Number.isSafeInteger(pullRequest.number)
  ));
  if (candidates.length !== 1) {
    return {
      number: null,
      headSha,
      reason: candidates.length === 0 ? "NO_OPEN_PULL_REQUEST" : "AMBIGUOUS_PULL_REQUEST",
    };
  }
  return { number: candidates[0].number, headSha };
}

function exactSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/iu.test(value);
}

function encodedRef(ref) {
  return ref.split("/").map(encodeURIComponent).join("/");
}

async function defaultBranchSha(repository, defaultBranch, token) {
  const ref = await api(`/repos/${repository}/git/ref/${encodedRef(`heads/${defaultBranch}`)}`, token);
  if (!exactSha(ref?.object?.sha)) throw new Error("GitHub returned an invalid default-branch revision.");
  return ref.object.sha;
}

async function trustedDefaultBranch(repository, token) {
  const state = await api(`/repos/${repository}`, token);
  const defaultBranch = state?.default_branch;
  if (typeof defaultBranch !== "string" || !defaultBranch
    || state?.full_name?.toLowerCase() !== repository.toLowerCase()) {
    throw new Error("GitHub returned an invalid repository default branch.");
  }
  return {
    defaultBranch,
    defaultSha: await defaultBranchSha(repository, defaultBranch, token),
  };
}

export function assertTrustedPullRequestBase({
  pullRequest,
  eventPullRequest = null,
  defaultBranch,
  defaultSha,
  controllerSha,
}) {
  if (!exactSha(controllerSha)) throw new Error("The trusted controller revision is unavailable.");
  if (pullRequest?.base?.ref !== defaultBranch || pullRequest?.base?.sha !== defaultSha
    || controllerSha !== defaultSha) {
    throw new Error("The pull request is not bound to the current trusted default branch.");
  }
  if (eventPullRequest && (eventPullRequest.base?.ref !== defaultBranch
    || eventPullRequest.base?.sha !== defaultSha
    || eventPullRequest.head?.sha !== pullRequest.head?.sha)) {
    throw new Error("The triggering pull-request revision is stale or targets an untrusted branch.");
  }
}

export async function resolveMergeGroup(event, repository, token) {
  if (!event.merge_group) return null;
  const group = event.merge_group;
  if (event.action !== "checks_requested" || !exactSha(group.head_sha) || !exactSha(group.base_sha)) {
    throw new Error("The merge-group event is missing an exact base or head revision.");
  }
  const repositoryState = await api(`/repos/${repository}`, token);
  const defaultBranch = repositoryState?.default_branch;
  if (typeof defaultBranch !== "string" || !defaultBranch
    || repositoryState?.full_name?.toLowerCase() !== repository.toLowerCase()) {
    throw new Error("GitHub returned an invalid repository default branch.");
  }
  if (group.base_ref !== `refs/heads/${defaultBranch}`
    || typeof group.head_ref !== "string"
    || !group.head_ref.startsWith(`refs/heads/gh-readonly-queue/${defaultBranch}/`)) {
    throw new Error("The merge group is not bound to the repository default branch.");
  }
  if (await defaultBranchSha(repository, defaultBranch, token) !== group.base_sha) {
    throw new Error("The merge-group base is stale relative to the trusted default branch.");
  }

  const comparison = await api(
    `/repos/${repository}/compare/${encodeURIComponent(group.base_sha)}...${encodeURIComponent(group.head_sha)}`,
    token,
  );
  if (comparison?.merge_base_commit?.sha !== group.base_sha
    || comparison?.base_commit?.sha !== group.base_sha
    || comparison?.head_commit?.sha !== group.head_sha
    || comparison?.status !== "ahead"
    || !Array.isArray(comparison.files)
    || comparison.files.length === 0) {
    throw new Error("GitHub returned an invalid merge-group comparison.");
  }
  if (comparison.files.length >= 300) {
    throw new Error("Merge groups with 300 or more changed files exceed GitHub comparison metadata and fail closed.");
  }
  if (comparison.files.some((file) => typeof file?.filename !== "string" || !file.filename)) {
    throw new Error("GitHub returned invalid merge-group file metadata.");
  }
  const actualFiles = comparison.files.map((file) => ({
    path: file?.filename,
    ...(file?.previous_filename ? { previousPath: file.previous_filename } : {}),
  }));
  return {
    targetType: "merge_group",
    defaultBranch,
    baseRef: group.base_ref,
    headRef: group.head_ref,
    baseSha: group.base_sha,
    headSha: group.head_sha,
    actualFiles,
  };
}

const OPEN_PULL_REQUESTS_QUERY = `query ChangePlaneOpenPullRequests($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 20, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        url
        files(first: 100) {
          nodes { path }
        }
      }
    }
  }
}`;

export async function discoverOpenPullRequestOverlaps(repository, currentNumber, actualFiles, token) {
  const [owner, name, extra] = String(repository).split("/");
  if (!owner || !name || extra || !Number.isSafeInteger(currentNumber)) return [];
  try {
    const payload = await api("/graphql", token, {
      method: "POST",
      body: { query: OPEN_PULL_REQUESTS_QUERY, variables: { owner, name } },
    });
    if (Array.isArray(payload?.errors)) return [];
    const nodes = payload?.data?.repository?.pullRequests?.nodes;
    if (!Array.isArray(nodes)) return [];
    return nodes.flatMap((pullRequest) => {
      if (pullRequest?.number === currentNumber || !Array.isArray(pullRequest?.files?.nodes)) return [];
      const advisory = detectFileOverlap(actualFiles, {
        state: "open",
        number: pullRequest.number,
        title: pullRequest.title,
        url: typeof pullRequest.url === "string" && pullRequest.url.startsWith("https://github.com/")
          ? pullRequest.url
          : null,
        actualFiles: pullRequest.files.nodes.map(({ path }) => path),
      });
      return advisory ? [advisory] : [];
    }).slice(0, 5);
  } catch {
    return [];
  }
}

export async function assertUniqueOpenPullRequestHead(repository, pullRequest, token) {
  const headSha = pullRequest?.head?.sha;
  if (!exactSha(headSha) || !Number.isSafeInteger(pullRequest?.number)) {
    throw new Error("The pull-request target is invalid.");
  }
  const payload = await api(
    `/repos/${repository}/commits/${encodeURIComponent(headSha)}/pulls?per_page=100`,
    token,
  );
  if (!Array.isArray(payload) || payload.length >= 100) {
    throw new Error("ChangePlane cannot prove that this exact head belongs to one open pull request.");
  }
  const supported = payload.filter((candidate) => (
    candidate?.state === "open"
    && candidate?.head?.sha === headSha
    && candidate?.head?.repo?.full_name === repository
    && candidate?.base?.repo?.full_name === repository
  ));
  if (supported.length !== 1 || supported[0]?.number !== pullRequest.number
    || supported[0]?.base?.sha !== pullRequest.base?.sha
    || supported[0]?.head?.ref !== pullRequest.head?.ref
    || supported[0]?.base?.ref !== pullRequest.base?.ref) {
    throw new Error("One exact head is associated with multiple or mismatched open pull requests. Push a unique commit before ChangePlane can repair or publish PASS.");
  }
  return true;
}

function mergeEvaluation(pathResult, evidenceResult, extraReasons = []) {
  const reasons = [...pathResult.reasons, ...evidenceResult.reasons, ...extraReasons];
  const decision = pathResult.decision === DECISION.BLOCKED
    ? DECISION.BLOCKED
    : reasons.some(({ resolved }) => !resolved)
      ? DECISION.REVIEW_REQUIRED
      : DECISION.PASS;
  return { ...pathResult, decision, reasons };
}

function evidenceText(value, limit = 2_000) {
  if (typeof value !== "string") return "";
  return value
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, limit);
}

export function checkDiagnostic(check, annotations = []) {
  const sections = [
    evidenceText(check.output?.title, 500),
    evidenceText(check.output?.summary),
    evidenceText(check.output?.text),
    ...annotations.slice(0, 20).map((annotation) => {
      const location = [
        evidenceText(annotation?.path, 300),
        Number.isSafeInteger(annotation?.start_line) ? `line ${annotation.start_line}` : "",
      ].filter(Boolean).join(":");
      const message = evidenceText(annotation?.message ?? annotation?.raw_details ?? annotation?.title);
      return [location, message].filter(Boolean).join(" — ");
    }),
  ].filter(Boolean);
  return sections.join("\n").slice(0, 6_000);
}

function canonicalGithubActionsRunId(detailsUrl, repository) {
  if (typeof detailsUrl !== "string"
    || typeof repository !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(repository)) return null;
  let parsed;
  try {
    parsed = new URL(detailsUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:"
    || parsed.hostname !== "github.com"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) return null;
  const repositoryPath = repository.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = parsed.pathname.match(new RegExp(`^/${repositoryPath}/actions/runs/([1-9][0-9]{0,19})(?:/job/[1-9][0-9]{0,19})?$`, "u"));
  return match?.[1] ?? null;
}

export async function evidenceSnapshot(repository, headSha, policy, token, { includeCommitStatuses = true } = {}) {
  const [checkRuns, combinedStatus] = await Promise.all([
    api(`/repos/${repository}/commits/${encodeURIComponent(headSha)}/check-runs?filter=latest&per_page=100`, token),
    includeCommitStatuses
      ? api(`/repos/${repository}/commits/${encodeURIComponent(headSha)}/status?per_page=100`, token)
      : null,
  ]);
  const requiredChecks = policy.evidence?.requiredChecks ?? [];
  const required = requiredChecks.map((item) => (
    typeof item === "string" ? { name: item, appSlug: null } : item
  ));
  const actionsRuns = new Map();
  const checks = Array.isArray(checkRuns?.check_runs) ? await Promise.all(checkRuns.check_runs.map(async (check) => {
    const source = check.app?.slug ?? null;
    const needsWorkflowProvenance = source === "github-actions"
      && required.some((item) => (
        item.name === check.name
        && item.appSlug === source
        && typeof item.workflowPath === "string"
      ));
    let workflowPath = null;
    if (needsWorkflowProvenance && check.head_sha === headSha) {
      const runId = canonicalGithubActionsRunId(check.details_url, repository);
      if (runId) {
        if (!actionsRuns.has(runId)) {
          actionsRuns.set(runId, api(`/repos/${repository}/actions/runs/${runId}`, token).catch(() => null));
        }
        const run = await actionsRuns.get(runId);
        if (String(run?.id ?? "") === runId
          && run?.head_sha === headSha
          && githubWorkflowFilePath(run?.path) != null) {
          workflowPath = githubWorkflowFilePath(run.path);
        }
      }
    }
    const needsDiagnostic = check.status === "completed"
      && check.conclusion !== "success"
      && required.some((item) => item.name === check.name && (!item.appSlug || item.appSlug === source));
    let annotations = [];
    if (needsDiagnostic && Number.isSafeInteger(check.id) && check.output?.annotations_count > 0) {
      try {
        const payload = await api(`/repos/${repository}/check-runs/${check.id}/annotations?per_page=20`, token);
        if (Array.isArray(payload)) annotations = payload;
      } catch {
        // The check output still carries useful bounded failure context when annotations are unavailable.
      }
    }
    const diagnostic = needsDiagnostic ? checkDiagnostic(check, annotations) : "";
    return {
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      createdAt: check.started_at,
      completedAt: check.completed_at,
      source,
      ...(workflowPath ? { workflowPath } : {}),
      ...(Number.isSafeInteger(check.id) && check.id > 0 ? { checkRunId: check.id } : {}),
      ...(Number.isSafeInteger(check.app?.id) && check.app.id > 0 ? { publisherAppId: check.app.id } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    };
  })) : [];
  if (Array.isArray(combinedStatus?.statuses)) {
    checks.push(...combinedStatus.statuses.map((status) => ({
      name: status.context,
      status: status.state === "pending" ? "in_progress" : "completed",
      conclusion: status.state === "pending" ? null : status.state,
      createdAt: status.created_at,
      completedAt: status.updated_at,
      source: LEGACY_COMMIT_STATUS,
      ...(status.state !== "success" && evidenceText(status.description)
        ? { diagnostic: evidenceText(status.description) }
        : {}),
    })));
  }
  return checks;
}

export function sanitizePreviewUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 500) return null;
  try {
    const url = new URL(raw);
    const parsedHostname = url.hostname.toLowerCase();
    const hostname = (parsedHostname.startsWith("[") && parsedHostname.endsWith("]")
      ? parsedHostname.slice(1, -1)
      : parsedHostname).replaceAll(/\.+$/gu, "");
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !hostname
      || isIP(hostname) !== 0
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
    ) return null;
    url.hostname = hostname;
    url.search = "";
    url.hash = "";
    const sanitized = url.toString();
    return sanitized.length <= 500 ? sanitized : null;
  } catch {
    return null;
  }
}

function previewLabel(value, fallback = "Preview") {
  return String(value ?? fallback).replaceAll(/[\u0000-\u001f\u007f]+/gu, " ").replaceAll(/\s+/gu, " ").trim().slice(0, 100) || fallback;
}

export async function discoverPreview(repository, headSha, token) {
  let deployments;
  try {
    deployments = await api(`/repos/${repository}/deployments?sha=${encodeURIComponent(headSha)}&per_page=100`, token);
  } catch {
    return { status: "UNAVAILABLE" };
  }
  if (!Array.isArray(deployments)) return { status: "UNAVAILABLE" };

  let statusReadFailed = false;
  const candidates = (await Promise.all(deployments
    .filter((deployment) => deployment?.sha === headSha && Number.isSafeInteger(deployment.id))
    .map(async (deployment) => {
      let statuses;
      try {
        statuses = await api(`/repos/${repository}/deployments/${deployment.id}/statuses?per_page=100`, token);
      } catch {
        statusReadFailed = true;
        return null;
      }
      if (!Array.isArray(statuses)) {
        statusReadFailed = true;
        return null;
      }
      const latest = statuses.filter((status) => status && typeof status === "object").reduce((winner, status) => (
        !winner || (Date.parse(status.created_at) || 0) > (Date.parse(winner.created_at) || 0) ? status : winner
      ), null);
      const url = latest?.state === "success" ? sanitizePreviewUrl(latest.environment_url) : null;
      if (!url) return null;
      const timestamp = Date.parse(latest.created_at) || Date.parse(deployment.created_at) || 0;
      const environmentOverride = previewLabel(latest.environment, "");
      return {
        status: "READY",
        headSha,
        url,
        environment: environmentOverride || previewLabel(deployment.environment),
        deploymentId: deployment.id,
        statusId: Number.isSafeInteger(latest.id) ? latest.id : null,
        statusCreator: previewLabel(latest.creator?.login, "unknown"),
        task: previewLabel(deployment.task, "deploy"),
        ...(environmentOverride ? { environmentOverride } : {}),
        ...(timestamp ? { createdAt: new Date(timestamp).toISOString() } : {}),
        timestamp,
      };
    }))).filter(Boolean).sort((a, b) => b.timestamp - a.timestamp);

  if (candidates[0]) {
    const { timestamp: _timestamp, ...preview } = candidates[0];
    return preview;
  }
  return { status: statusReadFailed ? "UNAVAILABLE" : "MISSING" };
}

export function bindPreview(preview, headSha) {
  if (preview?.status !== "READY") return preview;
  return preview.headSha === headSha ? preview : { status: "REVISION_MISMATCH" };
}

async function waitForEvidence(repository, headSha, policy, token, { includeCommitStatuses = true } = {}) {
  const requiredChecks = policy.evidence?.requiredChecks ?? [];
  if (requiredChecks.length === 0) return evaluateEvidence();
  const deadline = Date.now() + (policy.evidence?.timeoutSeconds ?? 0) * 1000;
  for (;;) {
    const result = evaluateEvidence({
      requiredChecks,
      checks: await evidenceSnapshot(repository, headSha, policy, token, { includeCommitStatuses }),
    });
    const onlyPending = result.reasons.length > 0
      && result.reasons.every(({ code }) => code === "EVIDENCE_PENDING" || code === "EVIDENCE_MISSING");
    if (!onlyPending || Date.now() >= deadline) return result;
    await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, Math.max(0, deadline - Date.now()))));
  }
}

export function headCheckPayload(receipt, markdown) {
  const conclusion = receipt.mode === "observe"
    ? "neutral"
    : receipt.decision === AUTONOMOUS_DECISION.PASS
      ? "success"
      : receipt.decision === "INDETERMINATE"
        ? "failure"
        : "action_required";
  return {
    name: CHECK_NAME,
    head_sha: receipt.headSha,
    status: "completed",
    conclusion,
    external_id: `${receipt.repository}#${receipt.targetType === "merge_group" ? "merge-group" : receipt.pullRequestNumber}:${receipt.headSha}:${receipt.inputDigest}`.slice(0, 255),
    output: {
      title: `${receiptOutcome(receipt).replace(/\.$/u, "")} · ${receipt.mode}`.slice(0, 255),
      summary: markdown.slice(0, 65_535),
    },
  };
}

function validatedGuardPublisherUrl(value = DEFAULT_GUARD_PUBLISHER_URL) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The dedicated guard publisher URL is invalid.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.origin !== "https://changeplane.vercel.app"
    || parsed.pathname !== "/api/github"
    || parsed.searchParams.size !== 1
    || parsed.searchParams.get("action") !== "guard-publish"
  ) {
    throw new Error("The dedicated guard publisher must use the fixed ChangePlane production endpoint.");
  }
  return parsed.href;
}

async function githubOidcToken(audience, fetchImpl = fetch) {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    throw new Error("GitHub OIDC is unavailable for dedicated guard publication.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || !(parsed.hostname === "actions.githubusercontent.com"
      || parsed.hostname.endsWith(".actions.githubusercontent.com"))
    || typeof requestToken !== "string"
    || requestToken.length < 20
  ) {
    throw new Error("GitHub OIDC is unavailable for dedicated guard publication.");
  }
  parsed.searchParams.set("audience", audience);
  const response = await fetchImpl(parsed, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${requestToken}`,
    },
  });
  if (!response.ok) throw new Error(`GitHub OIDC token request failed (${response.status}).`);
  const payload = await response.json();
  if (typeof payload?.value !== "string" || payload.value.length < 100 || payload.value.length > 20_000) {
    throw new Error("GitHub returned an invalid OIDC token.");
  }
  return payload.value;
}

function guardWorkflowIdentity() {
  const workflowRunId = Number(process.env.GITHUB_RUN_ID);
  const workflowRunAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const gitRef = process.env.GITHUB_REF;
  if (!Number.isSafeInteger(workflowRunId) || workflowRunId <= 0
    || !Number.isSafeInteger(workflowRunAttempt) || workflowRunAttempt <= 0
    || typeof gitRef !== "string" || !/^refs\/(?:heads|pull)\/[A-Za-z0-9._/-]{1,240}$/u.test(gitRef)
    || gitRef.includes("..") || gitRef.includes("//")) {
    throw new Error("The GitHub workflow run identity is unavailable.");
  }
  return Object.freeze({ workflowRunId, workflowRunAttempt, gitRef });
}

function guardTarget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["pull_request", "merge_group"].includes(value.type)
    || !exactSha(value.baseSha) || !exactSha(value.headSha)
    || typeof value.baseRef !== "string" || typeof value.headRef !== "string"
    || value.baseRef.length === 0 || value.baseRef.length > 240
    || value.headRef.length === 0 || value.headRef.length > 240
    || !/^(?:refs\/heads\/)?[A-Za-z0-9._/-]+$/u.test(value.baseRef)
    || !/^(?:refs\/heads\/)?[A-Za-z0-9._/-]+$/u.test(value.headRef)
    || value.baseRef.includes("..") || value.baseRef.includes("//")
    || value.headRef.includes("..") || value.headRef.includes("//")
    || (value.type === "pull_request"
      ? !Number.isSafeInteger(value.pullRequestNumber) || value.pullRequestNumber <= 0
      : value.pullRequestNumber !== null)) {
    throw new Error("The exact guard target is invalid.");
  }
  return Object.freeze({
    type: value.type,
    pullRequestNumber: value.pullRequestNumber,
    baseSha: value.baseSha,
    headSha: value.headSha,
    baseRef: value.baseRef,
    headRef: value.headRef,
  });
}

/**
 * Supersede any prior App-owned PASS before reading mutable evaluation inputs.
 * The matching workflow job remains the independent GitHub-owned liveness gate.
 */
export async function beginDedicatedGuard({
  repository,
  repositoryId,
  defaultBranch,
  controllerSha,
  target,
  publisherUrl = process.env.INPUT_GUARD_PUBLISHER_URL || DEFAULT_GUARD_PUBLISHER_URL,
  fetchImpl = fetch,
} = {}) {
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(repository)) {
    throw new Error("The guard publication repository is invalid.");
  }
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error("The guard publication repository ID is invalid.");
  }
  if (typeof defaultBranch !== "string" || defaultBranch.length === 0 || defaultBranch.length > 200
    || !/^[A-Za-z0-9._/-]+$/u.test(defaultBranch) || defaultBranch.startsWith("/")
    || defaultBranch.endsWith("/") || defaultBranch.includes("..") || defaultBranch.includes("//")) {
    throw new Error("The trusted default branch is invalid.");
  }
  if (!exactSha(controllerSha)) throw new Error("The trusted controller revision is unavailable.");
  const exactTarget = guardTarget(target);
  const identity = guardWorkflowIdentity();
  const endpoint = validatedGuardPublisherUrl(publisherUrl);
  const oidcToken = await githubOidcToken(GUARD_PUBLISHER_AUDIENCE, fetchImpl);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${oidcToken}`,
      "content-type": "application/json",
    },
    body: canonicalJson({
      schemaVersion: 1,
      type: "changeplane.guard-publication-begin",
      repository,
      repositoryId,
      defaultBranch,
      controllerSha,
      ...identity,
      target: exactTarget,
    }),
  });
  if (!response.ok) throw new Error(`Dedicated guard invalidation failed (${response.status}).`);
  const result = await response.json();
  if (result?.schemaVersion !== 1
    || result?.type !== "changeplane.guard-publication-begin"
    || !validPositiveId(result?.check?.id)
    || result.check.name !== CHECK_NAME
    || result.check.headSha !== exactTarget.headSha
    || result.check.status !== "in_progress"
    || !validPositiveId(result.check.publisherAppId)
    || typeof result.check.publisherAppSlug !== "string"
    || !GITHUB_APP_SLUG.test(result.check.publisherAppSlug)
    || result.check.publisherAppSlug === "github-actions"
    || result?.run?.id !== identity.workflowRunId
    || result?.run?.attempt !== identity.workflowRunAttempt
    || (result.previousContractDigest !== null && !validSha256(result.previousContractDigest))) {
    throw new Error("The dedicated guard publisher returned an invalid begin proof.");
  }
  return result;
}

export async function publishDedicatedGuard({
  repository,
  defaultBranch,
  passport,
  summary,
  publisherUrl = process.env.INPUT_GUARD_PUBLISHER_URL || DEFAULT_GUARD_PUBLISHER_URL,
  fetchImpl = fetch,
} = {}) {
  const verifiedPassport = verifyAssurancePassportIntegrity(passport);
  if (typeof repository !== "string" || repository !== verifiedPassport.target.repository) {
    throw new Error("The guard publication repository does not match the assurance passport.");
  }
  if (typeof defaultBranch !== "string" || defaultBranch.length === 0 || defaultBranch.length > 200
    || !/^[A-Za-z0-9._/-]+$/u.test(defaultBranch) || defaultBranch.startsWith("/")
    || defaultBranch.endsWith("/") || defaultBranch.includes("..") || defaultBranch.includes("//")) {
    throw new Error("The trusted default branch is invalid.");
  }
  if (typeof summary !== "string" || summary.length === 0 || summary.length > 65_535) {
    throw new Error("The guard publication summary is invalid.");
  }
  const { workflowRunId, workflowRunAttempt, gitRef } = guardWorkflowIdentity();
  const endpoint = validatedGuardPublisherUrl(publisherUrl);
  const oidcToken = await githubOidcToken(GUARD_PUBLISHER_AUDIENCE, fetchImpl);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${oidcToken}`,
      "content-type": "application/json",
    },
    body: canonicalJson({
      schemaVersion: 1,
      type: "changeplane.guard-publication-request",
      repository,
      defaultBranch,
      gitRef,
      workflowRunId,
      workflowRunAttempt,
      passport: verifiedPassport,
      summary,
    }),
  });
  if (!response.ok) throw new Error(`Dedicated guard publication failed (${response.status}).`);
  const result = await response.json();
  const expectedConclusion = expectedGuardConclusion(verifiedPassport);
  if (
    result?.schemaVersion !== 1
    || result?.type !== "changeplane.guard-publication"
    || result.passportDigest !== verifiedPassport.digest
    || !validPositiveId(result?.check?.id)
    || result.check.name !== CHECK_NAME
    || result.check.headSha !== verifiedPassport.target.headSha
    || result.check.conclusion !== expectedConclusion
    || !validPositiveId(result.check.publisherAppId)
    || typeof result.check.publisherAppSlug !== "string"
    || !GITHUB_APP_SLUG.test(result.check.publisherAppSlug)
    || result.check.publisherAppSlug === "github-actions"
  ) {
    throw new Error("The dedicated guard publisher returned an invalid proof.");
  }
  return {
    id: result.check.id,
    name: result.check.name,
    head_sha: result.check.headSha,
    status: "completed",
    conclusion: result.check.conclusion,
    app: {
      id: result.check.publisherAppId,
      slug: result.check.publisherAppSlug,
    },
  };
}

function validAssurancePolicyPath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ASSURANCE_POLICY_PATH_LENGTH
    && !value.startsWith("/")
    && !value.includes("\\")
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function validateAssurancePolicyPath(value) {
  if (!validAssurancePolicyPath(value)) {
    throw new Error(`policy_path must be a repository-relative path of at most ${MAX_ASSURANCE_POLICY_PATH_LENGTH} characters.`);
  }
  return value;
}

async function readPolicy(repository, baseSha, path, token) {
  validateAssurancePolicyPath(path);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const file = await api(`/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(baseSha)}`, token);
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
    throw new Error(`Policy ${path} is not a readable file at base ${baseSha.slice(0, 7)}.`);
  }

  let policy;
  try {
    policy = JSON.parse(Buffer.from(file.content.replaceAll("\n", ""), "base64").toString("utf8"));
  } catch {
    throw new Error(`Policy ${path} is not valid JSON at the pull request base SHA.`);
  }
  if (policy?.version !== 1 || !policy.protectedPaths || typeof policy.protectedPaths !== "object") {
    throw new Error(`Policy ${path} must use version 1 and define protectedPaths.`);
  }
  const requiredChecks = policy.evidence?.requiredChecks ?? [];
  const timeoutSeconds = policy.evidence?.timeoutSeconds ?? 0;
  try {
    validateRequiredChecks(requiredChecks);
  } catch (error) {
    throw new Error(`Policy ${path} has invalid evidence.requiredChecks: ${error instanceof Error ? error.message : "invalid policy"}`);
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 240) {
    throw new Error(`Policy ${path} evidence.timeoutSeconds must be an integer from 0 to 240.`);
  }
  return policy;
}

async function authorizedApproval(repository, reviews, pullRequest, revision, approvalDigest, token) {
  for (const review of eligibleReviewCandidates(reviews, pullRequest, approvalDigest)) {
    const login = review.user.login;
    if (!login) continue;
    const permission = await api(`/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`, token);
    if (WRITE_PERMISSIONS.has(permission.permission)) {
      return { ...revision, actorId: review.user.id, actorLogin: login };
    }
  }
  return undefined;
}

function safeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("`", "\\`").replaceAll(/\r?\n/gu, " ").slice(0, 500);
}

const REMEDIATION_MARKER = /<!-- changeplane-remediation:v1 input=([a-f0-9]{64}) attempt=(\d+) id=([a-f0-9]{64}) -->/u;
const RECEIPT_MARKER = "<!-- changeplane-receipt:v2";
const RECEIPT_STATE = /<!-- changeplane-receipt:v2 contract=([a-f0-9]{64}) input=([a-f0-9]{64}) head=([a-f0-9]{40}) -->/u;
const ASSURANCE_PASSPORT_STATE = /<!-- changeplane-assurance-passport:v1 digest=([a-f0-9]{64}) payload=([A-Za-z0-9_-]+) -->/u;

function assuranceAuthorityMap() {
  return {
    authoringAgent: {
      owns: "CHANGE",
      propose: true,
      decide: false,
      apply: false,
      publishGuard: false,
      merge: false,
    },
    proposalModel: {
      owns: "PROPOSE",
      propose: true,
      decide: false,
      apply: false,
      publishGuard: false,
      merge: false,
    },
    deterministicHarness: {
      owns: "DECIDE",
      propose: false,
      decide: true,
      apply: false,
      publishGuard: true,
      merge: false,
    },
    trustedController: {
      owns: "APPLY",
      propose: false,
      decide: false,
      apply: true,
      publishGuard: false,
      merge: false,
    },
    github: {
      owns: "MERGE",
      propose: false,
      decide: false,
      apply: false,
      publishGuard: false,
      merge: true,
    },
  };
}

function assurancePassportDigest(value) {
  return createHash("sha256")
    .update("changeplane:assurance-passport:v1\0")
    .update(canonicalJson(value))
    .digest("hex");
}

function validAssuranceTimestamp(value) {
  if (value === "") return true;
  if (typeof value !== "string" || value.length > MAX_ASSURANCE_TIMESTAMP_LENGTH
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const canonical = parsed.toISOString();
  return value === canonical || value === canonical.replace(".000Z", "Z");
}

function validPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function assuranceEvidencePassed(evidence) {
  return evidence.length > 0 && evidence.every((item) => (
    item.status === "COMPLETED"
    && item.conclusion === "SUCCESS"
    && item.actualPublisher !== UNKNOWN_ASSURANCE_VALUE
    && (item.expectedPublisher === ANY_ASSURANCE_PUBLISHER
      || item.actualPublisher === item.expectedPublisher)
  ));
}

function expectedGuardConclusion(passport) {
  if (passport.decision.mode === "observe") return "neutral";
  return passport.decision.outcome === AUTONOMOUS_DECISION.PASS ? "success" : "action_required";
}

function encodedContract(plan) {
  return Buffer.from(canonicalJson(plan)).toString("base64url");
}

export function verifyAssurancePassportIntegrity(passport, markerDigest = passport?.digest) {
  if (!passport || typeof passport !== "object" || Array.isArray(passport)) {
    throw new Error("The ChangePlane assurance passport is invalid.");
  }
  const { digest: claimedDigest, ...unsigned } = passport;
  const target = passport.target;
  const binding = passport.binding;
  const decision = passport.decision;
  const exactKeys = (value, keys) => (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
  const validTarget = target
    && exactKeys(target, ["type", "repository", "repositoryId", "pullRequestNumber", "baseSha", "headSha"])
    && ["pull_request", "merge_group"].includes(target.type)
    && typeof target.repository === "string"
    && target.repository.length > 0
    && target.repository.length <= 200
    && Number.isSafeInteger(target.repositoryId)
    && target.repositoryId > 0
    && /^[a-f0-9]{40}$/u.test(target.baseSha)
    && /^[a-f0-9]{40}$/u.test(target.headSha)
    && (target.type === "merge_group"
      ? target.pullRequestNumber === null
      : Number.isInteger(target.pullRequestNumber) && target.pullRequestNumber > 0);
  const validBinding = binding
    && exactKeys(binding, [
      "inputDigest",
      "contractDigest",
      "policyPath",
      "policyDigest",
      "policySourceRevision",
      "approvalDigest",
      "evaluatorVersion",
      "trustedControllerSha",
    ])
    && validSha256(binding.inputDigest)
    && validSha256(binding.contractDigest)
    && validAssurancePolicyPath(binding.policyPath)
    && validSha256(binding.policyDigest)
    && validSha256(binding.approvalDigest)
    && /^[a-f0-9]{40}$/u.test(binding.policySourceRevision)
    && /^[a-f0-9]{40}$/u.test(binding.trustedControllerSha)
    && binding.policySourceRevision === target?.baseSha
    && binding.trustedControllerSha === target?.baseSha
    && typeof binding.evaluatorVersion === "string"
    && binding.evaluatorVersion.length > 0
    && binding.evaluatorVersion.length <= 50;
  const validDecision = decision
    && exactKeys(decision, ["mode", "outcome", "reason", "evidenceCount", "assuranceLevel", "behavioralEvidencePassed"])
    && ["observe", "enforce"].includes(decision.mode)
    && Object.values(AUTONOMOUS_DECISION).includes(decision.outcome)
    && typeof decision.reason === "string"
    && decision.reason.length > 0
    && decision.reason.length <= 200
    && Number.isInteger(decision.evidenceCount)
    && decision.evidenceCount >= 0
    && decision.evidenceCount <= MAX_ASSURANCE_EVIDENCE
    && decision.assuranceLevel === (decision.evidenceCount > 0 ? "BEHAVIORAL" : "SCOPE_ONLY")
    && typeof decision.behavioralEvidencePassed === "boolean";
  const validEvidence = Array.isArray(passport.evidence)
    && passport.evidence.length === decision?.evidenceCount
    && passport.evidence.every((item) => (
      exactKeys(item, [
        "checkName",
        "expectedPublisher",
        "actualPublisher",
        "checkRunId",
        "publisherAppId",
        "status",
        "conclusion",
        "completedAt",
        "headSha",
      ])
      && typeof item.checkName === "string"
      && item.checkName.length > 0
      && item.checkName.length <= MAX_ASSURANCE_CHECK_NAME_LENGTH
      && typeof item.expectedPublisher === "string"
      && item.expectedPublisher.length <= MAX_ASSURANCE_PUBLISHER_LENGTH
      && (item.expectedPublisher === ANY_ASSURANCE_PUBLISHER || GITHUB_APP_SLUG.test(item.expectedPublisher))
      && typeof item.actualPublisher === "string"
      && item.actualPublisher.length <= MAX_ASSURANCE_PUBLISHER_LENGTH
      && ([UNKNOWN_ASSURANCE_VALUE, LEGACY_COMMIT_STATUS].includes(item.actualPublisher)
        || GITHUB_APP_SLUG.test(item.actualPublisher))
      && typeof item.status === "string"
      && ASSURANCE_EVIDENCE_STATUSES.has(item.status)
      && typeof item.conclusion === "string"
      && ASSURANCE_EVIDENCE_CONCLUSIONS.has(item.conclusion)
      && typeof item.completedAt === "string"
      && validAssuranceTimestamp(item.completedAt)
      && ((item.checkRunId === null && item.publisherAppId === null)
        || (validPositiveId(item.checkRunId) && validPositiveId(item.publisherAppId)))
      && (item.checkRunId === null
        ? [UNKNOWN_ASSURANCE_VALUE, LEGACY_COMMIT_STATUS].includes(item.actualPublisher)
        : GITHUB_APP_SLUG.test(item.actualPublisher))
      && (item.actualPublisher !== LEGACY_COMMIT_STATUS || item.expectedPublisher === ANY_ASSURANCE_PUBLISHER)
      && (decision?.mode !== "enforce" || (
        item.expectedPublisher !== ANY_ASSURANCE_PUBLISHER
        && GITHUB_APP_SLUG.test(item.expectedPublisher)
        && item.actualPublisher !== LEGACY_COMMIT_STATUS
      ))
      && (item.status !== "MISSING" || (
        item.actualPublisher === UNKNOWN_ASSURANCE_VALUE
        && item.checkRunId === null
        && item.conclusion === UNKNOWN_ASSURANCE_VALUE
      ))
      && (item.status !== "COMPLETED" || item.conclusion !== "SUCCESS" || (
        item.actualPublisher !== UNKNOWN_ASSURANCE_VALUE
        && (item.expectedPublisher === ANY_ASSURANCE_PUBLISHER
          || item.actualPublisher === item.expectedPublisher)
      ))
      && item.headSha === target?.headSha
    ));
  const evidencePassed = Array.isArray(passport.evidence)
    ? assuranceEvidencePassed(passport.evidence)
    : false;
  const decisionSemanticsValid = decision?.mode !== "enforce"
    || decision.outcome !== AUTONOMOUS_DECISION.PASS
    || (
      decision.reason === "ALL_GUARANTEES_SATISFIED"
      && decision.evidenceCount > 0
      && decision.assuranceLevel === "BEHAVIORAL"
      && decision.behavioralEvidencePassed === true
      && evidencePassed
    );
  if (
    !exactKeys(passport, ["schemaVersion", "type", "target", "binding", "decision", "evidence", "authority", "verification", "digest"])
    || passport.schemaVersion !== 1
    || passport.type !== "changeplane.assurance-passport"
    || !validTarget
    || !validBinding
    || !validDecision
    || !validEvidence
    || decision?.behavioralEvidencePassed !== evidencePassed
    || !decisionSemanticsValid
    || canonicalJson(passport.authority) !== canonicalJson(assuranceAuthorityMap())
    || canonicalJson(passport.verification) !== canonicalJson({
      localIntegrity: "SHA256_ONLY",
      authenticity: "REQUIRES_LIVE_GITHUB_CHECK",
      checkName: CHECK_NAME,
      agentIdentityUsedForDecision: false,
    })
    || !validSha256(claimedDigest)
    || claimedDigest !== markerDigest
    || assurancePassportDigest(unsigned) !== claimedDigest
  ) {
    throw new Error("The ChangePlane assurance passport is invalid.");
  }
  return passport;
}

export function parseAssurancePassportIntegrity(markdown) {
  if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
  const matches = [...markdown.matchAll(new RegExp(ASSURANCE_PASSPORT_STATE.source, "gu"))];
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw new Error("The ChangePlane assurance passport is invalid.");
  const match = matches[0];
  if (match[2].length > MAX_ASSURANCE_PASSPORT_ENCODED_LENGTH) {
    throw new Error("The ChangePlane assurance passport is too large.");
  }
  let passport;
  try {
    passport = JSON.parse(Buffer.from(match[2], "base64url").toString("utf8"));
  } catch {
    throw new Error("The ChangePlane assurance passport is invalid.");
  }
  return verifyAssurancePassportIntegrity(passport, match[1]);
}

export function verifyAssurancePassportAgainstCheck(passport, liveCheck, expectedPublisher) {
  const verifiedPassport = verifyAssurancePassportIntegrity(passport);
  if (
    !expectedPublisher
    || typeof expectedPublisher !== "object"
    || Array.isArray(expectedPublisher)
    || Object.keys(expectedPublisher).sort().join("\0") !== ["appId", "appSlug"].sort().join("\0")
    || !validPositiveId(expectedPublisher.appId)
    || typeof expectedPublisher.appSlug !== "string"
    || !GITHUB_APP_SLUG.test(expectedPublisher.appSlug)
  ) {
    throw new Error("The expected GitHub Check publisher is invalid.");
  }
  const summary = liveCheck?.output?.summary;
  const expectedMarker = assurancePassportMarker(verifiedPassport);
  const passportMarkers = typeof summary === "string"
    ? [...summary.matchAll(new RegExp(ASSURANCE_PASSPORT_STATE.source, "gu"))]
    : [];
  const receiptMarkers = typeof summary === "string"
    ? [...summary.matchAll(new RegExp(RECEIPT_STATE.source, "gu"))]
    : [];
  const liveMarker = passportMarkers[0]?.[0] ?? null;
  const receiptMarkerValid = verifiedPassport.target.type === "merge_group"
    ? receiptMarkers.length === 0
    : receiptMarkers.length === 1
      && receiptMarkers[0][1] === verifiedPassport.binding.contractDigest
      && receiptMarkers[0][2] === verifiedPassport.binding.inputDigest
      && receiptMarkers[0][3] === verifiedPassport.target.headSha;
  if (
    !validPositiveId(liveCheck?.id)
    || liveCheck.name !== CHECK_NAME
    || liveCheck.head_sha !== verifiedPassport.target.headSha
    || liveCheck.status !== "completed"
    || liveCheck.conclusion !== expectedGuardConclusion(verifiedPassport)
    || liveCheck.app?.id !== expectedPublisher.appId
    || liveCheck.app?.slug !== expectedPublisher.appSlug
    || typeof summary !== "string"
    || passportMarkers.length !== 1
    || liveMarker !== expectedMarker
    || !receiptMarkerValid
  ) {
    throw new Error("The live GitHub Check does not authenticate this assurance passport.");
  }
  return {
    authenticity: "VERIFIED_LIVE_GITHUB_CHECK",
    passport: verifiedPassport,
    checkRunId: liveCheck.id,
    publisherAppId: liveCheck.app.id,
    publisherAppSlug: liveCheck.app.slug,
  };
}

export function assurancePassportOutputs(passport, liveCheckPublished = false) {
  if (!liveCheckPublished) return {};
  const verifiedPassport = verifyAssurancePassportIntegrity(passport);
  return {
    assurance_passport: canonicalJson(verifiedPassport),
    assurance_passport_digest: verifiedPassport.digest,
  };
}

export function buildProofLocator(passport, publishedCheck) {
  const verifiedPassport = verifyAssurancePassportIntegrity(passport);
  if (
    !validPositiveId(publishedCheck?.id)
    || publishedCheck.name !== CHECK_NAME
    || publishedCheck.head_sha !== verifiedPassport.target.headSha
  ) {
    throw new Error("The published GitHub Check cannot locate this assurance proof.");
  }
  return {
    schemaVersion: 1,
    type: "changeplane.assurance-proof-locator",
    repositoryId: verifiedPassport.target.repositoryId,
    targetType: verifiedPassport.target.type,
    pullRequestNumber: verifiedPassport.target.pullRequestNumber,
    headSha: verifiedPassport.target.headSha,
    checkRunId: publishedCheck.id,
    passportDigest: verifiedPassport.digest,
  };
}

export function parseRemediationComments(comments, trustedLogin = "github-actions[bot]") {
  if (!Array.isArray(comments)) throw new TypeError("comments must be an array");
  return comments.flatMap((comment) => {
    if (comment?.user?.login !== trustedLogin) return [];
    const match = String(comment?.body ?? "").match(REMEDIATION_MARKER);
    if (!match) return [];
    return [{ inputDigest: match[1], attempt: Number(match[2]), idempotencyKey: match[3] }];
  });
}

export function remediationIdempotencyKey({ repository, pullRequestNumber, headSha, inputDigest, attempt }) {
  return digest({ repository, pullRequestNumber, headSha, inputDigest, attempt });
}

export function findCurrentRemediationRequest(remediationComments, context) {
  if (!Array.isArray(remediationComments)) throw new TypeError("remediationComments must be an array");
  return remediationComments.find((item) => (
    item.inputDigest === context.inputDigest
    && item.idempotencyKey === remediationIdempotencyKey({ ...context, attempt: item.attempt })
  ));
}

function renderRemediationComment({ inputDigest, idempotencyKey, payload, maxAttempts, authorization }) {
  const paths = payload.instructions.map(({ path, action }) => (
    action === "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE"
      ? `- \`${safeMarkdown(path)}\`: propose the smallest in-scope patch for this exact failure`
      : `- \`${safeMarkdown(path)}\`: revert or move into declared scope`
  ));
  return [
    `<!-- changeplane-remediation:v1 input=${inputDigest} attempt=${payload.attempt} id=${idempotencyKey} -->`,
    "## ChangePlane · agent remediation requested",
    "",
    `Attempt **${payload.attempt}/${maxAttempts}** was sent to the configured agent harness for head \`${payload.change.headSha.slice(0, 12)}\`.`,
    `Controller authorization \`${authorization.authorizationId.slice(0, 12)}\` expires at \`${authorization.deadlineAt}\`.`,
    "",
    ...paths,
    "",
    "The required check remains closed. A new commit will be evaluated automatically; no human action is needed unless the remediation budget is exhausted.",
  ].join("\n");
}

async function dispatchAgentWebhook(url, token, payload) {
  const parsed = validateAgentWebhookUrl(url);
  if (typeof token !== "string" || token.length < 32) throw new Error("Agent webhook secret must contain at least 32 characters.");
  const deliveryId = payload.idempotencyKey;
  const body = canonicalJson(payload);
  const signature = `sha256=${createHmac("sha256", token)
    .update("changeplane:controller-request:v1\0")
    .update(deliveryId)
    .update("\0")
    .update(body)
    .digest("hex")}`;

  const response = await fetch(parsed, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "changeplane-guard/0.1",
      "x-changeplane-delivery": deliveryId,
      "x-changeplane-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Agent webhook rejected the request (${response.status}).`);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Agent webhook returned an invalid controller authorization.");
  }
  if (result?.authorizationId !== deliveryId || !validSha256(result?.grantDigest)
    || !validSha256(result?.campaignId) || ![1, 2].includes(result?.attempt)
    || typeof result?.deadlineAt !== "string") {
    throw new Error("Agent webhook returned an invalid controller authorization.");
  }
  return result;
}

function compactPaths(paths, limit = 12) {
  const visible = paths.slice(0, limit).map((path) => `\`${safeMarkdown(path)}\``);
  return `${visible.join(", ")}${paths.length > limit ? `, +${paths.length - limit} more` : ""}`;
}

function nextAction(receipt) {
  if (receipt.decision === AUTONOMOUS_DECISION.PASS) {
    return {
      owner: "Nobody",
      action: "Merge when the repository's required CI checks pass.",
    };
  }
  if (receipt.decision === AUTONOMOUS_DECISION.CHANGES_REQUIRED) {
    return {
      owner: "PR author or coding agent",
      action: "Use the proposal-only agent handback below, apply the smallest allowed change, then push a new commit for exact-head re-evaluation.",
    };
  }
  if (receipt.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED) {
    return receipt.mode === "observe"
      ? {
        owner: "Configured repair adapter (simulated in observe)",
        action: `Enforce mode would send repair attempt ${receipt.nextAttempt}/${receipt.maxAttempts}; no request was dispatched.`,
      }
      : {
        owner: "Configured repair adapter",
        action: `Push repair attempt ${receipt.nextAttempt}/${receipt.maxAttempts}; the next head SHA will be evaluated automatically.`,
      };
  }
  if (receipt.decision === AUTONOMOUS_DECISION.BLOCKED) {
    return {
      owner: "PR author or coding agent",
      action: "Remove every blocked path. This policy decision cannot be overridden.",
    };
  }
  if (receipt.reason === "PROTECTED_CAPABILITY") {
    return {
      owner: "Repository reviewer with write access",
      action: `Review the protected change, then approve this exact revision with review body \`ChangePlane approve ${receipt.approvalDigest}\`, or ask the author to rescope it.`,
    };
  }
  if (receipt.reason === "CONTRACT_CHANGED_AFTER_BINDING") {
    return {
      owner: "Repository owner",
      action: "Restore the first bound contract or open a new pull request. An agent cannot broaden scope after evaluation starts.",
    };
  }
  if (["EVIDENCE_FAILED", "EVIDENCE_PENDING", "EVIDENCE_MISSING", "EVIDENCE_SOURCE_MISMATCH"].includes(receipt.reason)) {
    return {
      owner: "CI or platform owner",
      action: "Restore every required exact-head check, then re-run ChangePlane on the same revision.",
    };
  }
  if (receipt.reason === "REMEDIATION_BUDGET_EXHAUSTED") {
    return {
      owner: "Repository owner",
      action: "Inspect the exhausted repair attempts, then rescope the change or approve the exact revision.",
    };
  }
  if (receipt.agentHandback) {
    return {
      owner: "PR author or coding agent",
      action: "Use the proposal-only agent handback below, then push a new commit for exact-head re-evaluation.",
    };
  }
  return {
    owner: "Platform owner",
    action: "Connect the agent adapter or route this exception to the repository owner.",
  };
}

const FIXABLE_FINDING_CODES = new Set(["OUTSIDE_PLANNED_SCOPE", "EVIDENCE_FAILED"]);

export function buildAgentHandback({
  repository,
  pullRequest,
  plan,
  policyDigest,
  contractDigest,
  inputDigest,
  autonomousPlan,
  maxAttempts,
}) {
  const findings = (autonomousPlan?.findings ?? [])
    .filter(({ code, resolved }) => FIXABLE_FINDING_CODES.has(code) && !resolved)
    .slice(0, 20)
    .map(({ code, path, pathKind, diagnostic }) => ({
      code,
      path,
      pathKind,
      action: code === "EVIDENCE_FAILED"
        ? "PROPOSE_SMALLEST_PATCH_WITHIN_CONTRACT"
        : "PROPOSE_REVERT_OR_MOVE_INTO_CONTRACT",
      ...(diagnostic ? { diagnostic: evidenceText(diagnostic, 1_000) } : {}),
    }));
  if (findings.length === 0) return null;
  const kinds = new Set(findings.map(({ code }) => code));
  const allowedPaths = [...new Set(findings.flatMap(({ code, path }) => (
    code === "EVIDENCE_FAILED" ? plan.scope : [path]
  )))].sort();
  const payload = {
    schemaVersion: 1,
    type: "changeplane.agent-handback",
    target: {
      repository,
      pullRequestNumber: pullRequest.number,
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
    },
    binding: {
      inputDigest,
      contractDigest,
      policyDigest,
      evaluatorVersion: EVALUATOR_VERSION,
    },
    contract: { scope: plan.scope, goal: plan.goal ?? null },
    proposal: {
      kind: kinds.size === 1 ? (kinds.has("EVIDENCE_FAILED") ? "evidence" : "scope") : "mixed",
      allowedPaths,
      findings,
      requestedAttempt: autonomousPlan.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED
        ? autonomousPlan.nextAttempt
        : null,
      maxAttempts,
    },
    authority: {
      proposalOnly: true,
      gitWrite: false,
      checkWrite: false,
      pass: false,
      merge: false,
    },
  };
  return { ...payload, digest: digest(payload) };
}

function encodedAgentHandback(handback) {
  return Buffer.from(canonicalJson(handback)).toString("base64url");
}

function passportEvidence(item, headSha) {
  const bounded = (value, fallback, maximum, label) => {
    const result = String(value ?? fallback);
    if (result.length > maximum) {
      throw new Error(`Assurance passport ${label} exceeds ${maximum} characters.`);
    }
    return result;
  };
  const passportId = (value, label) => {
    if (value == null) return null;
    if (!validPositiveId(value)) throw new Error(`Assurance passport ${label} must be a positive safe integer.`);
    return value;
  };
  const checkRunId = passportId(item?.checkRunId, "Check Run ID");
  const publisherAppId = passportId(item?.publisherAppId, "publisher App ID");
  const actualPublisher = checkRunId === null && publisherAppId === null && item?.source
    ? LEGACY_COMMIT_STATUS
    : bounded(item?.source, UNKNOWN_ASSURANCE_VALUE, MAX_ASSURANCE_PUBLISHER_LENGTH, "actual publisher");
  return {
    checkName: bounded(item?.name, "", MAX_ASSURANCE_CHECK_NAME_LENGTH, "Check name"),
    expectedPublisher: bounded(item?.expectedSource, ANY_ASSURANCE_PUBLISHER, MAX_ASSURANCE_PUBLISHER_LENGTH, "expected publisher"),
    actualPublisher,
    checkRunId,
    publisherAppId,
    status: bounded(item?.status, "", 30, "evidence status"),
    conclusion: bounded(item?.conclusion, UNKNOWN_ASSURANCE_VALUE, 30, "evidence conclusion"),
    completedAt: bounded(item?.completedAt, "", MAX_ASSURANCE_TIMESTAMP_LENGTH, "evidence completion time"),
    headSha,
  };
}

export function buildAssurancePassport(receipt) {
  validateAssurancePolicyPath(receipt?.policy?.path);
  if (!Array.isArray(receipt.evidence ?? [])) throw new Error("Assurance passport evidence must be an array.");
  if ((receipt.evidence ?? []).length > MAX_ASSURANCE_EVIDENCE) {
    throw new Error(`Assurance passports support at most ${MAX_ASSURANCE_EVIDENCE} evidence entries.`);
  }
  const evidence = (receipt.evidence ?? []).map((item) => passportEvidence(item, receipt.headSha));
  const payload = {
    schemaVersion: 1,
    type: "changeplane.assurance-passport",
    target: {
      type: receipt.targetType ?? "pull_request",
      repository: receipt.repository,
      repositoryId: receipt.repositoryId,
      pullRequestNumber: receipt.targetType === "merge_group" ? null : receipt.pullRequestNumber,
      baseSha: receipt.baseSha,
      headSha: receipt.headSha,
    },
    binding: {
      inputDigest: receipt.inputDigest,
      contractDigest: receipt.boundContractDigest ?? receipt.contractDigest,
      policyPath: receipt.policy.path,
      policyDigest: receipt.policy.digest,
      policySourceRevision: receipt.policy.sourceRevision ?? receipt.baseSha,
      approvalDigest: receipt.approvalDigest,
      evaluatorVersion: receipt.evaluatorVersion,
      trustedControllerSha: receipt.baseSha,
    },
    decision: {
      mode: receipt.mode,
      outcome: receipt.decision,
      reason: receipt.reason,
      evidenceCount: evidence.length,
      assuranceLevel: evidence.length > 0 ? "BEHAVIORAL" : "SCOPE_ONLY",
      behavioralEvidencePassed: assuranceEvidencePassed(evidence),
    },
    evidence,
    authority: assuranceAuthorityMap(),
    verification: {
      localIntegrity: "SHA256_ONLY",
      authenticity: "REQUIRES_LIVE_GITHUB_CHECK",
      checkName: CHECK_NAME,
      agentIdentityUsedForDecision: false,
    },
  };
  const passport = { ...payload, digest: assurancePassportDigest(payload) };
  verifyAssurancePassportIntegrity(passport);
  encodedAssurancePassport(passport);
  return passport;
}

function encodedAssurancePassport(passport) {
  const encoded = Buffer.from(canonicalJson(passport)).toString("base64url");
  if (encoded.length > MAX_ASSURANCE_PASSPORT_ENCODED_LENGTH) {
    throw new Error("The ChangePlane assurance passport is too large.");
  }
  return encoded;
}

function assurancePassportMarker(passport) {
  return `<!-- changeplane-assurance-passport:v1 digest=${passport.digest} payload=${encodedAssurancePassport(passport)} -->`;
}

export function buildReceipt({
  repository,
  repositoryId,
  pullRequest,
  plan,
  contractSource = "declared",
  policyPath,
  policyDigest,
  inputDigest,
  contractDigest,
  boundContractDigest = contractDigest,
  approvalDigest,
  result,
  evidence = [],
  preview = { status: "MISSING" },
  approval,
  autonomousPlan,
  mode,
  actualFiles,
  advisories = [],
  maxAttempts,
  agentHandback = null,
}) {
  return {
    schemaVersion: 1,
    repository,
    repositoryId,
    pullRequestNumber: pullRequest.number,
    mode,
    decision: autonomousPlan.decision,
    reason: autonomousPlan.reason,
    baseSha: pullRequest.base.sha,
    headSha: pullRequest.head.sha,
    inputDigest,
    contractDigest,
    boundContractDigest,
    approvalDigest,
    evaluatorVersion: EVALUATOR_VERSION,
    policy: { path: policyPath, digest: policyDigest },
    contractSource,
    goal: plan.goal ?? null,
    plannedScope: plan.scope,
    actualFiles: actualFiles.map(({ path }) => path),
    findings: result.reasons,
    advisories,
    evidence,
    preview: bindPreview(preview, pullRequest.head.sha),
    agentHandback,
    approval: approval
      ? { status: "CURRENT", actor: approval.actorLogin }
      : { status: result.approval.status },
    humanRequired: autonomousPlan.humanRequired,
    nextAttempt: autonomousPlan.nextAttempt ?? null,
    maxAttempts,
  };
}

function renderPreview(preview) {
  if (preview?.status === "READY") {
    return `<${preview.url}> · ${safeMarkdown(preview.environment)} · bound to \`${preview.headSha.slice(0, 12)}\``;
  }
  if (preview?.status === "REVISION_MISMATCH") return "Excluded because deployment metadata did not match this revision";
  if (preview?.status === "UNAVAILABLE") return "GitHub deployment metadata unavailable (advisory)";
  return "Not published for this revision (advisory)";
}

function renderPreviewProvenance(preview) {
  if (preview?.status !== "READY") return null;
  return [
    `revision \`${preview.headSha.slice(0, 12)}\``,
    `deployment \`${preview.deploymentId ?? "unknown"}\``,
    `status \`${preview.statusId ?? "unknown"}\``,
    `creator @${safeMarkdown(preview.statusCreator ?? "unknown")}`,
    `task \`${safeMarkdown(preview.task ?? "deploy")}\``,
    ...(preview.environmentOverride ? [`environment override \`${safeMarkdown(preview.environmentOverride)}\``] : []),
    "informational only",
  ].join(" · ");
}

function receiptOutcome(receipt) {
  if (receipt.decision === AUTONOMOUS_DECISION.PASS) {
    return receipt.evidence.length === 0 ? "Revision and scope recorded." : "All configured guarantees passed.";
  }
  if (receipt.decision === AUTONOMOUS_DECISION.CHANGES_REQUIRED) return "Changes are required before this revision can pass.";
  if (receipt.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED) return "A fixable issue is ready for bounded repair.";
  if (receipt.decision === AUTONOMOUS_DECISION.REVIEW_REQUIRED) return "A human decision is required.";
  if (receipt.decision === AUTONOMOUS_DECISION.BLOCKED) return "Repository policy blocks this revision.";
  return `ChangePlane returned ${safeMarkdown(receipt.decision)}.`;
}

export function renderReceiptComment(receipt) {
  const next = nextAction(receipt);
  const outcome = receiptOutcome(receipt);
  const passport = buildAssurancePassport(receipt);
  const boundPlan = {
    scope: receipt.plannedScope,
    ...(receipt.goal ? { goal: receipt.goal } : {}),
  };
  const lines = [
    `${RECEIPT_MARKER} contract=${receipt.boundContractDigest} input=${receipt.inputDigest} head=${receipt.headSha} -->`,
    `<!-- changeplane-contract:v1 source=${receipt.contractSource} plan=${encodedContract(boundPlan)} -->`,
    assurancePassportMarker(passport),
    ...(receipt.agentHandback ? [`<!-- changeplane-agent-handback:v1 digest=${receipt.agentHandback.digest} payload=${encodedAgentHandback(receipt.agentHandback)} -->`] : []),
    `## ChangePlane · ${outcome.replace(/\.$/u, "")}`,
    "",
    `**What happened:** ${outcome}`,
    `**Merge impact:** ${receipt.mode === "observe"
      ? "ChangePlane is observing and does not block this pull request."
      : receipt.decision === AUTONOMOUS_DECISION.PASS
        ? "ChangePlane reports PASS for this revision; GitHub's rules still decide merge."
        : "ChangePlane publishes a non-passing exact-head Check; GitHub blocks only when that Check is required."}`,
    `**Who acts:** ${next.owner}.`,
    `**Next action:** ${next.action}`,
    `**Current revision:** \`${receipt.headSha.slice(0, 12)}\``,
    "",
    receipt.mode === "observe"
      ? "> **Observe only.** No repair is dispatched and this receipt cannot block merge."
      : "> **Blocking-capable guard.** GitHub blocks this exact-head result only when `ChangePlane / guard` is required by branch protection or a ruleset.",
    ...(receipt.evidence.length === 0
      ? ["", "> **Behavioral evidence:** No automated test was required for this receipt. This is not evidence that the code works."]
      : []),
    "",
    "### Independent authority",
    "",
    `Assurance passport \`${passport.digest.slice(0, 12)}\` binds this decision to the exact head. Its SHA-256 detects changes; live correspondence requires the exact \`${CHECK_NAME}\`, policy, evidence, and target on GitHub. The passport carries no credential or merge authority.`,
    "",
    "| Plane | Owns | Cannot do |",
    "| --- | --- | --- |",
    "| Authoring agent | Change | Decide PASS, publish guard, or merge |",
    "| Proposal model | Propose | Write the repository, decide PASS, or merge |",
    "| Deterministic harness | Decide + publish guard | Apply a patch or merge |",
    "| Trusted controller | Apply an accepted patch | Decide PASS or merge |",
    "| GitHub | Merge authority | Delegate merge authority to this passport |",
    "",
    "<details>",
    "<summary>Technical receipt and evidence</summary>",
    "",
    "| Revision-bound input | Value |",
    "| --- | --- |",
    `| Mode | **${safeMarkdown(receipt.mode)}** |`,
    `| Revision | \`${receipt.baseSha.slice(0, 12)}\` → \`${receipt.headSha.slice(0, 12)}\` |`,
    `| Goal | ${receipt.goal ? safeMarkdown(receipt.goal) : "Not declared"} |`,
    `| Contract | ${receipt.contractSource === "first-head" ? "First observed head · automatic" : "Declared in pull request"} |`,
    `| Planned scope | ${compactPaths(receipt.plannedScope)} |`,
    `| Actual files | **${receipt.actualFiles.length}** · ${compactPaths(receipt.actualFiles)} |`,
    `| Policy | \`${safeMarkdown(receipt.policy.path)}\` · \`${receipt.policy.digest.slice(0, 12)}\` |`,
    `| Evaluator | \`${safeMarkdown(receipt.evaluatorVersion)}\` · approval \`${receipt.approvalDigest.slice(0, 12)}\` |`,
    `| Approval | ${receipt.approval.status === "CURRENT" ? `Current review by @${safeMarkdown(receipt.approval.actor)}` : safeMarkdown(receipt.approval.status)} |`,
    `| Preview | ${renderPreview(receipt.preview)} |`,
    ...(renderPreviewProvenance(receipt.preview) ? [`| Preview provenance | ${renderPreviewProvenance(receipt.preview)} |`] : []),
  ];

  if (receipt.evidence.length > 0) {
    lines.push(
      "",
      "### Required evidence",
      "",
      "| Check | Expected source | Actual source | Status | Conclusion |",
      "| --- | --- | --- | --- | --- |",
      ...receipt.evidence.map((item) => `| ${safeMarkdown(item.name)} | ${safeMarkdown(item.expectedSource ?? "Any")} | ${safeMarkdown(item.source ?? "—")} | ${safeMarkdown(item.status)} | ${safeMarkdown(item.conclusion ?? "—")} |`),
    );
  }

  if (receipt.findings.length === 0) {
    lines.push("", "No scope or protected-path findings.");
  } else {
    lines.push("", "### Findings", "", "| Decision input | Path | Rule |", "| --- | --- | --- |");
    for (const finding of receipt.findings.slice(0, 20)) {
      lines.push(`| ${safeMarkdown(finding.code)} | \`${safeMarkdown(finding.path)}\` | ${finding.rule ? `\`${safeMarkdown(finding.rule)}\`` : "Declared scope"} |`);
    }
    if (receipt.findings.length > 20) lines.push(`| … | +${receipt.findings.length - 20} more findings | Open the job summary |`);
  }

  if (receipt.agentHandback) {
    lines.push(
      "",
      "### Agent handback",
      "",
      `Proposal only · exact head \`${receipt.agentHandback.target.headSha.slice(0, 12)}\` · ${receipt.agentHandback.proposal.findings.length} fixable finding${receipt.agentHandback.proposal.findings.length === 1 ? "" : "s"}`,
      "",
      `Allowed proposal paths: ${compactPaths(receipt.agentHandback.proposal.allowedPaths)}`,
      "",
      "| Fixable finding | Target | Requested proposal |",
      "| --- | --- | --- |",
      ...receipt.agentHandback.proposal.findings.map((finding) => `| ${safeMarkdown(finding.code)} | \`${safeMarkdown(finding.path)}\` | ${safeMarkdown(finding.action)} |`),
      "",
      "The receiving agent may propose a patch. It cannot push, merge, publish a Check, or issue PASS.",
    );
  }

  if (receipt.advisories.length > 0) {
    lines.push(
      "",
      "### Concurrent change risk",
      "",
      "| Open pull request | Shared paths |",
      "| --- | --- |",
      ...receipt.advisories.map((advisory) => {
        const pullRequest = advisory.pullRequest;
        const reference = pullRequest.url
          ? `#${pullRequest.number} · <${pullRequest.url}>`
          : `#${pullRequest.number}`;
        return `| ${reference} · ${safeMarkdown(pullRequest.title ?? "Untitled change")} | ${compactPaths(advisory.paths)} |`;
      }),
      "",
      "Advisory only. ChangePlane never auto-merges overlapping pull requests.",
    );
  }

  lines.push(
    "",
    "</details>",
    "",
    "If this decision is wrong, reply `ChangePlane false positive: <reason>`. The repository owner will review every report before enforcement is enabled.",
  );
  return `${lines.join("\n")}\n`;
}

async function upsertReceiptComment(repository, number, comments, token, body) {
  const existing = comments.find((comment) => (
    comment?.user?.login === "github-actions[bot]"
    && String(comment?.body ?? "").includes(RECEIPT_MARKER)
  ));
  if (existing?.id) {
    await api(`/repos/${repository}/issues/comments/${existing.id}`, token, {
      method: "PATCH",
      body: { body },
    });
    return;
  }
  await api(`/repos/${repository}/issues/${number}/comments`, token, {
    method: "POST",
    body: { body },
  });
}

function renderSummary({ pullRequest, plan, policyPath, policyDigest, result, approval, autonomousPlan, mode, actualFiles, preview }) {
  const lines = [
    `# ChangePlane · ${autonomousPlan.decision}`,
    "",
    `**Mode:** ${mode}`,
    `**PR:** #${pullRequest.number} · **Revision:** \`${pullRequest.base.sha.slice(0, 12)}\` → \`${pullRequest.head.sha.slice(0, 12)}\``,
    ...(plan.goal ? [`**Goal:** ${safeMarkdown(plan.goal)}`] : []),
    `**Planned scope:** ${plan.scope.map((path) => `\`${safeMarkdown(path)}\``).join(", ")}`,
    `**Actual files:** ${actualFiles.length}`,
    `**Policy:** \`${safeMarkdown(policyPath)}\` · \`${policyDigest.slice(0, 12)}\``,
    `**Approval:** ${approval ? `current review by @${safeMarkdown(approval.actorLogin)}` : "not present for this head"}`,
    `**Preview:** ${renderPreview(preview)}`,
    ...(renderPreviewProvenance(preview) ? [`**Preview provenance:** ${renderPreviewProvenance(preview)}`] : []),
    "",
  ];

  if (result.reasons.length === 0) {
    lines.push("No scope or protected-path findings.");
  } else {
    lines.push("| Decision input | Path | Rule |", "| --- | --- | --- |");
    for (const reason of result.reasons) {
      lines.push(`| ${safeMarkdown(reason.code)} | \`${safeMarkdown(reason.path)}\` | ${reason.rule ? `\`${safeMarkdown(reason.rule)}\`` : "Declared scope"} |`);
    }
  }

  lines.push(
    "",
    autonomousPlan.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED
      ? mode === "observe"
        ? `Enforce mode would request agent remediation attempt ${autonomousPlan.nextAttempt}. No request was dispatched.`
        : `Agent remediation attempt ${autonomousPlan.nextAttempt} was requested. The next commit will be evaluated automatically.`
      : autonomousPlan.decision === AUTONOMOUS_DECISION.CHANGES_REQUIRED
        ? "A proposal-only coding-agent handback was emitted. Apply an allowed change and push a new commit for exact-head re-evaluation; no webhook or repair controller was invoked."
      : autonomousPlan.decision === AUTONOMOUS_DECISION.REVIEW_REQUIRED
        ? `Human exception required: ${autonomousPlan.reason}.`
        : autonomousPlan.decision === AUTONOMOUS_DECISION.BLOCKED
        ? "Remove the blocked path. Policy blocks cannot be approved."
        : "The current commit matches policy.",
  );
  if (mode === "observe") {
    lines.push("", "Observe mode reported this decision without blocking the pull request or dispatching agent remediation.");
  }
  return `${lines.join("\n")}\n`;
}

function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function writeSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}

function skipRun(mode, headSha, reason) {
  const detail = reason === "AMBIGUOUS_PULL_REQUEST"
    ? "The deployment revision matched more than one open same-repository pull request."
    : reason === "STALE_DEPLOYMENT"
      ? "The associated pull request moved to a newer revision before evaluation."
      : "The deployment revision has no open same-repository pull request.";
  writeSummary(`# ChangePlane · SKIPPED\n\n**Mode:** ${mode}\n**Revision:** \`${headSha.slice(0, 12)}\`\n\n${detail} No receipt or Check was changed.\n`);
  writeOutput("mode", mode);
  writeOutput("decision", "SKIPPED");
  console.log(`ChangePlane SKIPPED (${reason}) for ${headSha.slice(0, 7)}`);
  return { skipped: true, reason, mode };
}

function workflowCommandValue(value) {
  return String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function buildMergeGroupReceipt({
  repository,
  repositoryId,
  target,
  plan,
  policyPath,
  policyDigest,
  inputDigest,
  contractDigest,
  result,
  evidence,
  autonomousPlan,
  mode,
}) {
  return {
    schemaVersion: 1,
    targetType: "merge_group",
    repository,
    repositoryId,
    pullRequestNumber: null,
    mode,
    decision: autonomousPlan.decision,
    reason: autonomousPlan.reason,
    baseRef: target.baseRef,
    headRef: target.headRef,
    baseSha: target.baseSha,
    headSha: target.headSha,
    inputDigest,
    contractDigest,
    approvalDigest: digest({
      baseSha: target.baseSha,
      headSha: target.headSha,
      policyDigest,
      inputDigest,
      contractDigest,
      evaluatorVersion: EVALUATOR_VERSION,
    }),
    evaluatorVersion: EVALUATOR_VERSION,
    policy: { path: policyPath, digest: policyDigest, sourceRevision: target.baseSha },
    contractSource: "merge-group-exact-files",
    goal: null,
    plannedScope: plan.scope,
    actualFiles: target.actualFiles.map(({ path }) => path),
    findings: result.reasons,
    advisories: [],
    evidence,
    preview: { status: "MISSING" },
    approval: { status: result.approval.status },
    humanRequired: autonomousPlan.humanRequired,
    nextAttempt: null,
    maxAttempts: 0,
    agentHandback: null,
  };
}

export function renderMergeGroupReceipt(receipt) {
  const outcome = receiptOutcome(receipt);
  const passport = buildAssurancePassport(receipt);
  const lines = [
    assurancePassportMarker(passport),
    `# ChangePlane · ${outcome.replace(/\.$/u, "")}`,
    "",
    `**Merge queue revision:** \`${receipt.headSha.slice(0, 12)}\``,
    `**Trusted default-branch base:** \`${receipt.baseSha.slice(0, 12)}\``,
    `**Mode:** ${safeMarkdown(receipt.mode)}`,
    `**Assurance passport:** \`${passport.digest.slice(0, 12)}\` · integrity only until verified against this live GitHub Check`,
    `**Policy:** \`${safeMarkdown(receipt.policy.path)}\` at \`${receipt.policy.sourceRevision.slice(0, 12)}\` · \`${receipt.policy.digest.slice(0, 12)}\``,
    `**Changed files:** ${receipt.actualFiles.length}`,
    "",
    receipt.mode === "observe"
      ? "Observe mode records this exact merge-group revision without blocking it."
      : receipt.decision === AUTONOMOUS_DECISION.PASS
        ? "This exact merge-group revision passed. GitHub still owns queue and merge decisions."
        : "This exact merge-group revision did not pass. No repair or model was dispatched from the merge queue.",
  ];
  if (receipt.evidence.length > 0) {
    lines.push(
      "",
      "| Required evidence | Expected source | Actual source | Status | Conclusion |",
      "| --- | --- | --- | --- | --- |",
      ...receipt.evidence.map((item) => `| ${safeMarkdown(item.name)} | ${safeMarkdown(item.expectedSource ?? "Any")} | ${safeMarkdown(item.source ?? "—")} | ${safeMarkdown(item.status)} | ${safeMarkdown(item.conclusion ?? "—")} |`),
    );
  }
  if (receipt.findings.length > 0) {
    lines.push(
      "",
      "| Decision input | Path | Rule |",
      "| --- | --- | --- |",
      ...receipt.findings.slice(0, 20).map((finding) => `| ${safeMarkdown(finding.code)} | \`${safeMarkdown(finding.path)}\` | ${finding.rule ? `\`${safeMarkdown(finding.rule)}\`` : "Exact merge-group revision"} |`),
    );
  }
  return `${lines.join("\n")}\n`;
}

async function runMergeGroup({ event, repository, token, mode }) {
  const target = await resolveMergeGroup(event, repository, token);
  if (process.env.INPUT_TRUSTED_CONTROLLER_SHA !== target.baseSha) {
    throw new Error("The merge-group controller is not bound to its trusted default-branch base.");
  }
  try {
    await beginDedicatedGuard({
      repository,
      repositoryId: Number(event.repository?.id),
      defaultBranch: target.defaultBranch,
      controllerSha: target.baseSha,
      target: {
        type: "merge_group",
        pullRequestNumber: null,
        baseSha: target.baseSha,
        headSha: target.headSha,
        baseRef: target.baseRef,
        headRef: target.headRef,
      },
    });
  } catch (error) {
    throw new PublicationError(`The previous merge-group guard could not be invalidated: ${error instanceof Error ? error.message : error}`);
  }
  const policyPath = process.env.INPUT_POLICY_PATH || ".changeplane.json";
  const policy = await readPolicy(repository, target.baseSha, policyPath, token);
  validateActionEvidencePolicy(policy, mode);
  const plan = {
    scope: [...new Set(target.actualFiles.flatMap(({ path, previousPath }) => [path, previousPath]).filter(Boolean))].sort(),
  };
  const policyDigest = digest(policy);
  const contractDigest = digest(plan);
  const inputDigest = digest({
    targetType: target.targetType,
    baseSha: target.baseSha,
    headSha: target.headSha,
    files: target.actualFiles,
  });
  const revision = {
    baseSha: target.baseSha,
    headSha: target.headSha,
    policyDigest,
    inputDigest,
    contractDigest,
    evaluatorVersion: EVALUATOR_VERSION,
  };
  const pathResult = evaluateChange({
    plannedPaths: plan.scope,
    actualFiles: target.actualFiles,
    protectedPaths: effectiveProtectedPaths(policy, target.actualFiles),
    approval: undefined,
    ...revision,
  });
  const evidenceResult = await waitForEvidence(repository, target.headSha, policy, token, {
    includeCommitStatuses: mode !== "enforce",
  });
  const result = mergeEvaluation(pathResult, evidenceResult);
  const autonomousPlan = planAutonomousDecision({ result, agentConfigured: false });
  const receipt = buildMergeGroupReceipt({
    repository,
    repositoryId: Number(event.repository?.id),
    target,
    plan,
    policyPath,
    policyDigest,
    inputDigest,
    contractDigest,
    result,
    evidence: evidenceResult.evidence,
    autonomousPlan,
    mode,
  });
  const assurancePassport = buildAssurancePassport(receipt);
  const markdown = renderMergeGroupReceipt(receipt);
  if (await defaultBranchSha(repository, target.defaultBranch, token) !== target.baseSha) {
    throw new Error("The trusted default branch changed during merge-group evaluation.");
  }
  let proofLocator;
  try {
    const publishedCheck = await publishDedicatedGuard({
      repository,
      defaultBranch: target.defaultBranch,
      passport: assurancePassport,
      summary: markdown,
    });
    proofLocator = buildProofLocator(assurancePassport, publishedCheck);
  } catch (error) {
    throw new PublicationError(`Exact merge-group Check could not be published: ${error instanceof Error ? error.message : error}`);
  }
  writeSummary(markdown);
  writeOutput("mode", mode);
  writeOutput("decision", autonomousPlan.decision);
  writeOutput("receipt", canonicalJson(receipt));
  for (const [name, value] of Object.entries(assurancePassportOutputs(assurancePassport, true))) {
    writeOutput(name, value);
  }
  writeOutput("proof_locator", canonicalJson(proofLocator));
  writeOutput("actual_files", target.actualFiles.length);
  writeOutput("finding_count", result.reasons.length);
  console.log(`ChangePlane ${autonomousPlan.decision} (${mode}) for ${repository} merge group ${target.headSha.slice(0, 7)}`);
  if (shouldFailDecision(mode, autonomousPlan.decision)) process.exitCode = 1;
  return { ...result, autonomous: autonomousPlan, mode, targetType: "merge_group" };
}

export async function run() {
  const mode = parseMode(process.env.INPUT_MODE);
  const token = process.env.INPUT_TOKEN;
  if (!token) throw new Error("The token input is required.");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY is required.");
  if (event.merge_group) return runMergeGroup({ event, repository, token, mode });
  const agentWebhookUrl = String(process.env.INPUT_AGENT_WEBHOOK_URL ?? "").trim();
  const agentDispatch = parseAgentDispatch(process.env.INPUT_AGENT_DISPATCH, agentWebhookUrl);
  const agentConfigured = agentDispatch !== "none";
  const controllerSha = process.env.INPUT_TRUSTED_CONTROLLER_SHA;
  if (mode === "enforce" && !exactSha(controllerSha)) {
    throw new Error("Enforce mode requires the dedicated ChangePlane App controller or an exact trusted controller revision.");
  }
  if (mode === "enforce" && agentDispatch === "webhook" && (
    String(process.env.INPUT_AGENT_WEBHOOK_TOKEN ?? "").length < 32
    || !/^[1-9][0-9]{0,19}$/u.test(String(process.env.INPUT_CONTROLLER_INSTALLATION_ID ?? ""))
  )) {
    throw new Error("Enforce mode requires the dedicated ChangePlane App controller.");
  }
  const resolution = await resolvePullRequestNumber(event, repository, token);
  if (!resolution.number) return skipRun(mode, resolution.headSha, resolution.reason);
  const number = resolution.number;

  const pullRequest = await api(`/repos/${repository}/pulls/${number}`, token);
  if (!pullRequest.head?.sha || !pullRequest.base?.sha) throw new Error("GitHub returned incomplete pull-request SHAs.");
  if (resolution.headSha && pullRequest.head.sha !== resolution.headSha) {
    return skipRun(mode, resolution.headSha, "STALE_DEPLOYMENT");
  }
  if (pullRequest.head.repo?.full_name !== repository || pullRequest.base.repo?.full_name !== repository) {
    throw new Error("ChangePlane supports same-repository pull requests only.");
  }
  const trustedBase = await trustedDefaultBranch(repository, token);
  let guardLease;
  try {
    guardLease = await beginDedicatedGuard({
      repository,
      repositoryId: Number(event.repository?.id),
      defaultBranch: trustedBase.defaultBranch,
      controllerSha,
      target: {
        type: "pull_request",
        pullRequestNumber: number,
        baseSha: pullRequest.base.sha,
        headSha: pullRequest.head.sha,
        baseRef: pullRequest.base.ref,
        headRef: pullRequest.head.ref,
      },
    });
  } catch (error) {
    throw new PublicationError(`The previous exact-head guard could not be invalidated: ${error instanceof Error ? error.message : error}`);
  }
  await assertUniqueOpenPullRequestHead(repository, pullRequest, token);
  assertTrustedPullRequestBase({
    pullRequest,
    eventPullRequest: event.pull_request,
    ...trustedBase,
    controllerSha,
  });
  if (pullRequest.changed_files > 3000) throw new Error("Pull requests above 3,000 files are indeterminate and fail closed.");

  const policyPath = process.env.INPUT_POLICY_PATH || ".changeplane.json";
  const policy = await readPolicy(repository, pullRequest.base.sha, policyPath, token);
  const files = await listPages(`/repos/${repository}/pulls/${number}/files`, token, pullRequest.changed_files);
  if (files.length !== pullRequest.changed_files) {
    throw new Error(`Expected ${pullRequest.changed_files} changed files but GitHub returned ${files.length}.`);
  }

  const actualFiles = files.map((file) => ({
    path: file.filename,
    ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
  }));
  const advisories = await discoverOpenPullRequestOverlaps(repository, number, actualFiles, token);
  const comments = await listPages(`/repos/${repository}/issues/${number}/comments`, token);
  const contract = resolveRevisionContract({
    body: pullRequest.body,
    title: pullRequest.title,
    actualFiles,
    boundContractDigest: guardLease.previousContractDigest,
    headSha: pullRequest.head.sha,
  });
  const { plan, contractSource, contractDigest, boundContractDigest } = contract;
  const policyDigest = digest(policy);
  const inputDigest = digest({ plan, files: actualFiles });
  const revision = {
    baseSha: pullRequest.base.sha,
    headSha: pullRequest.head.sha,
    policyDigest,
    inputDigest,
    contractDigest,
    evaluatorVersion: EVALUATOR_VERSION,
  };
  const approvalDigest = digest(revision);
  const reviews = await listPages(`/repos/${repository}/pulls/${number}/reviews`, token);
  const approval = await authorizedApproval(repository, reviews, pullRequest, revision, approvalDigest, token);
  const pathResult = evaluateChange({
    plannedPaths: plan.scope,
    actualFiles,
    protectedPaths: effectiveProtectedPaths(policy, actualFiles),
    approval,
    ...revision,
  });
  validateActionEvidencePolicy(policy, mode);
  const evidenceResult = await waitForEvidence(repository, pullRequest.head.sha, policy, token, {
    includeCommitStatuses: mode !== "enforce",
  });
  const preview = await discoverPreview(repository, pullRequest.head.sha, token);
  const contractReasons = boundContractDigest !== contractDigest
    ? [{
      code: "CONTRACT_CHANGED_AFTER_BINDING",
      path: "pull-request contract",
      pathKind: "contract",
      resolved: false,
    }]
    : [];
  const result = mergeEvaluation(pathResult, evidenceResult, contractReasons);

  const maxAttempts = Number.parseInt(process.env.INPUT_MAX_REMEDIATION_ATTEMPTS || "2", 10);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > REMEDIATION_MAX_ATTEMPTS) {
    throw new Error(`max_remediation_attempts must be an integer between 1 and ${REMEDIATION_MAX_ATTEMPTS}.`);
  }

  let remediationComments = [];
  if (agentConfigured && result.decision === DECISION.REVIEW_REQUIRED) {
    remediationComments = parseRemediationComments(comments);
  }
  const matchingRemediationComments = remediationComments.filter((item) => item.inputDigest === inputDigest);
  const remediationContext = {
    repository,
    pullRequestNumber: number,
    headSha: pullRequest.head.sha,
    inputDigest,
  };
  const currentRequest = findCurrentRemediationRequest(matchingRemediationComments, remediationContext);
  const priorAttempts = matchingRemediationComments.reduce((maximum, item) => Math.max(maximum, item.attempt), 0);
  const autonomousPlan = planAutonomousDecision({
    result,
    agentConfigured,
    agentHandoff: mode === "enforce" && agentDispatch === "none",
    attempt: currentRequest ? Math.max(0, currentRequest.attempt - 1) : priorAttempts,
    maxAttempts,
  });
  const agentHandback = buildAgentHandback({
    repository,
    pullRequest,
    plan,
    policyDigest,
    contractDigest,
    inputDigest,
    autonomousPlan,
    maxAttempts,
  });
  if (agentHandback) writeOutput("agent_handback", canonicalJson(agentHandback));

  if (autonomousPlan.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED) {
    const idempotencyKey = currentRequest?.idempotencyKey ?? remediationIdempotencyKey({
      ...remediationContext,
      attempt: autonomousPlan.nextAttempt,
    });
    const remediation = buildRemediationRequest({
      idempotencyKey,
      repository,
      repositoryId: Number(event.repository?.id),
      installationId: Number(process.env.INPUT_CONTROLLER_INSTALLATION_ID),
      pullRequestNumber: number,
      baseRef: pullRequest.base.ref,
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
      headRef: pullRequest.head.ref,
      headRepository: pullRequest.head.repo.full_name,
      controllerSha: pullRequest.base.sha,
      contract: plan,
      contractDigest,
      policyDigest,
      evaluatorVersion: EVALUATOR_VERSION,
      inputDigest,
      plan: autonomousPlan,
    });

    if (shouldDispatchAgentWebhook({
      mode,
      decision: autonomousPlan.decision,
      agentDispatch,
      requestAlreadyPublished: Boolean(currentRequest),
    })) {
      const [currentBeforeDispatch, currentDefaultSha] = await Promise.all([
        api(`/repos/${repository}/pulls/${number}`, token),
        defaultBranchSha(repository, trustedBase.defaultBranch, token),
      ]);
      if (currentBeforeDispatch.head?.sha !== pullRequest.head.sha) throw new Error("Pull request head changed before remediation dispatch.");
      assertTrustedPullRequestBase({
        pullRequest: currentBeforeDispatch,
        defaultBranch: trustedBase.defaultBranch,
        defaultSha: currentDefaultSha,
        controllerSha,
      });
      const authorization = await dispatchAgentWebhook(
        agentWebhookUrl,
        process.env.INPUT_AGENT_WEBHOOK_TOKEN,
        remediation,
      );
      await api(`/repos/${repository}/issues/${number}/comments`, token, {
        method: "POST",
        body: {
          body: renderRemediationComment({
            inputDigest,
            idempotencyKey,
            payload: remediation,
            maxAttempts,
            authorization,
          }),
        },
      });
    }
    writeOutput("remediation", canonicalJson(remediation));
  }

  const receipt = buildReceipt({
    repository,
    repositoryId: Number(event.repository?.id),
    pullRequest,
    plan,
    contractSource,
    policyPath,
    policyDigest,
    inputDigest,
    contractDigest,
    boundContractDigest,
    approvalDigest,
    result,
    evidence: evidenceResult.evidence,
    preview,
    approval,
    autonomousPlan,
    mode,
    actualFiles,
    advisories,
    maxAttempts,
    agentHandback,
  });
  const assurancePassport = buildAssurancePassport(receipt);
  const receiptComment = renderReceiptComment(receipt);
  let receiptWarning = "";
  const publicationFailures = [];
  try {
    await upsertReceiptComment(repository, number, comments, token, receiptComment);
  } catch (error) {
    const message = safeMarkdown(error instanceof Error ? error.message : error);
    receiptWarning = `\n> Receipt comment could not be published: ${message}\n`;
    publicationFailures.push(`receipt comment: ${message}`);
  }

  const [current, currentDefaultSha] = await Promise.all([
    api(`/repos/${repository}/pulls/${number}`, token),
    defaultBranchSha(repository, trustedBase.defaultBranch, token),
  ]);
  if (current.head?.sha !== pullRequest.head.sha) {
    throw new Error(`Pull request head changed from ${pullRequest.head.sha.slice(0, 12)} to ${String(current.head?.sha ?? "unknown").slice(0, 12)} during evaluation.`);
  }
  assertTrustedPullRequestBase({
    pullRequest: current,
    defaultBranch: trustedBase.defaultBranch,
    defaultSha: currentDefaultSha,
    controllerSha,
  });
  let headCheckPublished = false;
  let proofLocator;
  try {
    const publishedCheck = await publishDedicatedGuard({
      repository,
      defaultBranch: trustedBase.defaultBranch,
      passport: assurancePassport,
      summary: receiptComment,
    });
    proofLocator = buildProofLocator(assurancePassport, publishedCheck);
    headCheckPublished = true;
  } catch (error) {
    const message = safeMarkdown(error instanceof Error ? error.message : error);
    receiptWarning += `\n> Exact-head Check could not be published: ${message}\n`;
    publicationFailures.push(`exact-head Check: ${message}`);
  }

  writeSummary(`${renderSummary({ pullRequest, plan, policyPath, policyDigest, result, approval, autonomousPlan, mode, actualFiles, preview })}${receiptWarning}`);
  writeOutput("mode", mode);
  writeOutput("decision", autonomousPlan.decision);
  writeOutput("receipt", canonicalJson(receipt));
  for (const [name, value] of Object.entries(assurancePassportOutputs(assurancePassport, headCheckPublished))) {
    writeOutput(name, value);
  }
  if (headCheckPublished) writeOutput("proof_locator", canonicalJson(proofLocator));
  writeOutput("actual_files", actualFiles.length);
  writeOutput("finding_count", result.reasons.length);
  if (publicationFailures.length > 0) {
    throw new PublicationError(`Exact-head audit publication failed (${publicationFailures.join("; ")}).`);
  }
  console.log(`ChangePlane ${autonomousPlan.decision} (${mode}) for ${repository}#${number}@${pullRequest.head.sha.slice(0, 7)}`);
  if (shouldFailDecision(mode, autonomousPlan.decision)) process.exitCode = 1;
  return { ...result, autonomous: autonomousPlan, mode };
}

export async function reportFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  let mode = "observe";
  try {
    mode = parseMode(process.env.INPUT_MODE);
  } catch {
    mode = "enforce";
  }
  const markdown = `# ChangePlane · INDETERMINATE\n\n**Mode:** ${mode}\n\n${safeMarkdown(message)}${mode === "observe" ? "\n\nObserve mode reported this error without blocking the pull request." : ""}\n`;
  writeSummary(markdown);
  writeOutput("mode", mode);
  writeOutput("decision", "INDETERMINATE");

  // A repository workflow never owns guard publication authority. If the
  // trusted evaluation cannot produce a complete passport, the dedicated App
  // publishes nothing and GitHub's required Check remains unsatisfied.
  const fallbackPublished = false;
  console.error(`::error title=ChangePlane indeterminate::${workflowCommandValue(message)}`);
  if (shouldFailAction(error, mode, fallbackPublished)) process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule && process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_EVENT_PATH) {
  run().catch(reportFailure);
}
