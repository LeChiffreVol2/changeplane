import { readFileSync, statSync } from 'node:fs';
import { TeamError, requireTeam } from './team.js';
import { teamGitHub, operateTeam, observeTeam, nextTeamHandoffs } from './team-github.js';
import { prepareTeamWorktree } from './team-worktree.js';
import { CollectionError, unavailable } from './transport.js';
import { inspectTeamSetup } from './team-doctor.js';

export const teamHelp = `Repository teamwork (GitHub.com):
  node community/cli.js team doctor OWNER/REPO [TASK]
  node community/cli.js team status OWNER/REPO
  node community/cli.js team plan OWNER/REPO tasks.json
  node community/cli.js team start OWNER/REPO task.json OWNER
  node community/cli.js team claim OWNER/REPO TASK OWNER
  node community/cli.js team worktree OWNER/REPO TASK DESTINATION
  node community/cli.js team bind OWNER/REPO TASK PR_NUMBER
  node community/cli.js team cancel OWNER/REPO TASK
  node community/cli.js team archive OWNER/REPO TASK
  node community/cli.js team adopt-policy OWNER/REPO TASK EXPECTED_POLICY_SHA
  node community/cli.js team reconcile OWNER/REPO
  node community/cli.js team observe OWNER/REPO
  node community/cli.js team next OWNER/REPO
  node community/cli.js team acknowledge OWNER/REPO TASK WORKSPACE_ID HANDOFF_ID
  node community/cli.js team watch OWNER/REPO [SECONDS (30–3600)]

Merge a reviewed default-branch policy with team.enabled=true and team.maxActive first.
Writes require CHANGEPLANE_TEAM_WRITE=true and CHANGEPLANE_TEAM_REPOSITORY=OWNER/REPO.
Use a scoped GH_TOKEN/GITHUB_TOKEN in the trusted operator process, never in task JSON.
Set CHANGEPLANE_TEAM_CHECKOUT to the trusted target checkout when running from the runtime bundle.
The coordinator writes only its metadata branch. Your coding agent owns source changes;
GitHub owns review and merge. Owner labels are attribution, not authentication.
`;
const actions = {
  TEAM_COMMAND_INVALID: 'Run team --help and use a supported command with its documented arguments.',
  TEAM_INPUT_INVALID: 'Check the task ID, owner and immutable contract shape in the team setup guide.',
  TEAM_REPOSITORY_MISMATCH: 'Set CHANGEPLANE_TEAM_REPOSITORY to the exact OWNER/REPO being operated on.',
  TEAM_REPOSITORY_INVALID: 'Provide a GitHub.com repository as OWNER/REPO.',
  TEAM_MEMBER_NOT_CONFIGURED: 'Set CHANGEPLANE_TEAM_MEMBER to the assigned member label in the trusted operator environment.',
  TEAM_WORKSPACE_NOT_CONFIGURED: 'Set CHANGEPLANE_WORKSPACE_ROOT to the trusted operator workspace directory.',
  TEAM_TASK_FILE_MISSING: 'Create the task JSON file or correct the task-file argument, then retry.',
  TEAM_TASK_FILE_UNREADABLE: 'Check that the task-file argument is a readable local file of at most 100 KB.',
  TEAM_TASK_JSON_INVALID: 'Correct the task file to valid JSON using the documented task or tasks-array shape.',
  TEAM_LOCAL_REPOSITORY_MISMATCH: 'Point CHANGEPLANE_TEAM_CHECKOUT at a trusted clone of the selected repository with its exact GitHub origin.',
  TEAM_CONTRACT_IMMUTABLE: 'Keep the recorded contract unchanged; cancel unstarted work and plan a new task ID for a changed contract.',
  TEAM_DEPENDENCY_CANCELLED: 'A prerequisite was cancelled. Cancel the dependent unstarted task and plan replacement work with new task IDs.',
  TEAM_CAPACITY: 'Wait for active work to finish; archive eligible completed tasks if the task history is full.',
  TEAM_STATE_INVALID: 'Run team doctor and ask the repository owner to inspect coordination history before making further changes.',
  TEAM_TASK_MISSING: 'Read team status and use a task ID present on the board.',
  TEAM_TASK_NOT_ACTIVE: 'Read team status; this operation requires an unfinished task with its assigned writer.',
  TEAM_OWNER_MISMATCH: 'Have the assigned owner operate this task; member labels do not replace repository authorization.',
  TEAM_DEPENDENCY_MISSING: 'Plan the missing prerequisite in the same batch or use an existing task ID.',
  TEAM_DEPENDENCY_CYCLE: 'Remove the dependency cycle before recording the task plan.',
  TEAM_TASK_ARCHIVED: 'This task ID is retained in immutable archive history. Use a new task ID for new work.',
  TEAM_ARCHIVE_NOT_TERMINAL: 'Only merged or cancelled tasks can be archived. Keep active reservations and finish or safely recover their writers first.',
  TEAM_ARCHIVE_EVIDENCE_REQUIRED: 'Reconcile current GitHub merge evidence before archiving this completed task.',
  TEAM_ARCHIVE_IMMUTABLE: 'Keep the archived receipt unchanged and ask the owner to inspect coordination history.',
  TEAM_MERGE_RECEIPT_CHANGED: 'The live PR differs from its recorded merge receipt. Keep dependent work blocked and have the owner inspect repository history.',
  TEAM_TASK_COLLECTION_LIMIT: 'This task exceeds the bounded evidence budget. Inspect its CI configuration and evidence volume; other tasks can continue.',
  TEAM_REVIEW_LIMIT: 'Review history exceeds the bounded reader. Inspect the PR discussions with the owner; no current assessment was established.',
  TEAM_REVIEW_INVALID: 'Review metadata is incomplete or changed during collection. Re-observe the PR before acting on feedback.',
  TEAM_TASK_NOT_ACTIVE: 'Read team status; policy adoption applies only to an existing active, blocked or review task.',
  TEAM_OWNER_MISMATCH: 'Use the trusted operator for the assigned task owner; owner labels do not authenticate a different writer.',
  TEAM_PLAN_LIMIT: 'Split planning into smaller batches with at most 100 distinct archived prerequisites.',
  TEAM_NOT_ENABLED: 'Merge the reviewed team configuration into the default branch, then retry.',
  TEAM_WRITES_DISABLED: 'The operator must enable writes for this exact repository before recording team changes.',
  TEAM_SCOPE_BUSY: 'Work on a non-overlapping task or wait for the active task to merge.',
  TEAM_DEPENDENCY_PENDING: 'Wait for the prerequisite pull requests to merge, then claim this task.',
  TEAM_ALREADY_CLAIMED: 'Read team status and use a different task; do not duplicate the existing writer.',
  TEAM_ACTIVE_RESERVATION_HELD: 'The active reservation is retained. Finish its PR or have the repository owner contain the writer before manual recovery.',
  TEAM_CONCURRENT_UPDATE: 'Another client may have updated coordination. Read status before deciding whether to retry.',
  TEAM_WRITE_REJECTED: 'GitHub rejected the write. Check repository rules and operator configuration; this was not treated as ordinary contention.',
  TEAM_WRITE_UNCERTAIN: 'The write may have succeeded. Read status before retrying; no automatic mutation retry was made.',
  TEAM_POLICY_CHANGED: 'The trusted policy changed. Re-read team status and review the new configuration.',
  TEAM_REVISION_CHANGED: 'Repository state changed. Re-read status before continuing.',
  TEAM_WORKTREE_EXISTS: 'Choose a new empty destination; existing worktrees and branches are never overwritten.',
  TEAM_WORKSPACE_RESERVED: 'A workspace has already been reserved for this task. Continue with its owner; never start a second writer on the same branch.',
  TEAM_GIT_OPERATION_FAILED: 'Inspect local Git and authentication, then read worktree and branch state before retrying.',
  TEAM_CONDITIONAL_GIT_CONFIG: 'Use a trusted operator checkout without conditional Git includes; the workspace was not reserved.',
  TEAM_PERMISSION_DENIED: 'Have the repository owner check the operator token permissions.',
  TEAM_HANDOFF_STALE: 'The task revision or evidence changed. Read your next handoff and continue from that evidence.',
  TEAM_WORKSPACE_MISMATCH: 'Only the assigned workspace may acknowledge this task. Do not start another writer.',
};
export function teamFailure(error) {
  if (error instanceof CollectionError) return { ...unavailable(error), kind: 'changeplane.team-outcome' };
  if (!(error instanceof TeamError)) {
    const report = unavailable(error);
    if (report.code !== 'INPUT_INVALID') return { ...report, kind: 'changeplane.team-outcome' };
  }
  const code = error instanceof TeamError ? error.code : 'TEAM_UNAVAILABLE';
  return { kind: 'changeplane.team-outcome', decision: 'UNAVAILABLE', code,
    nextAction: actions[code] ?? 'Check the task input, trusted policy and repository access; no success was established.' };
}
export function configuredTeam(repository, configuration = process.env) {
  requireTeam(typeof repository === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(repository), 'TEAM_REPOSITORY_INVALID');
  const enabled = configuration.CHANGEPLANE_TEAM_WRITE === 'true';
  requireTeam(!enabled || configuration.CHANGEPLANE_TEAM_REPOSITORY === repository, 'TEAM_REPOSITORY_MISMATCH');
  return teamGitHub({ repository, token: configuration.GH_TOKEN || configuration.GITHUB_TOKEN, writeEnabled: enabled });
}
export function teamMember(configuration = process.env) {
  const member = configuration.CHANGEPLANE_TEAM_MEMBER;
  requireTeam(typeof member === 'string' && member.length > 0 && member.length <= 80 && !/[\u0000-\u001f\u007f]/u.test(member), 'TEAM_MEMBER_NOT_CONFIGURED');
  return member;
}
function taskFile(path) {
  let source;
  try {
    const stat = statSync(path);
    requireTeam(stat.isFile() && stat.size <= 100_000, 'TEAM_TASK_FILE_UNREADABLE');
    source = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof TeamError) throw error;
    throw new TeamError(error?.code === 'ENOENT' ? 'TEAM_TASK_FILE_MISSING' : 'TEAM_TASK_FILE_UNREADABLE');
  }
  try {
    const value = JSON.parse(source);
    requireTeam(value && typeof value === 'object' && !Array.isArray(value), 'TEAM_TASK_JSON_INVALID');
    return value;
  } catch { throw new TeamError('TEAM_TASK_JSON_INVALID'); }
}
export async function runTeamCli(args) {
  if (!args.length || ['--help', '-h'].includes(args[0])) return { help: teamHelp };
  const [action, repository, ...rest] = args;
  if (action === 'doctor' && rest.length <= 1) return inspectTeamSetup({ repository, configuration: process.env, taskId: rest[0] });
  const api = configuredTeam(repository);
  if (action === 'observe' && rest.length === 0) return observeTeam({ createApi: () => configuredTeam(repository) });
  if (action === 'next' && rest.length === 0) return nextTeamHandoffs({ api, owner: teamMember() });
  if (action === 'worktree' && rest.length === 2) return prepareTeamWorktree({ api, taskId: rest[0], destination: rest[1], owner: teamMember() });
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
    command.tasks = taskFile(rest[0]).tasks;
    requireTeam(Array.isArray(command.tasks) && command.tasks.length > 0 && command.tasks.length <= 50, 'TEAM_TASK_JSON_INVALID');
  } else if (action === 'start' && rest.length === 2) {
    command = { action, contract: taskFile(rest[0]), owner: rest[1] };
  } else if (action === 'claim' && rest.length === 2) command = { action, task: rest[0], owner: rest[1] };
  else if (action === 'bind' && rest.length === 2 && /^[1-9][0-9]*$/u.test(rest[1])) command = { action, task: rest[0], pullRequest: Number(rest[1]) };
  else if (action === 'acknowledge' && rest.length === 3) command = { action, task: rest[0], workspaceId: rest[1], handoff: rest[2], owner: teamMember() };
  else if (action === 'cancel' && rest.length === 1) command.task = rest[0];
  else if (action === 'archive' && rest.length === 1) command.task = rest[0];
  else if (action === 'adopt-policy' && rest.length === 2) command = { action, task: rest[0], policySha: rest[1], owner: teamMember() };
  else requireTeam(['status', 'reconcile'].includes(action) && rest.length === 0, 'TEAM_COMMAND_INVALID');
  return operateTeam({ api, command });
}
