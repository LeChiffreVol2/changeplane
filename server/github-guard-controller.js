import {
  constants,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

import {
  parseAssurancePassportIntegrity,
  verifyAssurancePassportAgainstCheck,
  verifyAssurancePassportIntegrity,
} from "../action/index.js";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const GUARD_REQUEST_TYPE = "changeplane.guard-publication-request";
const GUARD_BEGIN_TYPE = "changeplane.guard-publication-begin";
const GUARD_RECONCILIATION_TYPE = "changeplane.guard-reconciliation-sweep";
const GUARD_CHECK_NAME = "ChangePlane / guard";
const MAX_JWT_BYTES = 20_000;
const MAX_JWT_HEADER_BYTES = 2_048;
const MAX_JWT_PAYLOAD_BYTES = 16_384;
const MAX_JWKS_KEYS = 20;
const MAX_GUARD_REQUEST_BYTES = 96 * 1_024;
const MAX_GUARD_SUMMARY_BYTES = 65_535;
const MAX_GUARD_RUN_MARKER_BYTES = 256;
const MAX_TOKEN_LIFETIME_SECONDS = 10 * 60;
const MAX_REPOSITORY_PROPERTY_CLAIMS = 100;
const CLOCK_SKEW_SECONDS = 60;
const EXACT_SHA = /^[a-f0-9]{40}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,15}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9_.-]{1,200}\.ya?ml$/u;
const REF = /^refs\/(?:heads|tags|pull)\/[A-Za-z0-9._/-]{1,240}$/u;
const REPOSITORY_PROPERTY_CLAIM = /^repo_property_[A-Za-z0-9][A-Za-z0-9_. -]{0,74}$/u;
const GUARD_RUN_MARKER = /^changeplane\.guard-run\/v1;run_id=([1-9][0-9]{0,15});run_attempt=([1-9][0-9]{0,15});phase=(begin|complete)(?:;contract_digest=([a-f0-9]{64}))?(?:;pull_request_number=([1-9][0-9]{0,15}))?$/u;
const JWT_HEADER_KEYS = new Set(["alg", "kid", "typ", "x5t"]);
const JWT_REQUIRED_CLAIMS = [
  "aud",
  "event_name",
  "exp",
  "iat",
  "iss",
  "nbf",
  "ref",
  "repository",
  "repository_id",
  "run_attempt",
  "run_id",
  "jti",
  "sha",
  "workflow_ref",
  "workflow_sha",
];
// GitHub can include these documented claims in addition to the authority-bearing
// subset above. Unknown fields fail closed so a platform change is reviewed before
// it can widen the publisher trust boundary.
const JWT_CLAIM_KEYS = new Set([
  ...JWT_REQUIRED_CLAIMS,
  "actor",
  "actor_id",
  "base_ref",
  "check_run_id",
  "enterprise",
  "enterprise_id",
  "enterprise_owner_id",
  "environment",
  "environment_node_id",
  "head_ref",
  "issuer_scope",
  "job_workflow_ref",
  "job_workflow_sha",
  "jti",
  "ref_protected",
  "ref_type",
  "repository_owner",
  "repository_owner_id",
  "repository_visibility",
  "run_number",
  "runner_environment",
  "sub",
  "workflow",
  "workflow_repository",
  "workflow_repository_id",
]);
const NORMALIZED_CLAIM_KEYS = [
  "audience",
  "eventName",
  "baseRef",
  "headRef",
  "issuer",
  "jti",
  "ref",
  "repository",
  "repositoryId",
  "runAttempt",
  "runId",
  "sha",
  "workflowRef",
  "workflowSha",
].sort();
const GUARD_REQUEST_KEYS = [
  "defaultBranch",
  "gitRef",
  "passport",
  "repository",
  "schemaVersion",
  "summary",
  "type",
  "workflowRunAttempt",
  "workflowRunId",
].sort();
const GUARD_BEGIN_REQUEST_KEYS = [
  "controllerSha",
  "defaultBranch",
  "gitRef",
  "repository",
  "repositoryId",
  "schemaVersion",
  "target",
  "type",
  "workflowRunAttempt",
  "workflowRunId",
].sort();
const GUARD_RECONCILIATION_REQUEST_KEYS = [
  "controllerSha",
  "defaultBranch",
  "gitRef",
  "repository",
  "repositoryId",
  "schemaVersion",
  "type",
  "workflowRunAttempt",
  "workflowRunId",
].sort();
const GUARD_BEGIN_TARGET_KEYS = [
  "baseRef",
  "baseSha",
  "headRef",
  "headSha",
  "pullRequestNumber",
  "type",
].sort();
const CURRENT_TARGET_KEYS = [
  "baseRef",
  "baseRepositoryId",
  "baseSha",
  "current",
  "headRef",
  "headRepositoryId",
  "headSha",
  "pullRequestNumber",
  "repository",
  "repositoryId",
  "type",
].sort();
const verifiedClaimObjects = new WeakSet();

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(plainObject(value, label)).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains an unknown or missing field.`);
  }
}

function allowedKeys(value, allowed, label) {
  for (const key of Object.keys(plainObject(value, label))) {
    if (!allowed.has(key)) throw new Error(`${label} contains an unknown field.`);
  }
}

function allowedJwtClaimKeys(value) {
  let repositoryPropertyClaims = 0;
  for (const key of Object.keys(plainObject(value, "GitHub OIDC claims"))) {
    if (JWT_CLAIM_KEYS.has(key)) continue;
    if (REPOSITORY_PROPERTY_CLAIM.test(key)) {
      repositoryPropertyClaims += 1;
      if (repositoryPropertyClaims <= MAX_REPOSITORY_PROPERTY_CLAIMS) continue;
    }
    throw new Error("GitHub OIDC claims contains an unknown field.");
  }
}

function positiveInteger(value, label) {
  const candidate = typeof value === "number" ? String(value) : value;
  if (typeof candidate !== "string" || !POSITIVE_DECIMAL.test(candidate)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  const result = Number(candidate);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} is outside the supported range.`);
  return result;
}

