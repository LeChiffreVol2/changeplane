import { createHash } from 'node:crypto';
import { HttpError, GitHubError } from './http-errors.js';
import { GuardPublicationError } from './guard-publication-journal.js';
import { createGitHubAppJwt } from './github-repair-controller.js';
import { compareGuardRunOrder, createChecksWriteInstallationAccessToken,
  createGuardReadInstallationAccessToken, decodeGuardRunMarker, encodeGuardRunMarker,
  guardBoundContractDigest, guardEvaluationPending, stableGuardCheckExternalId,
  validateGuardBeginBody, validateGuardReconciliationBody, validateGuardPublishBody,
  verifyGitHubActionsOidcToken } from './github-guard-controller.js';
import { buildProofLocator, digest as canonicalDigest, verifyAssurancePassportIntegrity } from '../src/lib/assurance-passport.js';
import { HARNESS_MODE, harnessPolicy, githubWorkflowFilePath, validateRequiredChecks } from '../src/lib/harness.js';
import { reconcileGuardState } from './guard-reconciliation.js';
import { createGitHubEvidenceReader } from './github-evidence.js';

const GUARD_CHECK_NAME = 'ChangePlane / guard';
const POLICY_PATH = '.changeplane.json';
const encodeRepository = value => value.split('/').map(encodeURIComponent).join('/');
const encodeRef = value => value.split('/').map(encodeURIComponent).join('/');
const GUARD_PUBLISHER_AUDIENCE = "https://changeplane.vercel.app/guard-publisher/v1";
const GUARD_WORKFLOW_PATH = ".github/workflows/changeplane.yml";
const GUARD_PULL_REQUEST_EVENTS = Object.freeze([
  "pull_request_target",
  "pull_request_review",
  "deployment_status",
  "repository_dispatch",
]);

/** Trusted Guard lifecycle. Entry adapters authenticate callers; this module owns every
 * publication generation, held journal lane, live revalidation and acknowledged write.
 * The clock and repository adapters are explicit so contract tests cross the same seam.
 */
