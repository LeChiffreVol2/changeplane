import { canonical } from './core.js';
import { assessObservation, validateObservationPolicy } from './observation.js';
import { boundedReader } from './transport.js';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const id = value => Number.isSafeInteger(value) && value > 0;
const assert = condition => { if (!condition) throw new Error('GITLAB_OBSERVATION_INCOMPLETE'); };
export function gitlabReader(token = '', fetchImpl = fetch) {
  return boundedReader({ provider: 'gitlab', origin: 'https://gitlab.com', prefix: '/api/v4/projects/', fetchImpl,
    headers: { Accept: 'application/json', 'User-Agent': 'changeplane-open-source', ...(token ? { 'PRIVATE-TOKEN': token } : {}) } });
}
async function list(read, path, limit) {
  const result = [];
  for (let page = 1; page <= Math.floor(limit / 100) + 1; page++) {
    const batch = await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    assert(Array.isArray(batch) && batch.length <= 100);
    result.push(...batch); assert(result.length <= limit);
    if (batch.length < 100) return result;
  }
  throw new Error('GITLAB_OBSERVATION_INCOMPLETE');
}
function state(job) {
  if (['created', 'pending', 'preparing', 'running', 'scheduled', 'waiting_for_resource', 'canceling'].includes(job.status)) return { status: 'in_progress', conclusion: null };
  const conclusions = { success: 'success', canceled: 'cancelled', skipped: 'skipped', manual: 'action_required', failed: 'failure' };
  assert(Object.hasOwn(conclusions, job.status));
  const reason = job.failure_reason;
  const conclusion = job.status === 'failed' && ['runner_system_failure', 'api_failure', 'scheduler_failure', 'runner_unsupported'].includes(reason)
    ? 'startup_failure' : job.status === 'failed' && ['job_execution_timeout', 'stuck_or_timeout_failure'].includes(reason)
      ? 'timed_out' : conclusions[job.status];
  return { status: 'completed', conclusion };
}
function target(mr, project, number) {
  assert(id(mr?.id) && mr.iid === number && mr.state === 'opened' && mr.target_project_id === project.id
    && id(mr.source_project_id) && mr.target_branch === project.default_branch
    && [mr.sha, mr.diff_refs?.head_sha, mr.diff_refs?.base_sha, mr.diff_refs?.start_sha].every(sha)
    && mr.sha === mr.diff_refs.head_sha && /^[1-9][0-9]{0,3}$/u.test(mr.changes_count) && Number(mr.changes_count) <= 3000);
  return { id: mr.id, number, sourceId: mr.source_project_id, targetId: mr.target_project_id,
    head: mr.sha, mergeBase: mr.diff_refs.base_sha, diffStart: mr.diff_refs.start_sha,
    sourceBranch: mr.source_branch, targetBranch: mr.target_branch, files: Number(mr.changes_count) };
}

