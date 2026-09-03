import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import sodium from "libsodium-wrappers";

import {
  createGitHubAppJwt,
  deriveControllerSecret,
} from "../server/github-repair-controller.js";
import {
  repairLedgerKeyId,
  repairLedgerPublicKeyValue,
} from "../server/repair-ledger.js";
import { githubRulesetReadiness } from "../src/lib/github-ruleset-readiness.js";

const API = "https://api.github.com";
const MANAGED_REPAIR_ACTIVATION = "managed-v12";
const GUARD_CHECK_NAME = "ChangePlane / guard";

export function parseCanaryEvidenceChecks(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("CHANGEPLANE_CANARY_EVIDENCE_CHECKS_JSON must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new Error("CHANGEPLANE_CANARY_EVIDENCE_CHECKS_JSON must contain 1 to 100 evidence Check bindings");
  }
  const names = new Set();
  for (const check of parsed) {
    if (check === null || typeof check !== "object" || Array.isArray(check)
      || Object.keys(check).length !== 2
      || typeof check.name !== "string" || check.name.length === 0 || check.name.trim() !== check.name
      || /[\u0000-\u001f\u007f]/u.test(check.name)
      || check.name === GUARD_CHECK_NAME
      || !Number.isSafeInteger(check.integrationId) || check.integrationId < 1
      || names.has(check.name)) {
      throw new Error("CHANGEPLANE_CANARY_EVIDENCE_CHECKS_JSON must bind each unique evidence Check name to one positive integrationId");
    }
    names.add(check.name);
  }
  return parsed;
}

export function validateCanaryRulesets({
  rulesets,
  defaultBranch,
  guardIntegrationId,
  evidenceChecks,
}) {
  const readiness = githubRulesetReadiness(rulesets, {
    defaultBranch,
    guardCheckName: GUARD_CHECK_NAME,
    publisherIntegrationId: guardIntegrationId,
    evidenceChecks,
    repositoryScoped: true,
  });
  if (!readiness.active || !readiness.queueCertified) {
    const state = readiness.assuranceLevel === "strict_head"
      ? "merge_queue_required"
      : readiness.state;
    throw new Error(`Canary activation requires Queue Certified assurance from one complete no-bypass default-branch Ruleset (${state}). ${readiness.nextAction ?? "Review the Ruleset and retry."}`);
  }
  return readiness;
}

export function validateRepairGeneration(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error("CHANGEPLANE_REPAIR_GENERATION must be a positive integer");
  }
  const generation = Number(value);
  if (!Number.isSafeInteger(generation)) {
    throw new Error("CHANGEPLANE_REPAIR_GENERATION must be a positive integer");
  }
  return String(generation);
}

function requiredPath(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.startsWith("/")) throw new Error(`${name} must be an absolute file path`);
  return value;
}

function readSecretFile(name) {
  const value = readFileSync(requiredPath(name), "utf8").trim();
  if (!value) throw new Error(`${name} is empty`);
  return value;
}

function requiredPositiveInteger(name) {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function requiredRepository() {
  const value = process.env.CHANGEPLANE_CANARY_REPOSITORY;
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(value)) {
    throw new Error("CHANGEPLANE_CANARY_REPOSITORY must contain one owner/repository");
  }
  return value;
}

