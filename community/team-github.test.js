import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TeamError } from './team.js';
import { operateTeam, teamGitHub, nextTeamHandoffs } from './team-github.js';
import { CollectionError } from './transport.js';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareTeamWorktree } from './team-worktree.js';

const base = 'a'.repeat(40), head = 'b'.repeat(40);
const policy = { team: { enabled: true, maxActive: 3 }, protectedPaths: { block: [], requireApproval: [] },
  evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] } };
const file = value => ({ type: 'file', encoding: 'base64', size: JSON.stringify(value).length, content: Buffer.from(JSON.stringify(value)).toString('base64') });
function fixture({ baseSha = base } = {}) {
  const base = baseSha;
  let tip = null, counter = 0;
  const trees = new Map(), commits = new Map(), writes = [];
  const sha = value => createHash('sha1').update(value).digest('hex');
  const pr = { id: 91, number: 9, state: 'open', merged: false, merge_commit_sha: null, changed_files: 1, draft: false, mergeable: true,
    head: { sha: head, ref: 'changeplane/work/api-1', repo: { id: 7, full_name: 'example/repo' } },
    base: { sha: base, ref: 'main', repo: { id: 7, full_name: 'example/repo' } } };
  const f = { policy: structuredClone(policy), pr, fail: null, writes, files: [{ filename: 'src/api/a.js', status: 'modified' }], conclusion: 'success', attempt: 1, comparison: 'ahead' };
  const api = { repository: 'example/repo', root: '/repos/example/repo', request: async (method, path, body) => {
    if (f.fail?.(method, path)) throw new TeamError('TEAM_WRITE_UNCERTAIN');
    const suffix = path.replace(api.root, '');
    if (method === 'GET') {
      if (!suffix) return { id: 7, full_name: api.repository, default_branch: 'main' };
      if (suffix === '/commits/main') return { sha: base };
      if (suffix.startsWith('/contents/.changeplane.json?ref=')) return file(f.policy);
      if (suffix === '/git/ref/heads/changeplane/team-state') {
        if (!tip) throw new CollectionError('NOT_FOUND', { provider: 'github', status: 404 });
        return { ref: 'refs/heads/changeplane/team-state', object: { type: 'commit', sha: tip } };
      }
      if (suffix.startsWith('/contents/team.json?ref=')) return file(JSON.parse(trees.get(commits.get(suffix.split('=')[1]).tree)));
      if (suffix === '/pulls/9') return structuredClone(pr);
      if (suffix.startsWith('/pulls?')) return suffix.includes(encodeURIComponent('example:changeplane/work/api-1')) ? [{ number: 9 }] : [];
      if (suffix.startsWith('/pulls/9/files?')) return f.files;
      if (suffix.startsWith('/actions/runs?')) return { total_count: 1, workflow_runs: [{ id: 11, workflow_id: 12, run_number: 1,
        run_attempt: f.attempt, head_sha: head, path: '.github/workflows/ci.yml', status: 'completed', conclusion: f.conclusion,
        repository: { full_name: api.repository }, head_repository: { full_name: api.repository } }] };
      if (suffix === `/actions/runs/11/attempts/${f.attempt}/jobs?per_page=100`) return { total_count: 1, jobs: [{ id: 13, run_id: 11,
        head_sha: head, name: 'Behavior', status: 'completed', conclusion: f.conclusion }] };
      if (suffix.startsWith('/compare/')) return { status: f.comparison };
      throw new Error(`Unexpected read: ${suffix}`);
    }
    writes.push({ method, path, body });
    if (suffix === '/git/trees') { const id = sha(JSON.stringify(body)); trees.set(id, body.tree[0].content); return { sha: id }; }
    if (suffix === '/git/commits') { const id = sha(JSON.stringify(body) + ++counter); commits.set(id, body); return { sha: id }; }
    if (suffix === '/git/refs' || suffix === '/git/refs/heads/changeplane/team-state') {
      if (tip ? method !== 'PATCH' || commits.get(body.sha).parents[0] !== tip : method !== 'POST') throw new TeamError('TEAM_CONCURRENT_UPDATE');
      assert.notEqual(body.force, true); tip = body.sha;
      return { ref: 'refs/heads/changeplane/team-state', object: { sha: tip } };
    }
    throw new Error(`Unexpected mutation: ${suffix}`);
  } };
  return { ...f, get policy() { return f.policy; }, pr, api, setFailure: failure => { f.fail = failure; },
    setAttempt: value => { f.attempt = value; }, setComparison: value => { f.comparison = value; }, setFiles: files => { f.files = files; }, setConclusion: value => { f.conclusion = value; } };
}
const run = (f, command) => operateTeam({ api: f.api, command });
async function planned(f) {
  return run(f, { action: 'plan', tasks: [
    { id: 'api', title: 'API', paths: ['src/api/**'] },
    { id: 'web', title: 'Web', paths: ['src/web/**'] },
    { id: 'next', title: 'Next', paths: ['src/integration.js'], dependsOn: ['api'] },
  ] });
}
test('concurrent clients cannot claim the same task or overwrite an independent task update', async () => {
  const f = fixture(); await planned(f);
  const results = await Promise.allSettled(['alice', 'bob'].map(owner => run(f, { action: 'claim', task: 'api', owner })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  await run(f, { action: 'claim', task: 'web', owner: 'bob' });
  const status = await run(f, { action: 'status' });
  assert.equal(status.tasks.filter(task => task.state === 'active').length, 2);
  assert.equal(status.tasks[0].owner, 'alice');
});
test('reconciliation preserves scope, CI failures and closed-unmerged reservations; merge releases dependencies', async () => {
  const f = fixture(); await planned(f); await run(f, { action: 'claim', task: 'api', owner: 'alice' });
  await run(f, { action: 'bind', task: 'api', pullRequest: 9 });
  let result = await run(f, { action: 'reconcile' });
  assert.equal(result.tasks[0].outcome, 'AWAIT_GITHUB_REVIEW_AND_MERGE');
  f.setConclusion('failure'); result = await run(f, { action: 'reconcile' });
  assert.equal(result.tasks[0].outcome, 'INSPECT_FAILURE_EVIDENCE');
  f.setConclusion('success'); f.setFiles([{ filename: 'src/web/other.js', status: 'modified' }]);
  result = await run(f, { action: 'reconcile' }); assert.equal(result.tasks[0].state, 'blocked');
  f.pr.state = 'closed'; result = await run(f, { action: 'reconcile' });
  assert.equal(result.tasks[0].outcome, 'CLOSED_UNMERGED_RESERVATION_HELD');
  await assert.rejects(run(f, { action: 'claim', task: 'next', owner: 'alice' }), /TEAM_DEPENDENCY_PENDING/);
  f.pr.merged = true; f.pr.merge_commit_sha = 'c'.repeat(40);
  result = await run(f, { action: 'reconcile' }); assert.equal(result.tasks[0].state, 'merged');
  assert.equal((await run(f, { action: 'claim', task: 'next', owner: 'alice' })).task.baseSha, base);
  assert.ok(f.writes.every(item => item.path.includes('/git/')));
});
test('unavailable evidence replaces prior readiness and foreign PR bindings are rejected', async () => {
  const f = fixture(); await planned(f); await run(f, { action: 'claim', task: 'api', owner: 'alice' });
  f.pr.head.repo.id = 8;
  await assert.rejects(run(f, { action: 'bind', task: 'api', pullRequest: 9 }), /TEAM_PR_MISMATCH/);
  f.pr.head.repo.id = 7; await run(f, { action: 'bind', task: 'api', pullRequest: 9 });
  await run(f, { action: 'reconcile' });
  f.setFailure((method, path) => path.includes('/actions/'));
  const result = await run(f, { action: 'reconcile' });
  assert.equal(result.tasks[0].outcome, 'REOBSERVE_UNAVAILABLE');
  assert.equal(result.observations[0].state, 'unavailable');
});
test('HTTP writer stays on its configured repository and never retries ambiguous mutations', async () => {
  let calls = 0;
  const api = teamGitHub({ repository: 'example/repo', token: 'synthetic', writeEnabled: true,
    fetchImpl: async () => { calls++; throw new Error('private provider body'); } });
  await assert.rejects(api.request('POST', '/repos/other/repo/git/trees', {}), /TEAM_REPOSITORY_MISMATCH/);
  await assert.rejects(api.request('PUT', '/repos/example/repo/pulls/1/merge', {}), /TEAM_OPERATION_DENIED/);
  await assert.rejects(api.request('PATCH', '/repos/example/repo/git/refs/heads/changeplane/team-state', { force: true }), /TEAM_OPERATION_DENIED/);
  assert.equal(calls, 0);
  await assert.rejects(api.request('POST', '/repos/example/repo/git/trees', {}), /TEAM_WRITE_UNCERTAIN/);
  assert.equal(calls, 1);
});
test('start reserves a task atomically and reconciliation discovers its PR without a manual bind', async () => {
  const f = fixture();
  const result = await run(f, { action: 'start', contract: { id: 'api', title: 'API', paths: ['src/api/**'] }, owner: 'alice' });
  assert.equal(result.task.state, 'active');
  const refreshed = await run(f, { action: 'reconcile' });
  assert.equal(refreshed.tasks[0].pullRequest, 9);
  assert.equal(refreshed.tasks[0].outcome, 'AWAIT_GITHUB_REVIEW_AND_MERGE');
});
test('real Git worktree creation leaves the developer checkout untouched and prevents a second machine reservation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'changeplane-team-worktree-'));
  const checkout = join(root, 'checkout'), bare = join(root, 'remote.git'), destination = join(root, 'api');
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const saved = { command: process.env.GIT_SSH_COMMAND, variant: process.env.GIT_SSH_VARIANT, token: process.env.GH_TOKEN };
  try {
    mkdirSync(checkout); git(checkout, ['init', '-b', 'main']);
    git(checkout, ['config', 'user.name', 'Synthetic Team']); git(checkout, ['config', 'user.email', 'team@example.invalid']);
    mkdirSync(join(checkout, 'src/api'), { recursive: true }); writeFileSync(join(checkout, 'src/api/a.js'), 'export const value = 1;\n');
    writeFileSync(join(checkout, '.gitattributes'), 'src/api/a.js filter=synthetic\n');
    const marker = join(root, 'filter-ran');
    const filter = join(root, 'filter.sh');
    writeFileSync(filter, `#!/bin/sh\necho unsafe > '${marker}'\ncat\n`, { mode: 0o700 });
    git(checkout, ['config', 'filter.synthetic.smudge', filter]);
    git(checkout, ['config', 'filter.synthetic.required', 'true']);
    git(checkout, ['config', 'filter.synthetic.clean', 'cat']);
    git(checkout, ['add', '.']); git(checkout, ['commit', '-m', 'Synthetic baseline']);
    const revision = git(checkout, ['rev-parse', 'HEAD']);
    git(root, ['clone', '--bare', checkout, bare]);
    git(checkout, ['remote', 'add', 'origin', 'git@github.com:example/repo.git']);
    const ssh = join(root, 'ssh');
    writeFileSync(ssh, `#!/bin/sh\ntest -z \"$GH_TOKEN\" || exit 91\nexec git-upload-pack '${bare.replaceAll("'", "'\\''")}'\n`, { mode: 0o700 });
    process.env.GH_TOKEN = 'synthetic-env-marker';
    process.env.GIT_SSH_COMMAND = ssh; process.env.GIT_SSH_VARIANT = 'simple';
    writeFileSync(join(checkout, 'unrelated.txt'), 'Keep this draft');
    const f = fixture({ baseSha: revision }); await planned(f); await run(f, { action: 'claim', task: 'api', owner: 'alice' });
    const conditional = join(root, 'conditional.config');
    writeFileSync(conditional, `[filter \"hidden\"]\n  smudge = ${filter}\n`);
    git(checkout, ['config', 'includeIf.onbranch:changeplane/work/**.path', conditional]);
    await assert.rejects(prepareTeamWorktree({ api: f.api, taskId: 'api', owner: 'alice', cwd: checkout, destination }), /TEAM_CONDITIONAL_GIT_CONFIG/);
    assert.equal((await run(f, { action: 'status' })).tasks[0].workspaceId, null);
    assert.equal(existsSync(destination), false);
    git(checkout, ['config', '--unset-all', 'includeIf.onbranch:changeplane/work/**.path']);
    const result = await prepareTeamWorktree({ api: f.api, taskId: 'api', owner: 'alice', cwd: checkout, destination });
    assert.equal(result.codebase.revision, revision);
    assert.equal(existsSync(marker), false, 'checkout must not execute smudge filters');
    assert.equal(git(destination, ['branch', '--show-current']), 'changeplane/work/api-1');
    assert.equal(git(checkout, ['branch', '--show-current']), 'main');
    assert.equal(readFileSync(join(checkout, 'unrelated.txt'), 'utf8'), 'Keep this draft');
    await assert.rejects(prepareTeamWorktree({ api: f.api, taskId: 'api', owner: 'alice', cwd: checkout, destination: join(root, 'second-machine') }), /TEAM_WORKSPACE_RESERVED/);
  } finally {
    if (saved.token === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = saved.token;
    if (saved.command === undefined) delete process.env.GIT_SSH_COMMAND; else process.env.GIT_SSH_COMMAND = saved.command;
    if (saved.variant === undefined) delete process.env.GIT_SSH_VARIANT; else process.env.GIT_SSH_VARIANT = saved.variant;
    rmSync(root, { recursive: true, force: true });
  }
});

test('merged prerequisites must remain in current default history before another claim', async () => {
  const f = fixture(); await planned(f); await run(f, { action: 'claim', task: 'api', owner: 'alice' });
  await run(f, { action: 'reconcile' });
  f.pr.state = 'closed'; f.pr.merged = true; f.pr.merge_commit_sha = 'c'.repeat(40);
  await run(f, { action: 'reconcile' });
  f.setComparison('diverged');
  await assert.rejects(run(f, { action: 'claim', task: 'next', owner: 'alice' }), /TEAM_MERGE_NOT_ON_BASE/);
  await assert.rejects(run(f, { action: 'start', contract: { id: 'later', title: 'Later', paths: ['src/later.js'], dependsOn: ['api'] }, owner: 'bob' }), /TEAM_MERGE_NOT_ON_BASE/);
});
test('handoffs repeat until workspace receipt, invalidate on new evidence and return branch-update work to the existing writer', async () => {
  const f = fixture(); await planned(f); await run(f, { action: 'claim', task: 'api', owner: 'alice' });
  const workspaceId = '11111111-1111-1111-1111-111111111111';
  await run(f, { action: 'workspace', task: 'api', owner: 'alice', workspaceId });
  f.setConclusion('failure');
  const inbox = () => nextTeamHandoffs({ api: f.api, owner: 'alice' });
  const delivery = (await inbox()).handoffs[0];
  assert.equal(delivery.outcome, 'INSPECT_FAILURE_EVIDENCE');
  assert.equal(delivery.evidence.authority.mergeAuthorized, false);
  assert.equal((await inbox()).handoffs[0].id, delivery.id);
  assert.equal((await nextTeamHandoffs({ api: f.api, owner: 'bob' })).handoffs.length, 0);
  const ack = { action: 'acknowledge', task: 'api', owner: 'alice', workspaceId, handoff: delivery.id };
  await assert.rejects(run(f, { ...ack, workspaceId: '22222222-2222-2222-2222-222222222222' }), /TEAM_WORKSPACE_MISMATCH/);
  await run(f, ack);
  assert.equal((await inbox()).handoffs.length, 0);
  f.setAttempt(2);
  await assert.rejects(run(f, ack), /TEAM_HANDOFF_STALE/);
  const rerun = (await inbox()).handoffs[0];
  assert.notEqual(rerun.id, delivery.id, 'same-head same-outcome rerun is a new observation');
  await run(f, { ...ack, handoff: rerun.id });
  f.setConclusion('success');
  await assert.rejects(run(f, ack), /TEAM_HANDOFF_STALE/);
  const ready = (await inbox()).handoffs[0];
  assert.notEqual(ready.id, delivery.id);
  f.setComparison('diverged');
  assert.equal((await inbox()).handoffs[0].outcome, 'UPDATE_BRANCH_FROM_DEFAULT');
  f.setFailure((method, path) => path.includes('/actions/'));
  const unavailable = await inbox();
  assert.equal(unavailable.handoffs.length, 0);
  assert.deepEqual(unavailable.unavailable, ['api']);
});
