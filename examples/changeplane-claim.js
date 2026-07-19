import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { repairLedgerEntryDigest } from "../server/repair-ledger.js";
import {
  claimDeliveryId,
  signClaimRequest,
  validateClaimRequest,
} from "../server/github-repair-controller.js";

function positiveInteger(value, name) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} is unavailable.`);
  return result;
}

function controllerUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password
    || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new Error("The ChangePlane claim endpoint must be a public HTTPS URL.");
  }
  return url;
}

export function buildClaimRequest({ envelope, runId, runAttempt }) {
  const entry = envelope?.entry;
  const request = {
    schemaVersion: 1,
    issuer: "changeplane-repair-worker",
    authorizationId: entry?.authorizationId,
    grantDigest: repairLedgerEntryDigest(envelope),
    repository: entry?.repository,
    repositoryId: entry?.repositoryId,
    installationId: entry?.installationId,
    pullRequestId: entry?.pullRequestId,
    pullRequestNumber: entry?.pullRequestNumber,
    contractDigest: entry?.contractDigest,
    generation: entry?.generation,
    baseSha: entry?.baseSha,
    workflowRunId: positiveInteger(runId, "GITHUB_RUN_ID"),
    workflowRunAttempt: positiveInteger(runAttempt, "GITHUB_RUN_ATTEMPT"),
  };
  return validateClaimRequest(request);
}

export async function authorizeRepairGrant({ operation = "claim", envelope, runId, runAttempt, endpoint, secret, fetchImpl = fetch }) {
  if (!["claim", "validate"].includes(operation)) throw new Error("The ChangePlane authorization operation is invalid.");
  if (typeof secret !== "string" || secret.length < 32) throw new Error("The repository-scoped ChangePlane claim secret is unavailable.");
  const request = buildClaimRequest({ envelope, runId, runAttempt });
  const deliveryId = claimDeliveryId(request);
  const response = await fetchImpl(controllerUrl(endpoint), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-changeplane-delivery": deliveryId,
      "x-changeplane-signature": signClaimRequest({ secret, deliveryId, request }),
    },
    body: JSON.stringify(request),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`ChangePlane refused the repair ${operation} operation (${response.status}).`);
  const result = await response.json();
  const accepted = operation === "claim" ? result?.claimed === true : result?.valid === true;
  if (!accepted || result.authorizationId !== request.authorizationId) {
    throw new Error(`ChangePlane returned an invalid repair ${operation} result.`);
  }
  return result;
}

export async function claimRepairGrant(options) {
  return authorizeRepairGrant({ ...options, operation: "claim" });
}

async function runCli() {
  const operation = process.argv[2];
  if (!["claim", "validate"].includes(operation)) throw new Error("Expected claim or validate operation.");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const result = await authorizeRepairGrant({
    operation,
    envelope: event.client_payload,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    endpoint: process.env.CHANGEPLANE_CLAIM_URL,
    secret: process.env.CHANGEPLANE_CONTROLLER_HMAC,
  });
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is unavailable.");
  appendFileSync(process.env.GITHUB_OUTPUT, `authorization-id=${result.authorizationId}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : "Repair claim failed.");
    process.exitCode = 1;
  });
}
