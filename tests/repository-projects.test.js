import test from 'node:test';
import assert from 'node:assert/strict';
import { syncProjectDelivery } from '../community/repository-projects.js';
import { issueRevision } from '../community/repository-issue.js';
import { operateTeam } from '../community/team-github.js';
import { emptyTeam, transitionTeam, issuePlanDigest } from '../community/team.js';

const base = 'a'.repeat(40), head = 'b'.repeat(40), merge = 'c'.repeat(40), teamSha = 'd'.repeat(40);
const root = '/repos/example/repo';
const project = { id: 'PVT_1', fieldId: 'PVTSSF_1', optionId: 'done-option' };
const connection = nodes => ({ nodes, pageInfo: { hasNextPage: false } });
const file = value => ({ type: 'file', encoding: 'base64', size: Buffer.byteLength(JSON.stringify(value)), content: Buffer.from(JSON.stringify(value)).toString('base64') });
async function fixture({ taskCount = 1, archived = false } = {}) {
  const context = { baseSha: base, policySha: base, maxActive: 3 };
  const f = { rest: [], graphs: [], fail: null, graphHook: null, desired: null,
    issue: { id: 101, number: 1, title: 'Deliver the outcome', body: 'Expected result: documented delivery.', labels: [],
      state: 'open', repository_url: `https://api.github.com${root}` },
    policy: { team: { enabled: true, maxActive: 3, projectSyncEnabled: true }, protectedPaths: { block: [], requireApproval: [] },
      evidence: { requiredChecks: [{ name: 'CI', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] } },
  };
  const revision = issueRevision(f.issue);
  const ids = Array.from({ length: taskCount }, (_, index) => taskCount === 1 ? 'work' : `work-${index}`);
  f.state = transitionTeam(emptyTeam(7), { action: 'plan', tasks: ids.map(id => ({ id, title: 'Work', issue: 1, issueRevision: revision,
    acceptanceCriteria: ['The requested outcome is demonstrated.'], paths: [`src/${id}.js`] })) });
  for (const [index, id] of ids.entries()) {
    f.state = transitionTeam(f.state, { action: 'claim', task: id, owner: 'alice' }, context);
    f.state = transitionTeam(f.state, { action: 'bind', task: id, pullRequest: 9 + index }, { headSha: head });
    f.state = transitionTeam(f.state, { action: 'observe', task: id }, { state: 'merged', headSha: head, mergeCommitSha: merge, outcome: 'MERGED_BY_GITHUB' });
  }
  const plan = { issue: 1, issueId: 101, issueRevision: revision, baseSha: base, policySha: base, tasks: ids };
  plan.digest = issuePlanDigest(7, plan, f.state.tasks);
  f.state.issuePlans = [plan];
  const tasks = structuredClone(f.state.tasks);
  if (archived) f.state.tasks = [];
  f.api = { repository: 'example/repo', root, request: async (method, path) => {
    f.rest.push({ method, path }); assert.equal(method, 'GET');
    if (path === root) return { id: 7, full_name: 'example/repo', default_branch: 'main' };
    if (path === `${root}/commits/main`) return { sha: base };
    if (path === `${root}/contents/.changeplane.json?ref=${base}`) return file(f.policy);
    if (path === `${root}/git/ref/heads/changeplane/team-state`) return { ref: 'refs/heads/changeplane/team-state', object: { type: 'commit', sha: teamSha } };
    if (path === `${root}/contents/team.json?ref=${teamSha}`) return file(f.state);
    if (path === `${root}/git/commits/${teamSha}`) return { tree: { sha: 'e'.repeat(40) } };
    if (path.startsWith(`${root}/contents/archives/`)) return file(tasks.find(task => path === `${root}/contents/archives/${task.id}.json?ref=${teamSha}`));
    if (path === `${root}/issues/1`) return structuredClone(f.issue);
    if (path.startsWith(`${root}/pulls/`)) {
      const task = tasks.find(task => path === `${root}/pulls/${task.pullRequest}`);
      return { id: 200 + task.pullRequest, number: task.pullRequest, state: 'closed', merged: true, merge_commit_sha: merge,
        head: { sha: head, ref: task.branch, repo: { id: 7, full_name: 'example/repo' } },
        base: { sha: base, ref: 'main', repo: { id: 7, full_name: 'example/repo' } } };
    }
    if (path === `${root}/compare/${merge}...${base}`) return { status: 'ahead' };
    throw new Error(`Unexpected REST read ${path}`);
  } };
  f.report = await operateTeam({ api: f.api, command: { action: 'delivery', issue: 1 } });
  assert.equal(f.report.readyForAcceptance, true);
  plan.receipt = { digest: f.report.digest, confirmedBy: 'alice', acceptedCriteria: f.report.tasks.map(task => ({ task: task.task, criterion: 0 })), baseSha: base, policySha: base };
  f.graph = () => ({ repository: { databaseId: 7, nameWithOwner: 'example/repo', issue: { id: 'I_1', fullDatabaseId: '101', number: 1,
    projectItems: connection([{ id: 'PVTI_1', isArchived: false, project: { id: project.id },
      fieldValues: connection(f.desired ? [{ optionId: f.desired, field: { id: project.fieldId } }] : []) }]) } },
    node: { id: project.id, closed: false, fields: connection([{ id: project.fieldId, options: [{ id: project.optionId }] }]) } });
  f.fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.github.com/graphql');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer dedicated-project-token');
    const body = JSON.parse(options.body), mutation = body.query.startsWith('mutation');
    f.graphs.push({ ...body, mutation });
    if (mutation) {
      assert.deepEqual(body.variables, { project: project.id, item: 'PVTI_1', field: project.fieldId, option: project.optionId });
      f.desired = project.optionId;
      if (f.fail === 'uncertain') throw new Error('private provider information');
      return Response.json({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } } });
    }
    const data = f.graph();
    await f.graphHook?.(data, f.graphs.filter(item => !item.mutation).length);
    return Response.json({ data });
  };
  f.run = (overrides = {}) => syncProjectDelivery({ api: f.api, issue: 1, expectedDigest: f.report.digest,
    project, token: 'dedicated-project-token', writeEnabled: true, fetchImpl: f.fetchImpl, ...overrides });
  return f;
}

