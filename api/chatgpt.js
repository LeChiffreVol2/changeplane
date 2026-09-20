import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { chatgptAuth, productReadAccess, productRepositories } from './github.js';
import { createChatgptTools } from '../server/chatgpt-tools.js';
import { HttpError } from '../server/http-errors.js';

async function readBody(req) {
  if (req.body != null) {
    const body = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8')
      : String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded') ? new URLSearchParams(req.body).toString() : JSON.stringify(req.body);
    if (Buffer.byteLength(body) > 32000) throw new HttpError(413, 'Request is too large.');
    return body;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > 32000) throw new HttpError(413, 'Request is too large.'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createChatgptHandler({ auth = chatgptAuth, repositories = productRepositories, access = productReadAccess } = {}) {
  return async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId); res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
    const send = (status, payload) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); };
    let action;
    try {
      const provider = auth(), url = new URL(req.url, 'https://changeplane.invalid');
      action = req.query?.action ?? url.searchParams.get('action');
      if (Array.isArray(action) || url.searchParams.getAll('action').length > 1) throw new HttpError(400, 'Invalid action.');
      const method = String(req.method ?? 'GET').toUpperCase();
      if (method === 'GET' && ['resource', 'metadata'].includes(action)) return send(200, provider.metadata(action));
      if (method === 'GET' && action === 'authorize') return provider.authorize(req, res);
      if (method === 'POST' && ['consent', 'token'].includes(action)) {
        if (String(req.headers['content-type'] ?? '').split(';')[0] !== 'application/x-www-form-urlencoded') throw new HttpError(415, 'Use form-encoded OAuth requests.');
        const body = await readBody(req);
        return action === 'consent' ? provider.consent(req, res, body) : send(200, await provider.token(body));
      }
      if (action) throw new HttpError(404, 'Unknown ChatGPT action.');
      if (method !== 'POST') { res.setHeader('allow', 'POST'); throw new HttpError(405, 'Use the MCP POST endpoint.'); }
      const metadata = provider.metadata('resource');
      if (req.headers.origin && !['https://chatgpt.com', new URL(metadata.resource).origin].includes(req.headers.origin)) throw new HttpError(403, 'Origin is not allowed.');
      if (String(req.headers['content-type'] ?? '').split(';')[0] !== 'application/json') throw new HttpError(415, 'Use application/json.');
      let session;
      try { session = await provider.authenticate(req); }
      catch (error) {
        if (error.status === 401) res.setHeader('www-authenticate', `Bearer resource_metadata="${metadata.resource}?action=resource", scope="changeplane:read"`);
        throw error;
      }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (error) { if (error.status) throw error; throw new HttpError(400, 'Invalid JSON.'); }
      const server = createChatgptTools({ session, repositories, access });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try { await server.connect(transport); await transport.handleRequest(req, res, body); }
      finally { await transport.close(); await server.close(); }
    } catch (error) {
      if (!res.headersSent && action === 'token') return send(error instanceof HttpError && error.status < 500 ? 400 : 503, {
        error: error.oauthError ?? (error instanceof HttpError && error.status < 500 ? 'invalid_grant' : 'temporarily_unavailable'),
        error_description: error instanceof HttpError ? error.message : 'The connection is unavailable. Retry later.', requestId });
      if (!res.headersSent) send(error instanceof HttpError ? error.status : 503, {
        error: error instanceof HttpError ? error.message : 'The connection is unavailable. Retry later.', requestId });
    }
  };
}
export default createChatgptHandler();