function validRepository(value, label = "Repository") {
  if (typeof value !== "string" || !REPOSITORY.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function validSha(value, label) {
  if (typeof value !== "string" || !EXACT_SHA.test(value)) throw new Error(`${label} must be an exact full SHA.`);
  return value;
}

function validRef(value, label) {
  if (typeof value !== "string" || !REF.test(value) || value.includes("..") || value.includes("//") || value.endsWith(".lock")) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validTargetRef(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240
    || !/^(?:refs\/heads\/)?[A-Za-z0-9._/-]+$/u.test(value)
    || value.startsWith("/") || value.endsWith("/") || value.includes("..")
    || value.includes("//") || value.endsWith(".lock")) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function branchName(value) {
  return value.startsWith("refs/heads/") ? value.slice("refs/heads/".length) : value;
}

function optionalBranchClaim(payload, key) {
  if (!Object.hasOwn(payload, key) || payload[key] === "") return null;
  const value = payload[key];
  if (typeof value !== "string" || value.length > 240 || !/^[A-Za-z0-9._/-]+$/u.test(value)
    || value.startsWith("/") || value.endsWith("/") || value.includes("..")
    || value.includes("//") || value.endsWith(".lock")) {
    throw new Error(`GitHub OIDC ${key} claim is invalid.`);
  }
  return value;
}

function validJti(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/u.test(value)) {
    throw new Error("GitHub OIDC jti claim is invalid.");
  }
  return value;
}

function safeJsonSize(value, maximum, label) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (typeof encoded !== "string" || Buffer.byteLength(encoded) > maximum) {
    throw new Error(`${label} exceeds its size limit.`);
  }
}

function parseJwtJson(segment, maximumBytes, label) {
  if (typeof segment !== "string" || !/^[A-Za-z0-9_-]+$/u.test(segment)) {
    throw new Error(`GitHub OIDC ${label} is not canonical base64url.`);
  }
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.length === 0 || decoded.length > maximumBytes || decoded.toString("base64url") !== segment) {
    throw new Error(`GitHub OIDC ${label} is invalid.`);
  }
  let value;
  try {
    value = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error(`GitHub OIDC ${label} is not valid JSON.`);
  }
  return plainObject(value, `GitHub OIDC ${label}`);
}

function validateExpectedAudience(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Expected GitHub OIDC audience is invalid.");
  }
  if (typeof value !== "string" || value.length > 500 || parsed.protocol !== "https:" || parsed.username
    || parsed.password || parsed.hash || parsed.href !== value) {
    throw new Error("Expected GitHub OIDC audience is invalid.");
  }
  return value;
}

function validateWorkflowPath(value) {
  if (typeof value !== "string" || !WORKFLOW_PATH.test(value) || value.includes("..") || value.includes("//")) {
    throw new Error("Expected GitHub workflow path is invalid.");
  }
  return value;
}

function validateDefaultBranch(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 200
    || !/^[A-Za-z0-9._/-]+$/u.test(value) || value.startsWith("/") || value.endsWith("/")
    || value.includes("..") || value.includes("//") || value.endsWith(".lock")) {
    throw new Error("Expected default branch is invalid.");
  }
  return value;
}

function validateAllowedEvents(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error("GitHub OIDC event allowlist is invalid.");
  }
  const events = new Set();
  for (const eventName of value) {
    if (typeof eventName !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(eventName) || events.has(eventName)) {
      throw new Error("GitHub OIDC event allowlist is invalid.");
    }
    events.add(eventName);
  }
  return events;
}

function validateJwtTimes(payload, now) {
  if (!Number.isFinite(now)) throw new TypeError("now must be finite.");
  for (const claim of ["exp", "nbf", "iat"]) {
    if (!Number.isSafeInteger(payload[claim]) || payload[claim] <= 0) {
      throw new Error(`GitHub OIDC ${claim} claim is invalid.`);
    }
  }
  const nowSeconds = Math.floor(now / 1_000);
  if (payload.exp <= nowSeconds) throw new Error("GitHub OIDC token is expired.");
  if (payload.iat > nowSeconds + CLOCK_SKEW_SECONDS || payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new Error("GitHub OIDC token is not active yet.");
  }
  if (payload.exp <= payload.iat || payload.exp < payload.nbf
    || payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new Error("GitHub OIDC token lifetime is invalid.");
  }
}

function validateOptionalClaims(payload) {
  for (const [key, value] of Object.entries(payload)) {
    if (JWT_REQUIRED_CLAIMS.includes(key)) continue;
    if (typeof value === "string") {
      if (value.length > 1_000 || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new Error(`GitHub OIDC ${key} claim is invalid.`);
      }
      continue;
    }
    if (typeof value === "boolean") continue;
    if (Number.isSafeInteger(value)) continue;
    throw new Error(`GitHub OIDC ${key} claim is invalid.`);
  }
}

