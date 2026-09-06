import { decodeGuardRunMarker, encodeGuardRunMarker } from "./github-guard-controller.js";

const CAMPAIGN_WINDOW_MS = 15 * 60 * 1_000;
const RECONCILIATION_WINDOW_MS = 10 * 60 * 1_000;
const VERIFICATION_WINDOW_MS = 5 * 60 * 1_000;

export function reconcileGuardState({ checkRun, trustedHarnessMode = "autonomous", sourceRunCompleted = false, now = new Date().toISOString() } = {}) {
  // Only the controller's authenticated default-branch policy may select the shorter window.
  // Missing mode retains the repair campaign's conservative fallback.
  if (!["observe", "verify", "autonomous"].includes(trustedHarnessMode)) {
    throw new TypeError("Trusted Guard recovery mode is invalid.");
  }
  if (checkRun === null || typeof checkRun !== "object" || Array.isArray(checkRun)
    || !Number.isSafeInteger(checkRun.id) || checkRun.id < 1
    || checkRun.name !== "ChangePlane / guard") {
    throw new TypeError("Guard Check Run is invalid.");
  }
  if (checkRun.status === "completed") {
    return {
      state: "terminal",
      checkRunId: checkRun.id,
      conclusion: checkRun.conclusion ?? null,
      patch: null,
    };
  }
  if (checkRun.status !== "in_progress" || checkRun.conclusion != null) {
    throw new TypeError("Guard Check Run state is invalid.");
  }
  const marker = decodeGuardRunMarker(checkRun.output?.text);
  if (marker.phase !== "begin") throw new TypeError("In-progress Guard marker is invalid.");
  const startedAt = Date.parse(checkRun.started_at);
  const currentTime = Date.parse(now);
  if (!Number.isFinite(startedAt) || !Number.isFinite(currentTime)
    || new Date(currentTime).toISOString() !== now
    || currentTime < startedAt) {
    throw new TypeError("Guard reconciliation time is invalid.");
  }
  const generation = `${marker.runId}.${marker.runAttempt}`;
  // A healthy owning run can still be working after five minutes. Only independently
  // verified completion of that exact run attempt permits the shorter recovery window.
  const earlyRecovery = trustedHarnessMode !== "autonomous" && sourceRunCompleted === true;
  const recoveryWindowMs = earlyRecovery
    ? VERIFICATION_WINDOW_MS
    : CAMPAIGN_WINDOW_MS + RECONCILIATION_WINDOW_MS;
  if (currentTime - startedAt < recoveryWindowMs) {
    return { state: "within_window", checkRunId: checkRun.id, generation, patch: null };
  }
  return {
    state: "reconcile_required",
    checkRunId: checkRun.id,
    generation,
    patch: {
      status: "completed",
      conclusion: "action_required",
      completed_at: now,
      output: {
        title: "Evaluation timed out safely",
        summary: `The latest Evaluation Generation reached the ${earlyRecovery ? "5-minute recovery window after its owning workflow run completed" : "15-minute campaign plus 10-minute reconciliation window"}. No PASS was issued. Re-run ChangePlane on the same exact revision or inspect the failed workflow.`,
        text: encodeGuardRunMarker({
          runId: marker.runId,
          runAttempt: marker.runAttempt,
          phase: "complete",
          boundContractDigest: marker.boundContractDigest ?? null,
          pullRequestNumber: marker.pullRequestNumber ?? null,
        }),
      },
    },
  };
}
