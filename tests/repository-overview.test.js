import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRepository, issueRevision } from '../community/repository-github.js';
import { CollectionError } from '../community/transport.js';
import { emptyTeam, transitionTeam } from '../community/team.js';

const base = 'a'.repeat(40), head = 'b'.repeat(40), teamSha = 'c'.repeat(40);
const root = '/repos/example/repo';
const file = value => ({ type: 'file', encoding: 'base64', size: Buffer.byteLength(JSON.stringify(value)), content: Buffer.from(JSON.stringify(value)).toString('base64') });
const issueRow = (number, changes = {}) => ({ id: number + 100, number, title: `Improve repository work ${number}`, body: 'Context: a person needs to follow this issue.\nAcceptance criteria: the outcome is verified.',
  repository_url: `https://api.github.com${root}`, state: 'open', labels: [], assignees: [], updated_at: '2026-10-03T11:00:00Z', ...changes });
const pullRow = (number, changes = {}) => ({ id: number + 200, number, title: 'Update the dependency', state: 'open', draft: false,
  base: { ref: 'main', repo: { id: 7, full_name: 'example/repo' } }, head: { sha: head }, labels: [], assignees: [], user: { login: 'dependabot[bot]' }, ...changes });
function fixture() {
  const f = {
    calls: [], repo: { id: 7, full_name: 'example/repo', default_branch: 'main' }, sha: base,
    policy: { team: { enabled: true, maxActive: 3 }, protectedPaths: { block: [], requireApproval: [] }, evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] } },
    issues: [issueRow(1, { title: 'Improve repository work' }), issueRow(2, { title: 'Improve repository work now', labels: [{ name: 'priority: high' }] }), issueRow(3, { title: 'Missing details', body: null }),
      issueRow(4, { title: 'Explain setup', labels: [{ name: 'documentation' }] }), issueRow(5, { title: 'Investigate flaky test', labels: [{ name: 'flaky' }] }),
      { pull_request: { url: 'ignored' } }],
    pulls: [pullRow(9)], closed: [pullRow(10, { state: 'closed', merged_at: '2026-10-02T10:00:00Z', merge_commit_sha: 'd'.repeat(40) }), pullRow(11, { state: 'closed', merged_at: null })],
    runs: [{ id: 11, workflow_id: 1, name: 'CI', head_sha: head, repository: { id: 7, full_name: 'example/repo' }, status: 'completed', conclusion: 'failure' }],
    team: emptyTeam(7), teamSha, hook: null,
  };
  f.get = async path => {
    f.calls.push(path);
    const override = await f.hook?.(path, f.calls);
    if (override !== undefined) return override;
    if (path === root) return structuredClone(f.repo);
    if (path === `${root}/commits/main`) return { sha: f.sha };
    if (path === `${root}/contents/.changeplane.json?ref=${base}`) return file(f.policy);
    if (path.startsWith(`${root}/issues?`)) return structuredClone(f.issues);
    if (path.startsWith(`${root}/pulls?state=open`)) return structuredClone(f.pulls);
    if (path.startsWith(`${root}/pulls?state=closed`)) return structuredClone(f.closed);
    if (path.startsWith(`${root}/actions/runs?`)) return { total_count: f.runs.length, workflow_runs: structuredClone(f.runs) };
    if (path === `${root}/git/ref/heads/changeplane/team-state`) return { ref: 'refs/heads/changeplane/team-state', object: { type: 'commit', sha: f.teamSha } };
    if (path === `${root}/contents/team.json?ref=${teamSha}`) return file(f.team);
    if (/\/issues\/\d+$/u.test(path)) return structuredClone(f.issues.find(row => row.number === Number(path.split('/').at(-1))));
    throw new Error(`Unexpected read ${path}`);
  };
  f.api = { repository: 'example/repo', root, get: f.get };
  return f;
}

