import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  repairLedgerEntryDigest,
  verifyRepairLedgerEnvelope,
} from "../server/repair-ledger.js";

function requiredInteger(value, name) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(name + " is unavailable.");
  return result;
}

function publicKeyRing(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("ChangePlane repair public keys are unavailable.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype) {
    throw new Error("ChangePlane repair public keys are invalid.");
  }
  return parsed;
}

export function verifyRepairGrantEnvironment({
  event,
  enabled,
  generation,
  publicKeys,
  repository,
  baseRef,
  controllerSha,
  expectedDigest,
  now = Date.now(),
}) {
  if (enabled !== "true") throw new Error("ChangePlane repair is disabled.");
  const expectedGeneration = requiredInteger(generation, "ChangePlane repair generation");
  const entry = verifyRepairLedgerEnvelope(event?.client_payload, publicKeyRing(publicKeys), {
    now,
    expectedRepository: repository,
    expectedGeneration,
    expectedBaseRef: baseRef,
    expectedControllerSha: controllerSha,
  });
  const grantDigest = repairLedgerEntryDigest(event.client_payload);
  if (expectedDigest && grantDigest !== expectedDigest) {
    throw new Error("The verified repair grant changed between jobs.");
  }
  return {
    authorizationId: entry.authorizationId,
    baseRef: entry.baseRef,
    baseSha: entry.baseSha,
    claimName: "changeplane-claim-" + entry.authorizationId,
    deadlineAt: entry.deadlineAt,
    grantDigest,
    headRef: entry.headRef,
    headSha: entry.headSha,
    pullRequestNumber: entry.pullRequestNumber,
    repairKind: entry.repairKind,
    repository: entry.repository,
  };
}

function outputName(name) {
  return name.replace(/[A-Z]/gu, (character) => "-" + character.toLowerCase());
}

function runCli() {
  if (process.argv[2] !== "verify") throw new Error("Expected verify operation.");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const result = verifyRepairGrantEnvironment({
    event,
    enabled: process.env.CHANGEPLANE_REPAIR_ENABLED,
    generation: process.env.CHANGEPLANE_REPAIR_GENERATION,
    publicKeys: process.env.CHANGEPLANE_REPAIR_PUBLIC_KEYS,
    repository: process.env.GITHUB_REPOSITORY,
    baseRef: process.env.CHANGEPLANE_BASE_REF,
    controllerSha: process.env.CHANGEPLANE_CONTROLLER_SHA,
    expectedDigest: process.env.CHANGEPLANE_EXPECTED_GRANT_DIGEST,
  });
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is unavailable.");
  for (const [name, value] of Object.entries(result)) {
    appendFileSync(outputPath, outputName(name) + "=" + value + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Repair grant verification failed.");
    process.exitCode = 1;
  }
}
