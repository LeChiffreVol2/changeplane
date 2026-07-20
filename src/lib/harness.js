import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const HARNESS_MODE = Object.freeze({
  OBSERVE: "observe",
  AUTONOMOUS: "autonomous",
});

export const HARNESS_MAX_ATTEMPTS = 2;
export const HARNESS_BUDGET_MINUTES = 15;

export function harnessPolicy(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The harness policy must be an object.");
  }
  const mode = value.mode ?? HARNESS_MODE.OBSERVE;
  if (!Object.values(HARNESS_MODE).includes(mode)) {
    throw new TypeError("The harness mode must be observe or autonomous.");
  }
  const maxAttempts = value.maxAttempts ?? HARNESS_MAX_ATTEMPTS;
  const budgetMinutes = value.budgetMinutes ?? HARNESS_BUDGET_MINUTES;
  if (maxAttempts !== HARNESS_MAX_ATTEMPTS || budgetMinutes !== HARNESS_BUDGET_MINUTES) {
    throw new TypeError("The autonomous harness is fixed at two attempts within 15 minutes.");
  }
  return { mode, maxAttempts, budgetMinutes };
}

export function actionHarnessConfig(policy) {
  const harness = harnessPolicy(policy?.harness);
  return {
    mode: harness.mode === HARNESS_MODE.AUTONOMOUS ? "enforce" : "observe",
    dispatch: harness.mode === HARNESS_MODE.AUTONOMOUS ? "webhook" : "none",
    maxAttempts: harness.maxAttempts,
  };
}

function runCli() {
  const policyPath = process.env.CHANGEPLANE_TRUSTED_POLICY || ".changeplane.json";
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is unavailable.");
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    throw new Error("The trusted ChangePlane policy is missing or invalid.");
  }
  const config = actionHarnessConfig(policy);
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `mode=${config.mode}`,
    `dispatch=${config.dispatch}`,
    `max_attempts=${config.maxAttempts}`,
    "",
  ].join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Harness policy failed.");
    process.exitCode = 1;
  }
}
