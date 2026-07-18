import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import {
  AUTONOMOUS_DECISION,
  DECISION,
  buildRemediationRequest,
  detectFileOverlap,
  evaluateChange,
  evaluateEvidence,
  planAutonomousDecision,
} from "../src/lib/changeplane.js";

const API_VERSION = "2022-11-28";
export const EVALUATOR_VERSION = "0.3.0";
const CHECK_NAME = "ChangePlane / guard";
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const TRANSIENT_GITHUB_STATUSES = new Set([502, 503, 504]);

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

export function parseAgentDispatch(value, webhookUrl = "") {
  const adapter = String(value ?? "").trim().toLowerCase() || (webhookUrl ? "webhook" : "none");
  if (!["none", "webhook", "repository"].includes(adapter)) {
    throw new Error("agent_dispatch must be none, webhook, or repository.");
  }
  if (adapter === "webhook") validateAgentWebhookUrl(webhookUrl);
  return adapter;
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

async function evidenceSnapshot(repository, headSha, policy, token) {
  const [checkRuns, combinedStatus] = await Promise.all([
    api(`/repos/${repository}/commits/${encodeURIComponent(headSha)}/check-runs?filter=latest&per_page=100`, token),
    api(`/repos/${repository}/commits/${encodeURIComponent(headSha)}/status?per_page=100`, token),
  ]);
  const requiredChecks = policy.evidence?.requiredChecks ?? [];
  const required = requiredChecks.map((item) => (
    typeof item === "string" ? { name: item, appSlug: null } : item
  ));
  const checks = Array.isArray(checkRuns?.check_runs) ? await Promise.all(checkRuns.check_runs.map(async (check) => {
    const source = check.app?.slug ?? null;
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
      source: status.creator?.login ?? null,
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

async function waitForEvidence(repository, headSha, policy, token) {
  const requiredChecks = policy.evidence?.requiredChecks ?? [];
  if (requiredChecks.length === 0) return evaluateEvidence();
  const deadline = Date.now() + (policy.evidence?.timeoutSeconds ?? 0) * 1000;
  for (;;) {
    const result = evaluateEvidence({
      requiredChecks,
      checks: await evidenceSnapshot(repository, headSha, policy, token),
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
    external_id: `${receipt.repository}#${receipt.pullRequestNumber}:${receipt.headSha}:${receipt.inputDigest}`.slice(0, 255),
    output: {
      title: `${receiptOutcome(receipt).replace(/\.$/u, "")} · ${receipt.mode}`.slice(0, 255),
      summary: markdown.slice(0, 65_535),
    },
  };
}

async function publishHeadCheck(repository, token, receipt, markdown) {
  const payload = headCheckPayload(receipt, markdown);
  const existing = await api(
    `/repos/${repository}/commits/${encodeURIComponent(receipt.headSha)}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&filter=latest&per_page=100`,
    token,
  );
  const run = Array.isArray(existing?.check_runs)
    ? existing.check_runs.find((candidate) => candidate.external_id === payload.external_id)
    : undefined;
  if (run?.id) {
    const { head_sha: _headSha, ...updatePayload } = payload;
    await api(`/repos/${repository}/check-runs/${run.id}`, token, { method: "PATCH", body: updatePayload });
  } else {
    await api(`/repos/${repository}/check-runs`, token, { method: "POST", body: payload });
  }
}

async function readPolicy(repository, baseSha, path, token) {
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
  const invalidRequiredCheck = (requirement) => {
    const name = typeof requirement === "string" ? requirement : requirement?.name;
    const appSlug = typeof requirement === "object" && !Array.isArray(requirement) ? requirement?.appSlug : null;
    return typeof name !== "string"
      || !name.trim()
      || name.length > 100
      || name.trim() === CHECK_NAME
      || (typeof requirement === "object" && (
        Array.isArray(requirement)
        || typeof appSlug !== "string"
        || !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(appSlug)
        || Object.keys(requirement).some((key) => key !== "name" && key !== "appSlug")
      ));
  };
  if (!Array.isArray(requiredChecks) || requiredChecks.length > 20 || requiredChecks.some(invalidRequiredCheck)) {
    throw new Error(`Policy ${path} evidence.requiredChecks must contain at most 20 check names or { name, appSlug } entries and cannot include ${CHECK_NAME}.`);
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
const CONTRACT_STATE = /<!-- changeplane-contract:v1 source=(declared|first-head) plan=([A-Za-z0-9_-]+) -->/u;

function encodedContract(plan) {
  return Buffer.from(canonicalJson(plan)).toString("base64url");
}

function decodedContract(value) {
  try {
    return validatePlan(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new Error("The trusted ChangePlane contract marker is invalid.");
  }
}

export function parseBoundReceipt(comments, trustedLogin = "github-actions[bot]") {
  if (!Array.isArray(comments)) throw new TypeError("comments must be an array");
  for (const comment of comments) {
    if (comment?.user?.login !== trustedLogin) continue;
    const body = String(comment?.body ?? "");
    const match = body.match(RECEIPT_STATE);
    if (match) {
      const contract = body.match(CONTRACT_STATE);
      return {
        contractDigest: match[1],
        inputDigest: match[2],
        headSha: match[3],
        ...(contract ? { contractSource: contract[1], plan: decodedContract(contract[2]) } : {}),
      };
    }
  }
  return undefined;
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

function renderRemediationComment({ inputDigest, idempotencyKey, payload, maxAttempts }) {
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
    "",
    ...paths,
    "",
    "The required check remains closed. A new commit will be evaluated automatically; no human action is needed unless the remediation budget is exhausted.",
  ].join("\n");
}

async function dispatchAgentWebhook(url, token, payload) {
  const parsed = validateAgentWebhookUrl(url);

  const response = await fetch(parsed, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "changeplane-guard/0.1",
      "idempotency-key": payload.idempotencyKey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Agent webhook rejected the request (${response.status}).`);
  }
}

async function dispatchRepositoryRepair(repository, token, payload) {
  await api(`/repos/${repository}/dispatches`, token, {
    method: "POST",
    body: {
      event_type: "changeplane_repair",
      client_payload: payload,
    },
  });
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
  return {
    owner: "Platform owner",
    action: "Connect the agent adapter or route this exception to the repository owner.",
  };
}

export function buildReceipt({
  repository,
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
}) {
  return {
    schemaVersion: 1,
    repository,
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
    preview,
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
    return `<${preview.url}> · ${safeMarkdown(preview.environment)} · exact head`;
  }
  if (preview?.status === "UNAVAILABLE") return "GitHub deployment metadata unavailable (advisory)";
  return "Not published for this revision (advisory)";
}

function renderPreviewProvenance(preview) {
  if (preview?.status !== "READY") return null;
  return [
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
  if (receipt.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED) return "A fixable issue is ready for bounded repair.";
  if (receipt.decision === AUTONOMOUS_DECISION.REVIEW_REQUIRED) return "A human decision is required.";
  if (receipt.decision === AUTONOMOUS_DECISION.BLOCKED) return "Repository policy blocks this revision.";
  return `ChangePlane returned ${safeMarkdown(receipt.decision)}.`;
}

export function renderReceiptComment(receipt) {
  const next = nextAction(receipt);
  const outcome = receiptOutcome(receipt);
  const boundPlan = {
    scope: receipt.plannedScope,
    ...(receipt.goal ? { goal: receipt.goal } : {}),
  };
  const lines = [
    `${RECEIPT_MARKER} contract=${receipt.boundContractDigest} input=${receipt.inputDigest} head=${receipt.headSha} -->`,
    `<!-- changeplane-contract:v1 source=${receipt.contractSource} plan=${encodedContract(boundPlan)} -->`,
    `## ChangePlane · ${outcome.replace(/\.$/u, "")}`,
    "",
    `**What happened:** ${outcome}`,
    `**Merge impact:** ${receipt.mode === "observe"
      ? "ChangePlane is observing and does not block this pull request."
      : receipt.decision === AUTONOMOUS_DECISION.PASS
        ? "ChangePlane allows this revision; GitHub's remaining rules still decide merge."
        : "ChangePlane keeps its required Check closed."}`,
    `**Who acts:** ${next.owner}.`,
    `**Next action:** ${next.action}`,
    `**Current revision:** \`${receipt.headSha.slice(0, 12)}\``,
    "",
    receipt.mode === "observe"
      ? "> **Observe only.** No repair is dispatched and this receipt cannot block merge."
      : "> **Enforced.** This decision is bound to the exact revision below.",
    ...(receipt.evidence.length === 0
      ? ["", "> **Behavioral evidence:** No automated test was required for this receipt. This is not evidence that the code works."]
      : []),
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
    "If this decision is wrong, reply `ChangePlane false positive: <reason>`. The pilot owner will review every report before enforce is enabled.",
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

export async function run() {
  const mode = parseMode(process.env.INPUT_MODE);
  if (mode !== "observe") {
    throw new Error("Enforce mode is not available in the observe pilot.");
  }
  const token = process.env.INPUT_TOKEN;
  if (!token) throw new Error("The token input is required.");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY is required.");
  const resolution = await resolvePullRequestNumber(event, repository, token);
  if (!resolution.number) return skipRun(mode, resolution.headSha, resolution.reason);
  const number = resolution.number;

  const pullRequest = await api(`/repos/${repository}/pulls/${number}`, token);
  if (!pullRequest.head?.sha || !pullRequest.base?.sha) throw new Error("GitHub returned incomplete pull-request SHAs.");
  if (resolution.headSha && pullRequest.head.sha !== resolution.headSha) {
    return skipRun(mode, resolution.headSha, "STALE_DEPLOYMENT");
  }
  if (pullRequest.head.repo?.full_name !== repository || pullRequest.base.repo?.full_name !== repository) {
    throw new Error("ChangePlane pilot supports same-repository pull requests only.");
  }
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
  const boundReceipt = parseBoundReceipt(comments);
  const declaredPlan = parsePlan(pullRequest.body, { optional: true });
  const plan = declaredPlan ?? boundReceipt?.plan ?? inferPlan(actualFiles, pullRequest.title);
  const contractSource = declaredPlan
    ? "declared"
    : boundReceipt?.contractSource ?? "first-head";
  const policyDigest = digest(policy);
  const contractDigest = digest(plan);
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
    protectedPaths: policy.protectedPaths,
    approval,
    ...revision,
  });
  if (mode === "enforce" && (policy.evidence?.requiredChecks ?? []).some((requirement) => typeof requirement === "string")) {
    throw new Error("Enforce mode requires every evidence.requiredChecks entry to declare its expected GitHub App with { name, appSlug }.");
  }
  const evidenceResult = await waitForEvidence(repository, pullRequest.head.sha, policy, token);
  const preview = await discoverPreview(repository, pullRequest.head.sha, token);
  const boundContractDigest = boundReceipt?.contractDigest ?? contractDigest;
  const contractReasons = boundContractDigest !== contractDigest
    ? [{
      code: "CONTRACT_CHANGED_AFTER_BINDING",
      path: "pull-request contract",
      pathKind: "contract",
      resolved: false,
    }]
    : [];
  const result = mergeEvaluation(pathResult, evidenceResult, contractReasons);

  const agentWebhookUrl = String(process.env.INPUT_AGENT_WEBHOOK_URL ?? "").trim();
  const agentDispatch = parseAgentDispatch(process.env.INPUT_AGENT_DISPATCH, agentWebhookUrl);
  const agentConfigured = agentDispatch !== "none";
  if (mode === "enforce" && agentDispatch === "webhook" && !String(process.env.INPUT_AGENT_WEBHOOK_TOKEN ?? "").trim()) {
    throw new Error("agent_webhook_token is required when agent_webhook_url is configured.");
  }
  const maxAttempts = Number.parseInt(process.env.INPUT_MAX_REMEDIATION_ATTEMPTS || "2", 10);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("max_remediation_attempts must be an integer between 1 and 5.");
  }

  let remediationComments = [];
  if (agentConfigured && result.decision === DECISION.REVIEW_REQUIRED) {
    remediationComments = parseRemediationComments(comments);
  }
  const currentRequest = remediationComments.find((item) => item.inputDigest === inputDigest);
  const priorAttempts = remediationComments.reduce((maximum, item) => Math.max(maximum, item.attempt), 0);
  const autonomousPlan = planAutonomousDecision({
    result,
    agentConfigured,
    attempt: currentRequest ? Math.max(0, currentRequest.attempt - 1) : priorAttempts,
    maxAttempts,
  });

  if (autonomousPlan.decision === AUTONOMOUS_DECISION.REMEDIATION_REQUIRED) {
    const idempotencyKey = currentRequest?.idempotencyKey ?? digest({
      repository,
      pullRequestNumber: number,
      headSha: pullRequest.head.sha,
      inputDigest,
      attempt: autonomousPlan.nextAttempt,
    });
    const remediation = buildRemediationRequest({
      idempotencyKey,
      repository,
      pullRequestNumber: number,
      baseSha: pullRequest.base.sha,
      headSha: pullRequest.head.sha,
      headRef: pullRequest.head.ref,
      headRepository: pullRequest.head.repo.full_name,
      plannedPaths: plan.scope,
      plan: autonomousPlan,
    });

    if (mode === "enforce" && !currentRequest) {
      const currentBeforeDispatch = await api(`/repos/${repository}/pulls/${number}`, token);
      if (currentBeforeDispatch.head?.sha !== pullRequest.head.sha) {
        throw new Error("Pull request head changed before remediation dispatch.");
      }
      if (agentDispatch === "repository") {
        await dispatchRepositoryRepair(repository, token, remediation);
      } else {
        await dispatchAgentWebhook(agentWebhookUrl, process.env.INPUT_AGENT_WEBHOOK_TOKEN, remediation);
      }
      await api(`/repos/${repository}/issues/${number}/comments`, token, {
        method: "POST",
        body: { body: renderRemediationComment({ inputDigest, idempotencyKey, payload: remediation, maxAttempts }) },
      });
    }
    writeOutput("remediation", canonicalJson(remediation));
  }

  const receipt = buildReceipt({
    repository,
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
  });
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

  const current = await api(`/repos/${repository}/pulls/${number}`, token);
  if (current.head?.sha !== pullRequest.head.sha) {
    throw new Error(`Pull request head changed from ${pullRequest.head.sha.slice(0, 12)} to ${String(current.head?.sha ?? "unknown").slice(0, 12)} during evaluation.`);
  }
  try {
    await publishHeadCheck(repository, token, receipt, receiptComment);
  } catch (error) {
    const message = safeMarkdown(error instanceof Error ? error.message : error);
    receiptWarning += `\n> Exact-head Check could not be published: ${message}\n`;
    publicationFailures.push(`exact-head Check: ${message}`);
  }

  writeSummary(`${renderSummary({ pullRequest, plan, policyPath, policyDigest, result, approval, autonomousPlan, mode, actualFiles, preview })}${receiptWarning}`);
  writeOutput("mode", mode);
  writeOutput("decision", autonomousPlan.decision);
  writeOutput("receipt", canonicalJson(receipt));
  writeOutput("actual_files", actualFiles.length);
  writeOutput("finding_count", result.reasons.length);
  if (publicationFailures.length > 0) {
    throw new PublicationError(`Exact-head audit publication failed (${publicationFailures.join("; ")}).`);
  }
  console.log(`ChangePlane ${autonomousPlan.decision} (${mode}) for ${repository}#${number}@${pullRequest.head.sha.slice(0, 7)}`);
  if (mode === "enforce" && autonomousPlan.decision !== AUTONOMOUS_DECISION.PASS) process.exitCode = 1;
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

  let fallbackPublished = false;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const repository = process.env.GITHUB_REPOSITORY;
    const token = process.env.INPUT_TOKEN;
    if (!repository || !token) throw new Error("The fallback Check target is unavailable.");
    const target = await resolvePullRequestNumber(event, repository, token);
    if (!target.number || !/^[a-f0-9]{40}$/u.test(target.headSha ?? "")) {
      throw new Error("The fallback Check could not be bound to one exact pull-request revision.");
    }
    const receipt = {
      repository,
      pullRequestNumber: target.number,
      mode,
      decision: "INDETERMINATE",
      headSha: target.headSha,
      inputDigest: digest({ headSha: target.headSha, message }),
    };
    await publishHeadCheck(repository, token, receipt, markdown);
    fallbackPublished = true;
  } catch (publishError) {
    console.error(`::warning title=ChangePlane Check publication failed::${workflowCommandValue(publishError instanceof Error ? publishError.message : publishError)}`);
  }

  console.error(`::error title=ChangePlane indeterminate::${workflowCommandValue(message)}`);
  if (shouldFailAction(error, mode, fallbackPublished)) process.exitCode = 1;
}

if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_EVENT_PATH) {
  run().catch(reportFailure);
}
