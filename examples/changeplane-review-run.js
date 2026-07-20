import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { normalizeRepoPath } from "../src/lib/changeplane.js";
import { REVIEW_AUTHORITY, boundedReviewInput, validateReviewFindings } from "../src/lib/review.js";
import { requestOpenAIReview } from "./changeplane-review-openai.js";

export const REVIEW_CHECK_NAME = "ChangePlane / review";
export const REVIEW_JOB_STATE = Object.freeze({
  REVIEWED: "reviewed",
  DISABLED: "disabled",
  NOT_CONFIGURED: "not_configured",
  NO_REVIEWABLE_CHANGES: "no_reviewable_changes",
});

const GITHUB_API = "https://api.github.com";
const JOB_VERSION = 1;
const MAX_GITHUB_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_JOB_BYTES = 64 * 1024;
const MAX_REVIEW_FILES = 40;

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${label} is invalid.`);
  }
}

function exactSha(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) throw new Error(`${label} is unavailable.`);
  return value;
}

function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} is unavailable.`);
  return result;
}

function credential(value, label) {
  if (typeof value !== "string" || value.length < 20 || value.length > 512
    || /[\s\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} is unavailable.`);
  }
  return value;
}

function repositoryParts(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error("The GitHub repository identity is unavailable.");
  }
  return value.split("/");
}

export function reviewEventIdentity(event) {
  const repository = event?.repository?.full_name;
  repositoryParts(repository);
  if (event?.pull_request?.base?.repo?.full_name !== repository
    || event?.pull_request?.head?.repo?.full_name !== repository) {
    throw new Error("Independent review supports same-repository pull requests only.");
  }
  return Object.freeze({
    repository,
    pullRequestNumber: positiveInteger(event?.pull_request?.number ?? event?.number, "The pull request number"),
    baseSha: exactSha(event?.pull_request?.base?.sha, "The pull request base revision"),
    headSha: exactSha(event?.pull_request?.head?.sha, "The pull request head revision"),
  });
}

async function boundedJson(response) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_GITHUB_RESPONSE_BYTES) {
    throw new Error("GitHub returned an oversized response.");
  }
  let raw;
  try {
    raw = await response.text();
  } catch {
    throw new Error("GitHub is temporarily unavailable.");
  }
  if (!raw || Buffer.byteLength(raw) > MAX_GITHUB_RESPONSE_BYTES) {
    throw new Error("GitHub returned an empty or oversized response.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GitHub returned an invalid response.");
  }
}

async function githubJson(path, { token, method = "GET", body, optionalNotFound = false, fetchImpl }) {
  const githubToken = credential(token, "The repository-scoped GitHub token");
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API}${path}`, {
      method,
      redirect: "error",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${githubToken}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("GitHub is temporarily unavailable.");
  }
  if (optionalNotFound && response?.status === 404) return null;
  if (!response?.ok) throw new Error(`GitHub rejected the request (${response?.status ?? "unavailable"}).`);
  return boundedJson(response);
}

export function parseAddedLines(patch) {
  if (typeof patch !== "string" || patch.includes("\0") || Buffer.byteLength(patch) > MAX_GITHUB_RESPONSE_BYTES) {
    throw new Error("The GitHub diff is unavailable or oversized.");
  }
  const added = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const row of patch.replaceAll(/\r\n?/gu, "\n").split("\n")) {
    const hunk = row.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (row.startsWith("@@")) throw new Error("The GitHub diff contains an invalid hunk.");
    if (!inHunk || row === "\\ No newline at end of file") continue;
    if (row.startsWith("+")) {
      added.push({ line: newLine, text: row.slice(1) });
      newLine += 1;
    } else if (row.startsWith("-")) {
      oldLine += 1;
    } else if (row.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    } else if (row !== "") {
      throw new Error("The GitHub diff contains an invalid line.");
    }
  }
  return added;
}