/** GitLab.com reader candidate. GET-only, source/fork code is never executed. */
export async function inspectMergeRequest({ project: requestedProject, number, token, read = gitlabReader(token) }) {
  assert(typeof requestedProject === 'string' && requestedProject.length <= 300 && id(number)
    && /^(?:[1-9][0-9]*|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)$/u.test(requestedProject)
    && !requestedProject.split('/').some(part => ['.', '..'].includes(part)));
  const project = await read(`/api/v4/projects/${encodeURIComponent(requestedProject)}`);
  assert(id(project.id) && typeof project.default_branch === 'string' && project.default_branch.length > 0);
  assert(/^[1-9][0-9]*$/u.test(requestedProject) ? String(project.id) === requestedProject : project.path_with_namespace === requestedProject);
  const root = `/api/v4/projects/${project.id}`, mrPath = `${root}/merge_requests/${number}`;
  const initial = target(await read(mrPath), project, number);
  const branchPath = `${root}/repository/branches/${encodeURIComponent(project.default_branch)}`;
  const branch = await read(branchPath); assert(sha(branch.commit?.id));
  const contents = await read(`${root}/repository/files/.changeplane.json?ref=${branch.commit.id}`);
  assert(contents.encoding === 'base64' && Number.isSafeInteger(contents.size) && contents.size > 0 && contents.size <= 64000
    && typeof contents.content === 'string' && contents.content.length <= 90000);
  let policy;
  try { policy = validateObservationPolicy(JSON.parse(Buffer.from(contents.content, 'base64').toString('utf8'))); }
  catch { throw new Error('POLICY_INVALID'); }
  const diffs = await list(read, `${mrPath}/diffs`, 3000);
  assert(diffs.length === initial.files);
  const files = diffs.map(diff => {
    assert(typeof diff.new_path === 'string' && typeof diff.old_path === 'string'
      && diff.too_large !== true && diff.collapsed !== true);
    return { path: diff.new_path, ...(diff.renamed_file ? { previousPath: diff.old_path } : {}) };
  });
  const collect = async () => {
    const pipelines = await list(read, `${mrPath}/pipelines`, 100);
    assert(pipelines.every(pipeline => id(pipeline.id) && id(pipeline.project_id) && sha(pipeline.sha)
      && [initial.sourceId, initial.targetId].includes(pipeline.project_id)));
    assert(new Set(pipelines.map(pipeline => `${pipeline.project_id}/${pipeline.id}`)).size === pipelines.length);
    // Pipeline IDs are the provider's execution identity; a newer pending run supersedes an old success.
    const candidates = [...pipelines].sort((a, b) => b.id - a.id);
    const latest = candidates[0];
    if (!latest) return { evidence: [], execution: null };
    const pipelineRoot = `/api/v4/projects/${latest.project_id}/pipelines/${latest.id}`;
    const pipeline = await read(pipelineRoot);
    assert(pipeline.id === latest.id && pipeline.project_id === latest.project_id && pipeline.sha === latest.sha);
    const jobs = await list(read, `${pipelineRoot}/jobs?include_retried=false`, 100);
    assert(jobs.every(job => id(job.id) && job.pipeline?.id === pipeline.id && job.pipeline?.project_id === pipeline.project_id
      && job.pipeline?.sha === pipeline.sha && typeof job.name === 'string'));
    assert(new Set(jobs.map(job => job.id)).size === jobs.length);
    const evidence = jobs.filter(job => policy.evidence.required.some(item => item.name === job.name)).map(job => ({
      name: job.name, producer: { kind: 'gitlab-ci', id: String(pipeline.project_id) },
      execution: { id: `${pipeline.project_id}/${pipeline.id}/${job.id}`, attempt: String(job.id) },
      // The API associates this job with a SHA; a script can still override its checkout.
      subject: { kind: 'unknown', id: pipeline.sha, head: pipeline.sha }, ...state(job),
    }));
    return { evidence, execution: { projectId: pipeline.project_id, pipelineId: pipeline.id, sha: pipeline.sha,
      status: pipeline.status, source: pipeline.source, jobIds: jobs.map(job => job.id).sort((a, b) => a - b) } };
  };
  const first = await collect(), second = await collect();
  assert(canonical(first) === canonical(second));
  const finalProject = await read(root), finalBranch = await read(branchPath), final = target(await read(mrPath), project, number);
  assert(finalProject.id === project.id && finalProject.default_branch === project.default_branch
    && finalBranch.commit?.id === branch.commit.id && canonical(final) === canonical(initial));
  const report = assessObservation({ schemaVersion: 2,
    identity: { forge: 'gitlab', origin: 'https://gitlab.com', repositoryId: String(project.id),
      sourceRepositoryId: String(initial.sourceId), changeId: String(initial.id) },
    revisions: { head: initial.head, currentHead: final.head, target: branch.commit.id, currentTarget: finalBranch.commit.id,
      mergeBase: initial.mergeBase, diffStart: initial.diffStart, policy: branch.commit.id, currentPolicy: finalBranch.commit.id },
    policy, files, collection: { complete: true, stable: true, controlPathsComplete: false, controlPaths: ['.gitlab-ci.yml', '.gitlab/**'] },
    evidence: second.evidence });
  return { ...report, observation: { source: 'gitlab-api', observedAt: new Date().toISOString(), mergeRequest: number,
    diffStart: initial.diffStart, execution: second.execution },
    capabilities: { readOnly: true, qualification: 'candidate', testedSubjectVerified: false, ciIncludeClosureVerified: false,
      exclusivePublisherVerified: false, mergeEnforcementVerified: false, repair: false } };
}
