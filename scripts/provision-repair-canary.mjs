import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

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
const REPOSITORY = "LeChiffreVol2/changeplane-disposable-canary-20260719";
const REPOSITORY_ID = 1_305_203_396;
const INSTALLATION_ID = 147_492_050;

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
  return response.status === 204 ? null : response.json();
}

async function putEncryptedSecret({ name, value, token }) {
  const publicKey = await github(`/repos/${REPOSITORY}/actions/secrets/public-key`, token);
  await sodium.ready;
  const source = sodium.from_string(value);
  const key = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
  const encrypted = sodium.crypto_box_seal(source, key);
  try {
    await github(`/repos/${REPOSITORY}/actions/secrets/${name}`, token, {
      method: "PUT",
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

async function upsertVariable(name, value, token) {
  const path = `/repos/${REPOSITORY}/actions/variables/${name}`;
  const response = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "changeplane-canary-provisioner/1",
      "x-github-api-version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) {
    await github(`/repos/${REPOSITORY}/actions/variables`, token, {
      method: "POST",
      body: { name, value },
    });
    return;
  }
  if (!response.ok) throw new Error(`GitHub GET ${path} failed (${response.status})`);
  await github(path, token, { method: "PATCH", body: { name, value } });
}

async function main() {
  const appId = process.env.CHANGEPLANE_GITHUB_APP_ID;
  if (appId !== "4334716") throw new Error("CHANGEPLANE_GITHUB_APP_ID does not match the canary App");
  const privateKey = createPrivateKey(readSecretFile("CHANGEPLANE_GITHUB_APP_PRIVATE_KEY_PATH"));
  const controllerSecret = readSecretFile("CHANGEPLANE_CONTROLLER_SECRET_PATH");
  const appJwt = createGitHubAppJwt({ appId, privateKey });
  const installation = await github(`/app/installations/${INSTALLATION_ID}/access_tokens`, appJwt, {
    method: "POST",
    body: {
      repository_ids: [REPOSITORY_ID],
      permissions: {
        secrets: "write",
        variables: "write",
      },
    },
  });
  if (installation.repositories?.length !== 1 || installation.repositories[0]?.id !== REPOSITORY_ID) {
    throw new Error("GitHub did not return the exact disposable repository scope");
  }
  const repository = await github(`/repositories/${REPOSITORY_ID}`, installation.token);
  if (repository.full_name !== REPOSITORY || repository.archived || repository.disabled) {
    throw new Error("Disposable repository identity or state changed");
  }

  const repositorySecret = deriveControllerSecret({
    masterSecret: controllerSecret,
    installationId: INSTALLATION_ID,
    repositoryId: REPOSITORY_ID,
    repository: REPOSITORY,
  });
  const publicKey = createPublicKey(privateKey);
  const keyId = repairLedgerKeyId(publicKey);
  const publicKeys = JSON.stringify({ [keyId]: repairLedgerPublicKeyValue(publicKey) });

  // Make every partial provisioning state inert before writing any secret.
  await upsertVariable("CHANGEPLANE_REPAIR_ENABLED", "false", installation.token);
  await upsertVariable("CHANGEPLANE_CONTROLLER_INSTALLATION_ID", String(INSTALLATION_ID), installation.token);
  await upsertVariable("CHANGEPLANE_REPAIR_GENERATION", "1", installation.token);
  await upsertVariable("CHANGEPLANE_REPAIR_PUBLIC_KEYS", publicKeys, installation.token);

  await putEncryptedSecret({ name: "CHANGEPLANE_CONTROLLER_HMAC", value: repositorySecret, token: installation.token });
  const deepSeekPath = process.env.CHANGEPLANE_DEEPSEEK_KEY_PATH;
  if (deepSeekPath) {
    await putEncryptedSecret({ name: "DEEPSEEK_API_KEY", value: readSecretFile("CHANGEPLANE_DEEPSEEK_KEY_PATH"), token: installation.token });
  }

  process.stdout.write(JSON.stringify({
    repository: REPOSITORY,
    installationId: INSTALLATION_ID,
    keyId,
    controllerSecretStored: true,
    deepSeekStored: Boolean(deepSeekPath),
    repairEnabled: false,
  }));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Canary provisioning failed"}\n`);
  process.exitCode = 1;
});
