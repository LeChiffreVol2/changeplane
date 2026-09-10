import { readFileSync, statSync } from 'node:fs';
import { TeamError, requireTeam } from './team.js';
import { teamGitHub, operateTeam, nextTeamHandoffs } from './team-github.js';
import { prepareTeamWorktree } from './team-worktree.js';

export const teamHelp = `Repository teamwork (GitHub.com):
  node community/cli.js team status OWNER/REPO
  node community/cli.js team plan OWNER/REPO tasks.json
  node community/cli.js team start OWNER/REPO task.json OWNER
  node community/cli.js team claim OWNER/REPO TASK OWNER
  node community/cli.js team worktree OWNER/REPO TASK DESTINATION
  node community/cli.js team bind OWNER/REPO TASK PR_NUMBER
  node community/cli.js team cancel OWNER/REPO TASK
  node community/cli.js team reconcile OWNER/REPO
  node community/cli.js team next OWNER/REPO
  node community/cli.js team acknowledge OWNER/REPO TASK WORKSPACE_ID HANDOFF_ID
  node community/cli.js team watch OWNER/REPO [SECONDS (30–3600)]

Merge a reviewed default-branch policy with team.enabled=true and team.maxActive first.
Writes require CHANGEPLANE_TEAM_WRITE=true and CHANGEPLANE_TEAM_REPOSITORY=OWNER/REPO.
Use a scoped GH_TOKEN/GITHUB_TOKEN in the trusted operator process, never in task JSON.
The coordinator writes only its metadata branch. Your coding agent owns source changes;
GitHub owns review and merge. Owner labels are attribution, not authentication.
`;
const actions = {
  TEAM_NOT_ENABLED: 'Merge the reviewed team configuration into the default branch, then retry.',
  TEAM_WRITES_DISABLED: 'The operator must enable writes for this exact repository before recording team changes.',
  TEAM_SCOPE_BUSY: 'Work on a non-overlapping task or wait for the active task to merge.',
  TEAM_DEPENDENCY_PENDING: 'Wait for the prerequisite pull requests to merge, then claim this task.',
  TEAM_ALREADY_CLAIMED: 'Read team status and use a different task; do not duplicate the existing writer.',
  TEAM_ACTIVE_RESERVATION_HELD: 'The active reservation is retained. Finish its PR or have the repository owner contain the writer before manual recovery.',
  TEAM_CONCURRENT_UPDATE: 'Another client may have updated coordination. Read status before deciding whether to retry.',
  TEAM_WRITE_UNCERTAIN: 'The write may have succeeded. Read status before retrying; no automatic mutation retry was made.',
  TEAM_POLICY_CHANGED: 'The trusted policy changed. Re-read team status and review the new configuration.',
  TEAM_REVISION_CHANGED: 'Repository state changed. Re-read status before continuing.',
  TEAM_WORKTREE_EXISTS: 'Choose a new empty destination; existing worktrees and branches are never overwritten.',
  TEAM_WORKSPACE_RESERVED: 'A workspace has already been reserved for this task. Continue with its owner; never start a second writer on the same branch.',
  TEAM_GIT_OPERATION_FAILED: 'Inspect local Git and authentication, then read worktree and branch state before retrying.',
  TEAM_PERMISSION_DENIED: 'Have the repository owner check the operator token permissions.',
  TEAM_HANDOFF_STALE: 'The task revision or evidence changed. Read your next handoff and continue from that evidence.',
  TEAM_WORKSPACE_MISMATCH: 'Only the assigned workspace may acknowledge this task. Do not start another writer.',
};
export function teamFailure(error) {
  const code = error instanceof TeamError ? error.code : 'TEAM_UNAVAILABLE';
  return { kind: 'changeplane.team-outcome', decision: 'UNAVAILABLE', code,
    nextAction: actions[code] ?? 'Check the task input, trusted policy and repository access; no success was established.' };
}
export function configuredTeam(repository, configuration = process.env) {
  const enabled = configuration.CHANGEPLANE_TEAM_WRITE === 'true';
  requireTeam(!enabled || configuration.CHANGEPLANE_TEAM_REPOSITORY === repository, 'TEAM_REPOSITORY_MISMATCH');
  return teamGitHub({ repository, token: configuration.GH_TOKEN || configuration.GITHUB_TOKEN, writeEnabled: enabled });
}
export async function runTeamCli(args) {
  if (!args.length || args[0] === '--help') return { help: teamHelp };
  const [action, repository, ...rest] = args, api = configuredTeam(repository);
  if (action === 'next' && rest.length === 0) return nextTeamHandoffs({ api, owner: process.env.CHANGEPLANE_TEAM_MEMBER });
  if (action === 'worktree' && rest.length === 2) return prepareTeamWorktree({ api, taskId: rest[0], destination: rest[1] });
  if (action === 'watch' && rest.length <= 1) {
    const seconds = Number(rest[0] ?? 300);
    requireTeam(Number.isInteger(seconds) && seconds >= 30 && seconds <= 3600);
    const until = Date.now() + seconds * 1000;
    let last, report;
    do {
      report = await operateTeam({ api: configuredTeam(repository), command: { action: 'reconcile' } });
      const serialized = JSON.stringify(report);
      if (serialized !== last) { process.stdout.write(serialized + '\n'); last = serialized; }
      if (Date.now() + 30_000 >= until) break;
      await new Promise(resolve => setTimeout(resolve, 30_000));
    } while (Date.now() < until);
    return { kind: 'changeplane.team-watch', outcome: 'WATCH_WINDOW_ENDED', nextAction: 'Run the trusted scheduled reconciliation template for unattended observation.' };
  }
  let command = { action };
  if (action === 'plan' && rest.length === 1) {
    requireTeam(statSync(rest[0]).isFile() && statSync(rest[0]).size <= 100_000);
    command.tasks = JSON.parse(readFileSync(rest[0], 'utf8')).tasks;
  } else if (action === 'start' && rest.length === 2) {
    requireTeam(statSync(rest[0]).isFile() && statSync(rest[0]).size <= 100_000);
    command = { action, contract: JSON.parse(readFileSync(rest[0], 'utf8')), owner: rest[1] };
  } else if (action === 'claim' && rest.length === 2) command = { action, task: rest[0], owner: rest[1] };
  else if (action === 'bind' && rest.length === 2 && /^[1-9][0-9]*$/u.test(rest[1])) command = { action, task: rest[0], pullRequest: Number(rest[1]) };
  else if (action === 'acknowledge' && rest.length === 3) command = { action, task: rest[0], workspaceId: rest[1], handoff: rest[2], owner: process.env.CHANGEPLANE_TEAM_MEMBER };
  else if (action === 'cancel' && rest.length === 1) command.task = rest[0];
  else requireTeam(['status', 'reconcile'].includes(action) && rest.length === 0, 'TEAM_COMMAND_INVALID');
  return operateTeam({ api, command });
}
