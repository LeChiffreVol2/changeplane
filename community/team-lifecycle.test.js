import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveReceipt, emptyTeam, hydrateTeam, teamDependency, transitionTeam, validateTeam } from './team.js';

const context = { baseSha: 'a'.repeat(40), policySha: 'b'.repeat(40), maxActive: 3 };
const contract = (id, dependsOn = []) => ({ id, title: id, paths: [`src/${id}.js`], dependsOn });
const plan = (state, tasks) => transitionTeam(state, { action: 'plan', tasks });

test('a cancelled prerequisite requires replacement planning, not waiting for an impossible merge', () => {
  let state = plan(emptyTeam(7), [contract('cancelled'), contract('dependent', ['cancelled'])]);
  state = transitionTeam(state, { action: 'cancel', task: 'cancelled' });
  assert.throws(() => transitionTeam(state, { action: 'claim', task: 'dependent', owner: 'alice' }, context),
    { code: 'TEAM_DEPENDENCY_CANCELLED' });
  assert.equal(state.tasks[1].state, 'planned');
});

test('a full retained task window reports capacity without partially registering another contract', () => {
  let state = emptyTeam(7);
  for (let batch = 0; batch < 4; batch++) state = plan(state,
    Array.from({ length: 50 }, (_, index) => contract(`task-${batch * 50 + index}`)));
  assert.throws(() => plan(state, [contract('next')]), { code: 'TEAM_CAPACITY' });
  assert.equal(state.tasks.length, 200);
  assert.equal(state.tasks.some(task => task.id === 'next'), false);
});

test('explicit terminal archival supports more than 200 lifetime tasks without growing the working state', () => {
  let state = emptyTeam(7);
  const archiveFiles = new Map();
  for (let index = 0; index < 250; index++) {
    const id = `done-${index}`;
    state = plan(state, [contract(id)]);
    state = transitionTeam(state, { action: 'cancel', task: id });
    archiveFiles.set(id, archiveReceipt(state.tasks[0]));
    state = transitionTeam(state, { action: 'archive', task: id });
    assert.equal(state.tasks.length, 0);
    assert.equal(state.archivedTasks.length, 0);
  }
  assert.equal(archiveFiles.size, 250);
  state = hydrateTeam(state, [archiveFiles.get('done-0')]);
  assert.throws(() => plan(state, [contract('done-0')]), { code: 'TEAM_TASK_ARCHIVED' });
});

test('archived merged prerequisites retain immutable PR and merge evidence for a fresh forge ancestry check', () => {
  let state = plan(emptyTeam(7), [contract('merged'), contract('dependent', ['merged'])]);
  state = transitionTeam(state, { action: 'claim', task: 'merged', owner: 'alice' }, context);
  state = transitionTeam(state, { action: 'bind', task: 'merged', pullRequest: 9 }, { headSha: 'c'.repeat(40) });
  state = transitionTeam(state, { action: 'observe', task: 'merged' }, {
    state: 'merged', headSha: 'c'.repeat(40), mergeCommitSha: 'd'.repeat(40), outcome: 'MERGED_BY_GITHUB',
  });
  const receipt = archiveReceipt(state.tasks[0]);
  state = transitionTeam(state, { action: 'archive', task: 'merged' });
  assert.equal(state.tasks.length, 1);
  assert.deepEqual(teamDependency(state, 'merged'), receipt);
  assert.equal(receipt.pullRequest, 9);
  assert.equal(receipt.mergeCommitSha, 'd'.repeat(40));
  assert.equal(receipt.branch, 'changeplane/work/merged-1');
  assert.equal(receipt.headSha, 'c'.repeat(40));
  assert.throws(() => hydrateTeam(state, [{ ...receipt, mergeCommitSha: 'e'.repeat(40) }]),
    { code: 'TEAM_ARCHIVE_IMMUTABLE' });
  // The pure state transition does not authenticate this receipt. The adapter
  // must independently recheck its PR and merge ancestry before invoking claim.
  assert.equal(transitionTeam(state, { action: 'claim', task: 'dependent', owner: 'bob' }, context).tasks[0].state, 'active');
});

test('missing dependency receipts can be loaded by ID without restoring old tasks to the working window', () => {
  let state = plan(emptyTeam(7), [contract('cancelled')]);
  state = transitionTeam(state, { action: 'cancel', task: 'cancelled' });
  const receipt = archiveReceipt(state.tasks[0]);
  state = transitionTeam(state, { action: 'archive', task: 'cancelled' });
  state = plan(hydrateTeam(state, [receipt]), [contract('dependent', ['cancelled'])]);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.archivedTasks.length, 1);
  assert.throws(() => transitionTeam(state, { action: 'claim', task: 'dependent', owner: 'alice' }, context),
    { code: 'TEAM_DEPENDENCY_CANCELLED' });
  state = transitionTeam(state, { action: 'cancel', task: 'dependent' });
  state = transitionTeam(state, { action: 'archive', task: 'dependent' });
  assert.equal(state.archivedTasks.length, 0);
});