test('only a confirmed current delivery can update one selected existing Project field, and repeated invocation reads before no-op', async () => {
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.status, 'synced');
  assert.equal(result.deliveryDigest, f.report.digest);
  assert.equal(result.itemId, 'PVTI_1');
  assert.equal(result.authority.sourceWrites, false);
  assert.equal(result.authority.mergeAuthorized, false);
  assert.equal(f.graphs.filter(item => item.mutation).length, 1);
  const before = f.graphs.length;
  const again = await f.run();
  assert.equal(again.status, 'already-synced');
  assert.equal(f.graphs.length, before + 2);
  assert.equal(f.graphs.filter(item => item.mutation).length, 1);
  assert.equal(JSON.stringify(result).includes('dedicated-project-token'), false);
});

test('the dedicated write flag, trusted repository policy, and exact receipt are all required before GraphQL access', async () => {
  const f = await fixture();
  await assert.rejects(f.run({ writeEnabled: false }), { code: 'PROJECT_WRITES_DISABLED' });
  await assert.rejects(f.run({ expectedDigest: 'f'.repeat(64) }), { code: 'PROJECT_DELIVERY_CHANGED' });
  f.policy.team.projectSyncEnabled = false;
  await assert.rejects(f.run(), { code: 'PROJECT_POLICY_DISABLED' });
  assert.equal(f.graphs.length, 0);
});