function validateInstallationTokenPermissions(value, expected, label) {
  const permissions = plainObject(value, `${label} permissions`);
  const expectedKeys = Object.keys(expected);
  for (const [key, permission] of Object.entries(permissions)) {
    if (key === "metadata") {
      if (permission !== "read") throw new Error(`${label} permissions are broader than requested.`);
      continue;
    }
    if (!Object.hasOwn(expected, key) || permission !== expected[key]) {
      throw new Error(`${label} permissions are broader than requested.`);
    }
  }
  if (expectedKeys.some((key) => permissions[key] !== expected[key])) {
    throw new Error(`${label} permissions are incomplete.`);
  }
  return permissions;
}

async function githubOidcPublicKey(header, fetchImpl) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");
  let response;
  try {
    response = await fetchImpl(GITHUB_OIDC_JWKS_URL, {
      headers: { accept: "application/json" },
      redirect: "error",
    });
  } catch {
    throw new Error("GitHub OIDC signing keys are unavailable.");
  }
  if (!response?.ok || typeof response.json !== "function") {
    throw new Error("GitHub OIDC signing keys are unavailable.");
  }
  let document;
  try {
    document = await response.json();
  } catch {
    throw new Error("GitHub OIDC signing keys are invalid.");
  }
  const keys = plainObject(document, "GitHub OIDC JWKS").keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_JWKS_KEYS) {
    throw new Error("GitHub OIDC signing keys are invalid.");
  }
  const matches = keys.filter((candidate) => candidate?.kid === header.kid);
  if (matches.length !== 1) throw new Error("GitHub OIDC signing key is unavailable or ambiguous.");
  const jwk = plainObject(matches[0], "GitHub OIDC signing key");
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string"
    || (jwk.use != null && jwk.use !== "sig") || (jwk.alg != null && jwk.alg !== "RS256")
    || (jwk.key_ops != null && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes("verify")))
    || (header.x5t != null && jwk.x5t != null && header.x5t !== jwk.x5t)) {
    throw new Error("GitHub OIDC signing key is invalid.");
  }
  let key;
  try {
    key = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    throw new Error("GitHub OIDC signing key is invalid.");
  }
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2_048) {
    throw new Error("GitHub OIDC signing key is invalid.");
  }
  return key;
}

/**
 * Verify and normalize the GitHub Actions OIDC identity authorized to request a
 * dedicated-App guard. The expected ref must come from trusted GitHub state, not
 * from the request body.
 */
export async function verifyGitHubActionsOidcToken({
  token,
  audience,
  repository,
  repositoryId,
  defaultBranch,
  workflowPath,
  workflowSha,
  ref,
  allowedEventNames = ["pull_request_target", "merge_group"],
  now = Date.now(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof token !== "string" || token.length === 0 || Buffer.byteLength(token) > MAX_JWT_BYTES) {
    throw new Error("GitHub OIDC token is invalid.");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/u.test(part))) {
    throw new Error("GitHub OIDC token is invalid.");
  }
  const header = parseJwtJson(parts[0], MAX_JWT_HEADER_BYTES, "header");
  allowedKeys(header, JWT_HEADER_KEYS, "GitHub OIDC header");
  if (header.alg !== "RS256" || header.typ !== "JWT" || typeof header.kid !== "string"
    || header.kid.length === 0 || header.kid.length > 200 || !/^[A-Za-z0-9._-]+$/u.test(header.kid)
    || (header.x5t != null && (typeof header.x5t !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(header.x5t)))) {
    throw new Error("GitHub OIDC header is invalid.");
  }
  const payload = parseJwtJson(parts[1], MAX_JWT_PAYLOAD_BYTES, "claims");
  allowedJwtClaimKeys(payload);
  if (JWT_REQUIRED_CLAIMS.some((claim) => !Object.hasOwn(payload, claim))) {
    throw new Error("GitHub OIDC claims contain a missing field.");
  }
  safeJsonSize(payload, MAX_JWT_PAYLOAD_BYTES, "GitHub OIDC claims");
  validateOptionalClaims(payload);

  const expectedAudience = validateExpectedAudience(audience);
  const expectedRepository = validRepository(repository, "Expected repository");
  const expectedRepositoryId = positiveInteger(repositoryId, "Expected repository ID");
  const expectedDefaultBranch = validateDefaultBranch(defaultBranch);
  const expectedWorkflowPath = validateWorkflowPath(workflowPath);
  const expectedWorkflowSha = validSha(workflowSha, "Expected workflow SHA");
  const expectedRef = validRef(ref, "Expected GitHub ref");
  const eventNames = validateAllowedEvents(allowedEventNames);
  validateJwtTimes(payload, now);

  const claimRepositoryId = positiveInteger(payload.repository_id, "GitHub OIDC repository_id claim");
  const runId = positiveInteger(payload.run_id, "GitHub OIDC run_id claim");
  const runAttempt = positiveInteger(payload.run_attempt, "GitHub OIDC run_attempt claim");
  const sha = validSha(payload.sha, "GitHub OIDC sha claim");
  const jti = validJti(payload.jti);
  const headRef = optionalBranchClaim(payload, "head_ref");
  const baseRef = optionalBranchClaim(payload, "base_ref");
  const expectedWorkflowRef = `${expectedRepository}/${expectedWorkflowPath}@refs/heads/${expectedDefaultBranch}`;
  if (payload.iss !== GITHUB_OIDC_ISSUER || payload.aud !== expectedAudience
    || payload.repository !== expectedRepository || claimRepositoryId !== expectedRepositoryId
    || payload.workflow_ref !== expectedWorkflowRef || payload.workflow_sha !== expectedWorkflowSha
    || payload.ref !== expectedRef || !eventNames.has(payload.event_name)) {
    throw new Error("GitHub OIDC authority claims do not match the expected workflow run.");
  }

  const key = await githubOidcPublicKey(header, fetchImpl);
  const signature = Buffer.from(parts[2], "base64url");
  if (signature.length === 0 || signature.toString("base64url") !== parts[2]
    || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), {
      key,
      padding: constants.RSA_PKCS1_PADDING,
    }, signature)) {
    throw new Error("GitHub OIDC signature verification failed.");
  }

  const normalized = Object.freeze({
    issuer: payload.iss,
    audience: payload.aud,
    repository: payload.repository,
    repositoryId: claimRepositoryId,
    workflowRef: payload.workflow_ref,
    workflowSha: payload.workflow_sha,
    ref: payload.ref,
    eventName: payload.event_name,
    runId,
    runAttempt,
    sha,
    jti,
    headRef,
    baseRef,
  });
  verifiedClaimObjects.add(normalized);
  return normalized;
}