test('repository inbox connects bounded intake, native PRs, team state, maintenance and a release preparation', async () => {
  const f = fixture();
  f.team = transitionTeam(f.team, { action: 'plan', tasks: [{ id: 'work', title: 'Work', paths: ['src/**'], issue: 1 }] }, { repositoryId: 7 });
  const result = await inspectRepository({ api: f.api, issue: 1 });
  assert.equal(result.kind, 'changeplane.repository-overview');
  assert.deepEqual(result.binding, { repositoryId: 7, defaultBranch: 'main', baseSha: base });
  assert.equal(result.issues.items.length, 5);
  assert.deepEqual(result.issues.items[2].missingInputs, ['acceptanceCriteria', 'context']);
  assert.equal(result.issues.items[1].priority.label, 'priority: high');
  assert.equal(result.issues.items[0].duplicateCandidates[0].number, 2);
  assert.equal(result.selectedIssue.binding.issueRevision, issueRevision(f.issues[0]));
  assert.equal(result.team.tasks[0].id, 'work');
  assert.equal(result.team.observationsFresh, false);
  assert.equal(result.pullRequests.items[0].assurance, 'not-assessed');
  assert.deepEqual(result.maintenance.suggestions.map(item => item.kind), ['documentation', 'flaky-test-investigation', 'dependency', 'ci-investigation']);
  assert.equal(result.release.draft.items.length, 1);
  assert.equal(result.release.draft.items[0].mergeCommitSha, 'd'.repeat(40));
  assert.equal(result.release.published, false);
  assert.equal(result.release.coverage, 'bounded-window');
  assert.equal(result.authority.mergeAuthorized, false);
  assert.equal(result.authority.sourceWrites, false);
  assert.ok(result.collection.reads <= 20);
  assert.equal(result.collection.reads, f.calls.length);
  assert.equal(JSON.stringify(result.issues).includes('Context: a person'), false);
  assert.equal(result.selectedIssue.context.body, f.issues[0].body);
  assert.equal(result.selectedIssue.context.untrusted, true);
  assert.equal(result.needsAttention.find(item => item.kind === 'issue').id, 1);
});

test('selected issue content has a stable digest across native assignment and closure', () => {
  const issue = issueRow(1), revision = issueRevision(issue);
  assert.equal(issueRevision({ ...issue, state: 'closed', updated_at: '2026-10-04T00:00:00Z', assignees: [{ login: 'new-owner' }] }), revision);
  assert.notEqual(issueRevision({ ...issue, body: `${issue.body}\nExpanded goal` }), revision);
  assert.notEqual(issueRevision({ ...issue, labels: [{ name: 'new scope' }] }), revision);
  assert.throws(() => issueRevision({ ...issue, labels: [{ name: { secret: 'never reflected' } }] }), /RESPONSE_INVALID/u);
});

test('only an explicitly selected issue includes bounded untrusted context, without weakening the full goal digest', async () => {
  const f = fixture();
  f.issues[0].body = 'Private goal context. '.repeat(1000);
  const overview = await inspectRepository({ api: f.api });
  assert.equal(JSON.stringify(overview).includes('Private goal context'), false);
  const selected = await inspectRepository({ api: f.api, issue: 1 });
  assert.equal(selected.selectedIssue.context.body.length, 16_000);
  assert.equal(selected.selectedIssue.context.truncated, true);
  assert.equal(selected.selectedIssue.context.untrusted, true);
  assert.equal(selected.selectedIssue.revision, issueRevision(f.issues[0]));
  assert.equal(JSON.stringify(selected.issues).includes('Private goal context'), false);
});

test('collection failures are explicit, redacted and do not erase available independent sources', async () => {
  const f = fixture();
  f.hook = path => {
    if (path.includes('/issues?')) throw new CollectionError('PERMISSION_DENIED', { provider: 'github', status: 403 });
    if (path.includes('/actions/')) throw new Error('secret provider response');
  };
  const result = await inspectRepository({ api: f.api });
  assert.equal(result.issues.status, 'unavailable');
  assert.equal(result.issues.reasonCode, 'PERMISSION_DENIED');
  assert.deepEqual(result.issues.items, []);
  assert.equal(result.pullRequests.status, 'available');
  assert.equal(result.maintenance.status, 'partial');
  assert.equal(result.maintenance.coverage.workflows, 'unknown');
  assert.ok(result.needsAttention.some(item => item.id === 'workflows' && item.kind === 'source'));
  assert.equal(JSON.stringify(result).includes('secret provider'), false);
});

