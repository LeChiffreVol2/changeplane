import { assess, canonical, validatePolicy } from './core.js';
import { githubWorkflowFilePath } from '../src/lib/harness.js';
import { boundedReader } from './transport.js';
import { createHash } from 'node:crypto';

const SHA = /^[a-f0-9]{40}$/u;
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** Fixed-origin, GET-only transport. Never follows redirects with credentials. */
export function githubReader(token = '', fetchImpl = fetch) {
  return boundedReader({ provider: 'github', origin: 'https://api.github.com', prefix: '/repos/', fetchImpl,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'changeplane-open-source', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
}

function boundedList(response, key, max = 100) {
  if (!response || !Array.isArray(response[key]) || !Number.isSafeInteger(response.total_count)
    || response.total_count < 0 || response.total_count > max || response[key].length !== response.total_count) {
    throw new Error('GITHUB_LIMIT: incomplete or oversized evidence; narrow the workflow before retrying.');
  }
  return response[key];
}

function target(pr, repo, defaultBranch) {
  if (!positive(pr?.number) || pr.state !== 'open' || !SHA.test(pr.head?.sha) || !SHA.test(pr.base?.sha)
    || !positive(pr.head.repo?.id) || !positive(pr.base.repo?.id) || !positive(pr.id)
    || typeof pr.head.repo.full_name !== 'string' || !same(pr.base.repo?.full_name, repo)
    || pr.base.ref !== defaultBranch || !Number.isSafeInteger(pr.changed_files) || pr.changed_files < 1 || pr.changed_files > 3000) {
    throw new Error('TARGET_UNSUPPORTED: use an open PR targeting the default branch with available source identity (1–3000 files).');
  }
  return { headSha: pr.head.sha, baseSha: pr.base.sha, headRef: pr.head.ref, baseRef: pr.base.ref, files: pr.changed_files,
    sourceRepository: pr.head.repo.full_name, sourceRepositoryId: pr.head.repo.id, repositoryId: pr.base.repo.id, changeId: pr.id };
}

export async function inspectPullRequest({ repository, number, token, read = githubReader(token) }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(repository)
    || !positive(number)) throw new Error('TARGET_INVALID: use owner/repository and a positive pull request number.');
  const root = `/repos/${repository}`;
  const repo = await read(root);
  if (!positive(repo.id) || !same(repo.full_name, repository) || !repo.default_branch) throw new Error('REPOSITORY_INVALID');
  const pr = await read(`${root}/pulls/${number}`);
  if (pr.number !== number) throw new Error('TARGET_INVALID');
  const initial = target(pr, repository, repo.default_branch);
  if (initial.repositoryId !== repo.id) throw new Error('REPOSITORY_INVALID');
  const base = await read(`${root}/commits/${encodeURIComponent(repo.default_branch)}`);
  if (!SHA.test(base.sha)) throw new Error('BASE_INVALID');
  const contents = await read(`${root}/contents/.changeplane.json?ref=${base.sha}`);
  if (contents.type !== 'file' || contents.encoding !== 'base64' || !Number.isSafeInteger(contents.size)
    || contents.size > 64_000 || typeof contents.content !== 'string' || contents.content.length > 90_000) {
    throw new Error('POLICY_INVALID: default-branch .changeplane.json must be a bounded JSON file.');
  }
  let policy;
  try { policy = JSON.parse(Buffer.from(contents.content, 'base64').toString('utf8')); }
  catch { throw new Error('POLICY_INVALID: default-branch .changeplane.json must contain JSON.'); }
  validatePolicy(policy);
  const files = [];
  for (let page = 1; files.length < initial.files; page++) {
    const batch = await read(`${root}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length < 1 || batch.length > 100) throw new Error('FILES_INCOMPLETE');
    files.push(...batch.map(file => {
      if (file.status === 'renamed' && !file.previous_filename) throw new Error('RENAME_INCOMPLETE');
      return { path: file.filename, ...(file.previous_filename ? { previousPath: file.previous_filename } : {}) };
    }));
  }
  if (files.length !== initial.files) throw new Error('FILES_CHANGED: retry this PR.');
  const collect = async () => {
    const runs = policy.evidence.requiredChecks.some(item => item.appSlug === 'github-actions')
      ? boundedList(await read(`${root}/actions/runs?head_sha=${initial.headSha}&per_page=100`), 'workflow_runs') : [];
    const appRequirements = policy.evidence.requiredChecks.filter(item => item.appSlug !== 'github-actions');
    const appChecks = appRequirements.length
      ? boundedList(await read(`${root}/commits/${initial.headSha}/check-runs?filter=latest&per_page=100`), 'check_runs') : [];
    const checks = [];
    const identities = [];
    const jobsByRun = new Map();
    for (const requirement of policy.evidence.requiredChecks) {
      if (requirement.appSlug !== 'github-actions') {
        for (const check of appChecks.filter(check => check.head_sha === initial.headSha
          && check.name === requirement.name && check.app?.slug === requirement.appSlug)) {
          if (!positive(check.id) || !positive(check.app?.id)) throw new Error('CHECK_IDENTITY_INVALID');
          checks.push({ name: check.name, source: check.app.slug, headSha: check.head_sha, status: check.status, conclusion: check.conclusion });
          identities.push({ checkId: check.id, appId: check.app.id, status: check.status, conclusion: check.conclusion });
        }
        continue;
      }
      const candidates = runs.filter(run => run.head_sha === initial.headSha
        && githubWorkflowFilePath(run.path) === requirement.workflowPath);
      if (candidates.some(run => !positive(run.id) || !positive(run.workflow_id) || !positive(run.run_number) || !positive(run.run_attempt)
        || !same(run.repository?.full_name, repository) || !same(run.head_repository?.full_name, initial.sourceRepository))) {
        throw new Error('WORKFLOW_IDENTITY_INVALID');
      }
      if (new Set(candidates.map(run => run.workflow_id)).size > 1) {
        throw new Error('WORKFLOW_AMBIGUOUS: the workflow identity changed; choose an unambiguous evidence workflow.');
      }
      // A later run or attempt supersedes older successes, including while queued.
      candidates.sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt || b.id - a.id);
      const run = candidates[0];
      if (!run) continue;
      identities.push({ runId: run.id, attempt: run.run_attempt, status: run.status, conclusion: run.conclusion });
      let status = run.status === 'completed' ? 'completed' : 'in_progress';
      let conclusion = run.status === 'completed' ? run.conclusion : null;
      if (run.status === 'completed' && run.conclusion === 'success') {
        if (!jobsByRun.has(run.id)) jobsByRun.set(run.id, boundedList(
          await read(`${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`), 'jobs'));
        const jobs = jobsByRun.get(run.id).filter(job => job.name === requirement.name);
        if (jobs.length !== 1) throw new Error('JOB_AMBIGUOUS: bind one unique job name in the selected workflow.');
        const job = jobs[0];
        if (!positive(job.id) || job.run_id !== run.id || job.head_sha !== initial.headSha) throw new Error('JOB_IDENTITY_INVALID');
        status = job.status; conclusion = job.conclusion;
        identities.push({ jobId: job.id, status, conclusion });
      }
      checks.push({ name: requirement.name, source: 'github-actions', workflowPath: requirement.workflowPath,
        headSha: initial.headSha, status, conclusion });
    }
    return { checks, identities };
  };
  const first = await collect();
  const second = await collect();
  if (canonical(first) !== canonical(second)) throw new Error('EVIDENCE_CHANGED: a workflow changed during inspection; rerun the assessment.');
  const finalRepo = await read(root);
  const finalBase = await read(`${root}/commits/${encodeURIComponent(repo.default_branch)}`);
  const finalPr = await read(`${root}/pulls/${number}`);
  if (finalRepo.id !== repo.id || finalRepo.default_branch !== repo.default_branch || finalBase.sha !== base.sha
    || finalPr.number !== number || canonical(target(finalPr, repository, repo.default_branch)) !== canonical(initial)) {
    throw new Error('REVISION_CHANGED: the PR or trusted default branch changed; reassess.');
  }
  const report = assess({ schemaVersion: 1, baseSha: base.sha, headSha: initial.headSha,
    currentHeadSha: finalPr.head.sha, policy, files, checks: second.checks });
  const identity = { forge: 'github', origin: 'https://github.com', repositoryId: String(repo.id),
    sourceRepositoryId: String(initial.sourceRepositoryId), changeId: String(initial.changeId) };
  const binding = { ...report.handback.binding, identity, policyRevision: base.sha, targetRevision: initial.baseSha,
    observationDigest: createHash('sha256').update(canonical({ identity, initial, policyDigest: report.policyDigest,
      inputDigest: report.inputDigest, executions: second.identities })).digest('hex') };
  return { ...report, handback: { ...report.handback, binding, executions: second.identities },
    observation: { source: 'github-api', identity, repository, pullRequest: number,
    observedAt: new Date().toISOString(), workflowIdentities: second.identities,
    limitation: 'Point-in-time read-only assessment. GitHub may change immediately afterward; this is not a Guard or merge approval.' } };
}