function normalizedPrivateKey(value) {
  if (value?.type === "private") {
    if (value.asymmetricKeyType !== "rsa") throw new Error("GitHub App private key must be RSA.");
    return value;
  }
  if (typeof value !== "string" || !value.trim()) throw new Error("GitHub App private key is unavailable.");
  const pem = value.includes("\\n") && !value.includes("\n") ? value.replaceAll("\\n", "\n") : value;
  let key;
  try {
    key = createPrivateKey(pem.trim());
  } catch {
    throw new Error("GitHub App private key is invalid.");
  }
  if (key.asymmetricKeyType !== "rsa") throw new Error("GitHub App private key must be RSA.");
  return key;
}

function createGitHubAppJwt({ appId, privateKey, now }) {
  const issuer = String(appId ?? "").trim();
  if (!POSITIVE_DECIMAL.test(issuer)) throw new Error("GitHub App ID must be a positive integer.");
  if (!Number.isFinite(now)) throw new TypeError("now must be finite.");
  const issuedAt = Math.floor(now / 1_000) - CLOCK_SKEW_SECONDS;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: issuedAt, exp: issuedAt + (9 * 60), iss: issuer })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), {
    key: normalizedPrivateKey(privateKey),
    padding: constants.RSA_PKCS1_PADDING,
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Stable GitHub Check Run external identity for one exact repository target.
 * The identity deliberately excludes mutable decision inputs and workflow run
 * numbers so every re-evaluation of one exact target supersedes the same Check.
 */
export function stableGuardCheckExternalId({ repositoryId, targetType, headSha } = {}) {
  const validatedRepositoryId = positiveInteger(repositoryId, "Guard repository ID");
  if (targetType !== "pull_request" && targetType !== "merge_group") {
    throw new Error("Guard target type is invalid.");
  }
  const validatedHeadSha = validSha(headSha, "Guard target head SHA");
  return `changeplane.guard/v1:${validatedRepositoryId}:${targetType}:${validatedHeadSha}`;
}

/** Encode the authenticated workflow run stored in the App-owned Check output. */
export function encodeGuardRunMarker({ runId, runAttempt, phase, boundContractDigest = null, pullRequestNumber = null } = {}) {
  const validatedRunId = positiveInteger(runId, "Guard workflow run ID");
  const validatedRunAttempt = positiveInteger(runAttempt, "Guard workflow run attempt");
  if (phase !== "begin" && phase !== "complete") throw new Error("Guard workflow run phase is invalid.");
  if (boundContractDigest !== null && (typeof boundContractDigest !== "string" || !/^[a-f0-9]{64}$/u.test(boundContractDigest))) {
    throw new Error("Guard bound contract digest is invalid.");
  }
  const marker = `changeplane.guard-run/v1;run_id=${validatedRunId};run_attempt=${validatedRunAttempt};phase=${phase}`
    + (boundContractDigest === null ? "" : `;contract_digest=${boundContractDigest}`)
    + (pullRequestNumber === null ? "" : `;pull_request_number=${positiveInteger(pullRequestNumber, "Guard pull request number")}`);
  if (Buffer.byteLength(marker) > MAX_GUARD_RUN_MARKER_BYTES) {
    throw new Error("Guard workflow run marker exceeds its size limit.");
  }
  return marker;
}

/** Decode only the canonical server-produced marker; surrounding text is rejected. */
export function decodeGuardRunMarker(value) {
  if (typeof value !== "string" || value.length === 0
    || Buffer.byteLength(value) > MAX_GUARD_RUN_MARKER_BYTES || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("Guard workflow run marker is invalid.");
  }
  const match = GUARD_RUN_MARKER.exec(value);
  if (!match) throw new Error("Guard workflow run marker is invalid.");
  return Object.freeze({
    runId: positiveInteger(match[1], "Guard workflow run ID"),
    runAttempt: positiveInteger(match[2], "Guard workflow run attempt"),
    phase: match[3],
    ...(match[4] ? { boundContractDigest: match[4] } : {}),
    ...(match[5] ? { pullRequestNumber: positiveInteger(match[5], "Guard pull request number") } : {}),
  });
}

/** GitHub may keep a completed Check blocked while a new evaluation owns it. */
export function guardEvaluationPending(check) {
  const blocked = (check?.status === "in_progress" && check.conclusion == null)
    || (check?.status === "completed" && check.conclusion === "action_required");
  if (!blocked) return false;
  try { return decodeGuardRunMarker(check.output?.text).phase === "begin"; }
  catch { return false; }
}

/** Recover a frozen contract only from the configured App's exact-target Check. */
export function guardBoundContractDigest(check, { repository, repositoryId, target, appId, appSlug } = {}) {
  if (check == null) return null;
  if (!Number.isSafeInteger(appId) || appId <= 0 || typeof appSlug !== "string" || !/^[a-z0-9-]{1,100}$/u.test(appSlug)
    || !Number.isSafeInteger(check.id) || check.id <= 0 || check.name !== GUARD_CHECK_NAME
    || check.head_sha !== target?.headSha || check.app?.id !== appId || check.app?.slug !== appSlug
    || check.external_id !== stableGuardCheckExternalId({ repositoryId, targetType: target?.type, headSha: target?.headSha })) {
    throw new Error("The frozen contract does not belong to the configured App and exact target.");
  }
  const marker = decodeGuardRunMarker(check.output?.text);
  const passport = parseAssurancePassportIntegrity(check.output?.summary ?? "");
  if (passport) {
    verifyAssurancePassportAgainstCheck(passport, check, { appId, appSlug });
    if (marker.phase !== "complete" || passport.target.repository !== repository
      || passport.target.repositoryId !== repositoryId || passport.target.type !== target.type
      || (marker.pullRequestNumber != null && marker.pullRequestNumber !== passport.target.pullRequestNumber)
      || (marker.boundContractDigest && marker.boundContractDigest !== passport.binding.contractDigest)) {
      throw new Error("The frozen contract passport does not match the exact target.");
    }
    // The same commit can later open a different PR. Its old PASS must still be
    // invalidated, but the previous PR's contract is not this PR's binding.
    if (passport.target.pullRequestNumber !== target.pullRequestNumber) return null;
    return passport.binding.contractDigest;
  }
  // Begin replaces the old passport; reconciliation also replaces its summary.
  // Carry the previously authenticated digest through those App-owned states.
  if (guardEvaluationPending(check)
    || (marker.phase === "complete" && check.status === "completed" && check.conclusion === "action_required")) {
    if (target.type === "pull_request") {
      if (marker.boundContractDigest && marker.pullRequestNumber == null) {
        throw new Error("The frozen contract marker is missing its pull-request identity.");
      }
      if (marker.pullRequestNumber != null && marker.pullRequestNumber !== target.pullRequestNumber) return null;
    } else if (marker.pullRequestNumber != null) {
      throw new Error("The frozen contract marker belongs to a different target type.");
    }
    return marker.boundContractDigest ?? null;
  }
  throw new Error("The completed Guard is missing its authenticated contract passport.");
}

/** Compare GitHub's monotonic run identity. Returns -1, 0, or 1. */
export function compareGuardRunOrder(left, right) {
  const leftValue = plainObject(left, "Left guard workflow run");
  const rightValue = plainObject(right, "Right guard workflow run");
  const leftRunId = positiveInteger(leftValue.runId, "Left guard workflow run ID");
  const rightRunId = positiveInteger(rightValue.runId, "Right guard workflow run ID");
  const leftRunAttempt = positiveInteger(leftValue.runAttempt, "Left guard workflow run attempt");
  const rightRunAttempt = positiveInteger(rightValue.runAttempt, "Right guard workflow run attempt");
  if (leftRunId !== rightRunId) return leftRunId < rightRunId ? -1 : 1;
  if (leftRunAttempt === rightRunAttempt) return 0;
  return leftRunAttempt < rightRunAttempt ? -1 : 1;
}

/** Mint one short-lived token scoped to exactly one repository and Checks write. */
export async function createChecksWriteInstallationAccessToken({
  appId,
  privateKey,
  installationId,
  repositoryId,
  request,
  now = Date.now(),
} = {}) {
  if (typeof request !== "function") throw new TypeError("GitHub request function is required.");
  const validatedInstallationId = positiveInteger(installationId, "GitHub App installation ID");
  const validatedRepositoryId = positiveInteger(repositoryId, "GitHub repository ID");
  if (!Number.isFinite(now)) throw new TypeError("now must be finite.");
  const jwt = createGitHubAppJwt({ appId, privateKey, now });
  const payload = await request(`/app/installations/${validatedInstallationId}/access_tokens`, jwt, {
    method: "POST",
    body: {
      repository_ids: [validatedRepositoryId],
      permissions: { checks: "write" },
    },
  });
  const expiresAt = Date.parse(payload?.expires_at);
  validateInstallationTokenPermissions(payload?.permissions, { checks: "write" }, "Checks-only repository credential");
  if (typeof payload?.token !== "string" || payload.token.length === 0 || payload.token.length > 4_096
    || /[\u0000-\u0020\u007f]/u.test(payload.token)
    || !Array.isArray(payload?.repositories) || payload.repositories.length !== 1
    || payload.repositories[0]?.id !== validatedRepositoryId
    || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + (65 * 60 * 1_000)) {
    throw new Error("GitHub returned an invalid Checks-only repository credential.");
  }
  return Object.freeze({ token: payload.token, expiresAt: new Date(expiresAt).toISOString() });
}

/** Mint a separate exact-repository credential with read-only guard inputs. */
export async function createGuardReadInstallationAccessToken({
  appId,
  privateKey,
  installationId,
  repositoryId,
  request,
  now = Date.now(),
} = {}) {
  if (typeof request !== "function") throw new TypeError("GitHub request function is required.");
  const validatedInstallationId = positiveInteger(installationId, "GitHub App installation ID");
  const validatedRepositoryId = positiveInteger(repositoryId, "GitHub repository ID");
  if (!Number.isFinite(now)) throw new TypeError("now must be finite.");
  const jwt = createGitHubAppJwt({ appId, privateKey, now });
  const payload = await request(`/app/installations/${validatedInstallationId}/access_tokens`, jwt, {
    method: "POST",
    body: {
      repository_ids: [validatedRepositoryId],
      permissions: {
        actions: "read",
        checks: "read",
        contents: "read",
        pull_requests: "read",
      },
    },
  });
  const expiresAt = Date.parse(payload?.expires_at);
  validateInstallationTokenPermissions(payload?.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    pull_requests: "read",
  }, "Read-only guard credential");
  if (typeof payload?.token !== "string" || payload.token.length === 0 || payload.token.length > 4_096
    || /[\u0000-\u0020\u007f]/u.test(payload.token)
    || !Array.isArray(payload?.repositories) || payload.repositories.length !== 1
    || payload.repositories[0]?.id !== validatedRepositoryId
    || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + (65 * 60 * 1_000)) {
    throw new Error("GitHub returned an invalid read-only guard credential.");
  }
  return Object.freeze({ token: payload.token, expiresAt: new Date(expiresAt).toISOString() });
}

