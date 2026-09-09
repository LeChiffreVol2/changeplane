import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assess } from './core.js';
import { githubReader, inspectPullRequest } from './github.js';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const policy = { protectedPaths: { requireApproval: ['infra/**'], block: ['secrets/**'] },
  evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] } };
function snapshot() {
  return { schemaVersion: 1, baseSha: base, headSha: head, currentHeadSha: head, policy: structuredClone(policy),
    files: [{ path: 'src/sort.js' }], checks: [{ name: 'Behavior', source: 'github-actions', headSha: head,
      workflowPath: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success' }] };
}
test('core shares deterministic scope/evidence behavior without granting authority', () => {
  const report = assess(snapshot());
  assert.equal(report.decision, 'EVIDENCE_SATISFIED');
  assert.deepEqual(report.authority, { advisory: true, guardPublished: false, mergeAuthorized: false, repairAuthorized: false });
  assert.equal(report.handback.headSha, head);
  assert.deepEqual(assess(snapshot()), report);
});
for (const [label, mutate, expected] of [
  ['stale head', input => { input.currentHeadSha = base; }, 'BLOCKED'],
  ['stale evidence', input => { input.checks[0].headSha = base; }, 'REVIEW_REQUIRED'],
  ['failed evidence', input => { input.checks[0].conclusion = 'failure'; }, 'REVIEW_REQUIRED'],
  ['queued rerun', input => { input.checks[0].status = 'queued'; input.checks[0].conclusion = null; }, 'REVIEW_REQUIRED'],
  ['skipped evidence', input => { input.checks[0].conclusion = 'skipped'; }, 'REVIEW_REQUIRED'],
  ['wrong publisher', input => { input.checks[0].source = 'another-app'; }, 'REVIEW_REQUIRED'],
  ['wrong workflow', input => { input.checks[0].workflowPath = '.github/workflows/untrusted.yml'; }, 'REVIEW_REQUIRED'],
  ['ambiguous success', input => { input.checks.push({ ...input.checks[0], status: 'in_progress' }); }, 'BLOCKED'],
  ['protected test', input => { input.files = [{ path: 'src/sort.test.js' }]; }, 'REVIEW_REQUIRED'],
  ['renamed test', input => { input.files = [{ path: 'src/sort.js', previousPath: 'tests/sort.js' }]; }, 'REVIEW_REQUIRED'],
  ['blocked path', input => { input.files = [{ path: 'secrets/value.txt' }]; }, 'BLOCKED'],
  ['expanded scope', input => { input.plannedPaths = ['lib/**']; }, 'REVIEW_REQUIRED'],
]) test(label, () => { const input = snapshot(); mutate(input); assert.equal(assess(input).decision, expected); });
test('caller approvals and diagnostics cannot grant authority or enter output', () => {
  const input = snapshot(); input.files = [{ path: 'package.json' }];
  input.approval = { authorized: true }; input.checks[0].diagnostic = 'arbitrary private output';
  const report = assess(input);
  assert.equal(report.decision, 'REVIEW_REQUIRED');
  assert.equal(JSON.stringify(report).includes('arbitrary private output'), false);
});
test('missing requirements and traversal are rejected, never interpreted as success', () => {
  const empty = snapshot(); empty.policy.evidence.requiredChecks = [];
  assert.throws(() => assess(empty));
  const traversal = snapshot(); traversal.files[0].path = '../secret';
  assert.throws(() => assess(traversal));
  const unbound = snapshot(); unbound.policy.evidence.requiredChecks = ['Behavior'];
  assert.throws(() => assess(unbound));
});

function fixture(overrides = {}) {
  const root = '/repos/example/project';
  const pr = { id: 71, number: 7, state: 'open', changed_files: 1,
    head: { sha: head, ref: 'feature', repo: { id: 1, full_name: 'example/project' } },
    base: { sha: base, ref: 'main', repo: { id: 1, full_name: 'example/project' } } };
  const run = { id: 12, workflow_id: 18, run_number: 2, run_attempt: 2, head_sha: head,
    path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success',
    repository: { full_name: 'example/project' }, head_repository: { full_name: 'example/project' } };
  const payloads = {
    [root]: { id: 1, full_name: 'example/project', default_branch: 'main' },
    [`${root}/pulls/7`]: pr,
    [`${root}/commits/main`]: { sha: base },
    [`${root}/contents/.changeplane.json?ref=${base}`]: { type: 'file', encoding: 'base64', size: JSON.stringify(policy).length,
      content: Buffer.from(JSON.stringify(policy)).toString('base64') },
    [`${root}/pulls/7/files?per_page=100&page=1`]: [{ filename: 'src/sort.js', status: 'modified' }],
    [`${root}/actions/runs?head_sha=${head}&per_page=100`]: { total_count: 1, workflow_runs: [run] },
    [`${root}/actions/runs/12/attempts/2/jobs?per_page=100`]: { total_count: 1,
      jobs: [{ id: 99, run_id: 12, head_sha: head, name: 'Behavior', status: 'completed', conclusion: 'success' }] },
    ...overrides,
  };
  const requests = [];
  return { payloads, run, pr, requests, read: async path => {
    requests.push(path);
    assert.ok(Object.hasOwn(payloads, path), `Unexpected read ${path}`);
    return structuredClone(payloads[path]);
  } };
}
const inspect = read => inspectPullRequest({ repository: 'example/project', number: 7, read });
test('GitHub reader binds default-branch policy and the latest workflow attempt twice', async () => {
  const f = fixture(); const result = await inspect(f.read);
  assert.equal(result.decision, 'EVIDENCE_SATISFIED');
  assert.equal(result.observation.source, 'github-api');
  assert.equal(f.requests.filter(path => path.includes('/attempts/2/jobs')).length, 2);
  assert.equal(f.requests.some(path => path.includes(`?ref=${head}`)), false);
});
test('a queued same-SHA rerun supersedes old successful jobs', async () => {
  const f = fixture(); f.run.status = 'queued'; f.run.conclusion = null;
  const result = await inspect(f.read);
  assert.equal(result.decision, 'REVIEW_REQUIRED');
  assert.equal(f.requests.some(path => path.includes('/jobs')), false);
});
test('later workflow run wins even when the API returns the old success first', async () => {
  const f = fixture(); const list = f.payloads[`/repos/example/project/actions/runs?head_sha=${head}&per_page=100`];
  list.total_count = 2; list.workflow_runs.push({ ...f.run, id: 13, run_number: 3, status: 'queued', conclusion: null });
  assert.equal((await inspect(f.read)).decision, 'REVIEW_REQUIRED');
});
test('fork assessment reads target policy and preserves separate source identity without executing code', async () => {
  const f = fixture(); f.pr.head.repo = { id: 2, full_name: 'someone/fork' };
  f.run.head_repository.full_name = 'someone/fork';
  const report = await inspect(f.read);
  assert.equal(report.handback.binding.identity.sourceRepositoryId, '2');
  assert.equal(report.handback.binding.identity.repositoryId, '1');
  assert.equal(report.authority.repairAuthorized, false);
  assert.equal(f.requests.some(path => path.includes('/repos/someone/')), false);
});
test('recreated workflow identities cannot inherit an older run number success', async () => {
  const f = fixture(); const list = f.payloads[`/repos/example/project/actions/runs?head_sha=${head}&per_page=100`];
  list.total_count = 2; list.workflow_runs.push({ ...f.run, id: 13, workflow_id: 19, run_number: 1, status: 'queued', conclusion: null });
  await assert.rejects(inspect(f.read), /WORKFLOW_AMBIGUOUS/u);
});
test('incomplete run pages never hide a later evaluation', async () => {
  const f = fixture(); f.payloads[`/repos/example/project/actions/runs?head_sha=${head}&per_page=100`].total_count = 101;
  await assert.rejects(inspect(f.read), /GITHUB_LIMIT/u);
});
test('wrong-attempt job, duplicate job names and skipped job cannot satisfy evidence', async () => {
  const f = fixture(); const jobs = f.payloads['/repos/example/project/actions/runs/12/attempts/2/jobs?per_page=100'];
  jobs.jobs[0].run_id = 9;
  await assert.rejects(inspect(f.read), /JOB_IDENTITY_INVALID/u);
  jobs.jobs[0].run_id = 12; jobs.jobs[0].conclusion = 'skipped';
  assert.equal((await inspect(f.read)).decision, 'REVIEW_REQUIRED');
  jobs.total_count = 2; jobs.jobs.push({ ...jobs.jobs[0], id: 100 });
  await assert.rejects(inspect(f.read), /JOB_AMBIGUOUS/u);
});
test('head and workflow drift during collection stop the assessment', async () => {
  const f = fixture(); let pulls = 0;
  await assert.rejects(inspect(async path => {
    const value = await f.read(path);
    if (path.endsWith('/pulls/7') && ++pulls === 2) value.head.sha = 'c'.repeat(40);
    return value;
  }), /REVISION_CHANGED/u);
  let runs = 0;
  await assert.rejects(inspect(async path => {
    const value = await f.read(path);
    if (path.includes('/actions/runs?') && ++runs === 2) value.workflow_runs[0].run_attempt = 3;
    if (path.includes('/attempts/3/')) throw new Error('EVIDENCE_CHANGED');
    return value;
  }), /Unexpected read|EVIDENCE_CHANGED/u);
});
test('transport is fixed-origin GET-only, redacts errors and refuses credential redirects', async () => {
  const reader = githubReader('synthetic-token', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/example/project');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return new Response('private response', { status: 403 });
  });
  await assert.rejects(reader('/repos/example/project'), error => error.code === 'PERMISSION_DENIED' && !error.message.includes('private'));
});
test('CLI quickstart runs without dependencies and uses meaningful exit codes', () => {
  for (const [name, status] of [['satisfied', 0], ['failed', 1], ['stale', 1]]) {
    const child = spawnSync(process.execPath, ['community/cli.js', 'evaluate', `examples/community/${name}.json`], { encoding: 'utf8' });
    assert.equal(child.status, status, child.stderr);
    assert.equal(JSON.parse(child.stdout).authority.guardPublished, false);
  }
  const invalid = spawnSync(process.execPath, ['community/cli.js', 'inspect', 'bad/repo/path', '7'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stderr).decision, 'UNAVAILABLE');
});
