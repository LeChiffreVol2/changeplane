import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assessmentRpc, callAssessmentTool } from './mcp.js';
import { CollectionError } from './transport.js';

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
    assert.equal(summary.authority.mergeAuthorized, false);
    assert.deepEqual(summary.findings, JSON.parse(result.stdout).findings);
    const text = run(['evaluate', `examples/community/${name}.json`, '--format', 'text']);
    assert.equal(text.status, exit); assert.ok(text.stdout.includes(JSON.parse(result.stdout).headSha));
  }
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
  await callAssessmentTool('changeplane_inspect', { pullRequest: 7 }, configuration, inspect);
  assert.deepEqual(calls, [{ repository: 'example/project', number: 7, token: 'operator-read-token' }]);
  for (const args of [{ pullRequest: 7, repository: 'other/repo' }, { pullRequest: 7, token: 'injected' }, { pullRequest: -1 }, {}, []]) {
    await assert.rejects(callAssessmentTool('changeplane_inspect', args, configuration, inspect), { code: 'INPUT_INVALID' });
  }
  await assert.rejects(callAssessmentTool('changeplane_start', { pullRequest: 7 }, configuration, inspect));
  await assert.rejects(callAssessmentTool('changeplane_inspect', { pullRequest: 7 }, {}, inspect));
  assert.equal(calls.length, 1);
});

test('read-only MCP advertises only inspection, structured authority and redacted failures', async () => {
  const rpc = assessmentRpc(async () => { throw new CollectionError('PERMISSION_DENIED', { provider: 'github', status: 403 }); });
  assert.equal((await rpc({ jsonrpc: '2.0', id: 0, method: 'tools/list' })).error.code, -32000);
  await init(rpc);
  const tools = (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools;
  assert.deepEqual(tools.map(tool => tool.name), ['changeplane_inspect']);
  assert.equal(tools[0].annotations.readOnlyHint, true);
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
  assert.equal(replies[1].result.tools.length, 1);
});