function expectedGuardConclusion(passport) {
  if (passport.decision.mode === "observe") return "neutral";
  return passport.decision.outcome === "PASS" ? "success" : "action_required";
}

function validateCurrentTarget(currentTarget, passport, claims, defaultBranch) {
  exactKeys(currentTarget, CURRENT_TARGET_KEYS, "Current GitHub target");
  validRepository(currentTarget.repository, "Current target repository");
  const repositoryId = positiveInteger(currentTarget.repositoryId, "Current target repository ID");
  const headRepositoryId = positiveInteger(currentTarget.headRepositoryId, "Current target head repository ID");
  const baseRepositoryId = positiveInteger(currentTarget.baseRepositoryId, "Current target base repository ID");
  validSha(currentTarget.headSha, "Current target head SHA");
  validSha(currentTarget.baseSha, "Current target base SHA");
  const baseRef = validTargetRef(currentTarget.baseRef, "Current target base ref");
  const headRef = validTargetRef(currentTarget.headRef, "Current target head ref");
  if (!Object.hasOwn({ pull_request: true, merge_group: true }, currentTarget.type)
    || typeof currentTarget.current !== "boolean"
    || (currentTarget.type === "pull_request"
      ? !Number.isSafeInteger(currentTarget.pullRequestNumber) || currentTarget.pullRequestNumber <= 0
      : currentTarget.pullRequestNumber !== null)) {
    throw new Error("Current GitHub target is malformed.");
  }
  if (!currentTarget.current) throw new Error("The GitHub target is stale or no longer current.");
  if (currentTarget.repository !== claims.repository || repositoryId !== claims.repositoryId
    || headRepositoryId !== claims.repositoryId || baseRepositoryId !== claims.repositoryId) {
    throw new Error("Forked or cross-repository guard publication is forbidden.");
  }
  if (currentTarget.type !== passport.target.type
    || currentTarget.pullRequestNumber !== passport.target.pullRequestNumber
    || currentTarget.headSha !== passport.target.headSha
    || currentTarget.baseSha !== passport.target.baseSha) {
    throw new Error("The assurance passport is stale for the current GitHub target.");
  }
  const expectedDefaultBranch = validateDefaultBranch(defaultBranch);
  if ((currentTarget.type === "pull_request" && branchName(baseRef) !== expectedDefaultBranch)
    || (currentTarget.type === "merge_group"
      && (baseRef !== `refs/heads/${expectedDefaultBranch}`
        || !headRef.startsWith(`refs/heads/gh-readonly-queue/${expectedDefaultBranch}/`)))) {
    throw new Error("The current GitHub target does not use the trusted default branch.");
  }
  if (claims.baseRef !== null && branchName(baseRef) !== branchName(claims.baseRef)) {
    throw new Error("The current target base ref does not match the authenticated workflow.");
  }
  if (claims.headRef !== null && branchName(headRef) !== branchName(claims.headRef)) {
    throw new Error("The current target head ref does not match the authenticated workflow.");
  }
  if (currentTarget.type === "merge_group" && claims.sha !== currentTarget.headSha) {
    throw new Error("The merge-group target does not match the authenticated workflow SHA.");
  }
}