function contentsPath(owner, repository, filePath, ref) {
  const encoded = normalizeRepoPath(filePath).split("/").map(encodeURIComponent).join("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encoded}?ref=${encodeURIComponent(ref)}`;
}

async function assuranceMemory({ owner, repository, baseSha, memoryPath, githubToken, fetchImpl }) {
  if (!memoryPath) return undefined;
  const payload = await githubJson(contentsPath(owner, repository, memoryPath, baseSha), {
    token: githubToken,
    optionalNotFound: true,
    fetchImpl,
  });
  if (payload === null) return undefined;
  if (payload?.type !== "file" || payload?.encoding !== "base64" || typeof payload?.content !== "string") {
    throw new Error("The trusted-base assurance memory is unavailable.");
  }
  let text;
  try {
    const encoded = payload.content.replaceAll(/\s/gu, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) throw new Error();
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encoded, "base64"));
  } catch {
    throw new Error("The trusted-base assurance memory is invalid.");
  }
  return text.trim() ? { path: normalizeRepoPath(memoryPath), text } : undefined;
}

export async function reconstructReviewContext({
  repository,
  pullRequestNumber,
  expectedBaseSha,
  expectedHeadSha,
  githubToken,
  memoryPath,
  requireBoundedDiff = true,
  fetchImpl = fetch,
}) {
  const [owner, name] = repositoryParts(repository);
  const pullPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${positiveInteger(pullRequestNumber, "The pull request number")}`;
  const pull = await githubJson(pullPath, { token: githubToken, fetchImpl });
  const headSha = exactSha(pull?.head?.sha, "The current pull request head revision");
  const baseSha = exactSha(pull?.base?.sha, "The current pull request base revision");
  if (headSha !== exactSha(expectedHeadSha, "The expected head revision")
    || baseSha !== exactSha(expectedBaseSha, "The expected base revision")) {
    throw new Error("The review job is stale for the current pull request revision.");
  }

  const changed = await githubJson(`${pullPath}/files?per_page=${MAX_REVIEW_FILES + 1}`, {
    token: githubToken,
    fetchImpl,
  });
  if (!Array.isArray(changed)) throw new Error("GitHub returned an invalid review diff.");
  if (changed.length > MAX_REVIEW_FILES && requireBoundedDiff) {
    throw new Error(`The review diff exceeds the ${MAX_REVIEW_FILES}-file boundary.`);
  }
  if (changed.length > MAX_REVIEW_FILES) return { headSha, baseSha, files: [] };
  const files = changed.flatMap((file) => {
    if (!file || typeof file.filename !== "string") throw new Error("GitHub returned an invalid review diff.");
    if (file.patch == null) return [];
    const lines = parseAddedLines(file.patch);
    return lines.length > 0 ? [{ path: normalizeRepoPath(file.filename), lines }] : [];
  });
  const memory = await assuranceMemory({
    owner,
    repository: name,
    baseSha,
    memoryPath,
    githubToken,
    fetchImpl,
  });
  if (files.length === 0) return { headSha, baseSha, files, ...(memory ? { memory } : {}) };
  const bounded = boundedReviewInput({ headSha, files, ...(memory ? { memory } : {}) });
  return { baseSha, ...bounded };
}

function reviewJob({ identity, state, review = null }) {
  return Object.freeze({
    version: JOB_VERSION,
    state,
    pullRequestNumber: identity.pullRequestNumber,
    baseSha: identity.baseSha,
    headSha: identity.headSha,
    review,
  });
}

export function readTrustedReviewPolicy(policyPath) {
  if (!policyPath) return Object.freeze({ mode: "disabled", memoryPath: null, maxFindings: 5 });
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    throw new Error("The trusted runtime policy is missing or invalid.");
  }
  if (policy?.review == null) return Object.freeze({ mode: "disabled", memoryPath: null, maxFindings: 5 });
  exactKeys(policy.review, ["mode", "memoryPath", "maxFindings"], "The trusted review policy");
  if (policy.review.mode === "disabled") {
    return Object.freeze({ mode: "disabled", memoryPath: null, maxFindings: 5 });
  }
  if (policy.review.mode !== "advisory") throw new Error("The trusted review mode must be advisory or disabled.");
  const maxFindings = policy.review.maxFindings ?? 5;
  if (!Number.isInteger(maxFindings) || maxFindings < 1 || maxFindings > 5) {
    throw new Error("The trusted review policy must allow 1–5 findings.");
  }
  const memoryPath = policy.review.memoryPath == null ? null : normalizeRepoPath(policy.review.memoryPath);
  return Object.freeze({ mode: "advisory", memoryPath, maxFindings });
}

export async function proposeReviewJob({
  event,
  githubToken,
  openaiApiKey,
  policyPath,
  fetchImpl = fetch,
}) {
  const identity = reviewEventIdentity(event);
  const policy = readTrustedReviewPolicy(policyPath);
  if (policy.mode !== "advisory") return reviewJob({ identity, state: REVIEW_JOB_STATE.DISABLED });
  if (!openaiApiKey) return reviewJob({ identity, state: REVIEW_JOB_STATE.NOT_CONFIGURED });
  const context = await reconstructReviewContext({
    repository: identity.repository,
    pullRequestNumber: identity.pullRequestNumber,
    expectedBaseSha: identity.baseSha,
    expectedHeadSha: identity.headSha,
    githubToken,
    memoryPath: policy.memoryPath,
    fetchImpl,
  });
  if (context.files.length === 0) {
    return reviewJob({ identity, state: REVIEW_JOB_STATE.NO_REVIEWABLE_CHANGES });
  }
  const review = await requestOpenAIReview({
    apiKey: openaiApiKey,
    policyPath,
    maxFindings: policy.maxFindings,
    input: boundedReviewInput({ headSha: context.headSha, files: context.files, ...(context.memory ? { memory: context.memory } : {}) }),
    fetchImpl,
  });
  return reviewJob({ identity, state: REVIEW_JOB_STATE.REVIEWED, review });
}

function validateReviewJob(job) {
  exactKeys(job, ["version", "state", "pullRequestNumber", "baseSha", "headSha", "review"], "The review job");
  if (job.version !== JOB_VERSION || !Object.values(REVIEW_JOB_STATE).includes(job.state)) {
    throw new Error("The review job is invalid.");
  }
  positiveInteger(job.pullRequestNumber, "The review pull request number");
  exactSha(job.baseSha, "The review base revision");
  exactSha(job.headSha, "The review head revision");
  if (job.state === REVIEW_JOB_STATE.REVIEWED) {
    exactKeys(job.review, ["authority", "headSha", "findings"], "The advisory review");
    if (job.review.authority !== REVIEW_AUTHORITY || job.review.headSha !== job.headSha || !Array.isArray(job.review.findings)) {
      throw new Error("The advisory review is invalid.");
    }
  } else if (job.review !== null) {
    throw new Error("The review job is invalid.");
  }
  return job;
}

export function encodeReviewJob(job) {
  const raw = JSON.stringify(validateReviewJob(job));
  if (Buffer.byteLength(raw) > MAX_JOB_BYTES) throw new Error("The review job is oversized.");
  return Buffer.from(raw).toString("base64url");
}

export function decodeReviewJob(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length > Math.ceil(MAX_JOB_BYTES * 4 / 3)) {
    throw new Error("The encoded review job is invalid or oversized.");
  }
  let job;
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length > MAX_JOB_BYTES) throw new Error();
    if (raw.toString("base64url") !== value) throw new Error();
    job = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error("The encoded review job is invalid or oversized.");
  }
  return validateReviewJob(job);
}

function annotationLevel(severity) {
  return severity === "critical" || severity === "high" ? "warning" : "notice";
}

export function buildNeutralReviewCheck(job, review) {
  const findings = review?.findings ?? [];
  let title;
  let summary;
  if (job.state === REVIEW_JOB_STATE.NOT_CONFIGURED) {
    title = "Advisory review not configured";
    summary = "OPENAI_API_KEY is not configured, so independent review did not run. This neutral Check does not approve the change or publish PASS.";
  } else if (job.state === REVIEW_JOB_STATE.DISABLED) {
    title = "Advisory review disabled";
    summary = "The trusted repository policy does not enable advisory review. No model call was made. This neutral Check does not approve the change or publish PASS.";
  } else if (job.state === REVIEW_JOB_STATE.NO_REVIEWABLE_CHANGES) {
    title = "No added lines to review";
    summary = "No bounded added-line context was available. This neutral Check is advisory and does not approve the change or publish PASS.";
  } else if (findings.length === 0) {
    title = "No advisory findings returned";
    summary = "The bounded review returned no findings. This is not a PASS; deterministic evidence and ChangePlane / guard remain authoritative.";
  } else {
    title = `${findings.length} advisory finding${findings.length === 1 ? "" : "s"}`;
    summary = "GPT-5.6 identified bounded advisory findings on this exact head. These findings cannot approve, merge, repair, or publish PASS.";
  }
  return {
    name: REVIEW_CHECK_NAME,
    head_sha: job.headSha,
    status: "completed",
    conclusion: "neutral",
    output: {
      title,
      summary,
      annotations: findings.map((finding) => ({
        path: finding.path,
        start_line: finding.line,
        end_line: finding.line,
        annotation_level: annotationLevel(finding.severity),
        title: finding.title,
        message: `${finding.evidence}\n\nSuggested next step: ${finding.suggestion}`,
      })),
    },
  };
}

export async function publishReviewJob({ event, encodedJob, githubToken, fetchImpl = fetch }) {
  const identity = reviewEventIdentity(event);
  const job = decodeReviewJob(encodedJob);
  if (job.pullRequestNumber !== identity.pullRequestNumber || job.baseSha !== identity.baseSha || job.headSha !== identity.headSha) {
    throw new Error("The review job does not match the triggering pull request revision.");
  }
  const context = await reconstructReviewContext({
    repository: identity.repository,
    pullRequestNumber: identity.pullRequestNumber,
    expectedBaseSha: job.baseSha,
    expectedHeadSha: job.headSha,
    githubToken,
    requireBoundedDiff: job.state === REVIEW_JOB_STATE.REVIEWED,
    fetchImpl,
  });
  const review = job.state === REVIEW_JOB_STATE.REVIEWED
    ? validateReviewFindings({ headSha: job.review.headSha, findings: job.review.findings }, {
      headSha: context.headSha,
      files: context.files,
    })
    : null;
  const check = buildNeutralReviewCheck(job, review);
  const [owner, repository] = repositoryParts(identity.repository);
  const published = await githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/check-runs`, {
    token: githubToken,
    method: "POST",
    body: check,
    fetchImpl,
  });
  return Object.freeze({
    checkId: positiveInteger(published?.id, "The published review Check ID"),
    conclusion: "neutral",
    headSha: job.headSha,
    state: job.state,
  });
}

