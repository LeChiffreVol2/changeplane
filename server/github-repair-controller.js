import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  constants,
  sign,
  timingSafeEqual,
  verify,
} from "node:crypto";

import {
  AUTONOMOUS_DECISION,
  evaluateChange,
  evaluateEvidence,
  planAutonomousDecision,
} from "../src/lib/changeplane.js";
import {
  canonicalJson,
  issueRepairGrant,
  repairLedgerEntryDigest,
  repairLedgerKeyId,
  repairLedgerPublicKeyValue,
  reduceVerifiedRepairLedger,
  verifyRepairLedgerEnvelope,
} from "./repair-ledger.js";

const REQUEST_DOMAIN = "changeplane:controller-request:v1\0";
const CLAIM_DOMAIN = "changeplane:controller-claim:v1\0";
const TRANSITION_DOMAIN = "changeplane:repair-transition:v1\0";
const LEDGER_SCHEMA_VERSION = 3;
const REQUEST_SCHEMA_VERSION = 3;
const EVALUATOR_VERSION = "0.3.0";
const MAX_CHANGED_FILES = 3_000;
const MAX_DIAGNOSTIC_LENGTH = 6_000;
const REQUEST_KEYS = [
  "allowedPaths",
  "attempt",
  "authority",
  "change",
  "contract",
  "idempotencyKey",
  "instructions",
  "issuer",
  "repairKind",
  "schemaVersion",
].sort();
const CHANGE_KEYS = [
  "baseRef",
  "baseSha",
  "headRef",
  "headRepository",
  "headSha",
  "installationId",
  "pullRequestNumber",
  "repository",
  "repositoryId",
].sort();
const AUTHORITY_KEYS = [
  "contractDigest",
  "controllerSha",
  "evaluatorVersion",
  "inputDigest",
  "policyDigest",
  "policyPath",
].sort();
const CONTRACT_KEYS = ["goal", "scope"].sort();
const CLAIM_KEYS = [
  "authorizationId",
  "baseSha",
  "contractDigest",
  "generation",
  "grantDigest",
  "installationId",
  "issuer",
  "pullRequestId",
  "pullRequestNumber",
  "repository",
  "repositoryId",
  "schemaVersion",
  "workflowRunAttempt",
  "workflowRunId",
].sort();

function plainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, name) {
  const actual = Object.keys(plainObject(value, name)).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${name} contains an unknown or missing field`);
  }
}

function validDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function validPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(value)) {
    throw new Error("Repair controller repository is invalid");
  }
  return value;
}

function validateRef(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._/-]{1,255}$/u.test(value)
    || value.startsWith("/") || value.endsWith("/") || value.endsWith(".lock")
    || value.includes("..") || value.includes("//")) {
    throw new Error(`${name} is invalid`);
  }
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function signLedgerTransition(kind, value, privateKey) {
  const key = normalizedPrivateKey(privateKey);
  const publicKey = createPublicKey(key);
  const payload = Buffer.from(`${TRANSITION_DOMAIN}${kind}\0${canonicalJson(value)}`);
  return {
    ...value,
    signature: {
      algorithm: "PS256",
      keyId: repairLedgerKeyId(publicKey),
      value: sign("sha256", payload, {
        key,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      }).toString("base64url"),
    },
  };
}

function verifyLedgerTransition(kind, value, publicKeys) {
  const signature = plainObject(value?.signature, `Repair ledger ${kind} signature`);
  exactKeys(signature, ["algorithm", "keyId", "value"].sort(), `Repair ledger ${kind} signature`);
  if (signature.algorithm !== "PS256" || typeof signature.keyId !== "string" || typeof signature.value !== "string") {
    throw new Error(`Repair ledger ${kind} signature is invalid`);
  }
  const publicKeyValue = publicKeys?.[signature.keyId];
  if (typeof publicKeyValue !== "string") throw new Error(`Repair ledger ${kind} signing key is unavailable`);
  const unsigned = { ...value };
  delete unsigned.signature;
  const valid = verify("sha256", Buffer.from(`${TRANSITION_DOMAIN}${kind}\0${canonicalJson(unsigned)}`), {
    key: createPublicKey({ key: Buffer.from(publicKeyValue, "base64"), format: "der", type: "spki" }),
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }, Buffer.from(signature.value, "base64url"));
  if (!valid) throw new Error(`Repair ledger ${kind} signature verification failed`);
}

function normalizedPrivateKey(value) {
  if (value?.type === "private") return value;
  if (typeof value !== "string" || !value.trim()) throw new Error("GitHub App private key is unavailable");
  const pem = value.includes("\\n") && !value.includes("\n") ? value.replaceAll("\\n", "\n") : value;
  const key = createPrivateKey(pem.trim());
  if (key.asymmetricKeyType !== "rsa") throw new Error("GitHub App private key must be RSA");
  return key;
}

export function createGitHubAppJwt({ appId, privateKey, now = Date.now() }) {
  const issuer = String(appId ?? "").trim();
  if (!/^[1-9][0-9]{0,19}$/u.test(issuer)) throw new Error("GITHUB_APP_ID must be a positive integer");
  if (!Number.isFinite(now)) throw new TypeError("now must be finite");
  const issuedAt = Math.floor(now / 1_000) - 60;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: issuedAt, exp: issuedAt + 9 * 60, iss: issuer })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), normalizedPrivateKey(privateKey)).toString("base64url");
  return `${signingInput}.${signature}`;
}

export function deriveControllerSecret({ masterSecret, installationId, repositoryId, repository }) {
  if (typeof masterSecret !== "string" || masterSecret.length < 32) {
    throw new Error("CHANGEPLANE_CONTROLLER_SECRET must contain at least 32 characters");
  }
  if (!validPositiveInteger(installationId) || !validPositiveInteger(repositoryId)) {
    throw new Error("Repair controller installation and repository IDs are invalid");
  }
  validateRepository(repository);
  return createHmac("sha256", masterSecret)
    .update(`changeplane:repository-controller:v1\0${installationId}\0${repositoryId}\0${repository.toLowerCase()}`)
    .digest("base64url");
}

export function signControllerRequest({ secret, deliveryId, request }) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Repair controller secret is invalid");
  if (!validDigest(deliveryId)) throw new Error("Repair controller delivery ID is invalid");
  return `sha256=${createHmac("sha256", secret)
    .update(REQUEST_DOMAIN)
    .update(deliveryId)
    .update("\0")
    .update(canonicalJson(request))
    .digest("hex")}`;
}

export function verifyControllerRequest({ secret, deliveryId, signature, request }) {
  const expected = Buffer.from(signControllerRequest({ secret, deliveryId, request }));
  const actual = Buffer.from(String(signature ?? ""));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Repair controller request signature is invalid");
  }
  return validateControllerRequest(request, { expectedDeliveryId: deliveryId });
}

export function claimDeliveryId(request) {
  return digest({
    authorizationId: request?.authorizationId,
    grantDigest: request?.grantDigest,
    workflowRunId: request?.workflowRunId,
    workflowRunAttempt: request?.workflowRunAttempt,
  });
}

export function validateClaimRequest(request, { expectedDeliveryId } = {}) {
  exactKeys(request, CLAIM_KEYS, "Repair claim request");
  if (request.schemaVersion !== 1 || request.issuer !== "changeplane-repair-worker") {
    throw new Error("Repair claim schema or issuer is invalid");
  }
  validateRepository(request.repository);
  for (const value of [request.installationId, request.repositoryId, request.pullRequestId, request.pullRequestNumber,
    request.generation, request.workflowRunId, request.workflowRunAttempt]) {
    if (!validPositiveInteger(value)) throw new Error("Repair claim identity is invalid");
  }
  for (const value of [request.authorizationId, request.grantDigest, request.contractDigest]) {
    if (!validDigest(value)) throw new Error("Repair claim digest is invalid");
  }
  if (!validSha(request.baseSha)) throw new Error("Repair claim base revision is invalid");
  const deliveryId = claimDeliveryId(request);
  if (expectedDeliveryId != null && deliveryId !== expectedDeliveryId) throw new Error("Repair claim delivery ID is invalid");
  return request;
}

export function signClaimRequest({ secret, deliveryId, request }) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Repair claim secret is invalid");
  if (!validDigest(deliveryId)) throw new Error("Repair claim delivery ID is invalid");
  return `sha256=${createHmac("sha256", secret)
    .update(CLAIM_DOMAIN)
    .update(deliveryId)
    .update("\0")
    .update(canonicalJson(request))
    .digest("hex")}`;
}

export function verifyClaimRequest({ secret, deliveryId, signature, request }) {
  const expected = Buffer.from(signClaimRequest({ secret, deliveryId, request }));
  const actual = Buffer.from(String(signature ?? ""));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Repair claim signature is invalid");
  }
  return validateClaimRequest(request, { expectedDeliveryId: deliveryId });
}

export function validateControllerRequest(request, { expectedDeliveryId } = {}) {
  exactKeys(request, REQUEST_KEYS, "Repair controller request");
  exactKeys(request.change, CHANGE_KEYS, "Repair controller change");
  exactKeys(request.authority, AUTHORITY_KEYS, "Repair controller authority");
  exactKeys(request.contract, CONTRACT_KEYS, "Repair controller contract");
  if (request.schemaVersion !== REQUEST_SCHEMA_VERSION || request.issuer !== "changeplane-guard") {
    throw new Error("Repair controller request schema or issuer is invalid");
  }
  if (!validDigest(request.idempotencyKey) || (expectedDeliveryId != null && request.idempotencyKey !== expectedDeliveryId)) {
    throw new Error("Repair controller idempotency key is invalid");
  }
  const { change, authority, contract } = request;
  validateRepository(change.repository);
  validateRepository(change.headRepository);
  if (change.repository !== change.headRepository) throw new Error("Cross-repository repair is forbidden");
  if (!validPositiveInteger(change.installationId) || !validPositiveInteger(change.repositoryId)
    || !validPositiveInteger(change.pullRequestNumber)) {
    throw new Error("Repair controller identity is invalid");
  }
  validateRef(change.baseRef, "Repair controller base ref");
  validateRef(change.headRef, "Repair controller head ref");
  if (!validSha(change.baseSha) || !validSha(change.headSha) || !validSha(authority.controllerSha)) {
    throw new Error("Repair controller revision is invalid");
  }
  for (const [name, value] of [
    ["contractDigest", authority.contractDigest],
    ["policyDigest", authority.policyDigest],
    ["inputDigest", authority.inputDigest],
  ]) if (!validDigest(value)) throw new Error(`${name} is invalid`);
  if (authority.evaluatorVersion !== EVALUATOR_VERSION || authority.policyPath !== ".changeplane.json") {
    throw new Error("Repair controller evaluator or policy path is invalid");
  }
  if (![1, 2].includes(request.attempt) || !["scope", "evidence"].includes(request.repairKind)) {
    throw new Error("Repair controller attempt or kind is invalid");
  }
  if (!Array.isArray(contract.scope) || contract.scope.length < 1 || contract.scope.length > 50
    || contract.scope.some((path) => typeof path !== "string" || !path || path.length > 300)
    || (contract.goal != null && (typeof contract.goal !== "string" || !contract.goal || contract.goal.length > 500))) {
    throw new Error("Repair controller contract is invalid");
  }
  if (!Array.isArray(request.allowedPaths) || !Array.isArray(request.instructions)) {
    throw new Error("Repair controller paths or instructions are invalid");
  }
  return request;
}

export async function createInstallationAccessToken({
  appId,
  privateKey,
  installationId,
  repositoryId,
  request,
  now = Date.now(),
}) {
  if (typeof request !== "function") throw new TypeError("GitHub request function is required");
  if (!validPositiveInteger(installationId) || !validPositiveInteger(repositoryId)) {
    throw new Error("GitHub App installation scope is invalid");
  }
  const jwt = createGitHubAppJwt({ appId, privateKey, now });
  const payload = await request(`/app/installations/${installationId}/access_tokens`, jwt, {
    method: "POST",
    body: {
      repository_ids: [repositoryId],
      permissions: {
        actions: "read",
        checks: "write",
        contents: "write",
        pull_requests: "read",
      },
    },
  });
  if (typeof payload?.token !== "string" || !payload.token || !Array.isArray(payload.repositories)
    || payload.repositories.length !== 1 || payload.repositories[0]?.id !== repositoryId) {
    throw new Error("GitHub returned an invalid repository-scoped installation token");
  }
  return payload.token;
}

function encodedRepository(repository) {
  return repository.split("/").map(encodeURIComponent).join("/");
}

function encodedPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function readChangedFiles(repository, pullRequest, token, request) {
  if (!Number.isSafeInteger(pullRequest.changed_files) || pullRequest.changed_files < 1
    || pullRequest.changed_files > MAX_CHANGED_FILES) {
    throw new Error(`Repair supports 1-${MAX_CHANGED_FILES} changed files`);
  }
  const files = [];
  for (let page = 1; files.length < pullRequest.changed_files && page <= 30; page += 1) {
    const batch = await request(`/repos/${encodedRepository(repository)}/pulls/${pullRequest.number}/files?per_page=100&page=${page}`, token);
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid pull-request file list");
    files.push(...batch);
    if (batch.length < 100) break;
  }
  if (files.length !== pullRequest.changed_files) throw new Error("GitHub returned an incomplete pull-request file list");
  return files.map((file) => ({
    path: file.filename,
    ...(file.previous_filename ? { previousPath: file.previous_filename } : {}),
  }));
}

function decodePolicy(file, path) {
  if (file?.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
    throw new Error(`Policy ${path} is not readable at the bound base revision`);
  }
  let policy;
  try {
    policy = JSON.parse(Buffer.from(file.content.replaceAll("\n", ""), "base64").toString("utf8"));
  } catch {
    throw new Error(`Policy ${path} is not valid JSON`);
  }
  if (policy?.version !== 1 || !plainObject(policy.protectedPaths, "Policy protected paths")) {
    throw new Error(`Policy ${path} must use version 1 and define protectedPaths`);
  }
  return policy;
}

function protectedPathRules(policy) {
  const values = [
    ...(Array.isArray(policy.protectedPaths.requireApproval) ? policy.protectedPaths.requireApproval : []),
    ...(Array.isArray(policy.protectedPaths.block) ? policy.protectedPaths.block : []),
  ];
  if (values.some((value) => typeof value !== "string")) throw new Error("Policy protected paths are invalid");
  return [...new Set(values)].sort();
}

function normalizeContract(value, name) {
  const object = plainObject(value, name);
  if (Object.keys(object).some((key) => !["goal", "scope"].includes(key))
    || !Array.isArray(object.scope) || object.scope.length < 1 || object.scope.length > 50
    || object.scope.some((path) => typeof path !== "string" || !path.trim() || path.length > 300)
    || (object.goal != null && (typeof object.goal !== "string" || !object.goal.trim() || object.goal.length > 500))) {
    throw new Error(`${name} is invalid`);
  }
  const scope = [...new Set(object.scope.map((path) => path.trim()))].sort();
  return { scope, ...(object.goal ? { goal: object.goal.trim() } : {}) };
}

function declaredContractFromPullRequest(body, { optional = false } = {}) {
  const match = String(body ?? "").match(/<!--\s*changeplane\s*([\s\S]*?)-->/iu);
  if (!match) {
    if (optional) return null;
    throw new Error("Controlled repair requires a ChangePlane contract");
  }
  let value;
  try {
    value = JSON.parse(match[1]);
  } catch {
    throw new Error("The live pull-request ChangePlane contract is not valid JSON");
  }
  return normalizeContract(value, "The live pull-request ChangePlane contract");
}

function inferAutomaticContract(actualFiles, title) {
  const scope = [...new Set(actualFiles.flatMap((file) => [file.path, file.previousPath]).filter(Boolean))].sort();
  if (scope.length < 1 || scope.length > 50) {
    throw new Error("Automatic repair contracts support 1-50 exact paths");
  }
  const goal = String(title ?? "").trim().slice(0, 500);
  return normalizeContract({ scope, ...(goal ? { goal } : {}) }, "The inferred ChangePlane contract");
}

function trustedAutomaticContractFromComments(comments) {
  if (!Array.isArray(comments)) throw new Error("GitHub returned an invalid pull-request comment list");
  const contracts = comments.flatMap((comment) => {
    if (comment?.user?.login !== "github-actions[bot]") return [];
    const body = String(comment.body ?? "");
    const receipt = body.match(/<!-- changeplane-receipt:v2 contract=([a-f0-9]{64}) input=[a-f0-9]{64} head=[a-f0-9]{40} -->/u);
    const marker = body.match(/<!-- changeplane-contract:v1 source=first-head plan=([A-Za-z0-9_-]+) -->/u);
    if (!receipt || !marker || marker[1].length > 20_000) return [];
    try {
      const plan = normalizeContract(
        JSON.parse(Buffer.from(marker[1], "base64url").toString("utf8")),
        "The trusted automatic ChangePlane contract",
      );
      return [{ contractDigest: receipt[1], plan }];
    } catch {
      return [];
    }
  });
  if (contracts.length > 1) throw new Error("A unique trusted automatic ChangePlane contract is unavailable");
  return contracts[0] ?? null;
}

async function readTrustedAutomaticContract(repository, pullRequestNumber, token, request) {
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await request(
      `/repos/${encodedRepository(repository)}/issues/${pullRequestNumber}/comments?per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(batch)) throw new Error("GitHub returned an invalid pull-request comment list");
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return trustedAutomaticContractFromComments(comments);
}

