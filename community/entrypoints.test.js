import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assessmentRpc, callAssessmentTool } from './mcp.js';
import { CollectionError } from './transport.js';
import { readFileSync } from 'node:fs';
import { assessObservation } from './observation.js';
import { formatReport } from './output.js';

const run = args => spawnSync(process.execPath, ['bin/changeplane.js', ...args], { encoding: 'utf8' });
const init = async rpc => {
  await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
};
test('stable command preserves complete assessment JSON and exit codes; alternate views retain authority and revision', () => {
  for (const [name, exit] of [['satisfied', 0], ['failed', 1], ['stale', 1]]) {
    const legacy = spawnSync(process.execPath, ['community/cli.js', 'evaluate', `examples/community/${name}.json`], { encoding: 'utf8' });
    const result = run(['evaluate', `examples/community/${name}.json`]);
    assert.equal(result.status, exit, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), JSON.parse(legacy.stdout));
    const compact = run(['evaluate', `examples/community/${name}.json`, '--format', 'compact']);
    const summary = JSON.parse(compact.stdout);
    assert.equal(compact.status, exit);
    assert.equal(summary.headSha, JSON.parse(result.stdout).headSha);
    assert.equal(summary.currentHeadSha, JSON.parse(result.stdout).currentHeadSha);
    assert.equal(summary.authority.mergeAuthorized, false);
    assert.deepEqual(summary.findings, JSON.parse(result.stdout).findings);
    const text = run(['evaluate', `examples/community/${name}.json`, '--format', 'text']);
    assert.equal(text.status, exit); assert.ok(text.stdout.includes(JSON.parse(result.stdout).headSha));
  }
});

test('portable CLI summaries retain the revision and supplied-observation authority', () => {
  const fixture = 'community/fixtures/observation.json';
  const full = run(['evaluate', fixture]);
  const report = JSON.parse(full.stdout);
  const compact = run(['evaluate', fixture, '--format', 'compact']);
  const summary = JSON.parse(compact.stdout);
  assert.equal(full.status, 0); assert.equal(compact.status, full.status);
  assert.equal(summary.headSha, report.binding.revisions.head);
  assert.equal(summary.currentHeadSha, report.binding.revisions.currentHead);
  assert.deepEqual(summary.binding, report.binding);
  assert.deepEqual(summary.authority, report.authority);
  assert.equal(summary.claim, report.claim);
  assert.equal(summary.authority.authenticated, false);
  const text = run(['evaluate', fixture, '--format', 'text']);
  assert.equal(text.status, full.status);
  assert.ok(text.stdout.includes(`Assessed revision: ${report.binding.revisions.head}`));
  assert.ok(text.stdout.includes(`Current revision: ${report.binding.revisions.currentHead}`));
  assert.ok(text.stdout.includes(report.claim));
});

test('portable views distinguish policy, target, diff and fork identity without inventing a legacy base or authority', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/observation.json', import.meta.url)));
  input.identity.sourceRepositoryId = '2';
  input.revisions.policy = 'e'.repeat(40); input.revisions.currentPolicy = 'e'.repeat(40);
  input.evidence[0].subject.kind = 'unknown';
  const report = { ...assessObservation(input),
    capabilities: { readOnly: true, qualification: 'candidate', testedSubjectVerified: false, repair: false } };
  const before = structuredClone(report);
  const summary = JSON.parse(formatReport(report, 'compact'));
  assert.equal(summary.decision, 'REVIEW_REQUIRED');
  assert.equal(summary.baseSha, null, 'policy, target and merge-base must not be relabelled as one legacy base');
  assert.deepEqual(summary.binding, report.binding);
  assert.deepEqual(summary.capabilities, report.capabilities);
  assert.deepEqual(summary.authority, report.authority);
  assert.deepEqual(summary.findings, report.findings);
  assert.equal(summary.nextActionCode, report.nextAction);
  const text = formatReport(report, 'text');
  for (const [label, revision] of [['Policy revision', input.revisions.policy], ['Current policy revision', input.revisions.currentPolicy],
    ['Target revision', input.revisions.target], ['Current target revision', input.revisions.currentTarget],
    ['Merge base', input.revisions.mergeBase], ['Diff start', input.revisions.diffStart]]) assert.ok(text.includes(`${label}: ${revision}`));
  assert.match(text, /repository 1 change 7/); assert.match(text, /Source repository: 2/);
  assert.match(text, /SUBJECT_UNVERIFIED/); assert.ok(text.includes(report.claim));
  assert.ok(text.includes(JSON.stringify(report.capabilities)));
  assert.deepEqual(JSON.parse(formatReport(report)), report);
  assert.deepEqual(report, before);

  input.revisions.currentHead = 'f'.repeat(40);
  input.revisions.currentPolicy = '1'.repeat(40);
  input.revisions.currentTarget = '2'.repeat(40);
  const stale = assessObservation(input);
  const staleSummary = JSON.parse(formatReport(stale, 'compact'));
  assert.equal(staleSummary.decision, 'BLOCKED');
  assert.equal(staleSummary.headSha, input.revisions.head);
  assert.equal(staleSummary.currentHeadSha, input.revisions.currentHead);
  assert.deepEqual(staleSummary.binding.revisions, input.revisions);
  const staleText = formatReport(stale, 'text');
  assert.ok(staleText.includes(`Current policy revision: ${input.revisions.currentPolicy}`));
  assert.ok(staleText.includes(`Current target revision: ${input.revisions.currentTarget}`));
});

