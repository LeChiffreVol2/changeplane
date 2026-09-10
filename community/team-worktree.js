import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { TeamError, requireTeam } from './team.js';
import { operateTeam } from './team-github.js';

function git(cwd, args) {
  // Git is a separate operator subprocess. Do not hand provider/model secrets to
  // credential helpers, SSH or checkout filters through its environment.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SSH_AUTH_SOCK',
    'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'SYSTEMROOT'].filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]]));
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0' });
  try {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false', ...args],
      { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'],
        env });
  } catch { throw new TeamError('TEAM_GIT_OPERATION_FAILED'); }
}
function localRepository(cwd, repository) {
  const top = realpathSync(git(cwd, ['rev-parse', '--show-toplevel']).trim());
  const remote = git(top, ['remote', 'get-url', 'origin']).trim();
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(remote);
  requireTeam(match && match[1].toLowerCase() === repository.toLowerCase(), 'TEAM_LOCAL_REPOSITORY_MISMATCH');
  return top;
}

/** Read a bounded map from a trusted revision; never run repo scripts or read env files. */
export function repositoryMap(cwd, revision) {
  requireTeam(/^[a-f0-9]{40}$/u.test(revision));
  const files = git(cwd, ['ls-tree', '-r', '--name-only', '-z', revision]).split('\0').filter(Boolean);
  requireTeam(files.length <= 20_000, 'TEAM_CODEBASE_LIMIT');
  const manifests = files.filter(path => /(?:^|\/)(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml)$/u.test(path));
  return { revision, fileCount: files.length, directories: [...new Set(files.map(path => path.split('/').slice(0, -1).slice(0, 2).join('/') || '.'))].sort().slice(0, 100),
    manifests: manifests.slice(0, 100), instructions: files.filter(path => /(?:^|\/)(?:AGENTS\.md|CONTRIBUTING\.md|README\.md)$/u.test(path)).slice(0, 100),
    workflows: files.filter(path => path.startsWith('.github/workflows/')).slice(0, 100),
    limitation: 'Path inventory only. Agents must inspect relevant code and contracts; disjoint directories can still share behavior.' };
}

export async function prepareTeamWorktree({ api, taskId, owner = process.env.CHANGEPLANE_TEAM_MEMBER, cwd = process.cwd(), destination }) {
  requireTeam(typeof destination === 'string' && destination.length > 0 && !destination.includes('\0'));
  const report = await operateTeam({ api, command: { action: 'status' } });
  const task = report.tasks.find(item => item.id === taskId);
  requireTeam(task?.state === 'active' && task.pullRequest === null && task.owner === owner, 'TEAM_TASK_NOT_STARTABLE');
  requireTeam(task.workspaceId === null, 'TEAM_WORKSPACE_RESERVED');
  const top = localRepository(cwd, api.repository), path = resolve(destination);
  requireTeam(!existsSync(path) && path !== top && !path.startsWith(top + '/.git/'), 'TEAM_WORKTREE_EXISTS');
  const config = git(top, ['config', '--name-only', '--list']).trim().split('\n');
  // A branch/gitdir-conditional include could introduce an unseen filter when
  // checkout enters the new worktree. Refuse before reserving any workspace.
  requireTeam(!config.some(key => key.toLowerCase().startsWith('includeif.')), 'TEAM_CONDITIONAL_GIT_CONFIG');
  const filters = config.filter(key => key.startsWith('filter.'));
  const disabled = [...new Set(filters.map(key => key.slice(0, key.lastIndexOf('.'))))]
    .flatMap(name => ['-c', `${name}.smudge=`, '-c', `${name}.clean=`, '-c', `${name}.process=`, '-c', `${name}.required=false`]);
  // Only fetch the trusted default branch from the already-validated origin.
  git(top, ['fetch', '--no-tags', 'origin', report.defaultBranch]);
  git(top, ['merge-base', '--is-ancestor', task.baseSha, 'FETCH_HEAD']);
  const fresh = await operateTeam({ api, command: { action: 'status' } });
  requireTeam(fresh.revision === report.revision, 'TEAM_REVISION_CHANGED');
  const workspaceId = randomUUID();
  const journal = resolve(top, git(top, ['rev-parse', '--git-common-dir']).trim(), 'changeplane-team');
  mkdirSync(journal, { recursive: true, mode: 0o700 });
  // Record intent before the remote reservation. An interrupted client can be
  // investigated without claiming the same branch from another machine.
  writeFileSync(resolve(journal, `${task.id}.json`), JSON.stringify({ workspaceId, path, task: task.id, revision: report.revision }), { flag: 'wx', mode: 0o600 });
  await operateTeam({ api, command: { action: 'workspace', task: task.id, owner, workspaceId } });
  // Git refuses an existing path or branch. Never reset, force checkout, delete,
  // clean, or reuse someone else's workspace after an uncertain invocation.
  // Attributes can select locally configured filters. Disable every configured
  // driver, including process filters, before any checkout reads those attributes.
  git(top, [...disabled, 'worktree', 'add', '-b', task.branch, '--', path, task.baseSha]);
  return { kind: 'changeplane.team-worktree', repository: api.repository, task: { ...task, workspaceId }, path,
    codebase: repositoryMap(path, task.baseSha), requiredChecks: report.requiredChecks,
    nextAction: 'DEVELOP_IN_WORKTREE', sourceMutation: false,
    instructions: 'Use this worktree for the assigned task. Follow trusted repository instructions and the immutable task scope. Push and open a PR with your existing coding agent, then reconcile to discover it automatically. Never share a worktree between simultaneous writers.' };
}