export async function runCli({ env = process.env, argv = process.argv, fetchImpl = fetch } = {}) {
  const mode = String(argv[2] ?? "").toLowerCase();
  if (!env.GITHUB_EVENT_PATH || !env.GITHUB_OUTPUT) throw new Error("GitHub job paths are unavailable.");
  let event;
  try {
    event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    throw new Error("The GitHub pull request event is unavailable.");
  }
  if (mode === "propose") {
    const job = await proposeReviewJob({
      event,
      githubToken: env.GITHUB_TOKEN,
      openaiApiKey: env.OPENAI_API_KEY,
      policyPath: env.CHANGEPLANE_TRUSTED_POLICY,
      fetchImpl,
    });
    appendFileSync(env.GITHUB_OUTPUT, `review_job=${encodeReviewJob(job)}\n`);
    return job;
  }
  if (mode === "publish") {
    if (env.OPENAI_API_KEY) throw new Error("The review publisher must not receive an OpenAI credential.");
    const result = await publishReviewJob({
      event,
      encodedJob: env.CHANGEPLANE_REVIEW_JOB,
      githubToken: env.GITHUB_TOKEN,
      fetchImpl,
    });
    appendFileSync(env.GITHUB_OUTPUT, `review_check_id=${result.checkId}\nreview_state=${result.state}\n`);
    return result;
  }
  throw new Error("Expected propose or publish review operation.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : "Independent review failed.");
    process.exitCode = 1;
  });
}
