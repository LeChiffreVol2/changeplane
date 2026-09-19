#!/usr/bin/env node
// Optional compatibility check against an operator-built OCR binary. Synthetic
// Git data and a loopback Responses stub only; no real key or GitHub access.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectPipeline, OCR_SOURCE } from '../community/pipeline.js';

const binary = process.argv[2] && resolve(process.argv[2]);
assert.ok(binary, 'Usage: node scripts/qualify-opencode-review.mjs /absolute/path/to/pinned/ocr');
const scratch = mkdtempSync(join(tmpdir(), 'changeplane-ocr-qualification-'));
const repo = join(scratch, 'repo'), profile = join(scratch, 'profile');
mkdirSync(repo); mkdirSync(profile);
// A separate child profile prevents OCR from reading operator configuration or
// persisting its sessions in the operator account. No inherited credentials.
const env = { PATH: process.env.PATH, HOME: profile, USERPROFILE: profile,
  ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(scratch, 'no-global-config'),
  OCR_ENABLE_TELEMETRY: '0', OCR_CONTENT_LOGGING: '0', OCR_RAW_LOGGING: '0',
  OCR_LLM_TOKEN: 'synthetic-local-token', OCR_LLM_MODEL: 'gpt-5.6-luna', OCR_LLM_PROTOCOL: 'openai-responses', OCR_LLM_TIMEOUT: '10' };
const git = (...args) => execFileSync('git', ['-c', 'user.name=ChangePlane Test', '-c', 'user.email=test@example.test', ...args], { cwd: repo, env, encoding: 'utf8' }).trim();
let mode = 'clean', calls = 0;
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks)); calls++;
  assert.equal(req.url, '/v1/responses'); assert.equal(body.store, false);
  assert.equal(req.headers.authorization, 'Bearer synthetic-local-token');
  res.setHeader('Content-Type', 'application/json');
  if (mode === 'failed') { res.statusCode = 400; res.end(JSON.stringify({ error: { message: 'synthetic-provider-failure', type: 'invalid_request_error' } })); return; }
  const done = { type: 'function_call', id: `fc_${calls}`, call_id: `call_${calls}`, name: 'task_done', arguments: '{"state":"DONE"}' };
  const alreadyCommented = body.input?.some(item => item.type === 'function_call' && item.name === 'code_comment');
  const output = body.tools?.length ? [mode === 'finding' && !alreadyCommented ? {
    type: 'function_call', id: `fc_${calls}`, call_id: `call_${calls}`, name: 'code_comment',
    arguments: JSON.stringify({ comments: [{ path: 'sort.js', content: 'Handle empty input before sorting.',
      existing_code: 'export const sort = values => values.sort();', category: 'bug', severity: 'medium' }] }),
  } : done] : [{ type: 'message', id: `msg_${calls}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Read the diff and finish the review.', annotations: [] }] }];
  res.end(JSON.stringify({ id: `resp_${calls}`, object: 'response', created_at: 1, status: 'completed', model: body.model,
    output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }));
});

try {
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'sort.js'), 'export const sort = values => values;\n');
  git('add', 'sort.js'); git('commit', '-q', '-m', 'Synthetic base'); const base = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'sort.js'), 'export const sort = values => values.sort();\n');
  git('add', 'sort.js'); git('commit', '-q', '-m', 'Synthetic change'); const head = git('rev-parse', 'HEAD');
  git('checkout', '--detach', '-q', base);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  env.OCR_LLM_URL = `http://127.0.0.1:${server.address().port}/v1`;
  const root = '/repos/example/project', identity = { id: 1, full_name: 'example/project', default_branch: 'main' };
  const policy = { protectedPaths: { requireApproval: [], block: [] },
    evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] } };
  const data = {
    [root]: identity,
    [`${root}/pulls/7`]: { id: 71, number: 7, state: 'open', changed_files: 1,
      head: { sha: head, ref: 'feature', repo: identity }, base: { sha: base, ref: 'main', repo: identity } },
    [`${root}/commits/main`]: { sha: base },
    [`${root}/contents/.changeplane.json?ref=${base}`]: { type: 'file', encoding: 'base64', size: JSON.stringify(policy).length, content: Buffer.from(JSON.stringify(policy)).toString('base64') },
    [`${root}/pulls/7/files?per_page=100&page=1`]: [{ filename: 'sort.js', status: 'modified', patch: git('diff', base, head, '--', 'sort.js') }],
    [`${root}/compare/${base}...${head}?per_page=1`]: { merge_base_commit: { sha: base }, base_commit: { sha: base } },
    [`${root}/actions/runs?head_sha=${head}&per_page=100`]: { total_count: 1, workflow_runs: [{ id: 12, workflow_id: 18, run_number: 2, run_attempt: 2, head_sha: head,
      path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', repository: identity, head_repository: identity }] },
    [`${root}/actions/runs/12/attempts/2/jobs?per_page=100`]: { total_count: 1, jobs: [{ id: 99, run_id: 12, head_sha: head, name: 'Behavior', status: 'completed', conclusion: 'success' }] },
  };
  const options = { repository: 'example/project', number: 7, read: async path => { assert.ok(Object.hasOwn(data, path)); return structuredClone(data[path]); } };
  const request = (await inspectPipeline(options)).reviewRequest;
  const outcomes = [];
  for (const scenario of ['clean', 'finding', 'failed', 'budget']) {
    mode = scenario; calls = 0;
    const output = join(scratch, `${scenario}.json`);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(binary, ['review', '--repo', repo, '--from', base, '--to', head,
        '--format', 'json', '--output', output, '--no-filter', '--audience', 'agent', '--timeout', '1', '--max-tokens-budget', scenario === 'budget' ? '1' : '100000'],
      { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let diagnostics = ''; child.stdout.on('data', chunk => { diagnostics += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, diagnostics }); });
    });
    const review = JSON.parse(readFileSync(output, 'utf8'));
    const report = await inspectPipeline({ ...options, review, requestId: request.id });
    assert.ok(scenario === 'budget' ? calls === 0 : calls > 0, JSON.stringify({ scenario, review, diagnostics: result.diagnostics }));
    assert.equal(report.review.status, scenario === 'clean' ? 'complete' : scenario === 'finding' ? 'findings' : 'incomplete', JSON.stringify({ scenario, review, report: report.review, diagnostics: result.diagnostics }));
    assert.equal(report.authority.guardPublished, false);
    if (scenario === 'finding') assert.equal(report.review.findings[0].content, 'Handle empty input before sorting.');
    outcomes.push({ scenario, exitCode: result.code, providerCalls: calls, upstreamState: review.status, pipelineState: report.pipeline.status });
  }
  console.log(JSON.stringify({ compatibleSource: OCR_SOURCE, binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    qualification: 'Real OCR binary; synthetic GitHub observations and loopback Responses stub. No live model quality claim.', outcomes }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}