function boundedEvidenceText(value, limit = MAX_DIAGNOSTIC_LENGTH) {
  return String(value ?? "").replaceAll(/[\u0000-\u001f\u007f]+/gu, " ").replaceAll(/\s+/gu, " ").trim().slice(0, limit);
}

function checkDiagnostic(check, annotations) {
  return [
    boundedEvidenceText(check?.output?.title, 300),
    boundedEvidenceText(check?.output?.summary),
    boundedEvidenceText(check?.output?.text),
    ...annotations.slice(0, 20).map((annotation) => {
      const location = [boundedEvidenceText(annotation?.path, 300), Number.isSafeInteger(annotation?.start_line) ? `line ${annotation.start_line}` : ""]
        .filter(Boolean).join(":");
      const message = boundedEvidenceText(annotation?.message ?? annotation?.raw_details ?? annotation?.title);
      return [location, message].filter(Boolean).join(" — ");
    }),
  ].filter(Boolean).join("\n").slice(0, MAX_DIAGNOSTIC_LENGTH);
}

async function evidenceResult(repository, headSha, policy, token, request) {
  const requiredChecks = policy.evidence?.requiredChecks ?? [];
  if (!Array.isArray(requiredChecks) || requiredChecks.some((item) => typeof item === "string")) {
    throw new Error("Repair requires every evidence check to bind an expected GitHub App");
  }
  if (requiredChecks.length === 0) return evaluateEvidence();
  const encoded = encodedRepository(repository);
  const checkPayload = await request(`/repos/${encoded}/commits/${headSha}/check-runs?filter=latest&per_page=100`, token);
  const required = new Set(requiredChecks.map(({ name, appSlug }) => `${name}\0${appSlug}`));
  const checks = Array.isArray(checkPayload?.check_runs) ? await Promise.all(checkPayload.check_runs.map(async (check) => {
    const source = check.check_suite?.app?.slug ?? check.app?.slug ?? null;
    const needsDiagnostic = check.status === "completed" && check.conclusion !== "success"
      && required.has(`${check.name}\0${source}`);
    let annotations = [];
    if (needsDiagnostic && validPositiveInteger(check.id) && check.output?.annotations_count > 0) {
      try {
        const payload = await request(`/repos/${encoded}/check-runs/${check.id}/annotations?per_page=20`, token);
        if (Array.isArray(payload)) annotations = payload;
      } catch {
        // Bounded Check output remains usable when annotation access is unavailable.
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
  return evaluateEvidence({ requiredChecks, checks });
}

function sameFinding(left, right) {
  return left?.code === right?.code && left?.path === right?.path && left?.pathKind === right?.pathKind;
}

export async function buildTrustedRepairCandidate({
  controllerRequest,
  installationToken,
  appId,
  publisherReleaseSha,
  request,
  expectedRepository,
}) {
  const input = validateControllerRequest(controllerRequest);
  const { change, authority, contract } = input;
  if (expectedRepository && change.repository.toLowerCase() !== expectedRepository.toLowerCase()) {
    throw new Error("Repair controller is bound to a different canary repository");
  }
  if (typeof request !== "function" || typeof installationToken !== "string" || !installationToken) {
    throw new TypeError("GitHub installation authority is required");
  }
  const encoded = encodedRepository(change.repository);
  const repository = await request(`/repositories/${change.repositoryId}`, installationToken);
  if (repository?.id !== change.repositoryId || repository?.full_name !== change.repository
    || repository.archived || repository.disabled || typeof repository.default_branch !== "string") {
    throw new Error("Repair controller repository identity or state changed");
  }
  const [pullRequest, controllerRef] = await Promise.all([
    request(`/repos/${encoded}/pulls/${change.pullRequestNumber}`, installationToken),
    request(`/repos/${encoded}/git/ref/heads/${encodedPath(repository.default_branch)}`, installationToken),
  ]);
  if (!validPositiveInteger(pullRequest?.id) || pullRequest?.number !== change.pullRequestNumber || pullRequest.state !== "open"
    || pullRequest.base?.ref !== repository.default_branch
    || pullRequest.base?.ref !== change.baseRef || pullRequest.base?.sha !== change.baseSha
    || pullRequest.head?.sha !== change.headSha || pullRequest.head?.ref !== change.headRef
    || pullRequest.head?.repo?.full_name !== change.repository
    || controllerRef?.object?.sha !== authority.controllerSha
    || authority.controllerSha !== pullRequest.base.sha) {
    throw new Error("Repair controller request is stale or does not match the live pull request");
  }
  const policyFile = await request(
    `/repos/${encoded}/contents/${encodedPath(authority.policyPath)}?ref=${encodeURIComponent(change.baseSha)}`,
    installationToken,
  );
  const policy = decodePolicy(policyFile, authority.policyPath);
  const actualFiles = await readChangedFiles(change.repository, pullRequest, installationToken, request);
  const plan = { scope: contract.scope, ...(contract.goal ? { goal: contract.goal } : {}) };
  const computedContractDigest = digest(plan);
  const declaredPlan = declaredContractFromPullRequest(pullRequest.body, { optional: true });
  if (declaredPlan) {
    if (canonicalJson(declaredPlan) !== canonicalJson(plan)) {
      throw new Error("Repair controller contract does not match the live pull-request declaration");
    }
  } else {
    const trusted = await readTrustedAutomaticContract(
      change.repository,
      change.pullRequestNumber,
      installationToken,
      request,
    );
    if (trusted
      ? trusted.contractDigest !== computedContractDigest || canonicalJson(trusted.plan) !== canonicalJson(plan)
      : canonicalJson(inferAutomaticContract(actualFiles, pullRequest.title)) !== canonicalJson(plan)) {
      throw new Error("Repair controller contract does not match the trusted automatic contract");
    }
  }
  const computedPolicyDigest = digest(policy);
  const computedInputDigest = digest({ plan, files: actualFiles });
  if (computedContractDigest !== authority.contractDigest
    || computedPolicyDigest !== authority.policyDigest
    || computedInputDigest !== authority.inputDigest) {
    throw new Error("Repair controller authority digest does not match live GitHub state");
  }
  const expectedIdempotencyKey = digest({
    repository: change.repository,
    pullRequestNumber: change.pullRequestNumber,
    headSha: change.headSha,
    inputDigest: authority.inputDigest,
    attempt: input.attempt,
  });
  if (expectedIdempotencyKey !== input.idempotencyKey) throw new Error("Repair controller idempotency key does not match live state");

  const revision = {
    baseSha: change.baseSha,
    headSha: change.headSha,
    policyDigest: computedPolicyDigest,
    inputDigest: computedInputDigest,
    contractDigest: computedContractDigest,
    evaluatorVersion: EVALUATOR_VERSION,
  };
  const pathResult = evaluateChange({
    plannedPaths: plan.scope,
    actualFiles,
    protectedPaths: policy.protectedPaths,
    ...revision,
  });
  const checks = await evidenceResult(change.repository, change.headSha, policy, installationToken, request);
  const reasons = [...pathResult.reasons, ...checks.reasons];
  const autonomous = planAutonomousDecision({
    result: { decision: reasons.length === 0 ? "PASS" : "REVIEW_REQUIRED", reasons },
    agentConfigured: true,
    attempt: input.attempt - 1,
    maxAttempts: 2,
  });
  if (autonomous.decision !== AUTONOMOUS_DECISION.REMEDIATION_REQUIRED || autonomous.nextAttempt !== input.attempt) {
    throw new Error("Live GitHub state no longer authorizes autonomous repair");
  }
  const repairKind = autonomous.reason === "FIXABLE_EVIDENCE_FAILURE" ? "evidence" : "scope";
  if (input.repairKind !== repairKind || input.instructions.length !== autonomous.findings.length
    || input.instructions.some((instruction, index) => !sameFinding(instruction, autonomous.findings[index]))) {
    throw new Error("Repair controller instructions do not match the deterministic finding set");
  }
  const allowedPaths = repairKind === "evidence" ? plan.scope : autonomous.findings.map(({ path }) => path);
  if (canonicalJson(input.allowedPaths) !== canonicalJson(allowedPaths)) {
    throw new Error("Repair controller allowed paths do not match the deterministic finding set");
  }
  const instructions = autonomous.findings.map((finding) => ({
    code: finding.code,
    path: finding.path,
    pathKind: finding.pathKind,
    action: repairKind === "evidence"
      ? "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE"
      : "REVERT_OR_MOVE_INTO_DECLARED_SCOPE",
    ...(repairKind === "evidence" && typeof finding.diagnostic === "string"
      ? { diagnostic: finding.diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH) }
      : {}),
  }));
  const numericAppId = Number(appId);
  if (!validPositiveInteger(numericAppId) || !validSha(publisherReleaseSha)) {
    throw new Error("Repair publisher identity or release is invalid");
  }
  return {
    attempt: input.attempt,
    authorizationId: input.idempotencyKey,
    appId: numericAppId,
    installationId: change.installationId,
    repositoryId: change.repositoryId,
    pullRequestId: pullRequest.id,
    repository: change.repository,
    pullRequestNumber: change.pullRequestNumber,
    contractDigest: computedContractDigest,
    policyDigest: computedPolicyDigest,
    evaluatorVersion: EVALUATOR_VERSION,
    inputDigest: computedInputDigest,
    evaluationDigest: digest({ revision, pathReasons: pathResult.reasons, evidenceReasons: checks.reasons, autonomous }),
    baseRef: change.baseRef,
    baseSha: change.baseSha,
    controllerSha: authority.controllerSha,
    publisherReleaseSha,
    headSha: change.headSha,
    headRef: change.headRef,
    headRepository: change.repository,
    repairKind,
    declaredScope: plan.scope,
    allowedPaths,
    protectedPaths: protectedPathRules(policy),
    instructions,
  };
}

export function repairLedgerReference({ pullRequestId, generation }) {
  if (!validPositiveInteger(pullRequestId) || !validPositiveInteger(generation)) {
    throw new Error("Repair ledger reference identity is invalid");
  }
  return `refs/changeplane/repair/v3/g${generation}/pr-${pullRequestId}`;
}

function ledgerDocument({ appId, installationId, repositoryId, repository, pullRequestId, pullRequestNumber, contractDigest, generation, envelopes = [], claims = [], dispatches = [] }) {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    appId,
    installationId,
    repositoryId,
    repository,
    pullRequestId,
    pullRequestNumber,
    contractDigest,
    generation,
    envelopes,
    claims,
    dispatches,
  };
}

function validateLedgerDocument(document, expected) {
  exactKeys(document, ["appId", "claims", "contractDigest", "dispatches", "envelopes", "generation", "installationId", "pullRequestId", "pullRequestNumber", "repository", "repositoryId", "schemaVersion"].sort(), "Repair ledger document");
  if (document.schemaVersion !== LEDGER_SCHEMA_VERSION
    || document.appId !== expected.appId
    || document.installationId !== expected.installationId
    || document.repositoryId !== expected.repositoryId
    || document.repository !== expected.repository
    || document.pullRequestId !== expected.pullRequestId
    || document.pullRequestNumber !== expected.pullRequestNumber
    || document.contractDigest !== expected.contractDigest
    || document.generation !== expected.generation
    || !Array.isArray(document.envelopes) || document.envelopes.length > 2
    || !Array.isArray(document.claims) || document.claims.length > 2
    || !Array.isArray(document.dispatches) || document.dispatches.length > 2) {
    throw new Error("Repair ledger document identity is invalid");
  }
  const authorizationIds = new Set(document.envelopes.map((envelope) => envelope?.entry?.authorizationId));
  for (const claim of document.claims) {
    exactKeys(claim, ["authorizationId", "claimedAt", "grantDigest", "signature", "workflowRunAttempt", "workflowRunId"].sort(), "Repair ledger claim");
    if (!authorizationIds.has(claim.authorizationId) || !validDigest(claim.grantDigest)
      || !validPositiveInteger(claim.workflowRunId) || !validPositiveInteger(claim.workflowRunAttempt)
      || Number.isNaN(Date.parse(claim.claimedAt))) {
      throw new Error("Repair ledger claim is invalid");
    }
    if (expected.publicKeys) verifyLedgerTransition("claim", claim, expected.publicKeys);
  }
  for (const dispatch of document.dispatches) {
    exactKeys(dispatch, ["authorizationId", "grantDigest", "reservedAt", "signature"].sort(), "Repair ledger dispatch");
    if (!authorizationIds.has(dispatch.authorizationId) || !validDigest(dispatch.grantDigest)
      || Number.isNaN(Date.parse(dispatch.reservedAt))) {
      throw new Error("Repair ledger dispatch is invalid");
    }
    if (expected.publicKeys) verifyLedgerTransition("dispatch", dispatch, expected.publicKeys);
  }
  if (new Set(document.claims.map((claim) => claim.authorizationId)).size !== document.claims.length
    || new Set(document.dispatches.map((dispatch) => dispatch.authorizationId)).size !== document.dispatches.length) {
    throw new Error("Repair ledger state contains a replayed transition");
  }
  if (expected.publicKeys) {
    reduceVerifiedRepairLedger(document.envelopes, expected.publicKeys, {
      now: expected.now ?? Date.now(),
      expectedRepository: expected.repository,
      expectedPullRequestNumber: expected.pullRequestNumber,
      expectedContractDigest: expected.contractDigest,
      expectedGeneration: expected.generation,
      allowExpired: true,
    });
  }
  return document;
}

export async function readGitHubRepairLedger({ request, token, repository, reference, expected }) {
  if (typeof request !== "function") throw new TypeError("GitHub request function is required");
  const encoded = encodedRepository(repository);
  const refPath = reference.replace(/^refs\//u, "");
  let ref;
  try {
    ref = await request(`/repos/${encoded}/git/ref/${encodedPath(refPath)}`, token);
  } catch (error) {
    if (error?.status === 404) return { document: ledgerDocument(expected), envelopes: [], claims: [], dispatches: [], tipSha: null, parentSha: null, parentCount: 0 };
    throw error;
  }
  if (!validSha(ref?.object?.sha)) throw new Error("Repair ledger reference is invalid");
  return readGitHubRepairLedgerCommit({ request, token, repository, tipSha: ref.object.sha, expected });
}

async function readGitHubRepairLedgerCommit({ request, token, repository, tipSha, expected }) {
  const encoded = encodedRepository(repository);
  const commit = await request(`/repos/${encoded}/git/commits/${tipSha}`, token);
  if (!validSha(commit?.tree?.sha)) throw new Error("Repair ledger commit is invalid");
  const tree = await request(`/repos/${encoded}/git/trees/${commit.tree.sha}`, token);
  const entry = Array.isArray(tree?.tree) ? tree.tree.find((item) => item?.path === "ledger.json" && item?.type === "blob") : null;
  if (!validSha(entry?.sha)) throw new Error("Repair ledger blob is missing");
  const blob = await request(`/repos/${encoded}/git/blobs/${entry.sha}`, token);
  if (blob?.encoding !== "base64" || typeof blob.content !== "string") throw new Error("Repair ledger blob is invalid");
  let document;
  try {
    document = JSON.parse(Buffer.from(blob.content.replaceAll("\n", ""), "base64").toString("utf8"));
  } catch {
    throw new Error("Repair ledger blob is not valid JSON");
  }
  const verified = validateLedgerDocument(document, expected);
  const parents = Array.isArray(commit.parents) ? commit.parents : [];
  if (parents.some((parent) => !validSha(parent?.sha))) throw new Error("Repair ledger commit parent is invalid");
  const parentSha = parents.length === 1 ? parents[0].sha : null;
  return {
    document: verified,
    envelopes: verified.envelopes,
    claims: verified.claims,
    dispatches: verified.dispatches,
    tipSha,
    parentSha,
    parentCount: parents.length,
  };
}

export async function appendGitHubRepairLedger({
  request,
  token,
  repository,
  reference,
  expected,
  snapshot,
  envelope,
}) {
  const encoded = encodedRepository(repository);
  const envelopes = [...snapshot.envelopes, envelope];
  if (envelopes.length > 2) throw new Error("Repair ledger exceeds the attempt budget");
  const document = ledgerDocument({ ...snapshot.document, ...expected, envelopes });
  const blob = await request(`/repos/${encoded}/git/blobs`, token, {
    method: "POST",
    body: { content: `${canonicalJson(document)}\n`, encoding: "utf-8" },
  });
  const tree = await request(`/repos/${encoded}/git/trees`, token, {
    method: "POST",
    body: { tree: [{ path: "ledger.json", mode: "100644", type: "blob", sha: blob?.sha }] },
  });
  if (!validSha(blob?.sha) || !validSha(tree?.sha)) throw new Error("GitHub returned invalid repair ledger objects");
  const commit = await request(`/repos/${encoded}/git/commits`, token, {
    method: "POST",
    body: {
      message: `ChangePlane repair authorization ${envelope.entry.authorizationId.slice(0, 12)}`,
      tree: tree.sha,
      parents: snapshot.tipSha ? [snapshot.tipSha] : [],
    },
  });
  if (!validSha(commit?.sha)) throw new Error("GitHub returned an invalid repair ledger commit");
  if (snapshot.tipSha) {
    await request(`/repos/${encoded}/git/refs/${encodedPath(reference.replace(/^refs\//u, ""))}`, token, {
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    });
  } else {
    await request(`/repos/${encoded}/git/refs`, token, {
      method: "POST",
      body: { ref: reference, sha: commit.sha },
    });
  }
  return { tipSha: commit.sha, document };
}

function reconciliationEnvelope(envelopes, authorizationId) {
  const matches = envelopes.filter((envelope) => envelope?.entry?.authorizationId === authorizationId);
  if (matches.length > 1) throw new Error("Repair ledger contains duplicate authorization IDs");
  return matches[0] ?? null;
}

function ledgerAnchorExternalId({ expected, tipSha, document }) {
  return `changeplane:repair-ledger:v3:${expected.pullRequestId}:g${expected.generation}:${tipSha}:${digest(document)}`;
}

async function listAppChecks({ request, token, repository, headSha, name, appId }) {
  const payload = await request(
    `/repos/${encodedRepository(repository)}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`,
    token,
  );
  const checks = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
  return checks
    .filter((check) => check?.name === name && check?.app?.id === appId && validPositiveInteger(check?.id))
    .sort((left, right) => right.id - left.id);
}

function isSingleAllowedLedgerTransition(previous, current) {
  const collections = ["envelopes", "dispatches", "claims"];
  let additions = 0;
  for (const name of collections) {
    const before = previous[name];
    const after = current[name];
    if (after.length === before.length) {
      if (canonicalJson(after) !== canonicalJson(before)) return false;
      continue;
    }
    if (after.length !== before.length + 1
      || canonicalJson(after.slice(0, -1)) !== canonicalJson(before)) return false;
    additions += 1;
  }
  return additions === 1;
}

async function reconcileMissingLedgerAnchor({ request, token, repository, expected, snapshot, latest }) {
  if (!snapshot.tipSha) return false;
  if (snapshot.parentCount === 0) {
    if (latest || snapshot.envelopes.length !== 1 || snapshot.claims.length !== 0 || snapshot.dispatches.length !== 0) return false;
    await createLedgerAnchor({ request, token, repository, expected, tipSha: snapshot.tipSha, document: snapshot.document });
    return true;
  }
  if (snapshot.parentCount !== 1 || !latest || snapshot.parentSha == null) return false;
  const previous = await readGitHubRepairLedgerCommit({
    request,
    token,
    repository,
    tipSha: snapshot.parentSha,
    expected,
  });
  const expectedPreviousAnchor = ledgerAnchorExternalId({
    expected,
    tipSha: previous.tipSha,
    document: previous.document,
  });
  if (latest.external_id !== expectedPreviousAnchor
    || !isSingleAllowedLedgerTransition(previous.document, snapshot.document)) return false;
  await createLedgerAnchor({ request, token, repository, expected, tipSha: snapshot.tipSha, document: snapshot.document });
  return true;
}

async function assertLedgerAnchor({ request, token, repository, expected, snapshot }) {
  const checks = await listAppChecks({
    request,
    token,
    repository,
    headSha: expected.baseSha,
    name: "ChangePlane / repair ledger",
    appId: expected.appId,
  });
  const prefix = `changeplane:repair-ledger:v3:${expected.pullRequestId}:g${expected.generation}:`;
  const latest = checks.find((check) => typeof check.external_id === "string" && check.external_id.startsWith(prefix));
  if (!snapshot.tipSha) {
    if (latest) throw new Error("Repair ledger reference was deleted after an App-authored anchor");
    return;
  }
  const expectedExternalId = ledgerAnchorExternalId({ expected, tipSha: snapshot.tipSha, document: snapshot.document });
  if (latest?.external_id !== expectedExternalId) {
    if (await reconcileMissingLedgerAnchor({ request, token, repository, expected, snapshot, latest })) return;
    throw new Error("Repair ledger tip does not match the latest App-authored anchor");
  }
}

async function createLedgerAnchor({ request, token, repository, expected, tipSha, document }) {
  const externalId = ledgerAnchorExternalId({ expected, tipSha, document });
  await request(`/repos/${encodedRepository(repository)}/check-runs`, token, {
    method: "POST",
    body: {
      name: "ChangePlane / repair ledger",
      head_sha: expected.baseSha,
      status: "completed",
      conclusion: "neutral",
      external_id: externalId,
      output: {
        title: "App-authored repair ledger anchor",
        summary: `PR #${expected.pullRequestNumber} · generation ${expected.generation} · tip ${tipSha}`,
      },
    },
  });
  return externalId;
}

async function ensureGrantCheck({ request, token, candidate, envelope }) {
  const grantDigest = repairLedgerEntryDigest(envelope);
  const externalId = `changeplane:repair-grant:v3:${candidate.authorizationId}:${grantDigest}`;
  const checks = await listAppChecks({
    request,
    token,
    repository: candidate.repository,
    headSha: candidate.headSha,
    name: "ChangePlane / repair grant",
    appId: candidate.appId,
  });
  if (checks.some((check) => check.external_id === externalId)) return externalId;
  await request(`/repos/${encodedRepository(candidate.repository)}/check-runs`, token, {
    method: "POST",
    body: {
      name: "ChangePlane / repair grant",
      head_sha: candidate.headSha,
      status: "completed",
      conclusion: "neutral",
      external_id: externalId,
      output: {
        title: `Bounded repair attempt ${envelope.entry.attempt} of ${envelope.entry.maxAttempts}`,
        summary: `Exact head ${candidate.headSha} · deadline ${envelope.entry.deadlineAt} · model may propose; ChangePlane still decides.`,
      },
    },
  });
  return externalId;
}

async function appendStateTransition({ request, token, repository, reference, expected, snapshot, document, message }) {
  const encoded = encodedRepository(repository);
  const blob = await request(`/repos/${encoded}/git/blobs`, token, {
    method: "POST",
    body: { content: `${canonicalJson(document)}\n`, encoding: "utf-8" },
  });
  const tree = await request(`/repos/${encoded}/git/trees`, token, {
    method: "POST",
    body: { tree: [{ path: "ledger.json", mode: "100644", type: "blob", sha: blob?.sha }] },
  });
  if (!validSha(blob?.sha) || !validSha(tree?.sha) || !snapshot.tipSha) {
    throw new Error("Repair ledger transition cannot be persisted");
  }
  const commit = await request(`/repos/${encoded}/git/commits`, token, {
    method: "POST",
    body: { message, tree: tree.sha, parents: [snapshot.tipSha] },
  });
  if (!validSha(commit?.sha)) throw new Error("GitHub returned an invalid repair ledger transition commit");
  await request(`/repos/${encoded}/git/refs/${encodedPath(reference.replace(/^refs\//u, ""))}`, token, {
    method: "PATCH",
    body: { sha: commit.sha, force: false },
  });
  await createLedgerAnchor({ request, token, repository, expected, tipSha: commit.sha, document });
  return { ...snapshot, document, envelopes: document.envelopes, claims: document.claims, dispatches: document.dispatches, parentSha: snapshot.tipSha, tipSha: commit.sha };
}

async function assertLiveGrantHead({ request, token, candidate }) {
  const pull = await request(
    `/repos/${encodedRepository(candidate.repository)}/pulls/${candidate.pullRequestNumber}`,
    token,
  );
  if (pull?.state !== "open" || pull.base?.ref !== candidate.baseRef || pull.base?.sha !== candidate.baseSha
    || pull.head?.sha !== candidate.headSha || pull.head?.ref !== candidate.headRef
    || pull.head?.repo?.full_name !== candidate.repository) {
    throw new Error("Pull-request head changed after repair authorization; dispatch refused");
  }
}

export async function publishTrustedRepair({
  controllerRequest,
  appId,
  privateKey,
  publisherReleaseSha,
  generation,
  enabled,
  expectedRepository,
  request,
  now = new Date(),
}) {
  const input = validateControllerRequest(controllerRequest);
  if (enabled !== true) throw new Error("Repair dispatch kill switch is off");
  if (!validPositiveInteger(generation)) throw new Error("Repair generation is invalid");
  const key = normalizedPrivateKey(privateKey);
  const installationToken = await createInstallationAccessToken({
    appId,
    privateKey: key,
    installationId: input.change.installationId,
    repositoryId: input.change.repositoryId,
    request,
    now: new Date(now).getTime(),
  });
  const candidate = await buildTrustedRepairCandidate({
    controllerRequest: input,
    installationToken,
    appId,
    publisherReleaseSha,
    request,
    expectedRepository,
  });
  const keyId = repairLedgerKeyId(createPublicKey(key));
  const publicKeys = { [keyId]: repairLedgerPublicKeyValue(createPublicKey(key)) };
  const reference = repairLedgerReference({ pullRequestId: candidate.pullRequestId, generation });
  const expected = {
    appId: candidate.appId,
    installationId: candidate.installationId,
    repositoryId: candidate.repositoryId,
    repository: candidate.repository,
    pullRequestId: candidate.pullRequestId,
    pullRequestNumber: candidate.pullRequestNumber,
    contractDigest: candidate.contractDigest,
    generation,
    baseSha: candidate.baseSha,
    publicKeys,
    now: new Date(now).getTime(),
  };
  let snapshot = await readGitHubRepairLedger({
    request,
    token: installationToken,
    repository: candidate.repository,
    reference,
    expected,
  });
  await assertLedgerAnchor({ request, token: installationToken, repository: candidate.repository, expected, snapshot });
  let envelope = reconciliationEnvelope(snapshot.envelopes, candidate.authorizationId);
  let replayed = Boolean(envelope);
  if (!envelope) {
    try {
      const issued = await issueRepairGrant({
        ledger: snapshot.envelopes,
        candidate,
        privateKey: key,
        publicKeys,
        generation,
        enabled,
        publishEntry: async (nextEnvelope) => {
          const persisted = await appendGitHubRepairLedger({
            request,
            token: installationToken,
            repository: candidate.repository,
            reference,
            expected,
            snapshot,
            envelope: nextEnvelope,
          });
          await createLedgerAnchor({
            request,
            token: installationToken,
            repository: candidate.repository,
            expected,
            tipSha: persisted.tipSha,
            document: persisted.document,
          });
        },
        readEntries: async () => {
          const persisted = await readGitHubRepairLedger({
            request,
            token: installationToken,
            repository: candidate.repository,
            reference,
            expected,
          });
          await assertLedgerAnchor({ request, token: installationToken, repository: candidate.repository, expected, snapshot: persisted });
          return persisted.envelopes;
        },
        now,
      });
      envelope = issued.envelope;
    } catch (error) {
      if (error?.status !== 409 && error?.status !== 422) throw error;
      snapshot = await readGitHubRepairLedger({
        request,
        token: installationToken,
        repository: candidate.repository,
        reference,
        expected,
      });
      await assertLedgerAnchor({ request, token: installationToken, repository: candidate.repository, expected, snapshot });
      envelope = reconciliationEnvelope(snapshot.envelopes, candidate.authorizationId);
      if (!envelope) throw new Error("Repair ledger compare-and-swap lost to a different authorization");
      replayed = true;
    }
  }
  const entry = verifyRepairLedgerEnvelope(envelope, publicKeys, {
    now: new Date(now).getTime(),
    expectedRepository: candidate.repository,
    expectedPullRequestNumber: candidate.pullRequestNumber,
    expectedContractDigest: candidate.contractDigest,
    expectedGeneration: generation,
    expectedHeadSha: candidate.headSha,
    expectedBaseRef: candidate.baseRef,
    expectedControllerSha: candidate.controllerSha,
  });
  if (entry.authorizationId !== candidate.authorizationId || entry.inputDigest !== candidate.inputDigest
    || entry.attempt !== candidate.attempt) {
    throw new Error("Persisted repair authorization does not match this request");
  }
  snapshot = await readGitHubRepairLedger({
    request,
    token: installationToken,
    repository: candidate.repository,
    reference,
    expected,
  });
  await assertLedgerAnchor({ request, token: installationToken, repository: candidate.repository, expected, snapshot });
  await ensureGrantCheck({ request, token: installationToken, candidate, envelope });
  await assertLiveGrantHead({ request, token: installationToken, candidate });
  let dispatch = snapshot.dispatches.find((item) => item.authorizationId === entry.authorizationId);
  let reservedByThisInvocation = false;
  if (!dispatch) {
    const reservation = signLedgerTransition("dispatch", {
      authorizationId: entry.authorizationId,
      grantDigest: repairLedgerEntryDigest(envelope),
      reservedAt: new Date(now).toISOString(),
    }, key);
    const document = ledgerDocument({ ...snapshot.document, dispatches: [...snapshot.dispatches, reservation] });
    try {
      snapshot = await appendStateTransition({
        request,
        token: installationToken,
        repository: candidate.repository,
        reference,
        expected,
        snapshot,
        document,
        message: `ChangePlane repair dispatch reservation ${entry.authorizationId.slice(0, 12)}`,
      });
      dispatch = reservation;
      reservedByThisInvocation = true;
    } catch (error) {
      if (error?.status !== 409 && error?.status !== 422) throw error;
      snapshot = await readGitHubRepairLedger({ request, token: installationToken, repository: candidate.repository, reference, expected });
      await assertLedgerAnchor({ request, token: installationToken, repository: candidate.repository, expected, snapshot });
      dispatch = snapshot.dispatches.find((item) => item.authorizationId === entry.authorizationId);
      if (!dispatch || dispatch.grantDigest !== reservation.grantDigest) {
        throw new Error("Repair dispatch state compare-and-swap lost to another transition");
      }
    }
  }
  let dispatched = false;
  if (reservedByThisInvocation) {
    await assertLiveGrantHead({ request, token: installationToken, candidate });
    await request(`/repos/${encodedRepository(candidate.repository)}/dispatches`, installationToken, {
      method: "POST",
      body: { event_type: "changeplane_repair", client_payload: envelope },
      expectJson: false,
    });
    dispatched = true;
  } else if (dispatch) {
    throw new Error("Repair dispatch reservation is already consumed or ambiguous; refusing to redeliver");
  }
  return {
    authorizationId: entry.authorizationId,
    campaignId: entry.campaignId,
    deadlineAt: entry.deadlineAt,
    attempt: entry.attempt,
    grantDigest: repairLedgerEntryDigest(envelope),
    publicKeyId: keyId,
    replayed,
    dispatchReserved: Boolean(dispatch),
    dispatched,
  };
}

export async function claimTrustedRepair({
  claimRequest,
  appId,
  privateKey,
  generation,
  enabled,
  expectedRepository,
  expectedPublisherReleaseSha,
  expectedActorLogin,
  consume = true,
  request,
  now = new Date(),
}) {
  const input = validateClaimRequest(claimRequest);
  const numericAppId = Number(appId);
  if (enabled !== true) throw new Error("Repair dispatch kill switch is off");
  if (typeof consume !== "boolean") throw new TypeError("Repair claim mode is invalid");
  if (!validPositiveInteger(numericAppId) || !validPositiveInteger(generation) || input.generation !== generation) {
    throw new Error("Repair claim publisher identity or generation is invalid");
  }
  if (expectedRepository && input.repository.toLowerCase() !== expectedRepository.toLowerCase()) {
    throw new Error("Repair claim is bound to a different canary repository");
  }
  if (!validSha(expectedPublisherReleaseSha) || typeof expectedActorLogin !== "string" || !expectedActorLogin.endsWith("[bot]")) {
    throw new Error("Repair claim release or App actor is unavailable");
  }
  const key = normalizedPrivateKey(privateKey);
  const publicKey = createPublicKey(key);
  const keyId = repairLedgerKeyId(publicKey);
  const publicKeys = { [keyId]: repairLedgerPublicKeyValue(publicKey) };
  const token = await createInstallationAccessToken({
    appId,
    privateKey: key,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    request,
    now: new Date(now).getTime(),
  });
  const reference = repairLedgerReference({ pullRequestId: input.pullRequestId, generation });
  const expected = {
    appId: numericAppId,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    repository: input.repository,
    pullRequestId: input.pullRequestId,
    pullRequestNumber: input.pullRequestNumber,
    contractDigest: input.contractDigest,
    generation,
    baseSha: input.baseSha,
    publicKeys,
    now: new Date(now).getTime(),
  };
  let snapshot = await readGitHubRepairLedger({ request, token, repository: input.repository, reference, expected });
  await assertLedgerAnchor({ request, token, repository: input.repository, expected, snapshot });
  const envelope = reconciliationEnvelope(snapshot.envelopes, input.authorizationId);
  if (!envelope || repairLedgerEntryDigest(envelope) !== input.grantDigest) {
    throw new Error("Repair claim does not match a persisted signed grant");
  }
  const entry = verifyRepairLedgerEnvelope(envelope, publicKeys, {
    now: new Date(now).getTime(),
    expectedRepository: input.repository,
    expectedPullRequestNumber: input.pullRequestNumber,
    expectedContractDigest: input.contractDigest,
    expectedGeneration: generation,
    expectedBaseRef: envelope.entry.baseRef,
    expectedControllerSha: envelope.entry.controllerSha,
  });
  if (entry.appId !== numericAppId || entry.publisherReleaseSha !== expectedPublisherReleaseSha
    || entry.repositoryId !== input.repositoryId || entry.installationId !== input.installationId
    || entry.pullRequestId !== input.pullRequestId || entry.baseSha !== input.baseSha
    || entry.authorizationId !== input.authorizationId) {
    throw new Error("Repair claim identity does not match the signed grant");
  }
  const [run, pull] = await Promise.all([
    request(`/repos/${encodedRepository(input.repository)}/actions/runs/${input.workflowRunId}`, token),
    request(`/repos/${encodedRepository(input.repository)}/pulls/${input.pullRequestNumber}`, token),
  ]);
  const workflowPath = typeof run?.path === "string" ? run.path.split("@")[0] : "";
  if (run?.id !== input.workflowRunId || run?.run_attempt !== input.workflowRunAttempt
    || run?.event !== "repository_dispatch" || run?.head_sha !== entry.controllerSha
    || run?.repository?.id !== input.repositoryId
    || run?.actor?.login !== expectedActorLogin || run?.triggering_actor?.login !== expectedActorLogin
    || workflowPath !== ".github/workflows/changeplane-repair.yml"
    || !["queued", "in_progress"].includes(run?.status)) {
    throw new Error("Repair claim workflow run is not the trusted exact-controller dispatch");
  }
  if (pull?.id !== input.pullRequestId || pull?.number !== input.pullRequestNumber || pull?.state !== "open"
    || pull.base?.ref !== entry.baseRef || pull.base?.sha !== entry.baseSha
    || pull.head?.sha !== entry.headSha || pull.head?.ref !== entry.headRef
    || pull.head?.repo?.full_name !== entry.repository) {
    throw new Error("Repair claim no longer matches the live pull-request revision");
  }
  const existing = snapshot.claims.find((claim) => claim.authorizationId === input.authorizationId);
  if (existing) {
    if (!consume && existing.workflowRunId === input.workflowRunId
      && existing.workflowRunAttempt === input.workflowRunAttempt
      && existing.grantDigest === input.grantDigest) {
      return { valid: true, authorizationId: input.authorizationId, deadlineAt: entry.deadlineAt };
    }
    throw new Error("Repair grant was already claimed");
  }
  if (!consume) throw new Error("Repair grant has not been claimed");
  const claim = signLedgerTransition("claim", {
    authorizationId: input.authorizationId,
    grantDigest: input.grantDigest,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
    claimedAt: new Date(now).toISOString(),
  }, key);
  const document = ledgerDocument({ ...snapshot.document, claims: [...snapshot.claims, claim] });
  try {
    snapshot = await appendStateTransition({
      request,
      token,
      repository: input.repository,
      reference,
      expected,
      snapshot,
      document,
      message: `ChangePlane repair claim ${input.authorizationId.slice(0, 12)}`,
    });
  } catch (error) {
    if (error?.status !== 409 && error?.status !== 422) throw error;
    snapshot = await readGitHubRepairLedger({ request, token, repository: input.repository, reference, expected });
    await assertLedgerAnchor({ request, token, repository: input.repository, expected, snapshot });
    throw new Error("Repair grant claim compare-and-swap was lost; authorization burned");
  }
  return { claimed: true, replayed: false, authorizationId: input.authorizationId, deadlineAt: entry.deadlineAt };
}

export async function validateTrustedRepair(options) {
  return claimTrustedRepair({ ...options, consume: false });
}