test('CLI rejects unsafe URLs, conflicting setup options and unsupported output formats before network access', () => {
  for (const args of [
    ['inspect', 'https://github.com.evil.test/owner/repo/pull/1'],
    ['inspect', 'https://token@github.com/owner/repo/pull/1'],
    ['inspect', 'https://github.com/owner/repo/pull/1?token=private'],
    ['init', 'owner/repo', '--dry-run', '--output', 'existing'],
    ['init', 'owner/repo', '--max-active', '2'],
    ['evaluate', 'missing', '--format', 'bad'],
    ['mcp', '--format', 'json'],
    ['doctor', 'owner/repo', '--format', 'compact'],
    ['doctor', 'https://private@evil.test/owner/repo'],
    ['inspect', 'owner/repo', '7', '--wait', '0'],
    ['inspect', 'owner/repo', '7', '--wait', '61'],
    ['inspect', 'owner/repo', '7', '--wait', '1.5'],
    ['inspect', 'owner/repo', '7', '--wait'],
    ['inspect', 'owner/repo', '7', '--wait', '1', '--wait', '2'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, result.stdout);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).decision, 'UNAVAILABLE');
    assert.ok(!result.stderr.includes('private'));
  }
});

test('read-only MCP fixes repository in operator configuration and rejects caller credential or repository overrides', async () => {
  const calls = [];
  const configuration = { CHANGEPLANE_REPOSITORY: 'example/project', GH_TOKEN: 'operator-read-token', CHANGEPLANE_TEAM_WRITE: 'true' };
  const inspect = async args => { calls.push(args); return { decision: 'REVIEW_REQUIRED', headSha: 'a'.repeat(40) }; };
  await callAssessmentTool('changeplane_inspect', { pullRequest: 7 }, configuration, { inspect });
  assert.deepEqual(calls, [{ repository: 'example/project', number: 7, token: 'operator-read-token' }]);
  for (const args of [{ pullRequest: 7, repository: 'other/repo' }, { pullRequest: 7, token: 'injected' }, { pullRequest: -1 }, {}, []]) {
    await assert.rejects(callAssessmentTool('changeplane_inspect', args, configuration, { inspect }), { code: 'INPUT_INVALID' });
  }
  await assert.rejects(callAssessmentTool('changeplane_start', { pullRequest: 7 }, configuration, { inspect }));
  await assert.rejects(callAssessmentTool('changeplane_inspect', { pullRequest: 7 }, {}, { inspect }));
  assert.equal(calls.length, 1);
});

test('read-only MCP advertises setup and inspection with structured authority and redacted failures', async () => {
  const rpc = assessmentRpc(async () => { throw new CollectionError('PERMISSION_DENIED', { provider: 'github', status: 403 }); });
  assert.equal((await rpc({ jsonrpc: '2.0', id: 0, method: 'tools/list' })).error.code, -32000);
  await init(rpc);
  const tools = (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools;
  assert.deepEqual(tools.map(tool => tool.name), ['changeplane_inspect', 'changeplane_check_setup', 'changeplane_setup']);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint === true));
  assert.deepEqual(tools[0].outputSchema.required, ['decision', 'authority']);
  const result = (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'changeplane_inspect', arguments: { pullRequest: 7 } } })).result;
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, 'PERMISSION_DENIED');
  assert.equal(result.structuredContent.authority.guardPublished, false);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'changeplane_start' } })).error.code, -32602);
});

test('installed-command MCP entry emits protocol frames without banners or credentials', () => {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map(JSON.stringify).join('\n') + '\n';
  const child = spawnSync(process.execPath, ['bin/changeplane.js', 'mcp'], { input, encoding: 'utf8' });
  assert.equal(child.status, 0); assert.equal(child.stderr, '');
  const replies = child.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(replies.map(reply => reply.id), [1, 2]);
  assert.equal(replies[1].result.tools.length, 3);
});

test('MCP validates bounded waiting and alternate output preserves the wait outcome', async () => {
  const configuration = { CHANGEPLANE_REPOSITORY: 'example/project' }, calls = [];
  const wait = async args => { calls.push(args); return { decision: 'REVIEW_REQUIRED', findings: [],
    wait: { secondsRequested: args.waitSeconds, inspections: 1, outcome: 'action_required' } }; };
  const result = await callAssessmentTool('changeplane_inspect', { pullRequest: 7, waitSeconds: 30 }, configuration, { wait });
  assert.equal(calls[0].waitSeconds, 30); assert.equal(calls[0].repository, 'example/project');
  assert.deepEqual(JSON.parse(formatReport(result, 'compact')).wait, result.wait);
  assert.match(formatReport(result, 'text'), /Wait: action_required/);
  for (const waitSeconds of [0, 61, 0.5, '30', null]) {
    await assert.rejects(callAssessmentTool('changeplane_inspect', { pullRequest: 7, waitSeconds }, configuration, { wait }), { code: 'INPUT_INVALID' });
  }
  assert.equal(calls.length, 1);
});