/** Validate the App-owned invalidation request before any evaluation input is read. */
export function validateGuardBeginBody(body, {
  oidcClaims,
  expectedWorkflowSha,
  currentTarget,
} = {}) {
  exactKeys(body, GUARD_BEGIN_REQUEST_KEYS, "Guard begin request");
  safeJsonSize(body, MAX_GUARD_REQUEST_BYTES, "Guard begin request");
  if (!verifiedClaimObjects.has(oidcClaims)) throw new Error("Verified GitHub OIDC claims are required.");
  exactKeys(oidcClaims, NORMALIZED_CLAIM_KEYS, "Normalized GitHub OIDC claims");
  const workflowSha = validSha(expectedWorkflowSha, "Expected workflow SHA");
  if (body.schemaVersion !== 1 || body.type !== GUARD_BEGIN_TYPE) {
    throw new Error("Guard begin request schema is invalid.");
  }
  const repository = validRepository(body.repository, "Guard begin repository");
  const repositoryId = positiveInteger(body.repositoryId, "Guard begin repository ID");
  const defaultBranch = validateDefaultBranch(body.defaultBranch);
  const controllerSha = validSha(body.controllerSha, "Guard begin controller SHA");
  const expectedWorkflowRef = `${repository}/.github/workflows/changeplane.yml@refs/heads/${defaultBranch}`;
  if (repository !== oidcClaims.repository || repositoryId !== oidcClaims.repositoryId
    || controllerSha !== workflowSha || oidcClaims.workflowSha !== workflowSha
    || oidcClaims.workflowRef !== expectedWorkflowRef
    || validRef(body.gitRef, "Guard workflow ref") !== oidcClaims.ref
    || positiveInteger(body.workflowRunId, "Guard workflow run ID") !== oidcClaims.runId
    || positiveInteger(body.workflowRunAttempt, "Guard workflow run attempt") !== oidcClaims.runAttempt) {
    throw new Error("Guard begin request does not match the authenticated workflow run.");
  }

  exactKeys(body.target, GUARD_BEGIN_TARGET_KEYS, "Guard begin target");
  const target = Object.freeze({
    type: body.target.type,
    pullRequestNumber: body.target.pullRequestNumber,
    baseSha: validSha(body.target.baseSha, "Guard begin base SHA"),
    headSha: validSha(body.target.headSha, "Guard begin head SHA"),
    baseRef: validTargetRef(body.target.baseRef, "Guard begin base ref"),
    headRef: validTargetRef(body.target.headRef, "Guard begin head ref"),
  });
  if (!Object.hasOwn({ pull_request: true, merge_group: true }, target.type)
    || (target.type === "pull_request"
      ? !Number.isSafeInteger(target.pullRequestNumber) || target.pullRequestNumber <= 0
      : target.pullRequestNumber !== null)
    || (target.type === "merge_group") !== (oidcClaims.eventName === "merge_group")) {
    throw new Error("Guard begin target is invalid for the authenticated event.");
  }

  exactKeys(currentTarget, CURRENT_TARGET_KEYS, "Current GitHub target");
  const currentRepositoryId = positiveInteger(currentTarget.repositoryId, "Current target repository ID");
  const headRepositoryId = positiveInteger(currentTarget.headRepositoryId, "Current target head repository ID");
  const baseRepositoryId = positiveInteger(currentTarget.baseRepositoryId, "Current target base repository ID");
  if (currentTarget.current !== true || currentTarget.repository !== repository
    || currentRepositoryId !== repositoryId || headRepositoryId !== repositoryId
    || baseRepositoryId !== repositoryId || currentTarget.type !== target.type
    || currentTarget.pullRequestNumber !== target.pullRequestNumber
    || currentTarget.baseSha !== target.baseSha || currentTarget.headSha !== target.headSha
    || currentTarget.baseRef !== target.baseRef || currentTarget.headRef !== target.headRef) {
    throw new Error("The guard begin target is stale, forked, or cross-repository.");
  }
  if (oidcClaims.baseRef !== null && branchName(target.baseRef) !== branchName(oidcClaims.baseRef)) {
    throw new Error("Guard begin base ref does not match the authenticated workflow.");
  }
  if (oidcClaims.headRef !== null && branchName(target.headRef) !== branchName(oidcClaims.headRef)) {
    throw new Error("Guard begin head ref does not match the authenticated workflow.");
  }
  if (target.type === "merge_group" && oidcClaims.sha !== target.headSha) {
    throw new Error("Guard begin merge-group SHA does not match the authenticated workflow.");
  }

  return Object.freeze({
    schemaVersion: 1,
    type: GUARD_BEGIN_TYPE,
    repository,
    repositoryId,
    defaultBranch,
    controllerSha,
    gitRef: oidcClaims.ref,
    workflowRunId: oidcClaims.runId,
    workflowRunAttempt: oidcClaims.runAttempt,
    target,
    check: Object.freeze({
      name: GUARD_CHECK_NAME,
      head_sha: target.headSha,
      status: "in_progress",
      external_id: stableGuardCheckExternalId({ repositoryId, targetType: target.type, headSha: target.headSha }),
      output: Object.freeze({
        title: "Evaluation in progress",
        summary: "A trusted ChangePlane evaluation is running for this exact revision. A previous PASS no longer applies.",
        text: encodeGuardRunMarker({
          runId: oidcClaims.runId,
          runAttempt: oidcClaims.runAttempt,
          phase: "begin",
        }),
      }),
    }),
  });
}

