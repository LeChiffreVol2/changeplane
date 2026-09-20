// Runs only inside the operator-built review image. No GitHub/controller access.
import { createServer, request as requestHttp } from 'node:http';
import { chmodSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';

const [mode, model, base, head] = process.argv.slice(2);
const models = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];
if (!models.includes(model)) process.exit(2);
if (mode === 'proxy') {
  // Bound key lifetime even if the calling CLI is forcibly killed.
  setTimeout(() => process.exit(2), 330_000).unref();
  const lines = createInterface({ input: process.stdin });
  const key = await new Promise(resolve => lines.once('line', resolve)); lines.close();
  let calls = 0, active = false, tokens = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const reject = () => { res.statusCode = 429; res.end('{"error":{"message":"Review request unavailable or budget exhausted"}}'); };
    if (req.method !== 'POST' || req.url !== '/v1/responses' || active || calls >= 24 || tokens >= 100_000) { reject(); return; }
    active = true; calls++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 512_000) throw new Error('input limit'); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks));
      const body = { model, input: input.input, instructions: input.instructions, tools: input.tools,
        tool_choice: input.tool_choice, include: ['reasoning.encrypted_content'],
        reasoning: { effort: 'high' }, store: false, stream: false, max_output_tokens: 4096 };
      if (body.tools?.some(tool => tool.type !== 'function')) throw new Error('unsupported tool');
      const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(90_000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('provider unavailable'); }
      const replies = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 2_000_000) throw new Error('output limit'); replies.push(chunk); }
      const result = JSON.parse(Buffer.concat(replies));
      if (!Number.isSafeInteger(result.usage?.total_tokens) || result.usage.total_tokens < 1) throw new Error('usage unavailable');
      tokens += result.usage.total_tokens;
      if (tokens >= 100_000) throw new Error('review budget exhausted');
      res.end(JSON.stringify(result));
    } catch { reject(); } finally { active = false; }
  });
  server.requestTimeout = 100_000;
  server.listen('/bridge/model.sock', () => { chmodSync('/bridge/model.sock', 0o666); process.stdout.write('ready\n'); });
} else if (mode === 'review' && [base, head].every(value => /^[a-f0-9]{40}$/u.test(value))) {
  const relay = createServer((req, res) => {
    const upstream = requestHttp({ socketPath: '/bridge/model.sock', path: req.url, method: req.method,
      headers: { 'Content-Type': 'application/json' }, timeout: 100_000 }, response => {
      res.writeHead(response.statusCode, { 'Content-Type': 'application/json' }); response.pipe(res);
    });
    upstream.on('error', () => { res.statusCode = 502; res.end('{}'); });
    upstream.on('timeout', () => upstream.destroy()); req.pipe(upstream);
  });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  mkdirSync('/tmp/profile', { mode: 0o700 });
  const env = { PATH: process.env.PATH, HOME: '/tmp/profile', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/tmp/no-config',
    OCR_LLM_URL: `http://127.0.0.1:${relay.address().port}/v1`, OCR_LLM_PROTOCOL: 'openai-responses',
    OCR_LLM_MODEL: model, OCR_LLM_TOKEN: 'isolated-proxy', OCR_LLM_TIMEOUT: '90',
    OCR_ENABLE_TELEMETRY: '0', OCR_CONTENT_LOGGING: '0', OCR_RAW_LOGGING: '0' };
  const child = spawn('ocr', ['review', '--repo', '/repo', '--from', base, '--to', head,
    '--effort', 'high', '--concurrency', '1', '--no-filter', '--timeout', '5', '--max-tokens-budget', '100000', '--format', 'json', '--output', '/output/review.json'],
  { cwd: '/repo', env, stdio: 'ignore' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 310_000);
  const stop = code => { clearTimeout(timer); relay.closeAllConnections(); relay.close(); process.exitCode = code; };
  child.once('error', () => stop(2)); child.once('exit', code => stop(code ?? 2));
} else process.exit(2);
