import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { archiveReceipt, emptyTeam, transitionTeam } from './team.js';
import { nextTeamHandoffs, observeTeam, operateTeam } from './team-github.js';
import { reviewFeedback } from './team-feedback.js';
import { CollectionError } from './transport.js';

const base = 'a'.repeat(40), head = 'b'.repeat(40), merge = 'c'.repeat(40);
const context = { baseSha: base, policySha: base, maxActive: 20 };
const workspaceId = '11111111-1111-1111-1111-111111111111';
const policy = { team: { enabled: true, maxActive: 20 }, protectedPaths: { block: [], requireApproval: [] },
  evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] } };
const file = value => ({ type: 'file', encoding: 'base64', size: Buffer.byteLength(JSON.stringify(value)), content: Buffer.from(JSON.stringify(value)).toString('base64') });
function activeState(ids = ['api']) {
  let state = transitionTeam(emptyTeam(7), { action: 'plan', tasks: ids.map(id => ({ id, title: id, paths: [`src/${id}/**`] })) });
  for (const task of ids) state = transitionTeam(state, { action: 'claim', task, owner: 'alice' }, context);
  return state;
}
function boundState() {
  let state = transitionTeam(activeState(), { action: 'workspace', task: 'api', owner: 'alice', workspaceId });
  return transitionTeam(state, { action: 'bind', task: 'api', pullRequest: 9 }, { headSha: head });
}
// Small in-memory forge: all writes stay in this object. Its state starts at the
// scenario's independently constructed coordination revision, not a live repo.
function forge(initial) {
  let state = structuredClone(initial), tip = '1'.repeat(40), tree = '2'.repeat(40), serial = 0;
  const trees = new Map(), commits = new Map(), reads = [];
  const pr = { id: 91, number: 9, state: 'open', merged: false, merge_commit_sha: null, changed_files: 1, draft: false, mergeable: true,
    head: { sha: head, ref: 'changeplane/work/api-1', repo: { id: 7, full_name: 'example/repo' } },
    base: { sha: base, ref: 'main', repo: { id: 7, full_name: 'example/repo' } } };
  const f = { pr, reviews: [], comments: [], reads };
  const api = { repository: 'example/repo', root: '/repos/example/repo', request: async (method, path, body) => {
    const suffix = path.slice(api.root.length);
    if (method === 'GET') {
      reads.push(suffix);
      if (!suffix) return { id: 7, full_name: api.repository, default_branch: 'main' };
      if (suffix === '/commits/main') return { sha: base };
      if (suffix.startsWith('/contents/.changeplane.json?')) return file(policy);
      if (suffix === '/git/ref/heads/changeplane/team-state') return { ref: 'refs/heads/changeplane/team-state', object: { type: 'commit', sha: tip } };
      if (suffix.startsWith('/git/commits/')) return { tree: { sha: tree } };
      if (suffix.startsWith('/contents/team.json?')) return file(state);
      if (suffix.startsWith('/contents/archives/')) throw new CollectionError('NOT_FOUND', { status: 404 });
      if (suffix === '/pulls/9') return structuredClone(pr);
      if (suffix.startsWith('/pulls?')) return [];
      if (suffix.startsWith('/pulls/9/reviews?')) return structuredClone(f.reviews);
      if (suffix.startsWith('/pulls/9/comments?')) return structuredClone(f.comments);
      if (suffix.startsWith('/pulls/9/files?')) return [{ filename: 'src/api/a.js', status: 'modified' }];
      if (suffix.startsWith('/actions/runs?')) return { total_count: 1, workflow_runs: [{ id: 11, workflow_id: 12, run_number: 1, run_attempt: 1,
        head_sha: head, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', repository: { full_name: api.repository }, head_repository: { full_name: api.repository } }] };
      if (suffix === '/actions/runs/11/attempts/1/jobs?per_page=100') return { total_count: 1, jobs: [{ id: 13, run_id: 11, head_sha: head, name: 'Behavior', status: 'completed', conclusion: 'success' }] };
      if (suffix.startsWith('/compare/')) return { status: 'ahead' };
      throw new Error(`Unexpected synthetic read ${suffix}`);
    }
    const sha = createHash('sha1').update(JSON.stringify(body) + ++serial).digest('hex');
    if (suffix === '/git/trees') { trees.set(sha, JSON.parse(body.tree.find(item => item.path === 'team.json').content)); return { sha }; }
    if (suffix === '/git/commits') { commits.set(sha, body.tree); return { sha }; }
    if (suffix === '/git/refs/heads/changeplane/team-state') {
      tip = body.sha; tree = commits.get(tip); state = trees.get(tree);
      return { ref: 'refs/heads/changeplane/team-state', object: { sha: tip } };
    }
    throw new Error(`Unexpected synthetic mutation ${suffix}`);
  } };
  return { ...f, api, get state() { return state; }, setReviews: value => { f.reviews = value; } };
}
const review = (id, state) => ({ id, user: { id: 77 }, state, commit_id: head, submitted_at: `2026-09-10T12:00:${String(id % 60).padStart(2, '0')}Z`, body: 'Untrusted review text.' });

test('an archived dependency cannot substitute a different live head or merge identity', async () => {
  for (const changed of ['head', 'merge']) {
    let state = transitionTeam(boundState(), { action: 'observe', task: 'api' }, { state: 'merged', outcome: 'MERGED_BY_GITHUB', headSha: head, mergeCommitSha: merge });
    const receipt = archiveReceipt(state.tasks[0]);
    const beforeArchive = forge(state); beforeArchive.pr.state = 'closed'; beforeArchive.pr.merged = true;
    beforeArchive.pr.merge_commit_sha = changed === 'merge' ? 'd'.repeat(40) : merge;
    beforeArchive.pr.head.sha = changed === 'head' ? 'd'.repeat(40) : head;
    await assert.rejects(operateTeam({ api: beforeArchive.api, command: { action: 'archive', task: 'api' } }), { code: 'TEAM_MERGE_RECEIPT_CHANGED' });
    assert.equal(beforeArchive.state.tasks[0].state, 'merged');
    state = transitionTeam(state, { action: 'plan', tasks: [{ id: 'next', title: 'Next', paths: ['src/next/**'], dependsOn: ['api'] }] });
    state = transitionTeam(state, { action: 'archive', task: 'api' });
    assert.deepEqual(state.archivedTasks[0], receipt);
    const f = forge(state); f.pr.state = 'closed'; f.pr.merged = true;
    f.pr.merge_commit_sha = changed === 'merge' ? 'd'.repeat(40) : merge;
    f.pr.head.sha = changed === 'head' ? 'd'.repeat(40) : head;
    await assert.rejects(operateTeam({ api: f.api, command: { action: 'claim', task: 'next', owner: 'alice' } }), { code: 'TEAM_MERGE_RECEIPT_CHANGED' });
    assert.equal(f.state.tasks[0].state, 'planned');
  }
});

test('expected sweep budget exhaustion defers work without failing the observer or returning stale handoffs', async () => {
  const f = forge(boundState());
  let remaining = 31;
  const request = f.api.request;
  f.api.request = async (method, path, body) => { if (method === 'GET') remaining--; return request(method, path, body); };
  f.api.budget = () => ({ requestsRemaining: remaining, millisecondsRemaining: 60_000 });
  const report = await observeTeam({ createApi: () => f.api, sleep: async () => {} });
  assert.equal(report.observerStatus, 'partial');
  assert.equal(report.observations[0].state, 'deferred');
  assert.equal(report.observations[0].code, 'TEAM_SWEEP_BUDGET');
  assert.equal(report.tasks[0].handoff, null);
});

test('sweeps persist cursor progress even when every inspected task is waiting for its first PR', async () => {
  const f = forge(activeState(['one', 'two', 'three', 'four', 'five', 'six']));
  const first = await operateTeam({ api: f.api, command: { action: 'reconcile' } });
  assert.equal(first.observations.find(item => item.task === 'six').state, 'deferred');
  assert.equal(f.state.observerCursor, 'five');
  const second = await operateTeam({ api: f.api, command: { action: 'reconcile' } });
  assert.equal(second.observations[0].task, 'six');
  assert.equal(second.observations[0].outcome, 'WAIT_FOR_TASK_PR');
});

test('duplicate native review identities cannot conceal requested changes during reviewer-state reduction', async () => {
  const f = forge(boundState()); f.setReviews([review(80, 'CHANGES_REQUESTED'), review(80, 'APPROVED')]);
  await assert.rejects(reviewFeedback(f.api, 9, head), { code: 'TEAM_REVIEW_INVALID' });
});

test('a later distinct review supersedes a request while an ordinary comment does not grant that authority', async () => {
  const f = forge(boundState()); f.setReviews([review(80, 'CHANGES_REQUESTED'), review(81, 'COMMENTED')]);
  assert.equal((await reviewFeedback(f.api, 9, head)).requiresChanges, true);
  f.setReviews([review(80, 'CHANGES_REQUESTED'), review(81, 'APPROVED')]);
  assert.equal((await reviewFeedback(f.api, 9, head)).requiresChanges, false);
});

test('feedback changing during one observation produces no currently actionable handoff', async () => {
  const f = forge(boundState()), request = f.api.request;
  let reviewReads = 0;
  f.api.request = async (method, path, body) => {
    if (path.includes('/reviews?') && ++reviewReads === 2) f.setReviews([review(80, 'CHANGES_REQUESTED')]);
    return request(method, path, body);
  };
  const report = await nextTeamHandoffs({ api: f.api, owner: 'alice' });
  assert.deepEqual(report.handoffs, []);
  assert.deepEqual(report.work, []);
  assert.deepEqual(report.unavailable, ['api']);
});
