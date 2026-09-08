import assert from "node:assert/strict";
import test from "node:test";

import {
  REVISION_STAGE_STATE,
  SDLC_POSTURE,
  SDLC_STAGE_STATE,
  buildRevisionSdlcAssurance,
  buildSdlcAssurance,
} from "./sdlc-assurance.js";

function stage(view, id) {
  return view.stages.find((item) => item.id === id);
}

const activeEnforcement = Object.freeze({
  active: true,
  strict: true,
  mergeQueueRequired: true,
  guardRequired: true,
  publisherBound: true,
  evidenceRequired: true,
  evidencePublisherBound: true,
});
const INITIAL_HEAD = "71b04c2e8a5d3101cce89d4f0a0b13273f2b631d";
const REPAIRED_HEAD = "9fc82a1b650d7a77340588f1b04f8ca4e788e7a2";

test("an uninstalled repository cannot project any ChangePlane-controlled SDLC checkpoint", () => {
  const view = buildSdlcAssurance({
    installed: false,
    managedProfile: "full",
    harnessMode: "autonomous",
    requiredCheckCount: 1,
    enforcement: activeEnforcement,
    autonomousReady: true,
  });
  assert.equal(view.posture, SDLC_POSTURE.SETUP_REQUIRED);
  assert.equal(view.stages.some(({ state }) => state === SDLC_STAGE_STATE.CONTROLLED), false);
  assert.equal(view.authority.contributesToPass, false);
});

test("Observe remains scope-only even when GitHub enforcement input appears active", () => {
  const view = buildSdlcAssurance({
    installed: true,
    managedProfile: "verify-lite",
    harnessMode: "observe",
    requiredCheckCount: 1,
    enforcement: activeEnforcement,
  });
  assert.equal(view.posture, SDLC_POSTURE.SCOPE_ONLY);
  assert.equal(stage(view, "verify").state, SDLC_STAGE_STATE.SCOPE_ONLY);
  assert.equal(stage(view, "release").state, SDLC_STAGE_STATE.ACTION_REQUIRED);
});

test("Verify Lite distinguishes behavioral readiness from live GitHub merge enforcement", () => {
  const ready = buildSdlcAssurance({
    installed: true,
    managedProfile: "verify-lite",
    harnessMode: "verify",
    requiredCheckCount: 1,
    enforcement: { ...activeEnforcement, active: false },
  });
  assert.equal(ready.posture, SDLC_POSTURE.VERIFICATION_READY);
  assert.equal(stage(ready, "verify").state, SDLC_STAGE_STATE.CONTROLLED);
  assert.equal(stage(ready, "release").state, SDLC_STAGE_STATE.ACTION_REQUIRED);

  const active = buildSdlcAssurance({
    installed: true,
    managedProfile: "verify-lite",
    harnessMode: "verify",
    requiredCheckCount: 1,
    enforcement: activeEnforcement,
  });
  assert.equal(active.posture, SDLC_POSTURE.MERGE_GATE_ACTIVE);
  assert.equal(stage(active, "release").state, SDLC_STAGE_STATE.CONTROLLED);
  assert.equal(active.authority.merge, "github");
});

test("malformed enforcement fails closed and Full autonomy stays inactive", () => {
  const view = buildSdlcAssurance({
    installed: true,
    managedProfile: "full",
    harnessMode: "autonomous",
    requiredCheckCount: 1,
    enforcement: { active: true, strict: true, guardRequired: true },
    autonomousReady: true,
  });
  assert.equal(view.posture, SDLC_POSTURE.AUTONOMY_ACTIVATION_REQUIRED);
  assert.equal(stage(view, "release").state, SDLC_STAGE_STATE.ACTION_REQUIRED);
  assert.equal(view.repairLoop.mode, "activation_required");
});

