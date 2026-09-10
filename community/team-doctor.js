import { lstatSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { TeamError, requireTeam } from './team.js';
import { teamGitHub, operateTeam } from './team-github.js';
import { git, localRepository } from './team-worktree.js';
import { CollectionError, unavailable } from './transport.js';

const taskIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const repositoryPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;
const localCodes = new Set(['TEAM_NOT_ENABLED', 'TEAM_STATE_INVALID', 'TEAM_LOCAL_REPOSITORY_MISMATCH',
  'TEAM_GIT_OPERATION_FAILED', 'TEAM_CONDITIONAL_GIT_CONFIG', 'TEAM_TASK_MISSING', 'TEAM_RECOVERY_JOURNAL_INVALID']);

function recoveryReport(top, task) {
  const journal = resolve(top, git(top, ['rev-parse', '--git-common-dir']).trim(), 'changeplane-team', `${task.id}.json`);
  let intent = null;
  try {
    const stat = lstatSync(journal);
    requireTeam(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 10_000, 'TEAM_RECOVERY_JOURNAL_INVALID');
    intent = JSON.parse(readFileSync(journal, 'utf8'));
    requireTeam(intent?.task === task.id && /^[a-f0-9-]{36}$/u.test(intent.workspaceId)
      && typeof intent.path === 'string' && isAbsolute(intent.path) && !/[\u0000-\u001f\u007f]/u.test(intent.path), 'TEAM_RECOVERY_JOURNAL_INVALID');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new TeamError('TEAM_RECOVERY_JOURNAL_INVALID');
  }
  const entries = git(top, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').map(record =>
    Object.fromEntries(record.split('\0').filter(Boolean).map(line => {
      const split = line.indexOf(' '); return split === -1 ? [line, true] : [line.slice(0, split), line.slice(split + 1)];
    })));
  const branchWorktree = entries.find(entry => entry.branch === `refs/heads/${task.branch}`);
  const workspaceMatches = Boolean(intent && task.workspaceId === intent.workspaceId && branchWorktree
    && existsSync(branchWorktree.worktree) && existsSync(intent.path)
    && realpathSync(branchWorktree.worktree) === realpathSync(intent.path));
  const reservationHeld = task.workspaceId !== null;
  const branchExists = Boolean(task.branch && git(top, ['branch', '--list', task.branch]).trim());
  const outcome = ['merged', 'cancelled'].includes(task.state) ? 'TERMINAL_TASK_REVIEW_CLEANUP'
    : workspaceMatches ? 'VERIFY_AND_RESUME_EXISTING_WRITER'
      : reservationHeld || intent || branchExists ? 'OWNER_RECOVERY_REQUIRED' : 'NO_WORKSPACE_RECORDED';
  return { task: task.id, state: task.state, reservationHeld, journalPresent: intent !== null, branchExists,
    workspaceMatches, outcome,
    nextAction: outcome === 'VERIFY_AND_RESUME_EXISTING_WRITER'
      ? 'Have the assigned owner confirm the existing writer and worktree, then read team next for current unfinished work.'
      : outcome === 'NO_WORKSPACE_RECORDED' ? 'Read current task status before creating its first workspace.'
        : 'Keep the reservation and files. Have the owner contain all writers and follow the recovery runbook before changing coordination.' };
}

/** Read-only configuration and recovery inspection; never a write grant or isolation attestation. */
export async function inspectTeamSetup({ repository, configuration = process.env, taskId,
  cwd = process.cwd(), api = null, workspaceRootRequired = false } = {}) {
  requireTeam(typeof repository === 'string' && repositoryPattern.test(repository), 'TEAM_REPOSITORY_INVALID');
  requireTeam(taskId === undefined || typeof taskId === 'string' && taskIdPattern.test(taskId), 'TEAM_INPUT_INVALID');
  const checks = [];
  const check = (id, ok, nextAction) => checks.push({ id, status: ok ? 'passed' : 'blocked', ...(ok ? {} : { nextAction }) });
  const capture = async (id, fn, nextAction) => {
    try { const result = await fn(); check(id, true); return result; }
    catch (error) {
      const sanitized = unavailable(error);
      const provider = error instanceof CollectionError || sanitized.code === 'POLICY_INVALID' ? sanitized : null;
      checks.push({ id, status: 'blocked', code: provider?.code
        ?? (error instanceof TeamError && localCodes.has(error.code) ? error.code : 'TEAM_SETUP_UNAVAILABLE'),
      nextAction: provider?.message ?? nextAction });
      return null;
    }
  };
  const [major, minor] = process.versions.node.split('.').map(Number);
  check('node_runtime', major === 22 && minor >= 18 || major === 24, 'Use a qualified Node.js 22.18+ or 24 runtime.');
  check('repository_pin', configuration.CHANGEPLANE_TEAM_REPOSITORY === repository,
    'Set CHANGEPLANE_TEAM_REPOSITORY to the exact repository being inspected.');
  check('write_opt_in', configuration.CHANGEPLANE_TEAM_WRITE === 'true',
    'Keep writes disabled until setup is reviewed; then set CHANGEPLANE_TEAM_WRITE=true for this repository.');
  check('member', typeof configuration.CHANGEPLANE_TEAM_MEMBER === 'string'
    && configuration.CHANGEPLANE_TEAM_MEMBER.length > 0 && configuration.CHANGEPLANE_TEAM_MEMBER.length <= 80
    && !/[\u0000-\u001f\u007f]/u.test(configuration.CHANGEPLANE_TEAM_MEMBER),
  'Set CHANGEPLANE_TEAM_MEMBER to the assigned member label.');
  if (workspaceRootRequired) check('workspace_root', typeof configuration.CHANGEPLANE_WORKSPACE_ROOT === 'string'
    && isAbsolute(configuration.CHANGEPLANE_WORKSPACE_ROOT) && !/[\u0000-\u001f\u007f]/u.test(configuration.CHANGEPLANE_WORKSPACE_ROOT),
  'Set CHANGEPLANE_WORKSPACE_ROOT to an absolute trusted operator workspace directory.');
  const token = configuration.GH_TOKEN || configuration.GITHUB_TOKEN;
  check('operator_token_present', typeof token === 'string' && token.length > 0,
    'Supply the repository-scoped token only to the trusted operator through its secret manager.');
  const pinned = configuration.CHANGEPLANE_TEAM_REPOSITORY === repository;
  const reader = api ?? teamGitHub({ repository, token: pinned ? token : undefined, writeEnabled: false });
  const status = await capture('trusted_repository_policy', () => operateTeam({ api: reader, command: { action: 'status' } }),
    'Check repository read access and merge the reviewed team policy into the default branch.');
  if (status) await capture('provider_read_access', async () => {
    const [pulls, runs, checks] = await Promise.all([
      reader.request('GET', `${reader.root}/pulls?state=open&per_page=1`),
      reader.request('GET', `${reader.root}/actions/runs?per_page=1`),
      reader.request('GET', `${reader.root}/commits/${status.baseSha}/check-runs?per_page=1`),
    ]);
    requireTeam(Array.isArray(pulls) && Array.isArray(runs?.workflow_runs) && Array.isArray(checks?.check_runs), 'TEAM_STATE_INVALID');
    return true;
  }, 'Check read access to Pull requests, Actions and Checks for the selected repository.');
  const checkout = configuration.CHANGEPLANE_TEAM_CHECKOUT ?? cwd;
  const top = await capture('target_checkout', () => localRepository(checkout, repository),
    'Set CHANGEPLANE_TEAM_CHECKOUT to a trusted clone of this repository with its exact GitHub origin.');
  let trustedConfig = false;
  if (top) trustedConfig = await capture('git_configuration', () => {
    const keys = git(top, ['config', '--name-only', '--list']).trim().split('\n');
    requireTeam(!keys.some(key => key.toLowerCase().startsWith('includeif.')), 'TEAM_CONDITIONAL_GIT_CONFIG');
    return true;
  }, 'Use a trusted checkout without conditional Git includes; doctor did not reserve a workspace.');
  if (top && trustedConfig && status) await capture('git_read_authentication', () => {
    const refs = git(top, ['ls-remote', '--exit-code', 'origin', `refs/heads/${status.defaultBranch}`]);
    requireTeam(refs.split('\n').some(line => /^[a-f0-9]{40}\trefs\/heads\//u.test(line)), 'TEAM_GIT_OPERATION_FAILED');
    return true;
  }, 'Configure separate Git read authentication for this repository; do not put the operator token in the remote URL.');
  let recovery = null;
  if (taskId && top && trustedConfig && status) recovery = await capture('task_recovery', () => {
    const task = status.tasks.find(item => item.id === taskId);
    requireTeam(task, 'TEAM_TASK_MISSING');
    return recoveryReport(top, task);
  }, 'Read team status and inspect the local recovery journal with the repository owner. Keep reservations and worktrees intact.');
  const blocked = checks.find(item => item.status === 'blocked');
  return { kind: 'changeplane.team-doctor', status: blocked ? 'blocked' : 'checks_passed', readOnly: true, checks,
    ...(recovery ? { recovery } : {}),
    nextAction: blocked?.nextAction ?? recovery?.nextAction ?? 'Review the operator isolation and permissions runbook before starting team work.',
    unverified: ['Repository write permission and branch rules: no write was attempted.',
      'Operating-system credential isolation and writer identity: a local diagnostic cannot prove either.',
      'Git push permission, coding-agent execution and live MCP client installation are not established.'],
    authority: { sourceMutation: false, coordinationMutation: false, guardPublished: false, mergeAuthorized: false } };
}
