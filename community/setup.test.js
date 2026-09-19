import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planSetup, inspectSetup, writeSetupPlan, setupFailure } from './setup.js';
import { CollectionError } from './transport.js';
import { assessmentRpc, callAssessmentTool } from './mcp.js';
import { formatReport } from './output.js';
import { spawnSync } from 'node:child_process';

const base = 'b'.repeat(40), head = 'a'.repeat(40), release = 'c'.repeat(40), root = '/repos/example/project';
const workflow = '.github/workflows/ci.yml';
const templates = Object.fromEntries(['changeplane-community.yml', 'changeplane-team.yml', 'changeplane-team-review-signal.yml']
  .map(name => [`examples/${name}`, readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8')]));
const file = content => ({ type: 'file', encoding: 'base64', size: Buffer.byteLength(content), content: Buffer.from(content).toString('base64') });
function fixture() {
  const data = {
    [root]: { id: 1, full_name: 'example/project', default_branch: 'main' },
    [`${root}/commits/main`]: { sha: base },
    [`${root}/pulls/7`]: { number: 7, state: 'open', base: { ref: 'main', repo: { id: 1 } }, head: { sha: head } },
    [`${root}/actions/workflows?per_page=100`]: { total_count: 1, workflows: [{ id: 18, path: workflow, name: 'Behavior CI', state: 'active' }] },
    [`${root}/actions/runs?head_sha=${base}&per_page=100`]: { total_count: 1, workflow_runs: [
      { id: 12, workflow_id: 18, run_number: 2, run_attempt: 2, head_sha: base, path: workflow },
    ] },
    [`${root}/actions/runs/12/attempts/2/jobs?per_page=100`]: { total_count: 1, jobs: [{ id: 99, run_id: 12, head_sha: base, name: 'Behavior' }] },
    [`${root}/contents/${workflow}?ref=${base}`]: file('name: Behavior CI\n'),
  };
  const reads = [];
  const read = async path => {
    reads.push(path);
    if (!Object.hasOwn(data, path)) {
      if (path.includes('/contents/')) throw new CollectionError('NOT_FOUND', { provider: 'github', status: 404 });
      throw new Error(`Unexpected read ${path}`);
    }
    return structuredClone(data[path]);
  };
  const options = { repository: 'example/project', read, runtime: () => ({ revision: release, templates }) };
  return { data, reads, read, options };
}
const selected = { check: 'Behavior', workflow };

test('installed CLI doctor reports missing and configured policy with distinct exits and useful text', () => {
  const f = fixture();
  f.data[`${root}/pulls?state=open&per_page=1`] = [];
  f.data[`${root}/actions/runs?per_page=1`] = { workflow_runs: [] };
  f.data[`${root}/commits/${base}/check-runs?per_page=1`] = { check_runs: [] };
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
  `, 'doctor', 'example/project', ...args], { encoding: 'utf8' });
  const missing = run();
  assert.equal(missing.status, 1, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).decision, 'SETUP_REQUIRED'); assert.equal(missing.stderr, '');
  f.data[`${root}/contents/.changeplane.json?ref=${base}`] = file(JSON.stringify({
    protectedPaths: { block: [], requireApproval: [] },
    evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: workflow }] },
  }));
  const ready = run();
  assert.equal(ready.status, 0, ready.stderr); assert.equal(JSON.parse(ready.stdout).decision, 'CHECKS_PASSED');
  const text = run('--format', 'text'); assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Next: Run inspect/); assert.match(text.stdout, /Prerequisites only/);
});

test('MCP takes an unconfigured repository through checks, discovery and a reviewable setup plan', async () => {
  const f = fixture();
  f.data[`${root}/pulls?state=open&per_page=1`] = [];
  f.data[`${root}/actions/runs?per_page=1`] = { workflow_runs: [] };
  f.data[`${root}/commits/${base}/check-runs?per_page=1`] = { check_runs: [] };
  const configuration = { CHANGEPLANE_REPOSITORY: 'example/project', GH_TOKEN: 'synthetic-secret' };
  const rpc = assessmentRpc((name, args) => callAssessmentTool(name, args, configuration, f.options));
  await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = async (name, args) => (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })).result;
  const check = await call('changeplane_check_setup', {});
  assert.equal(check.isError, false); assert.equal(check.structuredContent.decision, 'SETUP_REQUIRED');
  assert.match(formatReport(check.structuredContent, 'text'), /Prerequisites only/);
  const discovery = await call('changeplane_setup', {});
  assert.equal(discovery.isError, false); assert.equal(discovery.structuredContent.decision, 'SELECTION_REQUIRED');
  assert.equal(discovery.structuredContent.candidates[0].name, 'Behavior');
  assert.deepEqual(discovery.structuredContent.files, []);
  const plan = await call('changeplane_setup', selected);
  assert.equal(plan.isError, false); assert.equal(plan.structuredContent.decision, 'REVIEW_REQUIRED');
  assert.equal(plan.structuredContent.runtimeRevision, release);
  assert.deepEqual(plan.structuredContent.files.map(item => item.path), ['.changeplane.json', '.github/workflows/changeplane-community.yml']);
  assert.equal(JSON.parse(plan.structuredContent.files[0].content).evidence.requiredChecks[0].name, 'Behavior');
  assert.equal(plan.structuredContent.authority.repositoryModified, false);
  assert.equal(JSON.stringify(plan).includes('synthetic-secret'), false);
  const before = f.reads.length;
  for (const [name, args] of [
    ['changeplane_check_setup', { repository: 'other/repo' }], ['changeplane_check_setup', { token: 'injected' }],
    ['changeplane_setup', { ...selected, output: '/tmp/forbidden' }], ['changeplane_setup', { coordination: true }],
    ['changeplane_setup', { check: 'Behavior' }], ['changeplane_setup', { check: false, workflow }],
    ['changeplane_setup', { pullRequest: 0 }], ['changeplane_setup', { ...selected, repository: 'other/repo' }],
  ]) {
    const result = await call(name, args);
    assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'INPUT_INVALID');
  }
  assert.equal(f.reads.length, before);
});

test('read-only doctor distinguishes missing policy from ready prerequisites without preparing repository changes', async () => {
  const f = fixture();
  f.data[`${root}/pulls?state=open&per_page=1`] = [];
  f.data[`${root}/actions/runs?per_page=1`] = { workflow_runs: [] };
  f.data[`${root}/commits/${base}/check-runs?per_page=1`] = { check_runs: [] };
  const missing = await inspectSetup({ ...f.options, nodeVersion: '22.18.0' });
  assert.equal(missing.decision, 'SETUP_REQUIRED');
  assert.equal(missing.baseSha, base);
  assert.equal(missing.authority.repositoryModified, false);
  assert.equal(missing.files, undefined);
  assert.match(missing.nextAction, /init/);
  f.data[`${root}/contents/.changeplane.json?ref=${base}`] = file(JSON.stringify({
    protectedPaths: { block: [], requireApproval: [] },
    evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: workflow }] },
  }));
  const ready = await inspectSetup({ ...f.options, nodeVersion: '24.13.0' });
  assert.equal(ready.decision, 'CHECKS_PASSED');
  assert.equal(ready.runtimeRevision, release);
  assert.equal(ready.requiredChecks[0].name, 'Behavior');
  assert.equal(ready.authority.guardPublished, false);
  assert.match(ready.nextAction, /inspect/);
  assert.ok(ready.unverified.some(item => /behavior/i.test(item)));
});

test('doctor rejects unsupported runtimes before access and reports policy drift or permission failures without a ready result', async () => {
  const f = fixture();
  await assert.rejects(inspectSetup({ ...f.options, nodeVersion: '20.19.0' }), { code: 'SETUP_NODE_UNQUALIFIED' });
  assert.equal(f.reads.length, 0);
  await assert.rejects(inspectSetup({ ...f.options, read: async () => {
    throw new CollectionError('PERMISSION_DENIED', { provider: 'github', status: 403 });
  } }), { code: 'PERMISSION_DENIED' });
  f.data[`${root}/pulls?state=open&per_page=1`] = [];
  f.data[`${root}/actions/runs?per_page=1`] = { workflow_runs: [] };
  f.data[`${root}/commits/${base}/check-runs?per_page=1`] = { check_runs: [] };
  let reads = 0;
  await assert.rejects(inspectSetup({ ...f.options, read: async path => {
    const response = await f.read(path);
    if (path.endsWith('/commits/main') && ++reads === 2) response.sha = head;
    return response;
  } }), { code: 'EVIDENCE_CHANGED' });
  f.data[`${root}/contents/.changeplane.json?ref=${base}`] = file('null');
  await assert.rejects(inspectSetup(f.options), { code: 'POLICY_INVALID' });
  f.data[`${root}/contents/.changeplane.json?ref=${base}`] = file(JSON.stringify({
    protectedPaths: { block: [], requireApproval: [] },
    evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: workflow }] },
  }));
  f.data[`${root}/actions/workflows?per_page=100`].workflows[0].state = 'disabled_manually';
  await assert.rejects(inspectSetup(f.options), { code: 'SETUP_WORKFLOW_INVALID' });
});

test('setup discovers exact job identities without selecting or writing a policy', async () => {
  const f = fixture();
  const plan = await planSetup({ ...f.options, runtime: () => { throw new Error('Must not render'); } });
  assert.equal(plan.decision, 'SELECTION_REQUIRED');
  assert.equal(plan.baseSha, base);
  assert.deepEqual(plan.files, []);
  assert.deepEqual(plan.candidates, [{ name: 'Behavior', workflowPath: workflow, workflowName: 'Behavior CI', appSlug: 'github-actions' }]);
  assert.equal(plan.authority.repositoryModified, false);
});

test('setup preserves existing evidence, protected paths and unrelated policy when adding coordination', async () => {
  const f = fixture();
  const original = { protectedPaths: { block: ['private/**'], requireApproval: ['special/**'] },
    evidence: { requiredChecks: [{ name: 'External check', appSlug: 'trusted-publisher' }] },
    team: { enabled: false, maxActive: 5, custom: 'preserved' }, custom: { future: true } };
  f.data[`${root}/contents/.changeplane.json?ref=${base}`] = file(JSON.stringify(original));
  const plan = await planSetup({ ...f.options, ...selected, coordination: true });
  assert.equal(plan.decision, 'REVIEW_REQUIRED');
  const policy = JSON.parse(plan.files[0].content);
  assert.deepEqual(policy.protectedPaths, original.protectedPaths);
  assert.deepEqual(policy.evidence.requiredChecks[0], original.evidence.requiredChecks[0]);
  assert.deepEqual(policy.custom, original.custom);
  assert.deepEqual(policy.team, { ...original.team, enabled: true });
  assert.equal(plan.files.length, 4);
  const observer = plan.files.find(item => item.path.endsWith('/changeplane-team.yml')).content;
  assert.ok(observer.includes(`ref: ${release}`));
  assert.ok(observer.includes('workflows: ["Behavior CI","ChangePlane review signal"]'));
  assert.equal(plan.authority.mergeAuthorized, false);
  assert.ok(f.reads.filter(path => path.includes('/contents/')).every(path => path.endsWith(`ref=${base}`)));
});

test('read-only setup leaves existing coordination settings unchanged and pins public Action', async () => {
  const f = fixture();
  const policy = { protectedPaths: { block: [], requireApproval: [] }, team: { enabled: true, maxActive: 2 }, evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: workflow }] } };
  f.data[`${root}/contents/.changeplane.json?ref=${base}`] = file(JSON.stringify(policy));
  const plan = await planSetup({ ...f.options, ...selected });
  assert.deepEqual(JSON.parse(plan.files[0].content), policy);
  assert.equal(plan.files[0].change, 'unchanged');
  assert.equal(plan.files[0].content, JSON.stringify(policy));
  assert.equal(plan.files.length, 2);
  assert.ok(plan.files[1].content.includes(`changeplane/community@${release}`));
  assert.ok(plan.files[1].content.includes('workflows: ["Behavior CI"]'));
  assert.ok(!plan.files[1].content.includes('contents: write'));
});

test('existing workflows and conflicting evidence are never overwritten', async () => {
  const f = fixture();
  f.data[`${root}/contents/.github/workflows/changeplane-community.yml?ref=${base}`] = file('custom workflow');
  await assert.rejects(planSetup({ ...f.options, ...selected }), { code: 'SETUP_WORKFLOW_EXISTS' });
  delete f.data[`${root}/contents/.github/workflows/changeplane-community.yml?ref=${base}`];
  f.data[`${root}/contents/.changeplane.json?ref=${base}`] = file(JSON.stringify({ protectedPaths: { block: [], requireApproval: [] }, evidence: { requiredChecks: [
    { name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/another.yml' },
  ] } }));
  await assert.rejects(planSetup({ ...f.options, ...selected }), { code: 'SETUP_CHECK_CONFLICT' });
});

test('default branch and optional PR drift invalidate the complete setup plan', async () => {
  const f = fixture(); let bases = 0;
  await assert.rejects(planSetup({ ...f.options, ...selected, read: async path => {
    const result = await f.read(path);
    if (path.endsWith('/commits/main') && ++bases === 2) result.sha = head;
    return result;
  } }), { code: 'EVIDENCE_CHANGED' });
  f.data[`${root}/actions/runs?head_sha=${head}&per_page=100`] = structuredClone(f.data[`${root}/actions/runs?head_sha=${base}&per_page=100`]);
  f.data[`${root}/actions/runs?head_sha=${head}&per_page=100`].workflow_runs[0].head_sha = head;
  f.data[`${root}/actions/runs/12/attempts/2/jobs?per_page=100`].jobs[0].head_sha = head;
  let pulls = 0;
  await assert.rejects(planSetup({ ...f.options, ...selected, number: 7, read: async path => {
    const result = await f.read(path);
    if (path.endsWith('/pulls/7') && ++pulls === 2) result.head.sha = release;
    return result;
  } }), { code: 'EVIDENCE_CHANGED' });
});

test('PR-only CI discovery still reads workflow and policy from the trusted default revision', async () => {
  const f = fixture();
  f.data[`${root}/actions/runs?head_sha=${head}&per_page=100`] = structuredClone(f.data[`${root}/actions/runs?head_sha=${base}&per_page=100`]);
  f.data[`${root}/actions/runs?head_sha=${head}&per_page=100`].workflow_runs[0].head_sha = head;
  f.data[`${root}/actions/runs/12/attempts/2/jobs?per_page=100`].jobs[0].head_sha = head;
  const result = await planSetup({ ...f.options, ...selected, number: 7 });
  assert.equal(result.observedHeadSha, head);
  assert.ok(f.reads.filter(path => path.includes('/contents/')).every(path => path.endsWith(`ref=${base}`)));
});

test('ambiguous jobs, oversized lists, unsafe workflow names and invalid capacities fail closed', async () => {
  const f = fixture(); const jobs = f.data[`${root}/actions/runs/12/attempts/2/jobs?per_page=100`];
  jobs.total_count = 2; jobs.jobs.push({ ...jobs.jobs[0], id: 100 });
  await assert.rejects(planSetup({ ...f.options, ...selected }), { code: 'SETUP_CHECK_NOT_FOUND' });
  jobs.total_count = 101;
  await assert.rejects(planSetup(f.options), { code: 'COLLECTION_LIMIT' });
  for (const maxActive of [0, 21, -1, 1.5]) await assert.rejects(planSetup({ ...f.options, coordination: true, maxActive }), { code: 'SETUP_INPUT_INVALID' });
  const unsafe = fixture(); unsafe.data[`${root}/actions/workflows?per_page=100`].workflows[0].name = '${{ secrets.VALUE }}';
  await assert.rejects(planSetup({ ...unsafe.options, ...selected }), { code: 'SETUP_CHECK_NOT_FOUND' });
});

test('staging writes the complete plan only in a new directory and preserves occupied paths', async () => {
  const f = fixture(); const plan = await planSetup({ ...f.options, ...selected });
  const scratch = mkdtempSync(join(tmpdir(), 'changeplane-setup-'));
  try {
    const output = join(scratch, 'proposal');
    writeSetupPlan(plan, output);
    assert.deepEqual(JSON.parse(readFileSync(join(output, '.changeplane.json'))), JSON.parse(plan.files[0].content));
    assert.equal(JSON.parse(readFileSync(join(output, 'changeplane-setup.json'))).baseSha, base);
    writeFileSync(join(output, 'keep.txt'), 'unrelated');
    assert.throws(() => writeSetupPlan(plan, output), { code: 'SETUP_OUTPUT_EXISTS' });
    assert.equal(readFileSync(join(output, 'keep.txt'), 'utf8'), 'unrelated');
    assert.equal(existsSync(join(scratch, '.changeplane.json')), false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('setup failures redact unknown provider bodies, tokens and filesystem details', () => {
  const result = setupFailure(new Error('private-token /secret/path'));
  assert.equal(result.decision, 'UNAVAILABLE');
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});
