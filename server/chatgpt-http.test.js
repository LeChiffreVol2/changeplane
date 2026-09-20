import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createChatgptHandler } from '../api/chatgpt.js';
import { HttpError } from './http-errors.js';

test('OAuth token errors use standard codes without exposing provider failures', async () => {
  for (const [failure, status, code] of [
    [new HttpError(401, 'Reconnect ChangePlane.'), 400, 'invalid_grant'],
    [Object.assign(new HttpError(400, 'Unsupported grant.'), { oauthError: 'unsupported_grant_type' }), 400, 'unsupported_grant_type'],
    [new Error('private provider response'), 503, 'temporarily_unavailable'],
  ]) {
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
    const handler = createChatgptHandler({ auth: () => ({ token: async () => { throw failure; } }) });
    await handler({ url: '/api/chatgpt?action=token', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code' }, response);
    assert.equal(response.statusCode, status); assert.equal(response.body.error, code);
    assert.equal(JSON.stringify(response.body).includes('private provider'), false);
    assert.ok(response.body.requestId);
  }
});

test('HTTP MCP exposes only scoped read tools, rejects credential arguments and isolates users', async () => {
  const calls = [];
  const handler = createChatgptHandler({ auth: () => ({
    metadata: () => ({ resource: 'https://product.example/api/chatgpt' }),
    authenticate: async req => {
      const login = req.headers.authorization?.slice(7);
      if (!['alice', 'bob'].includes(login)) throw new HttpError(401, 'Connect ChangePlane.');
      return { login };
    },
  }), repositories: async session => { calls.push(session.login); return [{ repository: session.login + '/project' }]; },
  access: async (repository, session) => { calls.push(repository); if (repository !== session.login + '/project') throw new HttpError(403, 'Denied');
    return { repository, read: async () => [] }; },
  });
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/chatgpt`;
  const call = (body, login = 'alice', extra = {}) => fetch(url, { method: 'POST', headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + login, ...extra,
  }, body: JSON.stringify(body) });
  try {
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    assert.equal(init.status, 200); assert.equal((await init.json()).result.serverInfo.name, 'changeplane');
    const catalog = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    assert.equal(catalog.result.tools.length, 5);
    assert.ok(catalog.result.tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
    assert.ok(catalog.result.tools.every(tool => !/merge|approve|run_review/u.test(tool.name)));
    for (const login of ['alice', 'bob']) {
      const result = await (await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_repositories', arguments: {} } }, login)).json();
      assert.equal(result.result.structuredContent.repositories[0].repository, login + '/project');
      assert.equal(JSON.stringify(result).includes('token'), false);
    }
    const before = calls.length;
    const invalid = await (await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_pull_requests', arguments: { repository: 'alice/project', token: 'private-secret' } } })).json();
    assert.equal(invalid.result.isError, true); assert.equal(calls.length, before);
    const denied = await (await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_pull_requests', arguments: { repository: 'bob/project' } } })).json();
    assert.equal(denied.result.isError, true);
    const unauthenticated = await call({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, 'invalid');
    assert.equal(unauthenticated.status, 401); assert.match(unauthenticated.headers.get('www-authenticate'), /resource_metadata/);
    assert.equal((await call({}, 'alice', { origin: 'https://evil.example' })).status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