test('foreign issue identity, unknown field options, archived items and paginated project lists fail before mutation', async () => {
  for (const mutate of [
    data => { data.repository.databaseId = 8; },
    data => { data.repository.issue.fullDatabaseId = '999'; },
    data => { data.node.fields.nodes[0].options = [{ id: 'different' }]; },
    data => { data.repository.issue.projectItems.nodes[0].isArchived = true; },
    data => { data.repository.issue.projectItems.pageInfo.hasNextPage = true; },
    data => { data.repository.issue.projectItems.nodes.push(structuredClone(data.repository.issue.projectItems.nodes[0])); },
  ]) {
    const f = await fixture(); f.graphHook = mutate;
    await assert.rejects(f.run(), /PROJECT_TARGET_INVALID|PROJECT_COLLECTION_INCOMPLETE/u);
    assert.equal(f.graphs.filter(item => item.mutation).length, 0);
  }
});

test('concurrent Project edits and issue scope edits invalidate the operation before any write', async () => {
  const f = await fixture();
  f.graphHook = (data, count) => { if (count === 2) data.repository.issue.projectItems.nodes[0].id = 'PVTI_other'; };
  await assert.rejects(f.run(), { code: 'PROJECT_ITEM_CHANGED' });
  assert.equal(f.graphs.filter(item => item.mutation).length, 0);
  const changed = await fixture();
  changed.graphHook = (_, count) => { if (count === 2) changed.issue.body += ' New acceptance scope.'; };
  await assert.rejects(changed.run(), { code: 'PROJECT_DELIVERY_CHANGED' });
  assert.equal(changed.graphs.filter(item => item.mutation).length, 0);
});

test('ambiguous writes are never retried automatically; a later operator invocation reads the applied state first', async () => {
  const f = await fixture(); f.fail = 'uncertain';
  await assert.rejects(f.run(), { code: 'PROJECT_WRITE_UNCERTAIN' });
  assert.equal(f.graphs.filter(item => item.mutation).length, 1);
  f.fail = null;
  assert.equal((await f.run()).status, 'already-synced');
  assert.equal(f.graphs.filter(item => item.mutation).length, 1);
});

test('a post-write mismatch is reported as uncertain without applying a compensating or repeated mutation', async () => {
  const f = await fixture();
  f.graphHook = (data, count) => { if (count === 3) data.repository.issue.projectItems.nodes[0].fieldValues.nodes[0].optionId = 'changed'; };
  await assert.rejects(f.run(), { code: 'PROJECT_WRITE_UNCERTAIN' });
  assert.equal(f.graphs.filter(item => item.mutation).length, 1);
});

test('twenty archived tasks fit the shared 200-read budget including pre-write and post-write bindings', async () => {
  const f = await fixture({ taskCount: 20, archived: true });
  const request = f.api.request; let reads = 0;
  f.api.request = (method, path) => {
    assert.ok(++reads <= 200, 'delivery sync exhausted the shared read budget');
    return request(method, path);
  };
  const result = await f.run();
  assert.equal(result.status, 'synced');
  assert.equal(f.graphs.filter(item => item.mutation).length, 1);
  assert.ok(reads <= 200);
});

test('human Project changes during the long delivery collection are observed before applying', async () => {
  const f = await fixture();
  const request = f.api.request;
  f.api.request = (method, path) => {
    if (f.graphs.length === 1 && path === root) f.desired = 'human-selected-option';
    return request(method, path);
  };
  await assert.rejects(f.run(), { code: 'PROJECT_ITEM_CHANGED' });
  assert.equal(f.graphs.filter(item => item.mutation).length, 0);
});

test('goal changes after a successful Project response are reported uncertain without further mutation', async () => {
  const f = await fixture();
  f.graphHook = (_, count) => { if (count === 3) f.issue.body += ' A later goal change.'; };
  await assert.rejects(f.run(), { code: 'PROJECT_WRITE_UNCERTAIN' });
  assert.equal(f.graphs.filter(item => item.mutation).length, 1);
});

test('GraphQL errors and transport failures expose only a redacted failure code', async () => {
  const f = await fixture();
  await assert.rejects(f.run({ fetchImpl: async () => Response.json({ data: {}, errors: [{ message: 'private provider response' }] }) }),
    { code: 'PROJECT_SOURCE_UNAVAILABLE' });
  await assert.rejects(f.run({ fetchImpl: async () => { throw new Error('private provider response'); } }),
    { code: 'PROJECT_SOURCE_UNAVAILABLE' });
});