test("Strict Head activates the merge gate without granting queue or repair readiness", () => {
  const inputs = {
    installed: true,
    managedProfile: "verify-lite",
    harnessMode: "verify",
    requiredCheckCount: 1,
    enforcement: { ...activeEnforcement, mergeQueueRequired: false },
  };
  const strict = buildSdlcAssurance(inputs);
  assert.equal(strict.posture, SDLC_POSTURE.MERGE_GATE_ACTIVE);
  assert.equal(stage(strict, "release").state, SDLC_STAGE_STATE.CONTROLLED);
  assert.match(stage(strict, "release").proof, /Strict Head is active/u);
  const autonomous = buildSdlcAssurance({ ...inputs, managedProfile: "full", harnessMode: "autonomous", autonomousReady: true });
  assert.equal(autonomous.posture, SDLC_POSTURE.AUTONOMY_ACTIVATION_REQUIRED);
  assert.equal(autonomous.repairLoop.mode, "activation_required");
  for (const mergeQueueRequired of [null, undefined, "false", 0]) {
    assert.equal(buildSdlcAssurance({ ...inputs, enforcement: { ...inputs.enforcement, mergeQueueRequired } }).posture, SDLC_POSTURE.VERIFICATION_READY);
  }
});

test("bounded autonomy activates only when every existing prerequisite is already true", () => {
  const view = buildSdlcAssurance({
    installed: true,
    managedProfile: "full",
    harnessMode: "autonomous",
    requiredCheckCount: 1,
    enforcement: activeEnforcement,
    autonomousReady: true,
  });
  assert.equal(view.posture, SDLC_POSTURE.BOUNDED_AUTONOMY_ACTIVE);
  assert.equal(view.repairLoop.mode, "bounded_autonomous");
  assert.equal(view.repairLoop.maxAttempts, 2);
  assert.equal(view.authority.modelDecidesPass, false);
  assert.equal(stage(view, "deploy").state, SDLC_STAGE_STATE.SUPPORTED);
  assert.equal(stage(view, "operate").state, SDLC_STAGE_STATE.EXTERNAL);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
});

test("per-revision view omits stale deployment provenance and never upgrades merge authority", () => {
  const view = buildRevisionSdlcAssurance({
    headSha: REPAIRED_HEAD,
    status: "passed",
    previewHeadSha: INITIAL_HEAD,
    reviewHeadSha: INITIAL_HEAD,
    reviewAvailable: true,
    intentHeadSha: REPAIRED_HEAD,
    changeHeadSha: REPAIRED_HEAD,
    evidenceHeadSha: REPAIRED_HEAD,
  });
  assert.equal(stage(view, "verify").state, REVISION_STAGE_STATE.VERIFIED);
  assert.equal(stage(view, "review").state, REVISION_STAGE_STATE.STALE_OMITTED);
  assert.equal(stage(view, "delivery").state, REVISION_STAGE_STATE.STALE_OMITTED);
  assert.equal(stage(view, "merge").state, REVISION_STAGE_STATE.READY_FOR_GITHUB);
  assert.equal(view.authority.merge, "github");
  assert.equal(view.invalidation.aggregateAcrossRevisions, false);
});

test("merge-group projection carries no PR review state and remains guard-only", () => {
  const view = buildRevisionSdlcAssurance({
    targetType: "merge_group",
    headSha: "a".repeat(40),
    status: "passed",
    previewHeadSha: null,
    reviewAvailable: true,
    intentHeadSha: "a".repeat(40),
    changeHeadSha: "a".repeat(40),
    evidenceHeadSha: "a".repeat(40),
  });
  assert.equal(stage(view, "review").state, REVISION_STAGE_STATE.NOT_CARRIED_FORWARD);
  assert.equal(stage(view, "merge").state, REVISION_STAGE_STATE.QUEUE_GUARD_PASSED);
  assert.equal(stage(view, "delivery").state, REVISION_STAGE_STATE.NOT_OBSERVED);
});

test("blocked and running revisions never carry a previous verified state", () => {
  const blocked = buildRevisionSdlcAssurance({
    headSha: "b".repeat(40),
    status: "blocked",
    intentHeadSha: "b".repeat(40),
    changeHeadSha: "b".repeat(40),
  });
  assert.equal(stage(blocked, "verify").state, REVISION_STAGE_STATE.WITHHELD);
  assert.equal(stage(blocked, "merge").state, REVISION_STAGE_STATE.GITHUB_DECIDES);

  const running = buildRevisionSdlcAssurance({
    headSha: "c".repeat(40),
    status: "rechecking",
    intentHeadSha: "c".repeat(40),
    changeHeadSha: "c".repeat(40),
  });
  assert.equal(stage(running, "verify").state, REVISION_STAGE_STATE.VERIFYING);
  assert.equal(stage(running, "delivery").state, REVISION_STAGE_STATE.NOT_OBSERVED);
});

