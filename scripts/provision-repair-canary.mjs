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

const API = "https://api.github.com";
const MANAGED_REPAIR_ACTIVATION = "managed-v12";

export function validateCanaryBranchProtection(requiredChecks) {
  if (requiredChecks?.strict !== true) {
    throw new Error("Canary activation requires strict up-to-date required checks on the default branch");
  }
  return true;
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

async function requireEligibleCanary({ repository, repositoryId, adminToken, installationToken }) {
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
  const requiredChecks = await github(
    `/repos/${repository}/branches/${encodeURIComponent(liveRepository.default_branch)}/protection/required_status_checks`,
    installationToken,
  );
  validateCanaryBranchProtection(requiredChecks);
  return liveRepository;
}

export async function provisionRepairCanary({ writeOutput = (value) => process.stdout.write(value) } = {}) {
  const appId = String(requiredPositiveInteger("CHANGEPLANE_GITHUB_APP_ID"));
  const repository = requiredRepository();
  const repositoryId = requiredPositiveInteger("CHANGEPLANE_CANARY_REPOSITORY_ID");
  const installationId = requiredPositiveInteger("CHANGEPLANE_CANARY_INSTALLATION_ID");
  const repairGeneration = validateRepairGeneration(process.env.CHANGEPLANE_REPAIR_GENERATION);
  const privateKey = createPrivateKey(readSecretFile("CHANGEPLANE_GITHUB_APP_PRIVATE_KEY_PATH"));
  const adminToken = readSecretFile("CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH");
  const controllerSecret = readSecretFile("CHANGEPLANE_CONTROLLER_SECRET_PATH");
  const appJwt = createGitHubAppJwt({ appId, privateKey });
  const installation = await github(`/app/installations/${installationId}/access_tokens`, appJwt, {
    method: "POST",
    body: {
      repository_ids: [repositoryId],
      permissions: {
        administration: "read",
        secrets: "write",
      },
    },
  });
  if (installation.repositories?.length !== 1 || installation.repositories[0]?.id !== repositoryId) {
    throw new Error("GitHub did not return the exact disposable repository scope");
  }
  await requireEligibleCanary({ repository, repositoryId, adminToken, installationToken: installation.token });

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
  await putEncryptedSecret({ name: "CHANGEPLANE_REPAIR_ENABLED", value: "false", token: installation.token, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_CONTROLLER_HMAC", value: "retired-by-managed-v12", token: installation.token, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_CONTROLLER_INSTALLATION_ID", value: String(installationId), token: installation.token, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_REPAIR_GENERATION", value: repairGeneration, token: installation.token, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_REPAIR_PUBLIC_KEYS", value: publicKeys, token: installation.token, repository });
  await putEncryptedSecret({ name: "CHANGEPLANE_CONTROLLER_HMAC_V12", value: repositorySecret, token: installation.token, repository });
  if (openAIPath) {
    await putEncryptedSecret({ name: "OPENAI_API_KEY", value: readSecretFile("CHANGEPLANE_OPENAI_KEY_PATH"), token: installation.token, repository });
  }
  if (enableRepair) {
    await requireEligibleCanary({ repository, repositoryId, adminToken, installationToken: installation.token });
    await putEncryptedSecret({ name: "CHANGEPLANE_REPAIR_ENABLED", value: MANAGED_REPAIR_ACTIVATION, token: installation.token, repository });
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
