import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTeam, transitionTeam, validateTeam, teamSummary, scopesOverlap } from './team.js';
import { matchesPathRule } from '../src/lib/changeplane.js';
const context = { baseSha: 'a'.repeat(40), policySha: 'b'.repeat(40), maxActive: 2 };
const task = (id, paths, dependsOn = []) => ({ id, title: id, paths, dependsOn });
const plan = (...tasks) => transitionTeam(emptyTeam(7), { action: 'plan', tasks });
const claim = (state, id, owner = 'alice') => transitionTeam(state, { action: 'claim', task: id, owner }, context);

test('parallel independent tasks reserve different branches while overlapping and dependent work waits', () => {
  let state = plan(task('api', ['src/api/**']), task('web', ['src/web/**']), task('api-fix', ['src/api/users.js']), task('integration', ['src/join.js'], ['api']));
  state = claim(state, 'api');
  assert.throws(() => claim(state, 'api-fix'), /TEAM_SCOPE_BUSY/);
  assert.throws(() => claim(state, 'integration'), /TEAM_DEPENDENCY_PENDING/);
  state = claim(state, 'web', 'bob');
  assert.deepEqual(state.tasks.slice(0, 2).map(item => item.branch), ['changeplane/work/api-1', 'changeplane/work/web-1']);
  assert.deepEqual(teamSummary(state).tasks[2].overlaps, ['api']);
  assert.throws(() => claim(state, 'api', 'bob'), /TEAM_ALREADY_CLAIMED/);
  assert.throws(() => transitionTeam(state, { action: 'cancel', task: 'api' }), /TEAM_ACTIVE_RESERVATION_HELD/);
});
test('dependencies release only after observed merge; new head replaces old findings', () => {
  let state = claim(plan(task('api', ['src/a.js']), task('next', ['src/b.js'], ['api'])), 'api');
  state = transitionTeam(state, { action: 'bind', task: 'api', pullRequest: 9 }, { headSha: context.baseSha });
  state = transitionTeam(state, { action: 'observe', task: 'api' }, { headSha: context.policySha, state: 'blocked', outcome: 'INVESTIGATE_CI' });
  assert.throws(() => claim(state, 'next'), /TEAM_DEPENDENCY_PENDING/);
  state = transitionTeam(state, { action: 'observe', task: 'api' }, { headSha: context.policySha, state: 'merged', outcome: 'MERGED_BY_GITHUB' });
  assert.equal(claim(state, 'next').tasks[1].state, 'active');
});
test('immutable task contracts, cycles, malformed paths and cross-repository state are rejected', () => {
  const state = plan(task('a', ['src/a.js']));
  assert.deepEqual(transitionTeam(state, { action: 'plan', tasks: [task('a', ['src/a.js'])] }), state);
  assert.throws(() => transitionTeam(state, { action: 'plan', tasks: [task('a', ['src/**'])] }), /TEAM_CONTRACT_IMMUTABLE/);
  assert.throws(() => plan(task('a', ['src/a.js'], ['b']), task('b', ['src/b.js'], ['a'])), /TEAM_DEPENDENCY_CYCLE/);
  for (const path of ['../x', '.git/config', 'src/*.js', '/tmp/file', 'src//a', 'src/./a']) assert.throws(() => plan(task('a', [path])));
  assert.throws(() => validateTeam(state, 8), /TEAM_STATE_INVALID/);
});

test('scope overlap retains exact and directory semantics across ordering, redundant rules and siblings', () => {
  const rules = ['src', 'src/**', 'src/api', 'src/api/**', 'src/api/file.js', 'src/api-client',
    'src/api-client/**', 'src/api.js', 'src/api0', 'src/z/**', 'src/ไทย/**', 'src/ไทย/file.js'];
  const scopes = rules.map(rule => [rule]);
  for (let index = 0; index < rules.length; index++) {
    for (const second of rules.slice(index)) scopes.push([second, rules[index], second]);
  }
  for (const left of scopes) for (const right of scopes) {
    const expected = left.some(a => right.some(b => matchesPathRule(a.replace(/\/\*\*$/u, ''), b)
      || matchesPathRule(b.replace(/\/\*\*$/u, ''), a)));
    assert.equal(scopesOverlap(left, right), expected, JSON.stringify({ left, right }));
  }
});

test('summaries and claims retain blocked and review reservations with deterministic overlap order', () => {
  let state = plan(task('api', ['src/api/**']), task('web', ['src/web/**']),
    task('shared', ['src/web/view.js', 'src/api-client', 'src/api/file.js']), task('sibling', ['src/api-client/**']));
  state = claim(state, 'api'); state = claim(state, 'web');
  for (const [index, status] of ['blocked', 'review'].entries()) {
    const id = state.tasks[index].id;
    state = transitionTeam(state, { action: 'bind', task: id, pullRequest: index + 1 }, { headSha: context.baseSha });
    state = transitionTeam(state, { action: 'observe', task: id }, { headSha: context.baseSha, state: status, outcome: 'WAIT' });
  }
  const before = structuredClone(state);
  const summary = teamSummary(state);
  assert.deepEqual(summary.tasks[2].overlaps, ['api', 'web']);
  assert.deepEqual(summary.tasks[3].overlaps, []);
  const claimContext = { ...context, maxActive: 20 };
  assert.throws(() => transitionTeam(state, { action: 'claim', task: 'shared', owner: 'alice' }, claimContext), /TEAM_SCOPE_BUSY/);
  assert.equal(transitionTeam(state, { action: 'claim', task: 'sibling', owner: 'alice' }, claimContext).tasks[3].state, 'active');
  assert.deepEqual(state, before, 'summary and unsuccessful/successful claims must not mutate their input');
});

test('the maximum board summarizes 100 paths per task and preserves conflicts without changing its input', () => {
  let state = emptyTeam(7);
  const contracts = Array.from({ length: 200 }, (_,index) => task(`task-${index}`,
    Array.from({ length: 100 }, (_,path) => `src/${index}/${path}`)));
  for (let start = 0; start < contracts.length; start += 50) {
    state = transitionTeam(state, { action: 'plan', tasks: contracts.slice(start, start + 50) });
  }
  for (let index = 0; index < 20; index++) {
    state = transitionTeam(state, { action: 'claim', task: `task-${index}`, owner: 'alice' }, { ...context, maxActive: 20 });
  }
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 500_000);
  const before = structuredClone(state);
  const summary = teamSummary(state);
  assert.equal(summary.tasks.length, 200);
  assert.ok(summary.tasks.every(task => task.overlaps.length === 0));
  assert.deepEqual(state, before);
  // A broad planned task still sees every participating writer, in board order.
  const competing = structuredClone(state);
  competing.tasks[199].paths = ['src/**'];
  assert.deepEqual(teamSummary(competing).tasks[199].overlaps, contracts.slice(0, 20).map(task => task.id));
});