async function github(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "changeplane-canary-provisioner/1",
      "x-github-api-version": "2022-11-28",
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub ${options.method ?? "GET"} ${path} failed (${response.status})`);
  return response.status === 204 || options.expectJson === false ? null : response.json();
}

export function validateInstallationCredential(payload, { repositoryId, permissions }) {
  const now = Date.now();
  const expiresAt = typeof payload?.expires_at === "string" ? Date.parse(payload.expires_at) : Number.NaN;
  const actualPermissions = payload?.permissions;
  const validPermissions = actualPermissions !== null
    && typeof actualPermissions === "object"
    && !Array.isArray(actualPermissions)
    && Object.entries(actualPermissions).every(([name, permission]) => (
      name === "metadata"
        ? permission === "read"
        : Object.hasOwn(permissions, name) && permission === permissions[name]
    ))
    && Object.entries(permissions).every(([name, permission]) => actualPermissions[name] === permission);
  if (typeof payload?.token !== "string" || !payload.token || payload.token.length > 4_096
    || /[\u0000-\u0020\u007f]/u.test(payload.token)
    || !Array.isArray(payload?.repositories) || payload.repositories.length !== 1
    || payload.repositories[0]?.id !== repositoryId
    || !validPermissions
    || !Number.isFinite(expiresAt) || expiresAt <= now
    || expiresAt > now + (65 * 60 * 1_000)) {
    throw new Error("GitHub returned an invalid exact-repository installation credential");
  }
  return payload.token;
}

async function mintInstallationCredential({ appJwt, installationId, repositoryId, permissions }) {
  const payload = await github(`/app/installations/${installationId}/access_tokens`, appJwt, {
    method: "POST",
    body: { repository_ids: [repositoryId], permissions },
  });
  return validateInstallationCredential(payload, { repositoryId, permissions });
}

export async function putEncryptedSecret({ name, value, token, repository }) {
  const publicKey = await github(`/repos/${repository}/actions/secrets/public-key`, token);
  await sodium.ready;
  const source = sodium.from_string(value);
  const key = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
  const encrypted = sodium.crypto_box_seal(source, key);
  try {
    await github(`/repos/${repository}/actions/secrets/${name}`, token, {
      method: "PUT",
      expectJson: false,
      body: {
        encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL),
        key_id: publicKey.key_id,
      },
    });
  } finally {
    sodium.memzero(source);
    sodium.memzero(key);
    sodium.memzero(encrypted);
  }
}

async function requireEligibleCanary({
  repository,
  repositoryId,
  adminToken,
  installationToken,
  guardIntegrationId,
  evidenceChecks,
}) {
  const adminRepository = await github(`/repos/${repository}`, adminToken);
  if (adminRepository.id !== repositoryId || adminRepository.full_name !== repository
    || adminRepository.permissions?.admin !== true) {
    throw new Error("Canary provisioning requires a current repository administrator");
  }
  const liveRepository = await github(`/repositories/${repositoryId}`, installationToken);
  if (liveRepository.full_name !== repository || liveRepository.archived || liveRepository.disabled
    || typeof liveRepository.default_branch !== "string" || !liveRepository.default_branch) {
    throw new Error("Canary requires the exact active repository and default branch");
  }
  const summaries = await github(
    `/repos/${repository}/rulesets?includes_parents=true&per_page=100`,
    installationToken,
  );
  if (!Array.isArray(summaries) || summaries.length > 25) {
    throw new Error("Canary activation requires an unambiguous Ruleset inventory");
  }
  const rulesetIds = summaries.map(({ id }) => id);
  if (rulesetIds.some((id) => !Number.isSafeInteger(id) || id < 1)
    || new Set(rulesetIds).size !== rulesetIds.length) {
    throw new Error("Canary activation requires valid GitHub Ruleset identities");
  }
  const rulesets = await Promise.all(rulesetIds.map((id) => (
    github(`/repos/${repository}/rulesets/${id}`, installationToken)
  )));
  validateCanaryRulesets({
    rulesets,
    defaultBranch: liveRepository.default_branch,
    guardIntegrationId,
    evidenceChecks,
  });
  return liveRepository;
}

export async function provisionRepairCanary({ writeOutput = (value) => process.stdout.write(value) } = {}) {
  const appId = String(requiredPositiveInteger("CHANGEPLANE_GITHUB_APP_ID"));
  const guardIntegrationId = requiredPositiveInteger("CHANGEPLANE_GUARD_APP_ID");
  const evidenceChecks = parseCanaryEvidenceChecks(process.env.CHANGEPLANE_CANARY_EVIDENCE_CHECKS_JSON);
  const repository = requiredRepository();
  const repositoryId = requiredPositiveInteger("CHANGEPLANE_CANARY_REPOSITORY_ID");
  const installationId = requiredPositiveInteger("CHANGEPLANE_CANARY_INSTALLATION_ID");
  const repairGeneration = validateRepairGeneration(process.env.CHANGEPLANE_REPAIR_GENERATION);
  const privateKey = createPrivateKey(readSecretFile("CHANGEPLANE_GITHUB_APP_PRIVATE_KEY_PATH"));
  const adminToken = readSecretFile("CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH");
  const controllerSecret = readSecretFile("CHANGEPLANE_CONTROLLER_SECRET_PATH");
  const appJwt = createGitHubAppJwt({ appId, privateKey });
  const readToken = await mintInstallationCredential({
    appJwt,
    installationId,
    repositoryId,
    permissions: { administration: "read" },
  });
  const eligibility = {
    repository,
    repositoryId,
    adminToken,
    installationToken: readToken,
    guardIntegrationId,
    evidenceChecks,
  };
  await requireEligibleCanary(eligibility);
  const secretsToken = await mintInstallationCredential({
    appJwt,
    installationId,
    repositoryId,
    permissions: { secrets: "write" },
  });

  const repositorySecret = deriveControllerSecret({
    masterSecret: controllerSecret,
    installationId,
    repositoryId,
    repository,
  });
  const publicKey = createPublicKey(privateKey);
  const keyId = repairLedgerKeyId(publicKey);
  const publicKeys = JSON.stringify({ [keyId]: repairLedgerPublicKeyValue(publicKey) });

  const openAIPath = process.env.CHANGEPLANE_OPENAI_KEY_PATH;
  const enableRepair = process.env.CHANGEPLANE_ENABLE_REPAIR === "true";
  if (enableRepair && !openAIPath) throw new Error("CHANGEPLANE_OPENAI_KEY_PATH is required before enabling repair");

  // Make every partial provisioning state inert before writing any authority or provider secret.
  await putEncryptedSecret({ name: "CHANGEPLANE_REPAIR_ENABLED", value: "false", token: secretsToken, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_CONTROLLER_HMAC", value: "retired-by-managed-v12", token: secretsToken, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_CONTROLLER_INSTALLATION_ID", value: String(installationId), token: secretsToken, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_REPAIR_GENERATION", value: repairGeneration, token: secretsToken, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_REPAIR_PUBLIC_KEYS", value: publicKeys, token: secretsToken, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_CONTROLLER_HMAC_V12", value: repositorySecret, token: secretsToken, repository });
  if (openAIPath) {
    await putEncryptedSecret({ name: "OPENAI_API_KEY", value: readSecretFile("CHANGEPLANE_OPENAI_KEY_PATH"), token: secretsToken, repository });
  }
  if (enableRepair) {
    await requireEligibleCanary(eligibility);
    await putEncryptedSecret({ name: "CHANGEPLANE_REPAIR_ENABLED", value: MANAGED_REPAIR_ACTIVATION, token: secretsToken, repository });
  }

  writeOutput(JSON.stringify({
    repository,
    installationId,
    repairGeneration,
    keyId,
    controllerSecretStored: true,
    openAIStored: Boolean(openAIPath),
    repairEnabled: enableRepair,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provisionRepairCanary().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Canary provisioning failed"}\n`);
    process.exitCode = 1;
  });
}