export function validateGuardReconciliationBody(body, {
  oidcClaims,
  expectedWorkflowSha,
} = {}) {
  exactKeys(body, GUARD_RECONCILIATION_REQUEST_KEYS, "Guard reconciliation request");
  safeJsonSize(body, MAX_GUARD_REQUEST_BYTES, "Guard reconciliation request");
  if (!verifiedClaimObjects.has(oidcClaims)) throw new Error("Verified GitHub OIDC claims are required.");
  exactKeys(oidcClaims, NORMALIZED_CLAIM_KEYS, "Normalized GitHub OIDC claims");
  const workflowSha = validSha(expectedWorkflowSha, "Expected workflow SHA");
  if (body.schemaVersion !== 1 || body.type !== GUARD_RECONCILIATION_TYPE) {
    throw new Error("Guard reconciliation request schema is invalid.");
  }
  const repository = validRepository(body.repository, "Guard reconciliation repository");
  const repositoryId = positiveInteger(body.repositoryId, "Guard reconciliation repository ID");
  const defaultBranch = validateDefaultBranch(body.defaultBranch);
  const controllerSha = validSha(body.controllerSha, "Guard reconciliation controller SHA");
  const expectedWorkflowRef = `${repository}/.github/workflows/changeplane.yml@refs/heads/${defaultBranch}`;
  if (repository !== oidcClaims.repository || repositoryId !== oidcClaims.repositoryId
    || controllerSha !== workflowSha || oidcClaims.workflowSha !== workflowSha
    || oidcClaims.workflowRef !== expectedWorkflowRef
    || validRef(body.gitRef, "Guard reconciliation workflow ref") !== `refs/heads/${defaultBranch}`
    || body.gitRef !== oidcClaims.ref
    || positiveInteger(body.workflowRunId, "Guard reconciliation workflow run ID") !== oidcClaims.runId
    || positiveInteger(body.workflowRunAttempt, "Guard reconciliation workflow run attempt") !== oidcClaims.runAttempt
    || !["schedule", "workflow_dispatch"].includes(oidcClaims.eventName)) {
    throw new Error("Guard reconciliation request does not match the authenticated workflow run.");
  }
  return Object.freeze({
    schemaVersion: 1,
    type: GUARD_RECONCILIATION_TYPE,
    repository,
    repositoryId,
    defaultBranch,
    controllerSha,
    gitRef: oidcClaims.ref,
    workflowRunId: oidcClaims.runId,
    workflowRunAttempt: oidcClaims.runAttempt,
  });
}

