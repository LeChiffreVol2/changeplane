import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planSetup, writeSetupPlan, setupFailure } from './setup.js';
import { CollectionError } from './transport.js';

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
