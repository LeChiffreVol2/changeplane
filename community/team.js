import { canonical } from './core.js';
import { matchesPathRule, normalizeRepoPath } from '../src/lib/changeplane.js';

export const TEAM_REF = 'changeplane/team-state';
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const text = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const active = task => ['active', 'review', 'blocked'].includes(task.state);
export class TeamError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireTeam(condition, code = 'TEAM_INPUT_INVALID') {
  if (!condition) throw new TeamError(code);
}
function scope(paths) {
  requireTeam(Array.isArray(paths) && paths.length > 0 && paths.length <= 100);
  return [...new Set(paths.map(path => {
    requireTeam(text(path, 300));
    const prefix = path.endsWith('/**'), bare = prefix ? path.slice(0, -3) : path;
    requireTeam(!/[*?\[\]]/u.test(bare) && normalizeRepoPath(bare) === bare && !bare.split('/').includes('.git'));
    return bare + (prefix ? '/**' : '');
  }))].sort();
}
export function scopesOverlap(left, right) {
  return left.some(a => right.some(b => matchesPathRule(a.replace(/\/\*\*$/u, ''), b)
    || matchesPathRule(b.replace(/\/\*\*$/u, ''), a)));
}
export function emptyTeam(repositoryId) {
  requireTeam(Number.isSafeInteger(repositoryId) && repositoryId > 0);
  return { schemaVersion: 1, kind: 'changeplane.team', repositoryId, tasks: [] };
}
export function validateTeam(input, repositoryId = input?.repositoryId) {
  requireTeam(input?.schemaVersion === 1 && input.kind === 'changeplane.team'
    && Number.isSafeInteger(repositoryId) && repositoryId > 0 && input.repositoryId === repositoryId
    && Array.isArray(input.tasks) && input.tasks.length <= 200, 'TEAM_STATE_INVALID');
  const tasks = input.tasks.map(task => {
    requireTeam(id(task.id) && text(task.title) && ['planned', 'active', 'review', 'blocked', 'merged', 'cancelled'].includes(task.state)
      && Array.isArray(task.dependsOn) && task.dependsOn.length <= 30 && task.dependsOn.every(id)
      && new Set(task.dependsOn).size === task.dependsOn.length && Number.isSafeInteger(task.generation) && task.generation >= 0
      && (task.owner === null || text(task.owner, 80))
      && (task.baseSha === null || sha(task.baseSha))
      && (task.headSha === null || sha(task.headSha))
      && (task.policySha === null || sha(task.policySha))
      && (task.pullRequest === null || Number.isSafeInteger(task.pullRequest) && task.pullRequest > 0)
      && (task.issue === null || Number.isSafeInteger(task.issue) && task.issue > 0)
      && (task.workspaceId === null || typeof task.workspaceId === 'string' && /^[a-f0-9-]{36}$/u.test(task.workspaceId))
      && (task.branch === null || task.branch === `changeplane/work/${task.id}-${task.generation}`)
      && (task.outcome === null || text(task.outcome, 100)), 'TEAM_STATE_INVALID');
    const handoff = task.handoff ?? null;
    requireTeam(handoff === null || typeof handoff === 'object'
      && /^[a-f0-9]{64}$/u.test(handoff.id) && sha(handoff.headSha) && sha(handoff.baseSha)
      && text(handoff.outcome, 100) && ['pending', 'acknowledged'].includes(handoff.status), 'TEAM_STATE_INVALID');
    requireTeam(task.state === 'planned' || task.state === 'cancelled' || (task.generation > 0 && task.owner && task.baseSha && task.policySha && task.branch), 'TEAM_STATE_INVALID');
    return { id: task.id, title: task.title, paths: scope(task.paths), dependsOn: [...task.dependsOn].sort(),
      state: task.state, generation: task.generation, owner: task.owner, baseSha: task.baseSha, policySha: task.policySha,
      branch: task.branch, headSha: task.headSha, pullRequest: task.pullRequest, issue: task.issue, workspaceId: task.workspaceId, outcome: task.outcome,
      handoff: handoff && { id: handoff.id, headSha: handoff.headSha, baseSha: handoff.baseSha, outcome: handoff.outcome, status: handoff.status } };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  requireTeam(byId.size === tasks.length, 'TEAM_STATE_INVALID');
  const visiting = new Set(), done = new Set();
  function visit(task) {
    requireTeam(!visiting.has(task.id), 'TEAM_DEPENDENCY_CYCLE');
    if (done.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.dependsOn) {
      requireTeam(byId.has(dependency), 'TEAM_DEPENDENCY_MISSING'); visit(byId.get(dependency));
    }
    visiting.delete(task.id); done.add(task.id);
  }
  tasks.forEach(visit);
  return { schemaVersion: 1, kind: 'changeplane.team', repositoryId, tasks };
}

/** Shared scheduling metadata, not a lock on arbitrary Git writers or merge authority. */
export function transitionTeam(input, command, context = {}) {
  const state = validateTeam(input), tasks = state.tasks;
  requireTeam(command && typeof command === 'object');
  const task = tasks.find(item => item.id === command.task);
  if (command.action === 'plan') {
    requireTeam(Array.isArray(command.tasks) && command.tasks.length > 0 && command.tasks.length <= 50);
    for (const item of command.tasks) {
      const proposed = { id: item.id, title: item.title, paths: scope(item.paths), dependsOn: item.dependsOn ?? [],
        state: 'planned', generation: 0, owner: null, baseSha: null, policySha: null, branch: null,
        headSha: null, pullRequest: null, issue: item.issue ?? null, workspaceId: null, outcome: null };
      const existing = tasks.find(task => task.id === item.id);
      if (existing) requireTeam(canonical({ id: existing.id, title: existing.title, paths: existing.paths,
        dependsOn: existing.dependsOn, issue: existing.issue }) === canonical({ id: proposed.id, title: proposed.title,
        paths: proposed.paths, dependsOn: [...proposed.dependsOn].sort(), issue: proposed.issue }), 'TEAM_CONTRACT_IMMUTABLE');
      else tasks.push(proposed);
    }
  } else {
    requireTeam(task, 'TEAM_TASK_MISSING');
    if (command.action === 'claim') {
      requireTeam(task.state === 'planned', 'TEAM_ALREADY_CLAIMED');
      requireTeam(text(command.owner, 80) && sha(context.baseSha) && sha(context.policySha));
      requireTeam(task.dependsOn.every(dependency => tasks.find(item => item.id === dependency)?.state === 'merged'), 'TEAM_DEPENDENCY_PENDING');
      requireTeam(tasks.filter(active).length < (context.maxActive ?? 10), 'TEAM_CAPACITY');
      requireTeam(!tasks.some(other => active(other) && scopesOverlap(task.paths, other.paths)), 'TEAM_SCOPE_BUSY');
      Object.assign(task, { state: 'active', generation: task.generation + 1, owner: command.owner,
        baseSha: context.baseSha, policySha: context.policySha, outcome: 'START_WORK' });
      task.branch = `changeplane/work/${task.id}-${task.generation}`;
    } else if (command.action === 'workspace') {
      requireTeam(task.state === 'active' && task.workspaceId === null && task.owner === command.owner, 'TEAM_WORKSPACE_RESERVED');
      requireTeam(typeof command.workspaceId === 'string' && /^[a-f0-9-]{36}$/u.test(command.workspaceId));
      task.workspaceId = command.workspaceId;
    } else if (command.action === 'cancel') {
      // A timeout is not proof that a writer stopped. Active reservations never expire.
      requireTeam(task.state === 'planned', 'TEAM_ACTIVE_RESERVATION_HELD');
      task.state = 'cancelled'; task.outcome = 'CANCELLED_BEFORE_START';
    } else if (command.action === 'bind') {
      requireTeam(active(task) && Number.isSafeInteger(command.pullRequest) && command.pullRequest > 0 && sha(context.headSha));
      requireTeam(task.pullRequest === null || task.pullRequest === command.pullRequest, 'TEAM_PR_ALREADY_BOUND');
      requireTeam(!tasks.some(other => other.id !== task.id && other.pullRequest === command.pullRequest), 'TEAM_PR_ALREADY_BOUND');
      Object.assign(task, { pullRequest: command.pullRequest, headSha: context.headSha, state: 'review', outcome: 'REOBSERVE_PR' });
    } else if (command.action === 'observe') {
      requireTeam(active(task) && task.pullRequest !== null && sha(context.headSha));
      requireTeam(['merged', 'review', 'blocked'].includes(context.state) && text(context.outcome, 100));
      Object.assign(task, { state: context.state, outcome: context.outcome, headSha: context.headSha });
      const handoff = context.handoff ?? null;
      task.handoff = handoff?.id === task.handoff?.id ? task.handoff : handoff;
    } else if (command.action === 'acknowledge') {
      requireTeam(active(task) && task.owner === command.owner && task.workspaceId !== null
        && task.workspaceId === command.workspaceId, 'TEAM_WORKSPACE_MISMATCH');
      requireTeam(task.handoff?.id === command.handoff && context.handoff?.id === command.handoff,
        'TEAM_HANDOFF_STALE');
      task.handoff.status = 'acknowledged';
    } else throw new TeamError('TEAM_COMMAND_INVALID');
  }
  return validateTeam(state);
}

export function teamSummary(input) {
  const state = validateTeam(input);
  return { ...state, coordinationOnly: true, mergeAuthority: 'github',
    tasks: state.tasks.map(task => ({ ...task,
      waitingFor: task.dependsOn.filter(id => state.tasks.find(other => other.id === id)?.state !== 'merged'),
      overlaps: state.tasks.filter(other => other.id !== task.id && active(other) && scopesOverlap(task.paths, other.paths)).map(other => other.id),
    })), limitation: 'Coordinates participating clients. Path separation cannot prove semantic independence. GitHub rules and fresh CI still control integration.' };
}
