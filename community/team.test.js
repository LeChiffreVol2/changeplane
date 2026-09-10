import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTeam, transitionTeam, validateTeam, teamSummary } from './team.js';
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
