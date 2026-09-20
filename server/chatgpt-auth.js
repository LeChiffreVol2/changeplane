import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './http-errors.js';

export const CHATGPT_SCOPE = 'changeplane:read';
export const CHATGPT_CLIENT = 'changeplane-chatgpt';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const COOKIE = '__Host-changeplane_chatgpt';
const cookie = (value, age = 600) => `${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
const oauthError = (code, message) => Object.assign(new HttpError(400, message), { oauthError: code });
const params = (value) => {
  const result = new URLSearchParams(value);
  if ([...new Set(result.keys())].some(key => result.getAll(key).length !== 1)) throw oauthError('invalid_request', 'Repeated OAuth parameter.');
  return result;
};
const escape = value => String(value).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** Stateless OAuth bridge. GitHub owns single-use codes and rotating refresh tokens.
 * The upstream code is sealed, bound to client/resource/PKCE, and exchanged once
 * by GitHub. No reusable local authorization-code store or bearer pass-through.
 */
export function createChatgptAuth({ configuration, seal, unseal, exchange, identity }) {
  const config = () => {
    const c = configuration();
    if (!c.origin?.startsWith('https://') || !c.clientId || !c.secret || !c.appSlug) throw new HttpError(503, 'The GitHub App connection is not configured.');
    return { ...c, resource: `${c.origin}/api/chatgpt`, callback: `${c.origin}/api/github?action=callback` };
  };
  const pack = (value, purpose, ttlMs) => seal(value, config().secret, { purpose: `chatgpt-${purpose}`, ttlMs });
  const unpack = (value, purpose) => {
    if (typeof value !== 'string' || value.length > 16000) throw new HttpError(401, 'Reconnect ChangePlane in ChatGPT.');
    try { return unseal(value, config().secret, { purpose: `chatgpt-${purpose}` }); }
    catch { throw new HttpError(401, 'Reconnect ChangePlane in ChatGPT.'); }
  };
  const binding = value => {
    const c = config();
    if (value.client !== CHATGPT_CLIENT || value.resource !== c.resource || value.scope !== CHATGPT_SCOPE
      || value.redirect !== CHATGPT_REDIRECT || value.githubClient !== c.clientId) throw new HttpError(400, 'OAuth connection binding changed. Reconnect ChangePlane.');
    return value;
  };
  const redirect = (res, url, cookies = []) => {
    res.statusCode = 302; res.setHeader('location', url); res.setHeader('cache-control', 'no-store');
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end();
  };
  function metadata(kind) {
    const c = config();
    return kind === 'resource' ? { resource: c.resource, authorization_servers: [c.origin], scopes_supported: [CHATGPT_SCOPE],
      resource_name: 'ChangePlane', resource_documentation: `${c.origin}/?chatgpt=about` }
      : { issuer: c.origin, authorization_response_iss_parameter_supported: true,
        authorization_endpoint: `${c.resource}?action=authorize`, token_endpoint: `${c.resource}?action=token`,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: [CHATGPT_SCOPE] };
  }
  function authorize(req, res) {
    const c = config(), p = params(new URL(req.url, c.origin).search);
    if (p.get('client_id') !== CHATGPT_CLIENT || p.get('redirect_uri') !== CHATGPT_REDIRECT
      || p.get('response_type') !== 'code' || p.get('resource') !== c.resource || p.get('scope') !== CHATGPT_SCOPE
      || p.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/u.test(p.get('code_challenge') ?? '')
      || !p.get('state') || p.get('state').length > 512) throw new HttpError(400, 'Use the registered ChatGPT client, read scope, resource and S256 PKCE.');
    const flow = { client: CHATGPT_CLIENT, redirect: CHATGPT_REDIRECT, resource: c.resource, scope: CHATGPT_SCOPE,
      githubClient: c.clientId, clientState: p.get('state'), challenge: p.get('code_challenge'), state: randomBytes(32).toString('base64url') };
    const ticket = pack(flow, 'flow', 600000);
    res.statusCode = 200; res.setHeader('set-cookie', cookie(ticket));
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('content-security-policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Connect ChangePlane</title><main><h1>Read your PR evidence in ChatGPT</h1><p>ChatGPT will receive repository names, PR titles, changed paths, CI evidence, human review decisions and the next action for repositories you can access through the ChangePlane GitHub App. Repository text is untrusted.</p><p>This connection cannot edit code, run a paid model review, approve or merge. Your GitHub credentials stay inside ChangePlane. Choose selected repositories in the GitHub App installation settings.</p><p>Continue with GitHub, then return to ChatGPT. Disconnect in ChatGPT or revoke ChangePlane in GitHub to stop access.</p><form method="post" action="${c.resource}?action=consent"><input type="hidden" name="ticket" value="${escape(ticket)}"><button type="submit">Allow read access and continue with GitHub</button></form><p><a href="${c.origin}">Cancel and return to ChangePlane</a></p></main></html>`);
  }
  function savedCookie(req) {
    return String(req.headers?.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  }
  function consent(req, res, body) {
    const c = config();
    if (req.headers?.origin !== c.origin) throw new HttpError(403, 'Same-origin consent is required.');
    const ticket = params(body).get('ticket');
    if (!ticket || ticket !== savedCookie(req)) throw new HttpError(403, 'Consent expired. Reconnect from ChatGPT.');
    const flow = binding(unpack(ticket, 'flow'));
    const url = new URL('https://github.com/login/oauth/authorize');
    Object.entries({ client_id: c.clientId, redirect_uri: c.callback, state: flow.state,
      code_challenge: flow.challenge, code_challenge_method: 'S256' }).forEach(([key, value]) => url.searchParams.set(key, value));
    redirect(res, url.href);
  }
  async function callback(req, res) {
    const saved = savedCookie(req);
    if (!saved) return false;
    const c = config(), p = params(new URL(req.url, c.origin).search);
    let flow;
    try { flow = binding(unpack(saved, 'flow')); } catch { return false; }
    if (p.get('state') !== flow.state) return false;
    const url = new URL(flow.redirect);
    url.searchParams.set('state', flow.clientState); url.searchParams.set('iss', c.origin);
    if (p.has('error')) url.searchParams.set('error', 'access_denied');
    else {
      if (!/^[A-Za-z0-9_-]{8,256}$/u.test(p.get('code') ?? '')) throw new HttpError(400, 'Invalid GitHub authorization code.');
      url.searchParams.set('code', pack({ ...flow, code: p.get('code') }, 'code', 600000));
    }
    redirect(res, url.href, [cookie('', 0)]); return true;
  }
  async function token(body) {
    const c = config(), p = params(body), refreshing = p.get('grant_type') === 'refresh_token';
    if (!refreshing && p.get('grant_type') !== 'authorization_code') throw oauthError('unsupported_grant_type', 'Unsupported OAuth grant.');
    const saved = binding(unpack(p.get(refreshing ? 'refresh_token' : 'code'), refreshing ? 'refresh' : 'code'));
    if (p.get('client_id') !== saved.client || p.get('resource') !== saved.resource
      || p.has('scope') && p.get('scope') !== saved.scope) throw new HttpError(400, 'OAuth resource or client mismatch.');
    if (!refreshing && (p.get('redirect_uri') !== saved.redirect || !/^[A-Za-z0-9._~-]{43,128}$/u.test(p.get('code_verifier') ?? '')
      || createHash('sha256').update(p.get('code_verifier')).digest('base64url') !== saved.challenge)) throw new HttpError(400, 'Invalid OAuth code verifier.');
    const result = await exchange(refreshing ? { grant_type: 'refresh_token', refresh_token: saved.refresh }
      : { code: saved.code, redirect_uri: c.callback, code_verifier: p.get('code_verifier') });
    if (typeof result.access_token !== 'string' || !result.access_token.startsWith('ghu_')) throw new HttpError(400, 'GitHub authorization expired or was already used. Reconnect ChangePlane.');
    await identity(result.access_token);
    const common = { client: saved.client, redirect: saved.redirect, resource: saved.resource, scope: saved.scope, githubClient: c.clientId };
    const ttl = Math.min(3600, Number.isSafeInteger(result.expires_in) && result.expires_in > 0 ? result.expires_in : 3600);
    return { access_token: pack({ ...common, token: result.access_token }, 'access', ttl * 1000), token_type: 'Bearer', expires_in: ttl, scope: saved.scope,
      ...(typeof result.refresh_token === 'string' && result.refresh_token.startsWith('ghr_')
        && Number.isSafeInteger(result.refresh_token_expires_in) && result.refresh_token_expires_in > 0
        ? { refresh_token: pack({ ...common, refresh: result.refresh_token }, 'refresh', Math.min(result.refresh_token_expires_in, 2592000) * 1000) } : {}) };
  }
  async function authenticate(req) {
    const raw = req.headers?.authorization;
    if (typeof raw !== 'string' || !raw.startsWith('Bearer ')) throw new HttpError(401, 'Connect ChangePlane in ChatGPT.');
    let value;
    try { value = binding(unpack(raw.slice(7), 'access')); }
    catch { throw new HttpError(401, 'Reconnect ChangePlane in ChatGPT.'); }
    try { return await identity(value.token); }
    catch (error) { if (error.status === 401) throw new HttpError(401, 'Reconnect ChangePlane in ChatGPT.'); throw error; }
  }
  return { metadata, authorize, consent, callback, token, authenticate };
}
