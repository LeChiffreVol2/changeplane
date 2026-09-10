import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectTeamSetup } from './team-doctor.js';
import { emptyTeam, transitionTeam } from './team.js';
import { CollectionError } from './transport.js';

const policy = { team: { enabled: true, maxActive: 3 }, protectedPaths: { block: [], requireApproval: [] },
  evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] } };
const file = value => ({ type: 'file', encoding: 'base64', size: JSON.stringify(value).length, content: Buffer.from(JSON.stringify(value)).toString('base64') });
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const shellPath = path => "'" + path.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
function reader(base, state, requests) {
  const root = '/repos/example/repo';
  return { repository: 'example/repo', root, async request(method, path) {
    requests.push({ method, path }); assert.equal(method, 'GET');
    if (path === root) return { id: 7, full_name: 'example/repo', default_branch: 'main' };
    if (path === `${root}/commits/main`) return { sha: base };
    if (path.startsWith(`${root}/contents/.changeplane.json`)) return file(policy);
    if (path === `${root}/git/ref/heads/changeplane/team-state`) return { ref: 'refs/heads/changeplane/team-state', object: { type: 'commit', sha: 'b'.repeat(40) } };
    if (path.startsWith(`${root}/contents/team.json`)) return file(state);
    if (path.startsWith(`${root}/git/commits/`)) return { tree: { sha: 'c'.repeat(40) } };
    if (path.includes('/pulls?')) return [];
    if (path.includes('/actions/runs?')) return { workflow_runs: [] };
    if (path.includes('/check-runs?')) return { check_runs: [] };
    throw new Error('Unexpected request');
  } };
}

test('doctor inspects setup and matching workspace without Git/API writes or credential output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'changeplane-doctor-'));
  const checkout = join(root, 'trusted checkout'), workspace = join(root, 'work space'), bare = join(root, 'remote.git');
  const saved = Object.fromEntries(['GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'GH_TOKEN'].map(key => [key, process.env[key]]));
  try {
    mkdirSync(checkout); git(checkout, ['init', '-b', 'main']);
    git(checkout, ['config', 'user.name', 'Synthetic']); git(checkout, ['config', 'user.email', 'synthetic@example.invalid']);
    writeFileSync(join(checkout, 'README.md'), 'Synthetic\n'); git(checkout, ['add', '.']); git(checkout, ['commit', '-m', 'Baseline']);
    const base = git(checkout, ['rev-parse', 'HEAD']);
    git(root, ['clone', '--bare', checkout, bare]); git(checkout, ['remote', 'add', 'origin', 'git@github.com:example/repo.git']);
    const ssh = join(root, 'ssh.sh');
    writeFileSync(ssh, `#!/bin/sh\ntest -z "$GH_TOKEN" || exit 91\nexec git-upload-pack ${shellPath(bare)}\n`, { mode: 0o700 });
    process.env.GIT_SSH_COMMAND = shellPath(ssh); process.env.GIT_SSH_VARIANT = 'simple'; process.env.GH_TOKEN = 'synthetic-private-marker';
    const context = { baseSha: base, policySha: base, maxActive: 3 };
    let state = transitionTeam(emptyTeam(7), { action: 'plan', tasks: [{ id: 'api', title: 'Synthetic private title', paths: ['src/api/**'] }] });
    state = transitionTeam(state, { action: 'claim', task: 'api', owner: 'alice' }, context);
    const workspaceId = '11111111-1111-1111-1111-111111111111';
    state = transitionTeam(state, { action: 'workspace', task: 'api', owner: 'alice', workspaceId });
    git(checkout, ['worktree', 'add', '-b', state.tasks[0].branch, workspace, base]);
    writeFileSync(join(checkout, 'draft.txt'), 'Keep my draft');
    const journalDir = join(checkout, '.git', 'changeplane-team'); mkdirSync(journalDir);
    const journal = join(journalDir, 'api.json');
    const intent = JSON.stringify({ task: 'api', path: workspace, workspaceId, revision: 'b'.repeat(40) }); writeFileSync(journal, intent);
    const configuration = { CHANGEPLANE_TEAM_REPOSITORY: 'example/repo', CHANGEPLANE_TEAM_WRITE: 'true',
      CHANGEPLANE_TEAM_MEMBER: 'alice', CHANGEPLANE_TEAM_CHECKOUT: checkout, GH_TOKEN: 'synthetic-private-marker' };
    const requests = [], api = reader(base, state, requests);
    const report = await inspectTeamSetup({ repository: 'example/repo', configuration, taskId: 'api', api });
    assert.equal(report.status, 'checks_passed', JSON.stringify(report.checks)); assert.equal(report.readOnly, true);
    assert.equal(report.recovery.workspaceMatches, true); assert.equal(report.recovery.outcome, 'VERIFY_AND_RESUME_EXISTING_WRITER');
    assert.ok(requests.length > 4); assert.ok(requests.every(request => request.method === 'GET'));
    assert.equal(existsSync(join(checkout, '.git', 'FETCH_HEAD')), false);
    assert.equal(readFileSync(journal, 'utf8'), intent); assert.equal(readFileSync(join(checkout, 'draft.txt'), 'utf8'), 'Keep my draft');
    assert.equal(git(checkout, ['branch', '--show-current']), 'main');
    const serialized = JSON.stringify(report);
    for (const privateValue of [root, checkout, workspace, 'synthetic-private-marker', 'Synthetic private title']) assert.equal(serialized.includes(privateValue), false);
    assert.ok(report.unverified.some(value => value.includes('isolation')));
    writeFileSync(journal, JSON.stringify({ task: 'api', path: workspace, workspaceId: '22222222-2222-2222-2222-222222222222' }));
    const held = await inspectTeamSetup({ repository: 'example/repo', configuration, taskId: 'api', api });
    assert.equal(held.recovery.outcome, 'OWNER_RECOVERY_REQUIRED'); assert.equal(held.recovery.reservationHeld, true);
    git(checkout, ['config', 'includeIf.onbranch:changeplane/work/**.path', join(root, 'absent.config')]);
    const blocked = await inspectTeamSetup({ repository: 'example/repo', configuration, taskId: 'api', api });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.checks.find(check => check.id === 'git_configuration').code, 'TEAM_CONDITIONAL_GIT_CONFIG');
    assert.equal(blocked.checks.some(check => check.id === 'git_read_authentication'), false);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor gives redacted configuration and permission fixes instead of claiming readiness', async () => {
  const root = mkdtempSync(join(tmpdir(), 'changeplane-doctor-missing-'));
  try {
    const report = await inspectTeamSetup({ repository: 'example/repo', configuration: {}, cwd: root, workspaceRootRequired: true,
      api: { async request(method) { assert.equal(method, 'GET'); throw new CollectionError('PERMISSION_DENIED', { provider: 'github', status: 403 }); } } });
    assert.equal(report.status, 'blocked');
    assert.equal(report.checks.find(check => check.id === 'trusted_repository_policy').code, 'PERMISSION_DENIED');
    assert.ok(report.checks.find(check => check.id === 'member').nextAction.includes('CHANGEPLANE_TEAM_MEMBER'));
    assert.ok(report.checks.find(check => check.id === 'workspace_root').nextAction.includes('CHANGEPLANE_WORKSPACE_ROOT'));
    assert.equal(JSON.stringify(report).includes(root), false);
    assert.equal(report.authority.coordinationMutation, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
