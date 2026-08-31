import { decodeGuardRunMarker, encodeGuardRunMarker } from "./github-guard-controller.js";

const CAMPAIGN_WINDOW_MS = 15 * 60 * 1_000;
const RECONCILIATION_WINDOW_MS = 10 * 60 * 1_000;

export function reconcileGuardState({ checkRun, now = new Date().toISOString() } = {}) {
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
  if (currentTime - startedAt <= CAMPAIGN_WINDOW_MS + RECONCILIATION_WINDOW_MS) {
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
        summary: "The latest Evaluation Generation exceeded the 15-minute campaign plus 10-minute reconciliation window. No PASS was issued. Re-run ChangePlane on the same exact revision or inspect the failed workflow.",
        text: encodeGuardRunMarker({
          runId: marker.runId,
          runAttempt: marker.runAttempt,
          phase: "complete",
        }),
      },
    },
  };
}