test('full first pages disclose incomplete coverage without pagination or N+1 PR assessments', async () => {
  const f = fixture();
  f.issues = Array.from({ length: 30 }, (_, index) => issueRow(index + 1));
  f.pulls = Array.from({ length: 30 }, (_, index) => pullRow(index + 1));
  const result = await inspectRepository({ api: f.api });
  assert.equal(result.issues.coverage, 'bounded-window');
  assert.equal(result.pullRequests.coverage, 'bounded-window');
  assert.ok(result.collection.reads <= 20);
  assert.equal(f.calls.some(path => path.includes('page=2') || /\/pulls\/\d/u.test(path)), false);
});

test('foreign and malformed source identities are never converted into trusted links or empty healthy sections', async () => {
  const f = fixture();
  f.issues[0].repository_url = 'https://api.github.com/repos/other/repo';
  f.pulls[0].base.repo.id = 8;
  f.runs[0].repository.full_name = 'other/repo';
  const result = await inspectRepository({ api: f.api });
  assert.equal(result.issues.status, 'unavailable');
  assert.equal(result.pullRequests.status, 'unavailable');
  assert.equal(result.maintenance.coverage.workflows, 'unknown');
  assert.equal(JSON.stringify(result).includes('other/repo'), false);
});

test('repository replacement, default revision motion and selected issue edits prevent a bound result', async () => {
  for (const change of ['repo', 'base', 'issue']) {
    const f = fixture();
    f.hook = (path, calls) => {
      if (change === 'repo' && path === root && calls.filter(value => value === path).length > 1) return { ...f.repo, id: 99 };
      if (change === 'base' && path === `${root}/commits/main` && calls.filter(value => value === path).length > 1) return { sha: head };
      if (change === 'issue' && path === `${root}/issues/1` && calls.filter(value => value === path).length > 1) return { ...f.issues[0], body: 'Changed request' };
    };
    await assert.rejects(inspectRepository({ api: f.api, issue: 1 }), /RESPONSE_INVALID|EVIDENCE_CHANGED/u);
  }
});

test('changed team state is discarded, absent team state is distinguished from denied access', async () => {
  const f = fixture();
  f.hook = (path, calls) => {
    if (path.includes('/git/ref/') && calls.filter(value => value === path).length > 1)
      return { ref: 'refs/heads/changeplane/team-state', object: { type: 'commit', sha: head } };
  };
  let result = await inspectRepository({ api: f.api });
  assert.equal(result.team.status, 'unavailable');
  assert.equal(result.team.reasonCode, 'EVIDENCE_CHANGED');
  assert.deepEqual(result.team.tasks, []);
  f.hook = path => { if (path.includes('/git/ref/')) throw new CollectionError('NOT_FOUND', { status: 404 }); };
  result = await inspectRepository({ api: f.api });
  assert.equal(result.team.status, 'not-started');
  f.hook = path => { if (path.includes('/git/ref/')) throw new CollectionError('PERMISSION_DENIED', { status: 403 }); };
  result = await inspectRepository({ api: f.api });
  assert.equal(result.team.status, 'unavailable');
});

test('latest collected successful workflow suppresses older failure and never diagnoses flakiness', async () => {
  const f = fixture();
  f.runs.unshift({ ...f.runs[0], id: 12, conclusion: 'success' });
  const result = await inspectRepository({ api: f.api });
  assert.equal(result.maintenance.suggestions.some(item => item.kind === 'ci-investigation'), false);
  assert.equal(result.maintenance.suggestions.filter(item => item.kind === 'flaky-test-investigation').length, 1);
});

test('selected pull request is not accepted as an issue and invalid inputs cause no reads', async () => {
  const f = fixture();
  for (const invalid of [-1, 0, '1', 1.5]) await assert.rejects(inspectRepository({ api: f.api, issue: invalid }), /INPUT_INVALID/u);
  assert.equal(f.calls.length, 0);
  f.issues[0].pull_request = { url: 'ignored' };
  const result = await inspectRepository({ api: f.api, issue: 1 });
  assert.equal(result.selectedIssueStatus, 'unavailable');
  assert.equal(result.selectedIssue, null);
});

test('reader can reuse the existing exact-repository team GET adapter without a mutation', async () => {
  const f = fixture();
  const result = await inspectRepository({ api: { repository: f.api.repository, root, request: (method, path) => {
    assert.equal(method, 'GET'); return f.get(path);
  } } });
  assert.equal(result.issues.status, 'available');
});