test('archival never releases active writers or invents missing merge evidence', () => {
  let state = plan(emptyTeam(7), [contract('active')]);
  assert.throws(() => transitionTeam(state, { action: 'archive', task: 'active' }), { code: 'TEAM_ARCHIVE_NOT_TERMINAL' });
  state = transitionTeam(state, { action: 'claim', task: 'active', owner: 'alice' }, context);
  assert.throws(() => transitionTeam(state, { action: 'archive', task: 'active' }), { code: 'TEAM_ARCHIVE_NOT_TERMINAL' });
  state = transitionTeam(state, { action: 'bind', task: 'active', pullRequest: 9 }, { headSha: 'c'.repeat(40) });
  state = transitionTeam(state, { action: 'observe', task: 'active' }, { state: 'merged', headSha: 'c'.repeat(40), outcome: 'MERGED_BY_GITHUB' });
  assert.throws(() => transitionTeam(state, { action: 'archive', task: 'active' }), { code: 'TEAM_ARCHIVE_EVIDENCE_REQUIRED' });
  assert.throws(() => archiveReceipt({ ...state.tasks[0], state: 'cancelled' }), { code: 'TEAM_ARCHIVE_NOT_TERMINAL' });
});

test('validation preserves observer progress independently of a subsequently archived task', () => {
  const state = { ...emptyTeam(7), observerCursor: 'previous-task' };
  assert.equal(validateTeam(state).observerCursor, 'previous-task');
  assert.equal(plan(state, [contract('new-task')]).observerCursor, 'previous-task');
  assert.throws(() => validateTeam({ ...state, observerCursor: '../invalid' }), { code: 'TEAM_STATE_INVALID' });
});

test('legacy state upgrades to schema 2 so older writers fail closed before dropping archive files', () => {
  const legacy = { schemaVersion: 1, kind: 'changeplane.team', repositoryId: 7, tasks: [] };
  assert.equal(validateTeam(legacy).schemaVersion, 2);
  assert.deepEqual(validateTeam(legacy), emptyTeam(7));
  assert.equal(plan(legacy, [contract('new-task')]).schemaVersion, 2);
  assert.equal(legacy.schemaVersion, 1);
  assert.throws(() => validateTeam({ ...legacy, schemaVersion: 3 }), { code: 'TEAM_STATE_INVALID' });
});

test('explicit policy adoption clears old handoffs while preserving the existing writer and immutable scope', () => {
  let state = plan(emptyTeam(7), [contract('active')]);
  state = transitionTeam(state, { action: 'claim', task: 'active', owner: 'alice' }, context);
  const workspaceId = '11111111-1111-1111-1111-111111111111';
  state = transitionTeam(state, { action: 'workspace', task: 'active', owner: 'alice', workspaceId });
  state = transitionTeam(state, { action: 'bind', task: 'active', pullRequest: 9 }, { headSha: 'c'.repeat(40) });
  state = transitionTeam(state, { action: 'observe', task: 'active' }, {
    state: 'blocked', headSha: 'c'.repeat(40), outcome: 'REVIEW_CHANGED_TASK_POLICY',
    handoff: { id: 'a'.repeat(64), headSha: 'c'.repeat(40), baseSha: context.baseSha, outcome: 'REVIEW_CHANGED_TASK_POLICY', status: 'pending' },
  });
  const before = structuredClone(state.tasks[0]), fresh = { ...context, policySha: 'd'.repeat(40) };
  const command = { action: 'adopt-policy', task: 'active', owner: 'alice', policySha: fresh.policySha };
  assert.throws(() => transitionTeam(state, { ...command, owner: 'bob' }, fresh), { code: 'TEAM_OWNER_MISMATCH' });
  assert.throws(() => transitionTeam(state, { ...command, policySha: context.policySha }, fresh), { code: 'TEAM_POLICY_CHANGED' });
  const adopted = transitionTeam(state, command, fresh).tasks[0];
  assert.deepEqual(adopted, { ...before, policySha: fresh.policySha, handoff: null, outcome: 'REOBSERVE_PR' });
  assert.deepEqual(state.tasks[0], before);
  assert.throws(() => transitionTeam(plan(emptyTeam(7), [contract('planned')]),
    { ...command, task: 'planned' }, fresh), { code: 'TEAM_TASK_NOT_ACTIVE' });
});