test("revision projection refuses abbreviated SHAs and compares only full revisions", () => {
  assert.throws(
    () => buildRevisionSdlcAssurance({ headSha: "9fc82a1" }),
    /full 40-character/u,
  );
  assert.throws(
    () => buildRevisionSdlcAssurance({
      headSha: REPAIRED_HEAD,
      previewHeadSha: "9fc82a1",
      intentHeadSha: REPAIRED_HEAD,
      changeHeadSha: REPAIRED_HEAD,
      evidenceHeadSha: REPAIRED_HEAD,
    }),
    /full 40-character/u,
  );
});

test("revision projection withholds assurance when receipt-backed intent or change facts are absent", () => {
  const view = buildRevisionSdlcAssurance({ headSha: REPAIRED_HEAD, status: "passed" });
  assert.equal(stage(view, "intent").state, REVISION_STAGE_STATE.NOT_OBSERVED);
  assert.equal(stage(view, "change").state, REVISION_STAGE_STATE.NOT_OBSERVED);
  assert.equal(stage(view, "verify").state, REVISION_STAGE_STATE.WITHHELD);
  assert.equal(stage(view, "merge").state, REVISION_STAGE_STATE.GITHUB_DECIDES);
});

test("revision projection invalidates intent and change facts from a previous full revision", () => {
  const view = buildRevisionSdlcAssurance({
    headSha: REPAIRED_HEAD,
    status: "passed",
    intentHeadSha: INITIAL_HEAD,
    changeHeadSha: INITIAL_HEAD,
    evidenceHeadSha: REPAIRED_HEAD,
  });
  assert.equal(stage(view, "intent").state, REVISION_STAGE_STATE.NOT_OBSERVED);
  assert.equal(stage(view, "change").state, REVISION_STAGE_STATE.NOT_OBSERVED);
  assert.equal(stage(view, "verify").state, REVISION_STAGE_STATE.WITHHELD);
  assert.equal(stage(view, "merge").state, REVISION_STAGE_STATE.GITHUB_DECIDES);
});

test("revision projection never carries a passed evidence result across full revisions", () => {
  const view = buildRevisionSdlcAssurance({
    headSha: REPAIRED_HEAD,
    status: "passed",
    intentHeadSha: REPAIRED_HEAD,
    changeHeadSha: REPAIRED_HEAD,
    evidenceHeadSha: INITIAL_HEAD,
    previewHeadSha: REPAIRED_HEAD,
  });
  assert.equal(stage(view, "verify").state, REVISION_STAGE_STATE.WITHHELD);
  assert.equal(stage(view, "delivery").state, REVISION_STAGE_STATE.NOT_OBSERVED);
  assert.equal(stage(view, "merge").state, REVISION_STAGE_STATE.GITHUB_DECIDES);
});

test("advisory review is shown only when its full revision matches the current head", () => {
  const current = buildRevisionSdlcAssurance({
    headSha: INITIAL_HEAD,
    reviewHeadSha: INITIAL_HEAD,
    reviewAvailable: true,
    intentHeadSha: INITIAL_HEAD,
    changeHeadSha: INITIAL_HEAD,
  });
  assert.equal(stage(current, "review").state, REVISION_STAGE_STATE.ADVISORY);

  const stale = buildRevisionSdlcAssurance({
    headSha: REPAIRED_HEAD,
    reviewHeadSha: INITIAL_HEAD,
    reviewAvailable: true,
    intentHeadSha: REPAIRED_HEAD,
    changeHeadSha: REPAIRED_HEAD,
  });
  assert.equal(stage(stale, "review").state, REVISION_STAGE_STATE.STALE_OMITTED);
});