export function createGuardLifecycle({ request: github, readManagedRuntime,
  admitEvaluation: admitPilotEvaluation = async () => null, clock = () => new Date().toISOString() }) {

  async function guardManagedBase(encodedRepository, defaultBranch, controllerSha, token) {
    const trusted = await readManagedRuntime(encodedRepository, defaultBranch, controllerSha, token);
    let trustedHarnessMode;
    try { trustedHarnessMode = harnessPolicy(JSON.parse(trusted.policyContent)?.harness).mode; }
    catch { throw new HttpError(409, 'The trusted managed guard recovery policy is invalid.'); }
    return { ...trusted, trustedHarnessMode };
  }
  function guardCurrentTarget(repo, source, token, refs = {}) {
    return createGitHubEvidenceReader({ repository: repo.full_name, request: path => github(path, token) })
      .target(repo, source, refs);
  }
  async function guardEvidenceChecks(passport, token, requiredChecks) {
    let observations;
    try {
      observations = await createGitHubEvidenceReader({ repository: passport.target.repository,
        request: path => github(path, token) }).freshness(passport, requiredChecks);
    } catch (error) {
      if (error instanceof HttpError || error instanceof GitHubError) throw error;
      throw new HttpError(409, 'Guard evidence freshness could not be established safely.');
    }
    if (observations.some(observation => !observation.current)) {
      throw new HttpError(409, 'Guard evidence changed or does not match the exact-head passport.');
    }
  }
  async function withGuardPublication(runtime, { repo, installation, configuration, headSha, operation }, callback) {
    // Non-hosted fixtures retain their existing adapter; hosted writes cannot enter
    // this branch, including when an operator disables a previously active journal.
    if (!runtime) return callback({ write: (mutateAndValidate) => mutateAndValidate() });
    const tenantId = repo?.owner?.id;
    if (!Number.isSafeInteger(tenantId) || tenantId < 1 || installation?.account?.id !== tenantId
      || !/^[a-f0-9]{40}$/u.test(headSha ?? "")) {
      throw new GuardPublicationError("GUARD_PUBLICATION_AUTHORITY");
    }
    return runtime.journal.withPublication({
      tenantId,
      repositoryId: repo.id,
      installationId: installation.id,
      guardAppId: configuration.appId,
      epoch: runtime.epoch,
      releaseSha: runtime.releaseSha,
      revisionFingerprint: createHash("sha256").update(`${repo.id}\0${headSha}`).digest("hex"),
      operation,
    }, callback);
  }

  function guardPolicyEvidenceMatches(passport, requiredChecks) {
    if (!Array.isArray(requiredChecks) || !Array.isArray(passport?.evidence)) return false;
    const policy = requiredChecks.map((requirement) => (
      typeof requirement === "string"
        ? `${requirement}\0Any`
        : `${requirement.name}\0${requirement.appSlug}`
    )).sort();
    const recorded = passport.evidence.map((item) => `${item.checkName}\0${item.expectedPublisher}`).sort();
    return policy.length === recorded.length
      && policy.every((identity, index) => identity === recorded[index]);
  }

  async function listGuardChecks(encodedRepository, headSha, token) {
    const payload = await github(
      `/repos/${encodedRepository}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(GUARD_CHECK_NAME)}&filter=all&per_page=100`,
      token,
    );
    if (!Array.isArray(payload?.check_runs) || payload.check_runs.length >= 100) {
      throw new HttpError(409, "The dedicated guard history is invalid or too large to order safely.");
    }
    return payload.check_runs;
  }

  function guardAppChecks(checks, configuration, headSha) {
    return checks.filter((check) => (
      check?.name === GUARD_CHECK_NAME
      && check?.head_sha === headSha
      && check?.app?.id === configuration.appId
      && check?.app?.slug === configuration.appSlug
    ));
  }

  function guardRunMarker(check) {
    try {
      return decodeGuardRunMarker(check?.output?.text);
    } catch {
      throw new HttpError(409, "The dedicated guard run marker is missing or malformed.");
    }
  }

  function assertGuardRunCanBegin(existing, incoming) {
    if (!existing) return "create";
    const current = guardRunMarker(existing);
    const order = compareGuardRunOrder(incoming, current);
    if (guardEvaluationPending(existing)
      && current.phase === "begin"
      && order === 0) {
      return "idempotent";
    }
    if (order > 0) return "replace";
    throw new HttpError(409, "This exact revision already has a newer or completed evaluation generation.");
  }

  function assertGuardRunCanComplete(existing, incoming) {
    if (!existing) throw new HttpError(409, "The App-owned guard was not invalidated before evaluation.");
    const current = guardRunMarker(existing);
    if (compareGuardRunOrder(incoming, current) !== 0) {
      throw new HttpError(409, "The guard completion does not own the current exact-revision evaluation lease.");
    }
    return current;
  }

  function guardPreviousContractDigest(check, request, configuration) {
    try {
      return guardBoundContractDigest(check, {
        repository: request.repository,
        repositoryId: request.repositoryId ?? request.passport?.target.repositoryId,
        target: request.target ?? request.passport?.target,
        appId: configuration.appId,
        appSlug: configuration.appSlug,
      });
    } catch {
      throw new HttpError(409, "The previous exact-head contract binding cannot be authenticated.");
    }
  }

  async function trustedGuardRecoveryState({ encodedRepository, repo, configuration, checkRun, trustedHarnessMode, token }) {
    const now = clock();
    const fallback = reconcileGuardState({ checkRun, trustedHarnessMode, now });
    if (trustedHarnessMode === HARNESS_MODE.AUTONOMOUS || fallback.state !== "within_window") return fallback;
    const earlyRecovery = reconcileGuardState({ checkRun, trustedHarnessMode, sourceRunCompleted: true, now });
    if (earlyRecovery.patch == null) return fallback;
    let sourceRunCompleted = false;
    if (checkRun?.name === GUARD_CHECK_NAME
      && checkRun?.app?.id === configuration.appId && checkRun?.app?.slug === configuration.appSlug) {
      const marker = guardRunMarker(checkRun);
      let run;
      try {
        run = await github(`/repos/${encodedRepository}/actions/runs/${marker.runId}/attempts/${marker.runAttempt}`, token);
      } catch {
        // Missing, inaccessible or unavailable owning-run evidence cannot shorten recovery.
        run = null;
      }
      sourceRunCompleted = String(run?.id ?? "") === String(marker.runId)
        && String(run?.run_attempt ?? "") === String(marker.runAttempt)
        && run?.repository?.id === repo.id && run?.repository?.full_name === repo.full_name
        && githubWorkflowFilePath(run?.path) === GUARD_WORKFLOW_PATH
        && run?.status === "completed"
        && ["action_required", "cancelled", "failure", "neutral", "skipped", "stale", "success", "timed_out", "startup_failure"].includes(run?.conclusion);
    }
    return sourceRunCompleted ? earlyRecovery : fallback;
  }

  async function guardBegin({ body, oidcToken, configuration, repository, journalRuntime }) {
    const targetType = body?.target?.type;
    const expectedRef = body?.gitRef;
    if (targetType === "merge_group"
      && (typeof expectedRef !== "string"
        || !expectedRef.startsWith(`refs/heads/gh-readonly-queue/${body?.defaultBranch ?? ""}/`))) {
      throw new HttpError(403, "The merge-group workflow ref is invalid.");
    }
    let claims;
    try {
      claims = await verifyGitHubActionsOidcToken({
        token: oidcToken,
        audience: GUARD_PUBLISHER_AUDIENCE,
        repository,
        repositoryId: body?.repositoryId,
        defaultBranch: body?.defaultBranch,
        workflowPath: GUARD_WORKFLOW_PATH,
        workflowSha: body?.controllerSha,
        ref: expectedRef,
        allowedEventNames: targetType === "merge_group" ? ["merge_group"] : GUARD_PULL_REQUEST_EVENTS,
      });
    } catch {
      throw new HttpError(403, "GitHub OIDC guard invalidation authentication failed.");
    }

    const encodedRepository = encodeRepository(repository);
    const appJwt = createGitHubAppJwt({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
    });
    const installation = await github(`/repos/${encodedRepository}/installation`, appJwt);
    if (!Number.isSafeInteger(installation?.id) || installation.id <= 0
      || installation.app_id !== configuration.appId
      || installation.app_slug !== configuration.appSlug) {
      throw new HttpError(403, "The repository is not bound to the configured ChangePlane App.");
    }
    const readCredential = await createGuardReadInstallationAccessToken({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
      installationId: installation.id,
      repositoryId: body?.repositoryId,
      request: github,
    });
    const repo = await github(`/repos/${encodedRepository}`, readCredential.token);
    if (repo?.full_name !== repository || repo.id !== body?.repositoryId
      || repo.default_branch !== body?.defaultBranch) {
      throw new HttpError(409, "The live repository identity does not match the guard invalidation.");
    }
    return withGuardPublication(journalRuntime, {
      repo, installation, configuration, headSha: body?.target?.headSha, operation: "begin",
    }, async ({ write }) => {
      const { workflowSha, managedProfile, trustedHarnessMode } = await guardManagedBase(
        encodedRepository,
        repo.default_branch,
        body?.controllerSha,
        readCredential.token,
      );
      const currentTarget = await guardCurrentTarget(
        repo,
        body?.target,
        readCredential.token,
        { baseRef: body?.target?.baseRef, headRef: body?.target?.headRef, requireUnique: true },
      );
      let request;
      try {
        request = validateGuardBeginBody(body, {
          oidcClaims: claims,
          expectedWorkflowSha: workflowSha,
          currentTarget,
        });
      } catch {
        throw new HttpError(409, "The guard invalidation request is stale or outside the trusted workflow boundary.");
      }

      const finalBaseRef = await github(
        `/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`,
        readCredential.token,
      );
      const finalTarget = await guardCurrentTarget(
        repo,
        body.target,
        readCredential.token,
        { baseRef: body.target.baseRef, headRef: body.target.headRef, requireUnique: true },
      );
      if (finalBaseRef?.object?.sha !== workflowSha || finalTarget.current !== true
        || finalTarget.headSha !== currentTarget.headSha || finalTarget.baseSha !== currentTarget.baseSha
        || finalTarget.headRef !== currentTarget.headRef || finalTarget.baseRef !== currentTarget.baseRef) {
        throw new HttpError(409, "The GitHub target changed before guard invalidation.");
      }

      const allChecks = await listGuardChecks(encodedRepository, request.target.headSha, readCredential.token);
      const appChecks = guardAppChecks(allChecks, configuration, request.target.headSha);
      const stable = appChecks.filter((check) => check?.external_id === request.check.external_id);
      if (stable.length > 1) throw new HttpError(409, "The dedicated guard publication is ambiguous.");
      const incomingMarker = decodeGuardRunMarker(request.check.output.text);
      const beginState = assertGuardRunCanBegin(stable[0], incomingMarker);
      const previousContractDigest = guardPreviousContractDigest(stable[0], request, configuration);
      const beginCheck = {
        ...request.check,
        output: {
          ...request.check.output,
          text: encodeGuardRunMarker({
            ...incomingMarker,
            boundContractDigest: previousContractDigest,
            pullRequestNumber: request.target.pullRequestNumber,
          }),
        },
      };
      let published = stable[0];
      const stableMarker = published ? guardRunMarker(published) : null;
      const idempotent = beginState === "idempotent"
        && guardEvaluationPending(published)
        && stableMarker?.phase === "begin"
        && compareGuardRunOrder(incomingMarker, stableMarker) === 0
        && published.output?.text === beginCheck.output.text;
      let writeCredential;
      if (!idempotent) {
        writeCredential = await createChecksWriteInstallationAccessToken({
          appId: configuration.appId,
          privateKey: configuration.privateKey,
          installationId: installation.id,
          repositoryId: repo.id,
          request: github,
        });
        for (const legacy of appChecks.filter((check) => (
          check?.external_id !== request.check.external_id
          && check?.status === "completed"
          && ["success", "neutral", "skipped"].includes(check?.conclusion)
        ))) {
          const retired = await write(() => github(`/repos/${encodedRepository}/check-runs/${legacy.id}`, writeCredential.token, {
            method: "PATCH",
            body: {
              status: "completed",
              conclusion: "action_required",
              output: {
                title: "Superseded by a new evaluation",
                summary: "A new trusted ChangePlane run started for this exact revision. This older result no longer applies.",
              },
            },
          }));
          if (retired?.id !== legacy.id || retired?.name !== GUARD_CHECK_NAME
            || retired?.head_sha !== request.target.headSha || retired?.status !== "completed"
            || retired?.conclusion !== "action_required"
            || retired?.app?.id !== configuration.appId || retired?.app?.slug !== configuration.appSlug) {
            throw new HttpError(502, "GitHub did not confirm that the previous Guard was invalidated.");
          }
        }
        const mutationChecks = guardAppChecks(
          await listGuardChecks(encodedRepository, request.target.headSha, readCredential.token),
          configuration,
          request.target.headSha,
        ).filter((check) => check?.external_id === request.check.external_id);
        if (mutationChecks.length !== stable.length || mutationChecks[0]?.id !== stable[0]?.id
          || mutationChecks[0]?.status !== stable[0]?.status
          || mutationChecks[0]?.conclusion !== stable[0]?.conclusion
          || mutationChecks[0]?.output?.text !== stable[0]?.output?.text
          || mutationChecks[0]?.output?.summary !== stable[0]?.output?.summary) {
          throw new HttpError(409, "The dedicated guard generation changed before invalidation.");
        }
        // A completed GitHub Check retains omitted conclusion/timestamp fields.
        // Retire usable assurance first so a failed begin cannot leave an old PASS.
        if (published?.status === "completed" && ["success", "neutral", "skipped"].includes(published.conclusion)) {
          const retired = await write(() => github(`/repos/${encodedRepository}/check-runs/${published.id}`, writeCredential.token, {
            method: "PATCH",
            body: { status: "completed", conclusion: "action_required" },
          }));
          if (retired?.id !== published.id || retired?.name !== GUARD_CHECK_NAME
            || retired?.head_sha !== request.target.headSha || retired?.status !== "completed"
            || retired?.conclusion !== "action_required" || retired?.external_id !== request.check.external_id
            || retired?.app?.id !== configuration.appId || retired?.app?.slug !== configuration.appSlug) {
            throw new HttpError(502, "GitHub did not confirm that the previous Guard was invalidated.");
          }
        }
        published = published
          ? await write(() => github(`/repos/${encodedRepository}/check-runs/${published.id}`, writeCredential.token, {
            method: "PATCH",
            body: {
              ...Object.fromEntries(Object.entries(beginCheck).filter(([key]) => key !== "head_sha")),
              // Completed Checks cannot reliably be reopened through REST. Keep the
              // stable Check blocked until this marker's fresh evidence completes.
              ...(published.status === "completed" ? {
                status: "completed", conclusion: "action_required",
                completed_at: clock(),
              } : {}),
              started_at: clock(),
            },
          }))
          : await write(() => github(`/repos/${encodedRepository}/check-runs`, writeCredential.token, {
            method: "POST",
            body: beginCheck,
          }));
      }
      if (!Number.isSafeInteger(published?.id) || published.id <= 0
        || published.name !== GUARD_CHECK_NAME || published.head_sha !== request.target.headSha
        || !guardEvaluationPending(published)
        || (published.status === "in_progress" && published.completed_at != null)
        || published.external_id !== request.check.external_id
        || published.output?.text !== beginCheck.output.text
        || published.app?.id !== configuration.appId || published.app?.slug !== configuration.appSlug) {
        throw new HttpError(502, "GitHub did not return the expected blocked dedicated-App evaluation.");
      }
      // The previous usable success is gone before any commercial network/DB wait.
      // A process loss here leaves an occupied lane AND a blocked Guard.
      const admissionBlock = await admitPilotEvaluation({ repo, installation,
        configuration, request, claims, managedProfile, trustedHarnessMode, encodedRepository, token: readCredential.token });
      if (admissionBlock) {
        writeCredential ??= await createChecksWriteInstallationAccessToken({
          appId: configuration.appId, privateKey: configuration.privateKey,
          installationId: installation.id, repositoryId: repo.id, request: github,
        });
        const text = encodeGuardRunMarker({ ...decodeGuardRunMarker(beginCheck.output.text), phase: "complete" });
        const blocked = await write(() => github(`/repos/${encodedRepository}/check-runs/${published.id}`, writeCredential.token, {
          method: "PATCH", body: { status: "completed", conclusion: "action_required",
            output: { title: admissionBlock.code === "PILOT_ADMISSION_DENIED" ? "Pilot allowance needs attention" : "Pilot allowance could not be confirmed",
              summary: admissionBlock.message, text } },
        }));
        if (blocked?.id !== published.id || blocked?.name !== GUARD_CHECK_NAME
          || blocked?.head_sha !== request.target.headSha || blocked?.external_id !== request.check.external_id
          || blocked?.status !== "completed" || blocked?.conclusion !== "action_required"
          || blocked?.output?.text !== text || blocked?.output?.summary !== admissionBlock.message
          || blocked?.app?.id !== configuration.appId || blocked?.app?.slug !== configuration.appSlug) {
          throw new HttpError(502, "GitHub did not confirm the blocked pilot Guard.");
        }
        return { admissionBlock };
      }
      return {
        schemaVersion: 1,
        type: "changeplane.guard-publication-begin",
        check: {
          id: published.id,
          name: published.name,
          headSha: published.head_sha,
          status: published.status,
          conclusion: published.conclusion ?? null,
          publisherAppId: published.app.id,
          publisherAppSlug: published.app.slug,
        },
        run: { id: request.workflowRunId, attempt: request.workflowRunAttempt },
        previousContractDigest,
      };
    });
  }

  // Both automated sweeps and deliberate human recovery use this held-lane
  // operation. Confirm the policy, target and owning generation before acquiring
  // write authority; the only recovery conclusion is action_required.
  async function reconcileHeldCheck({ repo, installation, configuration, token, workflowSha,
    trustedHarnessMode, check, headSha, write, target = null, expectedExternalId = null, requireUnique = true }) {
    const encodedRepository = encodeRepository(repo.full_name);
    const context = { encodedRepository, repo, configuration, trustedHarnessMode, token };
    const recovery = await trustedGuardRecoveryState({ ...context, checkRun: check });
    if (recovery.patch == null) return recovery;
    async function revalidateRecovery() {
      const [finalCheck, finalBase, finalTarget] = await Promise.all([
        github(`/repos/${encodedRepository}/check-runs/${check.id}`, token),
        github(`/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`, token),
        target ? guardCurrentTarget(repo, target, token, { requireUnique }) : null,
      ]);
      if (finalBase?.object?.sha !== workflowSha || finalCheck?.id !== check.id
        || finalCheck?.head_sha !== headSha || finalCheck?.name !== GUARD_CHECK_NAME
        || finalCheck?.app?.id !== configuration.appId || finalCheck?.app?.slug !== configuration.appSlug
        || expectedExternalId !== null && finalCheck?.external_id !== expectedExternalId
        || target && (!finalTarget?.current || finalTarget.headRepositoryId !== repo.id
          || finalTarget.baseRepositoryId !== repo.id || finalTarget.baseRef !== repo.default_branch)) {
        throw new HttpError(409, 'The trusted recovery policy or Guard publisher changed before reconciliation. Nothing was changed.');
      }
      const finalRecovery = await trustedGuardRecoveryState({ ...context, checkRun: finalCheck });
      if (finalRecovery.patch == null && target === null) return finalRecovery;
      if (finalRecovery.patch == null || finalRecovery.generation !== recovery.generation) {
        throw new HttpError(409, 'The owning Guard generation changed before reconciliation. Nothing was changed.');
      }
      return finalRecovery;
    }
    let finalRecovery = await revalidateRecovery();
    if (finalRecovery.patch == null) return finalRecovery;
    const credential = await createChecksWriteInstallationAccessToken({
      appId: configuration.appId, privateKey: configuration.privateKey,
      installationId: installation.id, repositoryId: repo.id, request: github,
    });
    // Token issuance is an external wait: confirm the same policy and generation
    // again before using its authority, even when eligibility was just checked.
    finalRecovery = await revalidateRecovery();
    if (finalRecovery.patch == null) return finalRecovery;
    const published = await write(() => github(`/repos/${encodedRepository}/check-runs/${check.id}`, credential.token, {
      method: 'PATCH', body: finalRecovery.patch,
    }));
    if (published?.id !== check.id || published?.head_sha !== headSha || published?.name !== GUARD_CHECK_NAME
      || published?.app?.id !== configuration.appId || published?.app?.slug !== configuration.appSlug
      || published?.status !== 'completed' || published?.conclusion !== 'action_required'
      || published?.output?.text !== finalRecovery.patch.output.text
      || expectedExternalId !== null && published?.external_id !== expectedExternalId) {
      throw new HttpError(502, 'GitHub did not return the safely reconciled Guard Check.');
    }
    return { state: 'reconciled', checkRunId: check.id, generation: finalRecovery.generation, conclusion: 'action_required' };
  }

  async function guardReconciliationSweep({ body, oidcToken, configuration, repository, journalRuntime }) {
    let claims;
    try {
      claims = await verifyGitHubActionsOidcToken({
        token: oidcToken,
        audience: GUARD_PUBLISHER_AUDIENCE,
        repository,
        repositoryId: body?.repositoryId,
        defaultBranch: body?.defaultBranch,
        workflowPath: GUARD_WORKFLOW_PATH,
        workflowSha: body?.controllerSha,
        ref: body?.gitRef,
        allowedEventNames: ["schedule", "workflow_dispatch"],
      });
    } catch {
      throw new HttpError(403, "GitHub OIDC guard reconciliation authentication failed.");
    }

    const encodedRepository = encodeRepository(repository);
    const appJwt = createGitHubAppJwt({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
    });
    const installation = await github(`/repos/${encodedRepository}/installation`, appJwt);
    if (!Number.isSafeInteger(installation?.id) || installation.id <= 0
      || installation.app_id !== configuration.appId
      || installation.app_slug !== configuration.appSlug) {
      throw new HttpError(403, "The repository is not bound to the configured ChangePlane App.");
    }
    const readCredential = await createGuardReadInstallationAccessToken({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
      installationId: installation.id,
      repositoryId: body?.repositoryId,
      request: github,
    });
    const repo = await github(`/repos/${encodedRepository}`, readCredential.token);
    if (repo?.full_name !== repository || repo.id !== body?.repositoryId
      || repo.default_branch !== body?.defaultBranch) {
      throw new HttpError(409, "The live repository identity does not match the reconciliation request.");
    }
    const { workflowSha, trustedHarnessMode } = await guardManagedBase(
      encodedRepository,
      repo.default_branch,
      body?.controllerSha,
      readCredential.token,
    );
    let request;
    try {
      request = validateGuardReconciliationBody(body, {
        oidcClaims: claims,
        expectedWorkflowSha: workflowSha,
      });
    } catch {
      throw new HttpError(409, "The guard reconciliation request is stale or outside the trusted workflow boundary.");
    }

    const pulls = await github(
      `/repos/${encodedRepository}/pulls?state=open&sort=updated&direction=desc&per_page=50`,
      readCredential.token,
    );
    if (!Array.isArray(pulls) || pulls.length >= 50) {
      throw new HttpError(409, "The open pull-request inventory is invalid or exceeds the bounded reconciliation sweep.");
    }
    const seenHeads = new Set();
    const inventory = [];
    for (const pull of pulls) {
      if (pull?.state !== "open" || pull?.merged === true
        || pull?.head?.repo?.id !== repo.id || pull?.head?.repo?.full_name !== repository
        || pull?.base?.repo?.id !== repo.id || pull?.base?.repo?.full_name !== repository
        || pull?.base?.ref !== repo.default_branch
        || !Number.isSafeInteger(pull?.number) || pull.number <= 0
        || !/^[a-f0-9]{40}$/u.test(pull?.head?.sha ?? "")) continue;
      if (seenHeads.has(pull.head.sha)) {
        throw new HttpError(409, "One exact head belongs to multiple open pull requests; reconciliation stopped without mutation.");
      }
      seenHeads.add(pull.head.sha);
      inventory.push(pull);
    }

    let inProgress = 0;
    let reconciled = 0;
    for (const discovered of inventory) {
      const headSha = discovered.head.sha;
      const result = await withGuardPublication(journalRuntime, {
        repo, installation, configuration, headSha, operation: "reconcile",
      }, async ({ write }) => {
        // Inventory selects immutable head lanes only. Policy, target, publisher,
        // generation and owning-run evidence are freshly read while holding one.
        const trusted = await guardManagedBase(encodedRepository, repo.default_branch, workflowSha, readCredential.token);
        const target = {
          type: "pull_request", pullRequestNumber: discovered.number,
          headSha, baseSha: discovered.base.sha,
          headRef: discovered.head.ref, baseRef: discovered.base.ref,
        };
        const readTarget = () => guardCurrentTarget(repo, target, readCredential.token, { requireUnique: journalRuntime !== null });
        const current = await readTarget();
        if (!current.current || current.headRepositoryId !== repo.id || current.baseRepositoryId !== repo.id
          || current.baseRef !== repo.default_branch) {
          throw new HttpError(409, "A Guard recovery target changed. Inspect the current revision before retrying the sweep.");
        }
        const expectedExternalId = stableGuardCheckExternalId({ repositoryId: repo.id, targetType: "pull_request", headSha });
        const stable = guardAppChecks(await listGuardChecks(encodedRepository, headSha, readCredential.token), configuration, headSha)
          .filter((check) => check?.external_id === expectedExternalId);
        if (stable.length > 1) throw new HttpError(409, "The dedicated Guard recovery target is ambiguous.");
        const check = stable[0];
        if (check?.status !== "in_progress" && !guardEvaluationPending(check)) return { inProgress: 0, reconciled: 0 };
        const recovery = await reconcileHeldCheck({ repo, installation, configuration, token: readCredential.token,
          workflowSha, trustedHarnessMode: trusted.trustedHarnessMode, check, headSha, write, target,
          expectedExternalId, requireUnique: journalRuntime !== null });
        return { inProgress: 1, reconciled: recovery.state === 'reconciled' ? 1 : 0 };
      });
      inProgress += result.inProgress;
      reconciled += result.reconciled;
    }
    return {
      schemaVersion: 1,
      type: "changeplane.guard-reconciliation-sweep",
      scannedHeads: seenHeads.size,
      inProgress,
      reconciled,
      withinWindow: inProgress - reconciled,
    };
  }

  async function complete({ body, oidcToken, configuration, repository, journalRuntime }) {
    let passport;
    try {
      passport = verifyAssurancePassportIntegrity(body?.passport);
      if (passport.target.repository !== repository || passport.binding.policyPath !== POLICY_PATH) {
        throw new Error("Guard repository or policy path mismatch.");
      }
    } catch {
      throw new HttpError(400, "The guard publication request is malformed.");
    }

    const expectedRef = body?.gitRef;
    if (passport.target.type === "merge_group"
      && (typeof expectedRef !== "string"
        || !expectedRef.startsWith(`refs/heads/gh-readonly-queue/${body?.defaultBranch ?? ""}/`))) {
      throw new HttpError(403, "The merge-group workflow ref is invalid.");
    }
    let claims;
    try {
      claims = await verifyGitHubActionsOidcToken({
        token: oidcToken,
        audience: GUARD_PUBLISHER_AUDIENCE,
        repository,
        repositoryId: passport.target.repositoryId,
        defaultBranch: body?.defaultBranch,
        workflowPath: GUARD_WORKFLOW_PATH,
        workflowSha: passport.target.baseSha,
        ref: expectedRef,
        allowedEventNames: passport.target.type === "merge_group"
          ? ["merge_group"]
          : GUARD_PULL_REQUEST_EVENTS,
      });
    } catch {
      throw new HttpError(403, "GitHub OIDC guard publication authentication failed.");
    }

    const encodedRepository = encodeRepository(repository);
    const appJwt = createGitHubAppJwt({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
    });
    const installation = await github(`/repos/${encodedRepository}/installation`, appJwt);
    if (!Number.isSafeInteger(installation?.id) || installation.id <= 0
      || installation.app_id !== configuration.appId
      || installation.app_slug !== configuration.appSlug) {
      throw new HttpError(403, "The repository is not bound to the configured ChangePlane App.");
    }
    const readCredential = await createGuardReadInstallationAccessToken({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
      installationId: installation.id,
      repositoryId: passport.target.repositoryId,
      request: github,
    });
    const repo = await github(`/repos/${encodedRepository}`, readCredential.token);
    if (repo?.full_name !== repository || repo.id !== passport.target.repositoryId
      || repo.default_branch !== body.defaultBranch) {
      throw new HttpError(409, "The live repository identity does not match the guard request.");
    }
    const result = await withGuardPublication(journalRuntime, {
      repo, installation, configuration, headSha: passport.target.headSha, operation: "complete",
    }, async ({ write }) => {
      const { workflowSha, policyContent } = await readManagedRuntime(
        encodedRepository, repo.default_branch, passport.target.baseSha, readCredential.token,
      );
      let policy;
      let requiredChecks;
      try {
        policy = JSON.parse(policyContent);
        requiredChecks = validateRequiredChecks(policy?.evidence?.requiredChecks, {
          mode: passport.decision.mode === "observe" ? "observe" : "enforce",
        });
      } catch {
        throw new HttpError(409, "The trusted guard policy is malformed.");
      }
      if (canonicalDigest(policy) !== passport.binding.policyDigest
        || !guardPolicyEvidenceMatches(passport, requiredChecks)) {
        throw new HttpError(409, "The guard passport does not match the trusted policy evidence contract.");
      }
      const currentTarget = await guardCurrentTarget(repo, passport, readCredential.token, {
        baseRef: `refs/heads/${repo.default_branch}`,
        headRef: body.gitRef,
        requireUnique: true,
      });
      let request;
      try {
        request = validateGuardPublishBody(body, {
          oidcClaims: claims,
          expectedWorkflowSha: workflowSha,
          expectedControllerSha: passport.binding.trustedControllerSha,
          currentTarget,
        });
      } catch {
        throw new HttpError(409, "The guard publication request is stale or outside the trusted workflow boundary.");
      }

      const finalBaseRef = await github(
        `/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`,
        readCredential.token,
      );
      if (finalBaseRef?.object?.sha !== workflowSha) {
        throw new HttpError(409, "The trusted default branch changed before guard mutation.");
      }
      const finalTarget = await guardCurrentTarget(repo, passport, readCredential.token, {
        baseRef: `refs/heads/${repo.default_branch}`,
        headRef: body.gitRef,
        requireUnique: true,
      });
      if (finalTarget.current !== true
        || finalTarget.headSha !== currentTarget.headSha
        || finalTarget.baseSha !== currentTarget.baseSha) {
        throw new HttpError(409, "The GitHub target changed before guard mutation.");
      }

      const allChecks = await listGuardChecks(encodedRepository, passport.target.headSha, readCredential.token);
      const existing = guardAppChecks(allChecks, configuration, passport.target.headSha)
        .filter((check) => check?.external_id === request.check.external_id);
      if (existing.length > 1) throw new HttpError(409, "The dedicated guard publication is ambiguous.");
      const incomingMarker = decodeGuardRunMarker(request.check.output.text);
      const currentMarker = assertGuardRunCanComplete(existing[0], incomingMarker);
      const previousContractDigest = guardPreviousContractDigest(existing[0], request, configuration);
      if (previousContractDigest !== null && previousContractDigest !== passport.binding.contractDigest) {
        throw new HttpError(409, "The guard passport changed the frozen exact-head contract binding.");
      }
      await guardEvidenceChecks(passport, readCredential.token, requiredChecks);
      let published = existing[0];
      const idempotent = currentMarker.phase === "complete"
        && published?.status === "completed"
        && published?.conclusion === request.check.conclusion
        && published?.output?.summary === request.check.output.summary
        && published?.output?.text === request.check.output.text;
      if (currentMarker.phase === "complete" && !idempotent) {
        throw new HttpError(409, "The current run already completed with a different assurance passport.");
      }
      if (!idempotent) {
        const writeCredential = await createChecksWriteInstallationAccessToken({
          appId: configuration.appId,
          privateKey: configuration.privateKey,
          installationId: installation.id,
          repositoryId: repo.id,
          request: github,
        });
        const mutationBase = await github(
          `/repos/${encodedRepository}/git/ref/heads/${encodeRef(repo.default_branch)}`,
          readCredential.token,
        );
        const mutationTarget = await guardCurrentTarget(repo, passport, readCredential.token, {
          baseRef: `refs/heads/${repo.default_branch}`,
          headRef: body.gitRef,
          requireUnique: true,
        });
        if (mutationBase?.object?.sha !== workflowSha || mutationTarget.current !== true
          || mutationTarget.headSha !== currentTarget.headSha || mutationTarget.baseSha !== currentTarget.baseSha) {
          throw new HttpError(409, "The GitHub target changed while guard evidence was being verified.");
        }
        // Evidence and credential calls can outlive this generation. Re-read after
        // both, immediately before writing. This is a freshness check, not a CAS:
        // GitHub Checks does not provide a documented conditional PATCH contract.
        const mutationChecks = guardAppChecks(
          await listGuardChecks(encodedRepository, passport.target.headSha, readCredential.token),
          configuration,
          passport.target.headSha,
        ).filter((check) => check?.external_id === request.check.external_id);
        if (mutationChecks.length !== 1 || mutationChecks[0].id !== existing[0].id) {
          throw new HttpError(409, "The dedicated guard publication changed before completion.");
        }
        assertGuardRunCanComplete(mutationChecks[0], incomingMarker);
        if (mutationChecks[0].status !== existing[0].status
          || mutationChecks[0].conclusion !== existing[0].conclusion
          || mutationChecks[0].output?.text !== existing[0].output?.text
          || mutationChecks[0].output?.summary !== existing[0].output?.summary) {
          throw new HttpError(409, "The dedicated guard generation changed before completion.");
        }
        published = await write(() => github(`/repos/${encodedRepository}/check-runs/${existing[0].id}`, writeCredential.token, {
          method: "PATCH",
          body: {
            ...Object.fromEntries(Object.entries(request.check).filter(([key]) => key !== "head_sha")),
            // GitHub retains the blocked begin timestamp unless completion replaces it.
            completed_at: clock(),
          },
        }));
      }
      if (!Number.isSafeInteger(published?.id) || published.id <= 0
        || published.name !== GUARD_CHECK_NAME
        || published.head_sha !== passport.target.headSha
        || published.status !== "completed"
        || published.conclusion !== request.check.conclusion
        || published.external_id !== request.check.external_id
        || published.output?.text !== request.check.output.text
        || published.app?.id !== configuration.appId
        || published.app?.slug !== configuration.appSlug) {
        throw new HttpError(502, "GitHub did not return the expected dedicated-App guard.");
      }
      const proofLocator = buildProofLocator(passport, published);
      return {
        schemaVersion: 1,
        type: "changeplane.guard-publication",
        passportDigest: passport.digest,
        check: {
          id: published.id,
          name: published.name,
          headSha: published.head_sha,
          conclusion: published.conclusion,
          publisherAppId: published.app.id,
          publisherAppSlug: published.app.slug,
        },
        proofLocator,
      };
    });
    return result;
  }

  async function reconcile({ target, checkRunId, configuration, journalRuntime }) {
    const repository = target.repo.full_name;
    const appJwt = createGitHubAppJwt({ appId: configuration.appId, privateKey: configuration.privateKey });
    const installation = await github(`/repos/${target.encodedRepository}/installation`, appJwt);
    if (!Number.isSafeInteger(installation?.id) || installation.id < 1
      || installation.app_id !== configuration.appId
      || installation.app_slug !== configuration.appSlug) {
      throw new HttpError(403, "The repository is not bound to the configured Guard App.");
    }
    const readCredential = await createGuardReadInstallationAccessToken({
      appId: configuration.appId,
      privateKey: configuration.privateKey,
      installationId: installation.id,
      repositoryId: target.repo.id,
      request: github,
    });
    const readCheck = () => github(
      `/repos/${target.encodedRepository}/check-runs/${checkRunId}`,
      readCredential.token,
    );
    const readBaseRef = () => github(
      `/repos/${target.encodedRepository}/git/ref/heads/${encodeRef(target.repo.default_branch)}`,
      readCredential.token,
    );
    // Check head_sha is immutable. Discovery chooses a lane only; every mutable
    // decision is re-read after acquiring it, including the Check publisher/head.
    const discovered = await readCheck();
    const headSha = discovered?.head_sha;
    if (!/^[a-f0-9]{40}$/u.test(headSha ?? "") || discovered?.name !== GUARD_CHECK_NAME
      || discovered?.app?.id !== configuration.appId || discovered?.app?.slug !== configuration.appSlug) {
      throw new HttpError(409, "The Guard recovery target cannot be authenticated. Nothing was changed.");
    }
    const result = await withGuardPublication(journalRuntime, {
      repo: target.repo, installation, configuration, headSha, operation: "reconcile",
    }, async ({ write }) => {
      const baseRef = await readBaseRef();
      const { workflowSha, trustedHarnessMode } = await guardManagedBase(
        target.encodedRepository,
        target.repo.default_branch,
        baseRef?.object?.sha,
        readCredential.token,
      );
      const checkRun = await readCheck();
      if (checkRun?.head_sha !== headSha || checkRun?.name !== GUARD_CHECK_NAME
        || checkRun?.app?.id !== configuration.appId || checkRun?.app?.slug !== configuration.appSlug) {
        throw new HttpError(409, "Only the configured Guard App Check can be reconciled. Nothing was changed.");
      }
      const recovery = await reconcileHeldCheck({ repo: target.repo, installation, configuration,
        token: readCredential.token, workflowSha, trustedHarnessMode, check: checkRun, headSha, write });
      return { repository, ...recovery };
    });
    return result;
  }

  return Object.freeze({
    async publish(input) {
      if (input.body?.type === 'changeplane.guard-publication-begin') return guardBegin(input);
      if (input.body?.type === 'changeplane.guard-reconciliation-sweep') return guardReconciliationSweep(input);
      return complete(input);
    },
    reconcile,
  });
}
