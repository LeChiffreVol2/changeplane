import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMergeRequest, gitlabReader } from './gitlab.js';
import { readFileSync } from 'node:fs';

const base = JSON.parse(readFileSync(new URL('./fixtures/observation.json', import.meta.url)));
const head = base.revisions.head, target = base.revisions.target;
function fixture() {
  const root = '/api/v4/projects/1', mrPath = `${root}/merge_requests/7`;
  const project = { id: 1, path_with_namespace: 'group/sub/project', default_branch: 'main' };
  const mr = { id: 70, iid: 7, state: 'opened', target_project_id: 1, source_project_id: 1, target_branch: 'main',
    source_branch: 'feature', sha: head, changes_count: '1',
    diff_refs: { head_sha: head, base_sha: base.revisions.mergeBase, start_sha: base.revisions.diffStart } };
  const pipeline = { id: 12, project_id: 1, sha: head, status: 'success', source: 'merge_request_event' };
  const job = { id: 99, name: 'Behavior', status: 'success', pipeline };
  const payloads = {
    '/api/v4/projects/group%2Fsub%2Fproject': project, [root]: project, [mrPath]: mr,
    [`${root}/repository/branches/main`]: { commit: { id: target } },
    [`${root}/repository/files/.changeplane.json?ref=${target}`]: { encoding: 'base64', size: JSON.stringify(base.policy).length,
      content: Buffer.from(JSON.stringify(base.policy)).toString('base64') },
    [`${mrPath}/diffs?per_page=100&page=1`]: [{ new_path: 'src/sort.js', old_path: 'src/sort.js', diff: 'PRIVATE_SYNTHETIC_DIFF' }],
    [`${mrPath}/pipelines?per_page=100&page=1`]: [pipeline], [`${root}/pipelines/12`]: pipeline,
    [`${root}/pipelines/12/jobs?include_retried=false&per_page=100&page=1`]: [job],
  };
  const requests = [];
  const read = async path => { requests.push(path); assert.ok(Object.hasOwn(payloads, path), `Unexpected read ${path}`); return structuredClone(payloads[path]); };
  return { root, mrPath, project, mr, pipeline, job, payloads, requests, read };
}
const inspect = read => inspectMergeRequest({ project: 'group/sub/project', number: 7, read });
test('GitLab reader retains distinct revision roles, subgroup identity and unqualified subject boundaries', async () => {
  const f = fixture(); const report = await inspect(f.read);
  assert.equal(report.binding.identity.repositoryId, '1');
  assert.equal(report.binding.identity.changeId, '70');
  assert.equal(report.binding.revisions.policy, target);
  assert.equal(report.binding.revisions.mergeBase, base.revisions.mergeBase);
  assert.equal(report.binding.revisions.diffStart, base.revisions.diffStart);
  assert.equal(report.decision, 'REVIEW_REQUIRED');
  assert.ok(report.findings.some(item => item.code === 'SUBJECT_UNVERIFIED'));
  assert.ok(report.findings.some(item => item.code === 'CONTROL_PATHS_UNRESOLVED'));
  assert.equal(report.capabilities.exclusivePublisherVerified, false);
  assert.equal(JSON.stringify(report).includes('PRIVATE_SYNTHETIC_DIFF'), false);
  assert.equal(f.requests.filter(path => path.includes('/jobs?')).length, 2);
  assert.equal(f.requests.some(path => path.includes(`/files/.changeplane.json?ref=${head}`)), false);
});
test('a retried current job does not inherit an older job success or pipeline summary', async () => {
  const f = fixture(); f.job.id = 100; f.job.status = 'pending';
  const report = await inspect(f.read);
  assert.equal(report.evidence[0].execution.attempt, '100');
  assert.ok(report.findings.some(item => item.code === 'EVIDENCE_PENDING'));
});
test('a newer merge-result or old-head execution never falls back to an older head success', async () => {
  const f = fixture(); const latest = { ...f.pipeline, id: 13, sha: 'f'.repeat(40), status: 'pending' };
  f.payloads[`${f.mrPath}/pipelines?per_page=100&page=1`].push(latest);
  f.payloads[`${f.root}/pipelines/13`] = latest;
  f.payloads[`${f.root}/pipelines/13/jobs?include_retried=false&per_page=100&page=1`] = [{ ...f.job, id: 100, status: 'pending', pipeline: latest }];
  const report = await inspect(f.read);
  assert.equal(report.observation.execution.pipelineId, 13);
  assert.equal(report.evidence[0].subject.kind, 'unknown');
  assert.equal(f.requests.some(path => path.includes('/pipelines/12/')), false);
});
test('fork identity stays separate without reading or executing fork CI configuration', async () => {
  const f = fixture(); f.mr.source_project_id = 2;
  const report = await inspect(f.read);
  assert.equal(report.binding.identity.sourceRepositoryId, '2');
  assert.equal(report.authority.repairAuthorized, false);
  assert.equal(f.requests.some(path => path.includes('/projects/2/repository/')), false);
});
for (const [reason, expected] of [['runner_system_failure', 'EVIDENCE_INFRASTRUCTURE_FAILURE'],
  ['job_execution_timeout', 'EVIDENCE_TIMED_OUT'], ['script_failure', 'EVIDENCE_DIAGNOSIS_REQUIRED']]) {
  test(`GitLab ${reason} preserves diagnosis without a code proposal`, async () => {
    const f = fixture(); f.job.status = 'failed'; f.job.failure_reason = reason; f.job.allow_failure = true;
    const report = await inspect(f.read);
    assert.ok(report.findings.some(item => item.code === expected));
    assert.equal(report.handback.campaign.sourceAttemptsAuthorized, 0);
  });
}
test('missing diff refs, truncated files, conflicting jobs and wrong execution identity fail closed', async () => {
  for (const mutate of [
    f => { f.mr.diff_refs = {}; }, f => { f.mr.changes_count = '1000+'; },
    f => { f.payloads[`${f.mrPath}/diffs?per_page=100&page=1`][0].too_large = true; },
    f => { f.job.pipeline = { ...f.pipeline, project_id: 3 }; },
  ]) { const f = fixture(); mutate(f); await assert.rejects(inspect(f.read)); }
  const f = fixture(); f.payloads[`${f.root}/pipelines/12/jobs?include_retried=false&per_page=100&page=1`].push({ ...f.job, id: 100 });
  assert.equal((await inspect(f.read)).decision, 'BLOCKED');
});
test('a head change during collection cannot return a stale report', async () => {
  const f = fixture(); let reads = 0;
  await assert.rejects(inspect(async path => {
    const result = await f.read(path);
    if (path === f.mrPath && ++reads === 2) { result.sha = 'f'.repeat(40); result.diff_refs.head_sha = result.sha; }
    return result;
  }));
});
test('GitLab transport sends credentials only to GitLab.com GETs', async () => {
  let calls = 0;
  const read = gitlabReader('synthetic-token', async (url, options) => {
    calls++; assert.equal(url, 'https://gitlab.com/api/v4/projects/group%2Fproject');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['PRIVATE-TOKEN'], 'synthetic-token'); return Response.json({ id: 1 });
  });
  await read('/api/v4/projects/group%2Fproject');
  await assert.rejects(read('https://attacker.invalid/api/v4/projects/x'));
  assert.equal(calls, 1);
});
