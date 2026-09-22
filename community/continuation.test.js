import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onboard } from './onboard.js';
import { watchPullRequest, codexNotifier } from './watch.js';
import { callAssessmentTool, assessmentRpc } from './mcp.js';
import { CollectionError } from './transport.js';
import { formatReport } from './output.js';
import { spawnSync } from 'node:child_process';

const head = 'a'.repeat(40), base = 'b'.repeat(40), release = 'c'.repeat(40);
const root = '/repos/example/project', workflow = '.github/workflows/ci.yml';
const thread = '12345678-1234-1234-1234-123456789abc';
const file = content => ({ type: 'file', encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') });
const policy = { protectedPaths: { requireApproval: ['infra/**'], block: ['secrets/**'] },
  evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: workflow }] } };
function fixture() {
  const repo = { id: 1, full_name: 'example/project', default_branch: 'main' };
  const pr = { id: 71, number: 7, state: 'open', changed_files: 1,
    head: { sha: head, ref: 'feature', repo }, base: { sha: base, ref: 'main', repo } };
  const run = { id: 12, workflow_id: 18, run_number: 2, run_attempt: 1, head_sha: head,
    path: workflow, status: 'completed', conclusion: 'failure', repository: repo, head_repository: repo };
  const job = { id: 99, run_id: 12, head_sha: head, name: 'Behavior', status: 'completed', conclusion: 'failure' };
  const data = { [root]: repo, [`${root}/pulls/7`]: pr, [`${root}/commits/main`]: { sha: base },
    [`${root}/pulls?state=open&per_page=1`]: [pr], [`${root}/actions/runs?per_page=1`]: { workflow_runs: [run] },
    [`${root}/commits/${base}/check-runs?per_page=1`]: { check_runs: [] },
    [`${root}/actions/workflows?per_page=100`]: { total_count: 1, workflows: [{ id: 18, path: workflow, name: 'Behavior CI', state: 'active' }] },
    [`${root}/contents/${workflow}?ref=${base}`]: file('name: Behavior CI\n'),
    [`${root}/pulls/7/files?per_page=100&page=1`]: [{ filename: 'src/sort.js', status: 'modified' }],
    [`${root}/actions/runs?head_sha=${head}&per_page=100`]: { total_count: 1, workflow_runs: [run] },
    [`${root}/actions/runs/12/attempts/1/jobs?per_page=100`]: { total_count: 1, jobs: [job] },
  };
  const templates = Object.fromEntries(['changeplane-community.yml', 'changeplane-team.yml', 'changeplane-team-review-signal.yml']
    .map(name => [`examples/${name}`, readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8')]));
  const read = async path => {
    if (!Object.hasOwn(data, path)) {
      if (path.includes('/contents/')) throw new CollectionError('NOT_FOUND');
      assert.fail(`Unexpected read ${path}`);
    }
    return structuredClone(data[path]);
  };
  const install = () => { data[`${root}/contents/.changeplane.json?ref=${base}`] = file(JSON.stringify(policy)); };
  return { data, run, job, pr, read, install, options: { repository: repo.full_name, number: 7, read, runtime: () => ({ revision: release, templates }) } };
}

test('one onboarding entry point discovers CI, prepares reviewed setup, then assesses after policy merge', async () => {
  const f = fixture();
  const first = await onboard(f.options);
  assert.equal(first.decision, 'SELECTION_REQUIRED'); assert.equal(first.onboarding.assessed, false);
  assert.deepEqual(first.candidates.map(item => item.name), ['Behavior']); assert.deepEqual(first.files, []);
  const plan = await onboard({ ...f.options, check: 'Behavior', workflow });
  assert.equal(plan.onboarding.stage, 'configuration_review'); assert.equal(plan.files.length, 2);
  assert.equal(plan.authority.repositoryModified, false);
  f.install();
  const failure = await onboard(f.options);
  assert.equal(failure.onboarding.assessed, true); assert.equal(failure.decision, 'REVIEW_REQUIRED');
  f.run.conclusion = f.job.conclusion = 'success';
  const success = await onboard(f.options);
  assert.equal(success.decision, 'EVIDENCE_SATISFIED'); assert.equal(success.headSha, head);
  assert.equal(JSON.parse(formatReport(success, 'compact')).onboarding.stage, 'assessed');
  assert.deepEqual(success.onboarding.resume, ['onboard', 'example/project', '7']);
  assert.equal(success.authority.mergeAuthorized, false);
});

test('MCP onboarding preserves scope, malformed selection stops before reads, and changing policy cannot activate', async () => {
  const f = fixture(), configuration = { CHANGEPLANE_REPOSITORY: 'example/project' };
  const result = await callAssessmentTool('changeplane_onboard', { pullRequest: 7 }, configuration, f.options);
  assert.equal(result.decision, 'SELECTION_REQUIRED');
  for (const args of [{}, { pullRequest: 0 }, { pullRequest: 7, token: 'private' }, { pullRequest: 7, check: 'Behavior' }]) {
    await assert.rejects(callAssessmentTool('changeplane_onboard', args, configuration, { read: () => assert.fail('no access') }), { code: 'INPUT_INVALID' });
  }
  await assert.rejects(onboard(f.options, { prerequisites: async () => ({ decision: 'SETUP_REQUIRED', baseSha: base }),
    plan: async () => ({ baseSha: head }) }), { code: 'EVIDENCE_CHANGED' });
  f.install();
  await assert.rejects(onboard(f.options, { inspect: async () => ({ handback: { binding: { policyRevision: head } } }) }), { code: 'EVIDENCE_CHANGED' });
  const rpc = assessmentRpc();
  await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const catalog = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.ok(catalog.result.tools.some(tool => tool.name === 'changeplane_onboard'));
  assert.ok(catalog.result.tools.every(tool => !/watch|queue/u.test(tool.name)), 'agents cannot register notification destinations');
});

test('installed CLI accepts a PR URL, retains setup contents in compact output and returns the real assessment exit', () => {
  const f = fixture();
  const run = (...args) => spawnSync(process.execPath, ['--input-type=module', '-e', `
    const data = ${JSON.stringify(f.data)};
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://api.github.com' || options.method !== 'GET') throw new Error('unexpected access');
      const value = data[parsed.pathname + parsed.search];
      return value === undefined ? new Response('', { status: 404 }) : Response.json(value);
    };
    process.argv = [process.execPath, 'bin/changeplane.js', ...process.argv.slice(1)];
    await import(${JSON.stringify(new URL('./cli.js', import.meta.url).href)});
  `, 'onboard', 'https://github.com/example/project/pull/7', '--format', 'compact', ...args], { encoding: 'utf8' });
  const missing = run(); assert.equal(missing.status, 1, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).onboarding.assessed, false);
  const selected = run('--check', 'Behavior', '--workflow', workflow);
  assert.equal(selected.status, 1, selected.stderr); assert.equal(JSON.parse(selected.stdout).files.length, 2);
  f.install(); f.run.conclusion = f.job.conclusion = 'success';
  const ready = run(); assert.equal(ready.status, 0, ready.stderr);
  assert.equal(JSON.parse(ready.stdout).onboarding.assessed, true);
});

function watchFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'changeplane-watch-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = fixture(); f.install();
  let time = 1000;
  const sent = [], events = [];
  const options = { repository: 'example/project', number: 7, thread, directory, seconds: 90 };
  const dependencies = { inspect: () => onboard(f.options), notify: async notice => sent.push(notice), now: () => time,
    pause: async ms => { time += ms; }, emit: event => events.push(event) };
  const statePath = () => join(directory, readdirSync(directory)[0], 'watch.json');
  return { f, sent, events, options, dependencies, advance: ms => { time += ms; }, statePath };
}

test('watch queues failure once, then a fresh green head, without sending repository prose', async t => {
  const s = watchFixture(t); let pauses = 0;
  const result = await watchPullRequest(s.options, { ...s.dependencies, pause: async ms => {
    s.advance(ms); if (++pauses === 2) {
      s.f.run.conclusion = s.f.job.conclusion = 'success';
      const next = 'd'.repeat(40); s.f.pr.head.sha = s.f.run.head_sha = s.f.job.head_sha = next;
      s.f.data[`${root}/actions/runs?head_sha=${next}&per_page=100`] = { total_count: 1, workflow_runs: [s.f.run] };
    }
  } });
  assert.equal(result.status, 'completed'); assert.equal(result.notificationsQueued, 2);
  assert.equal(result.agentExecutionConfirmed, false); assert.equal(s.sent.length, 2);
  assert.ok(s.sent.every(item => item.thread === thread && item.message.includes('changeplane onboard example/project 7')));
  assert.equal(s.sent.some(item => item.message.includes('src/sort.js')), false);
  const again = await watchPullRequest(s.options, s.dependencies);
  assert.equal(again.status, 'completed'); assert.equal(s.sent.length, 2);
});

test('pending CI waits without notifications and restart retains deadline and deduplication', async t => {
  const s = watchFixture(t); s.f.run.status = s.f.job.status = 'in_progress';
  s.f.run.conclusion = s.f.job.conclusion = null;
  const pending = await watchPullRequest(s.options, s.dependencies);
  assert.equal(pending.status, 'expired'); assert.equal(s.sent.length, 0);
  const expired = await watchPullRequest({ ...s.options, seconds: 900 }, s.dependencies);
  assert.equal(expired.deadline, pending.deadline); assert.equal(expired.status, 'expired');
  s.f.run.status = s.f.job.status = 'completed'; s.f.run.conclusion = s.f.job.conclusion = 'failure';
  const controller = new AbortController();
  await assert.rejects(watchPullRequest({ ...s.options, renew: true, signal: controller.signal }, {
    ...s.dependencies, pause: async () => { controller.abort(); throw new Error('cancelled'); },
  }), { code: 'COLLECTION_CANCELLED' });
  assert.equal(s.sent.length, 1);
  const resumed = await watchPullRequest(s.options, s.dependencies);
  assert.equal(resumed.status, 'expired'); assert.equal(s.sent.length, 1);
});

test('watch observes missing setup, then assesses after policy merge without another command', async t => {
  const s = watchFixture(t); delete s.f.data[`${root}/contents/.changeplane.json?ref=${base}`];
  const result = await watchPullRequest(s.options, { ...s.dependencies, pause: async ms => {
    s.advance(ms); s.f.install(); s.f.run.conclusion = s.f.job.conclusion = 'success';
  } });
  assert.equal(result.status, 'completed'); assert.equal(s.sent.length, 2);
});

test('uncertain native delivery and competing watchers never dispatch a duplicate', async t => {
  const s = watchFixture(t);
  await assert.rejects(watchPullRequest(s.options, { ...s.dependencies, notify: async () => { throw new Error('lost acknowledgement'); } }), { code: 'WATCH_DELIVERY_UNKNOWN' });
  await assert.rejects(watchPullRequest({ ...s.options, renew: true }, s.dependencies), { code: 'WATCH_DELIVERY_UNKNOWN' });
  assert.equal(s.sent.length, 0);
  const state = JSON.parse(readFileSync(s.statePath())); state.deliveries[0].status = 'queued'; writeFileSync(s.statePath(), JSON.stringify(state));
  mkdirSync(join(s.statePath(), '..', 'lock'));
  await assert.rejects(watchPullRequest(s.options, s.dependencies), { code: 'SESSION_BUSY' });
});

test('watch stops on changed repository identity, provider failure and exhausted notification bounds', async t => {
  const s = watchFixture(t);
  await assert.rejects(watchPullRequest(s.options, { ...s.dependencies, pause: async ms => { s.advance(ms); s.f.pr.id++; } }), { code: 'EVIDENCE_CHANGED' });
  assert.equal(s.sent.length, 1);
  const other = watchFixture(t);
  await assert.rejects(watchPullRequest(other.options, { ...other.dependencies, inspect: () => { throw new CollectionError('PERMISSION_DENIED'); } }), { code: 'PERMISSION_DENIED' });
  assert.equal(other.sent.length, 0);
  const bounded = watchFixture(t);
  const result = await watchPullRequest(bounded.options, { ...bounded.dependencies, pause: async ms => {
    bounded.advance(ms); bounded.f.job.conclusion = bounded.f.run.conclusion = bounded.f.job.conclusion === 'failure' ? 'cancelled' : 'timed_out';
  } });
  assert.equal(result.status, 'notification_limit'); assert.equal(bounded.sent.length, 2);
});

test('native notifier uses fixed argv and strips GitHub, model and controller credentials', async () => {
  const calls = [];
  const notify = codexNotifier(process.execPath, { HOME: '/operator', PATH: '/usr/bin', GH_TOKEN: 'private',
    OPENAI_API_KEY: 'private-model', CHANGEPLANE_CONTROLLER_SECRET: 'private-controller', NODE_OPTIONS: '--require evil' },
  async (...args) => { calls.push(args); });
  await notify({ thread, message: 'A fixed notification' });
  assert.deepEqual(calls[0][1], ['queue', '--thread', thread, '--message', 'A fixed notification']);
  assert.deepEqual(calls[0][2].env, { HOME: '/operator', PATH: '/usr/bin' });
  assert.equal(calls[0][2].timeout, 15000);
  await assert.rejects(notify({ thread: '--last', message: 'x' }), { code: 'INPUT_INVALID' });
  assert.throws(() => codexNotifier('/missing/codex'), { code: 'WATCH_CLIENT_UNAVAILABLE' });
});

test('restart cannot change the destination, reset read bounds or renew an active watch', async t => {
  const s = watchFixture(t), controller = new AbortController();
  await assert.rejects(watchPullRequest({ ...s.options, signal: controller.signal }, { ...s.dependencies,
    pause: async () => { controller.abort(); throw new Error(); } }), { code: 'COLLECTION_CANCELLED' });
  await assert.rejects(watchPullRequest({ ...s.options, thread: 'aaaaaaaa-1234-1234-1234-123456789abc' }, s.dependencies), { code: 'SESSION_UNAVAILABLE' });
  await assert.rejects(watchPullRequest({ ...s.options, renew: true }, s.dependencies), { code: 'WATCH_STILL_ACTIVE' });
  const state = JSON.parse(readFileSync(s.statePath())); state.reads = 600; writeFileSync(s.statePath(), JSON.stringify(state));
  await assert.rejects(watchPullRequest(s.options, { ...s.dependencies, inspect: ({ read }) => read('/repos/example/project') }), { code: 'COLLECTION_LIMIT' });
  assert.equal(s.sent.length, 1);
});
