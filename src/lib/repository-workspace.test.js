import test from 'node:test';
import assert from 'node:assert/strict';
import { issuePlanSnapshot, repositoryLink, repositoryOverviewMatches, repositoryPlanningHandoff } from './repository-workspace.js';

const issue = { number: 12, title: 'Clarify empty input', revision: 'b'.repeat(64),
  binding: { repositoryId: 42, issueNumber: 12, issueRevision: 'b'.repeat(64), baseSha: 'a'.repeat(40) } };
const report = () => ({ kind: 'changeplane.repository-overview', repository: 'example/project',
  binding: { repositoryId: 42, baseSha: 'a'.repeat(40) }, issues: { items: [issue] }, pullRequests: { items: [] },
  team: { tasks: [], issuePlans: [] }, needsAttention: [], maintenance: { suggestions: [] }, release: {}, selectedIssue: issue });

test('planning handoffs require the selected issue and exact repository revision binding', () => {
  const value = report();
  assert.equal(repositoryOverviewMatches(value, 'example/project', 12), true);
  const prompt = repositoryPlanningHandoff(value, issue);
  assert.ok(prompt.includes(issue.revision));
  assert.match(prompt, /operator must accept the plan before work is claimed/u);
  assert.match(prompt, /copying this request does not start an agent/u);
  assert.match(prompt, /verify every acceptance criterion/u);
  assert.equal(repositoryOverviewMatches(value, 'other/project', 12), false);
  for (const modify of [v => { v.selectedIssue.number = 13; }, v => { v.selectedIssue.binding.baseSha = 'c'.repeat(40); },
    v => { v.selectedIssue.binding.repositoryId = 99; }, v => { v.selectedIssue.revision = 'd'.repeat(64); },
    v => { v.team.tasks = null; }]) {
    const changed = structuredClone(value); modify(changed);
    assert.equal(repositoryOverviewMatches(changed, value.repository, 12), false);
  }
});

test('a changed issue cannot present its old accepted tasks as the current plan', () => {
  const value = report(); value.team.issuePlans = [{ issue: 12, issueRevision: issue.revision, tasks: ['input'] }];
  value.team.tasks = [{ id: 'input', state: 'merged', acceptanceCriteria: ['Empty input is rejected'] }];
  assert.equal(issuePlanSnapshot(value, issue).tasks.length, 1);
  const changed = issuePlanSnapshot(value, { ...issue, revision: 'c'.repeat(64) });
  assert.equal(changed.currentIssue, false); assert.equal(changed.tasks.length, 0);
  assert.ok(changed.plan, 'retain a visible outdated-plan warning');
  value.team.tasks = [];
  assert.deepEqual(issuePlanSnapshot(value, issue).missingTasks, ['input'], 'archived history is not zero scoped work');
});

test('repository links reject external, credentialed and similarly named targets', () => {
  assert.equal(repositoryLink('https://github.com/example/project/issues/12', 'example/project'), 'https://github.com/example/project/issues/12');
  for (const value of ['javascript:alert(1)', 'https://github.com/example/project-other/issues/12',
    'https://github.com/other/project', 'https://github.com.evil.test/example/project',
    'https://secret@github.com/example/project', 'https://github.com/example/project/../../other']) {
    assert.equal(repositoryLink(value, 'example/project'), null);
  }
});
