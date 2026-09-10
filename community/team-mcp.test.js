import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { teamRpc } from './team-mcp.js';
import { TeamError } from './team.js';

test('MCP negotiates, exposes bounded tools and sanitizes operator failures', async () => {
  const rpc = teamRpc(async () => { throw new TeamError('TEAM_SCOPE_BUSY'); });
  assert.equal((await rpc({ jsonrpc: '2.0', id: 0, method: 'tools/list' })).error.code, -32000);
  const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(initialized.result.protocolVersion, '2025-11-25');
  assert.equal(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.result.tools.length, 7);
  const failed = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'changeplane_start', arguments: {} } });
  assert.equal(failed.result.isError, true);
  assert.equal(failed.result.structuredContent.code, 'TEAM_SCOPE_BUSY');
});
test('stdio entry point emits JSON-RPC only, rejects oversized frames and does not require credentials to list tools', () => {
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ];
  const child = spawnSync(process.execPath, ['community/team-mcp.js'], { input: messages.map(JSON.stringify).join('\n') + '\n', encoding: 'utf8' });
  assert.equal(child.status, 0); assert.equal(child.stderr, '');
  const responses = child.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(responses.map(response => response.id), [1, 2]);
  assert.equal(responses[1].result.tools.some(tool => /merge|deploy|shell/u.test(tool.name)), false);
  const oversized = spawnSync(process.execPath, ['community/team-mcp.js'], { input: 'x'.repeat(300_000), encoding: 'utf8' });
  assert.equal(oversized.status, 2); assert.equal(oversized.stdout, '');
});
