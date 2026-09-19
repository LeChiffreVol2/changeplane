import { evaluateEvidence } from '../src/lib/changeplane.js';
import { githubWorkflowFilePath } from '../src/lib/harness.js';

const GUARD_CHECK_NAME = 'ChangePlane / guard';
const MAX_DIAGNOSTIC_LENGTH = 6_000;
const validPositiveInteger = value => Number.isSafeInteger(value) && value > 0;
const encodeRef = value => value.split('/').map(encodeURIComponent).join('/');
const sameRepository = (left, right) => typeof left === 'string' && typeof right === 'string'
  && left.toLowerCase() === right.toLowerCase();

const GITHUB_WORKFLOW_PATH = /^\.github\/workflows\/[^/\\\u0000-\u001f\u007f]{1,260}\.ya?ml$/u;

function validGithubWorkflowPath(value) {
  return typeof value === "string"
    && value.length <= 300
    && value === value.trim()
    && GITHUB_WORKFLOW_PATH.test(value);
}

/** One credential-scoped read lifetime; observations never confer publication or repair authority. */
export function createGitHubEvidenceReader({ repository, request }) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(repository)
    || typeof request !== 'function') throw new TypeError('A repository-scoped GitHub reader is required.');
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
  const github = request;
  function evidenceCheckMatchesPassport(check, item) {
    return check?.id === item.checkRunId
      && check.name === item.checkName
      && check.head_sha === item.headSha
      && String(check.status ?? "").toUpperCase() === item.status
      && String(check.conclusion ?? "").toUpperCase() === item.conclusion
      && check.completed_at === item.completedAt
      && check.app?.id === item.publisherAppId
      && check.app?.slug === item.actualPublisher;
  }

  function newestEligibleEvidenceCheck(checks, item) {
    const publisher = item.expectedPublisher === "Any"
      ? item.actualPublisher
      : item.expectedPublisher;
    const eligible = checks.filter((check) => (
      check?.name === item.checkName
      && check?.head_sha === item.headSha
      && check?.app?.slug === publisher
    ));
    let newest = null;
    let newestStartedAt = null;
    for (const check of eligible) {
      if (!Number.isSafeInteger(check?.id) || check.id <= 0) {
        throw new TypeError("GitHub returned an invalid eligible Check Run identifier.");
      }
      const startedAt = Date.parse(check.started_at ?? check.completed_at ?? "");
      if (!Number.isFinite(startedAt)) {
        throw new TypeError("GitHub returned an eligible Check Run without a valid started_at or completed_at timestamp.");
      }
      if (newest === null || startedAt > newestStartedAt
        || (startedAt === newestStartedAt && check.id > newest.id)) {
        newest = check;
        newestStartedAt = startedAt;
      }
    }
    return newest;
  }

  async function listEvidenceChecksByName(headSha, checkName) {
    const checks = [];
    for (let page = 1; page <= 10; page += 1) {
      const payload = await github(
        `/repos/${encodedRepository}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100&page=${page}`,
      );
      if (!Array.isArray(payload?.check_runs)) {
        throw new TypeError("GitHub returned an invalid Check Run list.");
      }
      checks.push(...payload.check_runs);
      if (payload.check_runs.length < 100) return checks;
    }
    throw new TypeError("GitHub returned too many Check Runs to prove the latest eligible evidence safely.");
  }

  function canonicalGithubActionsRunId(detailsUrl, repository) {
    if (typeof detailsUrl !== "string"
      || typeof repository !== "string"
      || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(repository)) return null;
    let parsed;
    try {
      parsed = new URL(detailsUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port
      || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const prefix = `/${repository}/`;
    if (!sameRepository(parsed.pathname.slice(0, prefix.length), prefix)) return null;
    const match = parsed.pathname.slice(prefix.length).match(/^actions\/runs\/([1-9][0-9]{0,19})(?:\/job\/[1-9][0-9]{0,19})?$/u);
    return match?.[1] ?? null;
  }

  function requiredWorkflowPaths(requiredChecks) {
    const paths = new Map();
    if (!Array.isArray(requiredChecks)) return paths;
    for (const requirement of requiredChecks) {
      if (requirement?.appSlug === "github-actions" && validGithubWorkflowPath(requirement.workflowPath)) {
        paths.set(`${requirement.name}\0${requirement.appSlug}`, requirement.workflowPath);
      }
    }
    return paths;
  }

  async function verifiedWorkflowPath(check, runCache, missingRunIsUnverified = true) {
    if (check?.app?.slug !== 'github-actions' || !/^[a-f0-9]{40}$/u.test(check?.head_sha ?? '')) return null;
    const runId = canonicalGithubActionsRunId(check.details_url, repository);
    if (!runId) return null;
    if (!runCache.has(runId)) {
      runCache.set(runId, github(`/repos/${encodedRepository}/actions/runs/${runId}`).catch(error => {
        if (missingRunIsUnverified && error?.status === 404) return null;
        throw error;
      }));
    }
    const run = await runCache.get(runId);
    return String(run?.id ?? '') === runId && run?.head_sha === check.head_sha
      ? githubWorkflowFilePath(run?.path) : null;
  }

  async function githubActionsWorkflowMatches({ headSha, check, workflowPath, runCache, missingRunIsUnverified = true }) {
    if (!workflowPath) return true;
    return check?.head_sha === headSha
      && await verifiedWorkflowPath(check, runCache, missingRunIsUnverified) === workflowPath;
  }

  // Setup discovery propagates failed reads; publication treats a missing run as
  // unverified. Each operation has its own cache so later reads are always fresh.
  async function workflows(checks) {
    const cache = new Map();
    return Promise.all(checks.map(check => verifiedWorkflowPath(check, cache, false)));
  }

  function boundedEvidenceText(value, limit = MAX_DIAGNOSTIC_LENGTH) {
    return String(value ?? "").replaceAll(/[\u0000-\u001f\u007f]+/gu, " ").replaceAll(/\s+/gu, " ").trim().slice(0, limit);
  }

  function checkDiagnostic(check, annotations) {
    return [
      boundedEvidenceText(check?.output?.title, 300),
      boundedEvidenceText(check?.output?.summary),
      boundedEvidenceText(check?.output?.text),
      ...annotations.slice(0, 20).map((annotation) => {
        const location = [boundedEvidenceText(annotation?.path, 300), Number.isSafeInteger(annotation?.start_line) ? `line ${annotation.start_line}` : ""]
          .filter(Boolean).join(":");
        const message = boundedEvidenceText(annotation?.message ?? annotation?.raw_details ?? annotation?.title);
        return [location, message].filter(Boolean).join(" — ");
      }),
    ].filter(Boolean).join("\n").slice(0, MAX_DIAGNOSTIC_LENGTH);
  }

  async function freshness(passport, requiredChecks = []) {
    if (!sameRepository(passport?.target?.repository, repository)) throw new TypeError("Evidence repository mismatch.");
    const seen = new Set();
    for (const item of passport.evidence) {
      if (!Number.isSafeInteger(item.checkRunId) || item.checkRunId <= 0 || seen.has(item.checkRunId)) {
        throw new TypeError("Guard evidence cannot be re-fetched as unique GitHub Check Runs.");
      }
      seen.add(item.checkRunId);
    }
    const recordedChecks = await Promise.all(passport.evidence.map((item) => (
      github(`/repos/${encodedRepository}/check-runs/${item.checkRunId}`)
    )));
    const checksByName = new Map();
    await Promise.all([...new Set(passport.evidence.map((item) => item.checkName))].map(async (checkName) => {
      checksByName.set(checkName, await listEvidenceChecksByName(
        passport.target.headSha,
        checkName,
      ));
    }));
    const workflows = requiredWorkflowPaths(requiredChecks);
    const runCache = new Map();
    return Promise.all(passport.evidence.map(async (item, index) => {
      const recorded = recordedChecks[index];
      const latest = newestEligibleEvidenceCheck(checksByName.get(item.checkName) ?? [], item);
      const workflowPath = workflows.get(`${item.checkName}\0${item.expectedPublisher}`) ?? null;
      const workflowCurrent = !workflowPath || (
        await githubActionsWorkflowMatches({
          headSha: passport.target.headSha,
          check: recorded,
          workflowPath,
          runCache,
        })
        && await githubActionsWorkflowMatches({
          headSha: passport.target.headSha,
          check: latest,
          workflowPath,
          runCache,
        })
      );
      return {
        item,
        recorded,
        latest,
        current: evidenceCheckMatchesPassport(recorded, item)
          && evidenceCheckMatchesPassport(latest, item)
          && workflowCurrent,
      };
    }));
  }

  async function forRepair(headSha, requiredChecks = []) {
    if (!Array.isArray(requiredChecks) || requiredChecks.some((item) => typeof item === "string")) {
      throw new Error("Repair requires every evidence check to bind an expected GitHub App");
    }
    if (requiredChecks.length === 0) return evaluateEvidence();
    const checkPayload = await request(`/repos/${encodedRepository}/commits/${headSha}/check-runs?filter=latest&per_page=100`);
    const required = new Map(requiredChecks.map(({ name, appSlug, workflowPath }) => (
      [`${name}\0${appSlug}`, workflowPath ?? null]
    )));
    const actionRuns = new Map();
    const checks = Array.isArray(checkPayload?.check_runs) ? await Promise.all(checkPayload.check_runs.map(async (check) => {
      const source = check.check_suite?.app?.slug ?? check.app?.slug ?? null;
      const workflowPath = required.get(`${check.name}\0${source}`) ?? null;
      let verifiedWorkflowPath = null;
      if (source === "github-actions" && typeof workflowPath === "string"
        && await githubActionsWorkflowMatches({ headSha, check: { ...check, app: { slug: source } }, workflowPath, runCache: actionRuns, missingRunIsUnverified: false })) {
        verifiedWorkflowPath = workflowPath;
      }
      const needsDiagnostic = check.status === "completed" && check.conclusion !== "success"
        && required.has(`${check.name}\0${source}`);
      let annotations = [];
      if (needsDiagnostic && validPositiveInteger(check.id) && check.output?.annotations_count > 0) {
        try {
          const payload = await request(`/repos/${encodedRepository}/check-runs/${check.id}/annotations?per_page=20`);
          if (Array.isArray(payload)) annotations = payload;
        } catch {
          // Bounded Check output remains usable when annotation access is unavailable.
        }
      }
      const diagnostic = needsDiagnostic ? checkDiagnostic(check, annotations) : "";
      return {
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        createdAt: check.started_at,
        completedAt: check.completed_at,
        source,
        ...(verifiedWorkflowPath ? { workflowPath: verifiedWorkflowPath } : {}),
        ...(diagnostic ? { diagnostic } : {}),
      };
    })) : [];
    return evaluateEvidence({ requiredChecks, checks });
  }

  async function target(repo, source, refs = {}) {
    if (!sameRepository(repo?.full_name, repository)) throw new TypeError("Evidence repository mismatch.");
    const target = source?.target ?? source;
    if (target.type === "pull_request") {
      const pull = await github(
        `/repos/${encodedRepository}/pulls/${target.pullRequestNumber}`,
      );
      let unique = true;
      if (refs.requireUnique === true) {
        const associated = await github(
          `/repos/${encodedRepository}/commits/${target.headSha}/pulls?per_page=100`,
        );
        if (!Array.isArray(associated) || associated.length >= 100) unique = false;
        else {
          const supported = associated.filter((candidate) => (
            candidate?.state === "open"
            && candidate?.head?.sha === target.headSha
            && candidate?.head?.repo?.full_name === repo.full_name
            && candidate?.base?.repo?.full_name === repo.full_name
          ));
          unique = supported.length === 1
            && supported[0]?.number === target.pullRequestNumber
            && supported[0]?.base?.sha === target.baseSha
            && supported[0]?.head?.ref === pull?.head?.ref
            && supported[0]?.base?.ref === pull?.base?.ref;
        }
      }
      return {
        type: "pull_request",
        repository: repo.full_name,
        repositoryId: repo.id,
        headRepositoryId: pull?.head?.repo?.id,
        baseRepositoryId: pull?.base?.repo?.id,
        pullRequestNumber: pull?.number,
        headRef: pull?.head?.ref,
        baseRef: pull?.base?.ref,
        headSha: pull?.head?.sha,
        baseSha: pull?.base?.sha,
        ...(refs.includeProofState === true ? {
          state: pull?.state,
          merged: pull?.merged === true,
          uniqueOpenPullRequest: unique,
        } : {}),
        current: pull?.state === "open"
          && pull?.merged !== true
          && pull?.head?.sha === target.headSha
          && pull?.base?.sha === target.baseSha
          && unique,
      };
    }
    const headRef = refs.headRef ?? target.headRef;
    const baseRef = refs.baseRef ?? target.baseRef;
    const refPath = typeof headRef === "string" && headRef.startsWith("refs/")
      ? headRef.slice("refs/".length)
      : null;
    const liveRef = refPath
      ? await github(`/repos/${encodedRepository}/git/ref/${encodeRef(refPath)}`)
      : null;
    return {
      type: "merge_group",
      repository: repo.full_name,
      repositoryId: repo.id,
      headRepositoryId: repo.id,
      baseRepositoryId: repo.id,
      pullRequestNumber: null,
      headRef,
      baseRef,
      headSha: liveRef?.object?.sha,
      baseSha: target.baseSha,
      current: liveRef?.object?.sha === target.headSha,
    };
  }

  async function publisherIdentities(repo, expectedPublisher, requirements) {
    if (!expectedPublisher) return { guard: null, evidence: [] };
    const pulls = await github(
      `/repos/${encodedRepository}/pulls?state=open&base=${encodeURIComponent(repo.default_branch)}&sort=updated&direction=desc&per_page=3`,
    );
    if (!Array.isArray(pulls)) throw new Error("GitHub returned an invalid pull request list.");
    const candidateHeads = [...new Set(pulls
      .filter((pull) => pull?.head?.repo?.full_name === repo.full_name && /^[a-f0-9]{40}$/u.test(pull?.head?.sha ?? ""))
      .map((pull) => pull.head.sha))].slice(0, 3);
    const payloads = await Promise.all(candidateHeads.map(async (headSha) => ({
      headSha,
      payload: await github(
        `/repos/${encodedRepository}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
      ),
    })));
    let guard = null;
    const observedEvidence = new Map(requirements.map((requirement) => [requirement.name, new Set()]));
    const runCache = new Map();
    for (const { headSha, payload } of payloads) {
      if (!Array.isArray(payload?.check_runs) || payload.check_runs.length >= 100) {
        throw new Error("GitHub returned an incomplete or invalid Check Run list.");
      }
      const guardRun = payload.check_runs.find((check) => check?.head_sha === headSha
        && check?.name === GUARD_CHECK_NAME
        && check?.app?.slug === expectedPublisher.appSlug
        && check?.app?.id === expectedPublisher.appId);
      if (guardRun) guard = expectedPublisher.appId;
      for (const requirement of requirements) {
        for (const check of payload.check_runs.filter((candidate) => (
          candidate?.head_sha === headSha
          && candidate?.name === requirement.name
          && candidate?.app?.slug === requirement.appSlug
          && Number.isSafeInteger(candidate?.app?.id)
          && candidate.app.id > 0
        ))) {
          const provenanceMatches = requirement.appSlug !== "github-actions"
            || await githubActionsWorkflowMatches({
              headSha,
              check,
              workflowPath: requirement.workflowPath,
              runCache,
            });
          if (provenanceMatches) observedEvidence.get(requirement.name).add(check.app.id);
        }
      }
    }
    return {
      guard,
      evidence: requirements.map(({ name }) => {
        const identities = [...observedEvidence.get(name)];
        return { name, integrationId: identities.length === 1 ? identities[0] : null };
      }),
    };
  }

  return Object.freeze({ freshness, forRepair, target, publisherIdentities, workflows });
}
