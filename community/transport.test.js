import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedReader, unavailable, CollectionError } from './transport.js';

function reader(fetchImpl, extra = {}) {
  return boundedReader({ provider: 'github', origin: 'https://api.github.com', prefix: '/repos/', fetchImpl,
    headers: { Authorization: 'Bearer synthetic-secret' }, sleep: async () => {}, ...extra });
}
test('safe reads recover from a transient response without exceeding three attempts', async () => {
  let calls = 0;
  const read = reader(async (_url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return ++calls < 3 ? new Response('private upstream text', { status: 503 }) : Response.json({ id: 1 });
  });
  assert.deepEqual(await read('/repos/example/repo'), { id: 1 }); assert.equal(calls, 3);
});
test('rate limit guidance beyond the local budget is returned without sleeping or retrying', async () => {
  let calls = 0, sleeps = 0;
  const read = reader(async () => { calls++; return new Response('secret', { status: 429, headers: { 'Retry-After': '90' } }); },
    { sleep: async () => { sleeps++; } });
  await assert.rejects(read('/repos/example/repo'), error => unavailable(error).nextAction === 'WAIT_FOR_RATE_LIMIT');
  assert.equal(calls, 1); assert.equal(sleeps, 0);
});
test('permission failure never retries or leaks the provider body', async () => {
  let calls = 0;
  await assert.rejects(reader(async () => { calls++; return new Response('synthetic-secret', { status: 403 }); })('/repos/example/repo'), error => {
    const report = unavailable(error); assert.equal(report.code, 'PERMISSION_DENIED');
    assert.equal(JSON.stringify(report).includes('synthetic-secret'), false); return true;
  });
  assert.equal(calls, 1);
});
test('GitHub reset guidance and an unspecified secondary-limit wait cannot trigger premature retries', async () => {
  for (const response of [
    () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '3600' } }),
    () => new Response('', { status: 429 }),
  ]) {
    let calls = 0, sleeps = 0;
    const read = reader(async () => { calls++; return response(); }, { now: () => 0, sleep: async () => { sleeps++; } });
    await assert.rejects(read('/repos/example/repo'), /RATE_LIMITED/u);
    assert.equal(calls, 1); assert.equal(sleeps, 0);
  }
});
test('credential destination cannot be redirected by a URL or traversal', async () => {
  let calls = 0;
  const read = reader(async () => { calls++; throw new Error('must not fetch'); });
  for (const path of ['https://attacker.invalid/repos/x', '//attacker.invalid/repos/x', '/repos/../user', '/repos/%2e%2e/user', '/repos/x\\y']) {
    await assert.rejects(read(path));
  }
  assert.equal(calls, 0);
});
test('response bytes and the complete reader lifetime have independent limits', async () => {
  await assert.rejects(reader(async () => new Response('x'.repeat(4_000_001)))('/repos/example/repo'), /COLLECTION_LIMIT/u);
  let now = 0; const read = reader(async () => Response.json({}), { now: () => now }); now = 60_001;
  await assert.rejects(read('/repos/example/repo'), /COLLECTION_LIMIT/u);
});
test('arbitrary exception strings cannot enter machine outcomes', () => {
  const report = unavailable(new Error('SYNTHETIC_SECRET: abc private context'));
  assert.equal(report.code, 'INPUT_INVALID');
  assert.equal(JSON.stringify(report).includes('private context'), false);
  assert.equal(unavailable(new CollectionError('NOT_FOUND')).authority.guardPublished, false);
});
