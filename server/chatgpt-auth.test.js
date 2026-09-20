import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { seal, unseal } from '../api/github.js';
import { createChatgptAuth, CHATGPT_CLIENT, CHATGPT_REDIRECT, CHATGPT_SCOPE } from './chatgpt-auth.js';
import { HttpError, GitHubError } from './http-errors.js';
const origin = 'https://product.example', secret = 'a-test-secret-with-at-least-thirty-two-characters';
const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
const recorder = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = value; } });
function fixture() {
  const calls = [], consumed = new Set();
  const auth = createChatgptAuth({ seal, unseal, configuration: () => ({ origin, secret, clientId: 'github-app', appSlug: 'changeplane' }),
    exchange: async value => { calls.push(value); const key = value.code ?? value.refresh_token;
      if (consumed.has(key)) return { error: 'bad_verification_code' }; consumed.add(key);
      return { access_token: 'ghu_private-provider-token', expires_in: 28800, refresh_token: 'ghr_' + consumed.size, refresh_token_expires_in: 100000 }; },
    identity: async token => ({ login: 'operator', token, authMode: 'github_app', installationIds: ['7'] }) });
  const query = new URLSearchParams({ action: 'authorize', client_id: CHATGPT_CLIENT, redirect_uri: CHATGPT_REDIRECT,
    response_type: 'code', scope: CHATGPT_SCOPE, resource: origin + '/api/chatgpt', state: 'client-state',
    code_challenge: challenge, code_challenge_method: 'S256' });
  return { auth, calls, query };
}
async function authorize(f) {
  const consent = recorder(); f.auth.authorize({ url: '/api/chatgpt?' + f.query }, consent);
  assert.match(consent.body, /Allow read access/);
  assert.match(consent.body, /cannot edit code/);
  const cookie = consent.headers['set-cookie'].split(';')[0], ticket = cookie.split('=')[1];
  const redirect = recorder(); f.auth.consent({ headers: { cookie, origin } }, redirect, new URLSearchParams({ ticket }).toString());
  const github = new URL(redirect.headers.location); assert.equal(github.origin, 'https://github.com');
  assert.equal(github.searchParams.get('code_challenge'), challenge);
  const callback = recorder();
  assert.equal(await f.auth.callback({ url: '/api/github?' + new URLSearchParams({ action: 'callback', state: github.searchParams.get('state'), code: 'upstream-code-123' }), headers: { cookie } }, callback), true);
  const result = new URL(callback.headers.location); assert.equal(result.searchParams.get('iss'), origin);
  assert.equal(result.searchParams.get('state'), 'client-state');
  const body = new URLSearchParams({ grant_type: 'authorization_code', code: result.searchParams.get('code'),
    client_id: CHATGPT_CLIENT, resource: origin + '/api/chatgpt', redirect_uri: CHATGPT_REDIRECT, code_verifier: verifier });
  return body;
}
test('OAuth consent, upstream one-time PKCE code, sealed scoped access and refresh', async () => {
  const f = fixture(), body = await authorize(f), result = await f.auth.token(body.toString());
  assert.equal(result.scope, CHATGPT_SCOPE); assert.equal(result.expires_in, 3600);
  assert.equal(JSON.stringify(result).includes('ghu_'), false); assert.equal(JSON.stringify(result).includes('ghr_'), false);
  const user = await f.auth.authenticate({ headers: { authorization: 'Bearer ' + result.access_token } });
  assert.equal(user.login, 'operator'); assert.equal(f.calls[0].code_verifier, verifier);
  await assert.rejects(() => f.auth.token(body.toString()), /already used/);
  const refresh = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: result.refresh_token, client_id: CHATGPT_CLIENT, resource: origin + '/api/chatgpt' });
  const renewed = await f.auth.token(refresh.toString()); assert.ok(renewed.access_token);
  await assert.rejects(() => f.auth.token(refresh.toString()), /already used/);
});
test('OAuth rejects expanded scope, redirect, resource, duplicate parameters and missing PKCE', () => {
  for (const [key, value] of [['scope', 'repo'], ['redirect_uri', 'https://attacker.example'], ['resource', 'https://other.example'], ['code_challenge_method', 'plain'], ['client_id', 'other']]) {
    const f = fixture(); f.query.set(key, value); assert.throws(() => f.auth.authorize({ url: '/?' + f.query }, recorder())); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.query.append('state', 'extra'); assert.throws(() => f.auth.authorize({ url: '/?' + f.query }, recorder()));
});
test('invalid verifier, token purpose and audience fail before any provider exchange', async () => {
  const f = fixture(), body = await authorize(f); body.set('code_verifier', 'x'.repeat(43));
  await assert.rejects(() => f.auth.token(body.toString())); assert.equal(f.calls.length, 0);
  for (const value of ['tampered', seal({ token: 'ghu_test' }, secret), seal({ token: 'ghu_test', resource: 'https://other.example' }, secret, { purpose: 'chatgpt-access' })]) {
    await assert.rejects(() => f.auth.authenticate({ headers: { authorization: 'Bearer ' + value } }), error => error.status === 401);
  }
});
test('ordinary GitHub callback is untouched and consent requires same-origin cookie binding', async () => {
  const f = fixture(); assert.equal(await f.auth.callback({ url: '/api/github?action=callback', headers: {} }, recorder()), false);
  assert.throws(() => f.auth.consent({ headers: { origin: 'https://attacker.example' } }, recorder(), 'ticket=x'), error => error.status === 403);
});

test('revoked GitHub credentials request reconnection without returning the provider error', async () => {
  const auth = createChatgptAuth({ seal, unseal, configuration: () => ({ origin, secret, clientId: 'github-app', appSlug: 'changeplane' }),
    identity: async () => { throw new GitHubError(401, 'private provider error'); } });
  const access = seal({ client: CHATGPT_CLIENT, redirect: CHATGPT_REDIRECT, resource: origin + '/api/chatgpt', scope: CHATGPT_SCOPE,
    githubClient: 'github-app', token: 'ghu_revoked' }, secret, { purpose: 'chatgpt-access' });
  await assert.rejects(() => auth.authenticate({ headers: { authorization: 'Bearer ' + access } }),
    error => error instanceof HttpError && error.status === 401 && !error.message.includes('provider'));
});
