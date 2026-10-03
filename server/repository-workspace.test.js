import test from 'node:test';
import assert from 'node:assert/strict';
import { readRepositoryWorkspace } from './product-workspace.js';
import { callAssessmentTool } from '../community/mcp.js';
import { callTeamTool, teamTools } from '../community/team-mcp.js';
import { runTeamCli } from '../community/team-cli.js';

const repository = 'example/project', root = `/repos/${repository}`, base = 'a'.repeat(40);
function reader() {
  const calls = [];
  const issue = { id: 42, number: 7, title: 'Describe an empty result', body: 'Acceptance criteria: an empty result has a working retry action.',
    repository_url: `https://api.github.com${root}`, state: 'open', labels: [], assignees: [], updated_at: '2026-10-03T00:00:00Z' };
  const read = async path => {
    calls.push(path);
    if (path === root) return { id: 1, full_name: repository, default_branch: 'main' };
    if (path === `${root}/commits/main`) return { sha: base };
    if (path.includes('/contents/.changeplane.json?')) {
      const data = JSON.stringify({ evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] }, protectedPaths: { block: [], requireApproval: [] } });
      return { type: 'file', encoding: 'base64', size: Buffer.byteLength(data), content: Buffer.from(data).toString('base64') };
    }
    if (path === `${root}/issues/7`) return structuredClone(issue);
    if (path.startsWith(`${root}/issues?`)) return [structuredClone(issue)];
    if (path.startsWith(`${root}/pulls?`)) return [];
    if (path.startsWith(`${root}/actions/runs?`)) return { total_count: 0, workflow_runs: [] };
    assert.fail(`Unexpected scoped read: ${path}`);
  };
  return { read, calls };
}

test('hosted and local MCP repository paths share issue identity, coverage and authority', async () => {
  const hosted = reader(), local = reader();
  const view = await readRepositoryWorkspace({ repository, issue: 7, read: hosted.read });
  const tool = await callAssessmentTool('changeplane_repository', { issue: 7 }, { CHANGEPLANE_REPOSITORY: repository }, { read: local.read });
  assert.deepEqual({ ...view, observedAt: null }, { ...tool, observedAt: null });
  assert.equal(view.selectedIssue.number, 7);
  assert.equal(view.team.status, 'not-enabled');
  assert.equal(view.authority.sourceWrites, false);
  assert.equal(view.release.published, false);
  assert.ok(hosted.calls.every(path => path === root || path.startsWith(`${root}/`)));
  assert.ok(hosted.calls.length <= 20);
});

test('repository entrypoints reject scope overrides and malformed issue selectors before any read', async () => {
  const read = async () => assert.fail('Invalid input must not access GitHub');
  for (const issue of [0, -1, '7', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(readRepositoryWorkspace({ repository, issue, read }), { code: 'INPUT_INVALID' });
    await assert.rejects(callAssessmentTool('changeplane_repository', { issue }, { CHANGEPLANE_REPOSITORY: repository }, { read }), { code: 'INPUT_INVALID' });
  }
  for (const args of [{ repository: 'other/repo' }, { token: 'private-value' }, { write: true }]) {
    await assert.rejects(callAssessmentTool('changeplane_repository', args, { CHANGEPLANE_REPOSITORY: repository }, { read }), { code: 'INPUT_INVALID' });
  }
});

test('human plan and delivery decisions remain outside model tools and require the explicit operator entrypoint', async () => {
  assert.ok(teamTools.some(tool => tool.name === 'changeplane_delivery' && tool.annotations.readOnlyHint));
  assert.ok(teamTools.every(tool => !/accept_issue|confirm_delivery|close_issue|sync_project/u.test(tool.name)));
  for (const name of ['changeplane_accept_issue', 'changeplane_confirm_delivery', 'changeplane_close_issue']) {
    await assert.rejects(callTeamTool(name, {}, {}), { code: 'TEAM_COMMAND_INVALID' });
  }
  const old = process.env.CHANGEPLANE_TEAM_OPERATOR;
  delete process.env.CHANGEPLANE_TEAM_OPERATOR;
  try {
    for (const action of ['accept-issue', 'confirm-delivery', 'close-issue', 'sync-project']) {
      await assert.rejects(runTeamCli([action, repository, 'proposal.json', '--human-reviewed']), { code: 'TEAM_OPERATOR_REQUIRED' });
    }
  } finally {
    if (old === undefined) delete process.env.CHANGEPLANE_TEAM_OPERATOR;
    else process.env.CHANGEPLANE_TEAM_OPERATOR = old;
  }
});