/**
 * Validate the bounded request emitted by the trusted workflow. currentTarget
 * must be freshly re-fetched by the caller after OIDC verification.
 */
export function validateGuardPublishBody(body, {
  oidcClaims,
  expectedWorkflowSha,
  expectedControllerSha,
  currentTarget,
} = {}) {
  exactKeys(body, GUARD_REQUEST_KEYS, "Guard publication request");
  safeJsonSize(body, MAX_GUARD_REQUEST_BYTES, "Guard publication request");
  if (!verifiedClaimObjects.has(oidcClaims)) throw new Error("Verified GitHub OIDC claims are required.");
  exactKeys(oidcClaims, NORMALIZED_CLAIM_KEYS, "Normalized GitHub OIDC claims");
  const workflowSha = validSha(expectedWorkflowSha, "Expected workflow SHA");
  const controllerSha = validSha(expectedControllerSha, "Expected controller SHA");
  if (workflowSha !== controllerSha || oidcClaims.workflowSha !== workflowSha) {
    throw new Error("The trusted workflow and controller revisions do not match.");
  }
  if (body.schemaVersion !== 1 || body.type !== GUARD_REQUEST_TYPE) {
    throw new Error("Guard publication request schema is invalid.");
  }
  const repository = validRepository(body.repository, "Guard publication repository");
  const defaultBranch = validateDefaultBranch(body.defaultBranch);
  const expectedWorkflowRef = `${repository}/.github/workflows/changeplane.yml@refs/heads/${defaultBranch}`;
  if (repository !== oidcClaims.repository
    || oidcClaims.workflowRef !== expectedWorkflowRef
    || validRef(body.gitRef, "Guard workflow ref") !== oidcClaims.ref
    || positiveInteger(body.workflowRunId, "Guard workflow run ID") !== oidcClaims.runId
    || positiveInteger(body.workflowRunAttempt, "Guard workflow run attempt") !== oidcClaims.runAttempt) {
    throw new Error("Guard publication request does not match the authenticated workflow run.");
  }
  if (typeof body.summary !== "string" || body.summary.length === 0
    || Buffer.byteLength(body.summary) > MAX_GUARD_SUMMARY_BYTES || body.summary.includes("\0")) {
    throw new Error("Guard publication summary is invalid.");
  }

  const passport = verifyAssurancePassportIntegrity(body.passport);
  if (passport.target.repository !== repository || passport.target.repositoryId !== oidcClaims.repositoryId
    || passport.binding.policySourceRevision !== controllerSha
    || passport.binding.trustedControllerSha !== controllerSha
    || passport.target.baseSha !== controllerSha) {
    throw new Error("Assurance passport authority does not match the trusted workflow.");
  }
  if ((passport.target.type === "merge_group") !== (oidcClaims.eventName === "merge_group")) {
    throw new Error("Assurance passport target does not match the authenticated event.");
  }
  validateCurrentTarget(currentTarget, passport, oidcClaims, defaultBranch);

  const conclusion = expectedGuardConclusion(passport);
  // Reuse the passport/check envelope verifier with a non-authoritative local
  // publisher identity to prove that the summary embeds this exact passport and
  // the exact PR receipt marker. The actual App identity is checked after GitHub
  // creates the Check Run.
  verifyAssurancePassportAgainstCheck(passport, {
    id: 1,
    name: GUARD_CHECK_NAME,
    head_sha: passport.target.headSha,
    status: "completed",
    conclusion,
    app: { id: 1, slug: "changeplane-envelope-validator" },
    output: { summary: body.summary },
  }, { appId: 1, appSlug: "changeplane-envelope-validator" });

  return Object.freeze({
    schemaVersion: 1,
    type: GUARD_REQUEST_TYPE,
    repository,
    defaultBranch,
    gitRef: oidcClaims.ref,
    workflowRunId: oidcClaims.runId,
    workflowRunAttempt: oidcClaims.runAttempt,
    passport,
    summary: body.summary,
    check: Object.freeze({
      name: GUARD_CHECK_NAME,
      head_sha: passport.target.headSha,
      status: "completed",
      conclusion,
      external_id: stableGuardCheckExternalId({
        repositoryId: passport.target.repositoryId,
        targetType: passport.target.type,
        headSha: passport.target.headSha,
      }),
      output: Object.freeze({
        title: `${passport.decision.outcome} · ${passport.decision.mode}`.slice(0, 255),
        summary: body.summary,
        text: encodeGuardRunMarker({
          runId: oidcClaims.runId,
          runAttempt: oidcClaims.runAttempt,
          phase: "complete",
        }),
      }),
    }),
  });
}

export const GITHUB_GUARD_OIDC = Object.freeze({
  issuer: GITHUB_OIDC_ISSUER,
  jwksUrl: GITHUB_OIDC_JWKS_URL,
});
