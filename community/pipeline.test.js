import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectPipeline, OCR_SOURCE } from './pipeline.js';
import { callAssessmentTool } from './mcp.js';
import { formatReport } from './output.js';
import { followPipeline } from './session.js';

const head = 'a'.repeat(40), base = 'b'.repeat(40), mergeBase = 'c'.repeat(40);
function fixture(paths = ['src/sort.js']) {
  const root = '/repos/example/project';
  const policy = { protectedPaths: { requireApproval: ['infra/**'], block: ['secrets/**'] },
    evidence: { requiredChecks: [{ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }] } };
  const repo = { id: 1, full_name: 'example/project', default_branch: 'main' };
  const pr = { id: 71, number: 7, state: 'open', user: { id: 10 }, changed_files: paths.length,
    head: { sha: head, ref: 'feature', repo }, base: { sha: base, ref: 'main', repo } };
  const run = { id: 12, workflow_id: 18, run_number: 2, run_attempt: 2, head_sha: head,
    path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', repository: repo, head_repository: repo };
  const data = {
    [root]: repo, [`${root}/pulls/7`]: pr, [`${root}/commits/main`]: { sha: base },
    [`${root}/pulls/7/reviews?per_page=100&page=1`]: [],
    [`${root}/contents/.changeplane.json?ref=${base}`]: { type: 'file', encoding: 'base64', size: JSON.stringify(policy).length,
      content: Buffer.from(JSON.stringify(policy)).toString('base64') },
    [`${root}/pulls/7/files?per_page=100&page=1`]: paths.map(filename => ({ filename, status: 'modified', patch: '@@ -1,3 +1,4 @@\n unchanged\n+added\n unchanged\n unchanged' })),
    [`${root}/actions/runs?head_sha=${head}&per_page=100`]: { total_count: 1, workflow_runs: [run] },
    [`${root}/actions/runs/12/attempts/2/jobs?per_page=100`]: { total_count: 1,
      jobs: [{ id: 99, run_id: 12, head_sha: head, name: 'Behavior', status: 'completed', conclusion: 'success' }] },
    [`${root}/compare/${base}...${head}?per_page=1`]: { merge_base_commit: { sha: mergeBase }, base_commit: { sha: base } },
  };
  const reads = [];
  const read = async path => { reads.push(path); assert.ok(Object.hasOwn(data, path), `Unexpected read ${path}`); return structuredClone(data[path]); };
  return { data, pr, run, reads, read, options: { repository: 'example/project', number: 7, read } };
}
function reviewFor(request, findings = []) {
  const selected = request.binding.files.map((file, i) => ({ item_id: (i + 1).toString(16).padStart(64, '0'), path: file.path,
    ...(file.previousPath ? { old_path: file.previousPath } : {}) }));
  return { status: 'complete', comments: findings, manifest: {
    schema_version: 'ocr.run-manifest/v1', run_id: 'synthetic-review', operation: 'review', terminal_state: 'complete',
    input: { mode: 'range', resolved_base: request.binding.mergeBase, resolved_head: request.binding.headSha,
      exact_range: `${request.binding.mergeBase}..${request.binding.headSha}` }, execution: { ocr_version: 'dev' },
    coverage: { selected, completed: structuredClone(selected), reused: [], failed: [], waived: [] },
  } };
}
const finding = { path: 'src/sort.js', start_line: 2, end_line: 2, content: 'Handle an empty input.', severity: 'medium', category: 'bug' };
async function started(f = fixture()) {
  const initial = await inspectPipeline(f.options);
  const requestId = initial.reviewRequest.id, review = reviewFor(initial.reviewRequest);
  return { f, initial, requestId, review, run: extra => inspectPipeline({ ...f.options, review, requestId, ...extra }) };
}

test('pipeline returns a pinned request, passes findings to the existing writer and waits for current CI', async () => {
  const s = await started();
  assert.equal(s.initial.pipeline.status, 'review_required');
  assert.equal(s.initial.reviewRequest.compatibleSource, OCR_SOURCE);
  assert.deepEqual(s.initial.reviewRequest.command.slice(0, 6), ['ocr', 'review', '--from', mergeBase, '--to', head]);
  s.review.comments = [finding];
  const feedback = await s.run();
  assert.equal(feedback.nextActionCode, 'ADDRESS_REVIEW_FINDINGS');
  assert.equal(feedback.handback.review.findings[0].content, finding.content);
  assert.equal(feedback.ci.decision, 'EVIDENCE_SATISFIED');
  assert.equal(feedback.decision, 'REVIEW_REQUIRED');
  s.review.comments = null;
  s.f.run.status = 'queued'; s.f.run.conclusion = null;
  const pending = await s.run();
  assert.equal(pending.pipeline.status, 'ci_pending');
  assert.equal(pending.reviewRequest.id, s.requestId, 'CI progress does not invalidate the review request');
  let time = 0;
  const ready = await inspectPipeline({ ...s.f.options, review: s.review, requestId: s.requestId, waitSeconds: 30 }, {
    now: () => time, pause: async ms => { time += ms; s.f.run.status = 'completed'; s.f.run.conclusion = 'success'; },
  });
  assert.equal(ready.pipeline.status, 'ready'); assert.equal(ready.wait.inspections, 2);
  assert.equal(ready.pipeline.authenticatedReview, false);
  assert.deepEqual(ready.authority, { advisory: true, guardPublished: false, mergeAuthorized: false, repairAuthorized: false });
  assert.equal(ready.nextActionCode, 'FOLLOW_REPOSITORY_MERGE_POLICY');
});

test('a new commit needs a new request and review before returning to the pipeline', async () => {
  const s = await started(), next = 'd'.repeat(40), root = '/repos/example/project';
  s.f.pr.head.sha = next; s.f.run.head_sha = next;
  s.f.data[`${root}/actions/runs?head_sha=${next}&per_page=100`] = s.f.data[`${root}/actions/runs?head_sha=${head}&per_page=100`];
  s.f.data[`${root}/actions/runs/12/attempts/2/jobs?per_page=100`].jobs[0].head_sha = next;
  s.f.data[`${root}/compare/${base}...${next}?per_page=1`] = s.f.data[`${root}/compare/${base}...${head}?per_page=1`];
  const stale = await s.run(); assert.equal(stale.review.code, 'REVIEW_STALE');
  assert.notEqual(stale.reviewRequest.id, s.requestId);
  const relabelled = await s.run({ requestId: stale.reviewRequest.id });
  assert.equal(relabelled.review.code, 'REVIEW_STALE', 'a new request ID cannot relabel an old OCR range');
  const fresh = await s.run({ requestId: stale.reviewRequest.id, review: reviewFor(stale.reviewRequest) });
  assert.equal(fresh.pipeline.status, 'ready');
});

test('policy, repository, target and diff coverage changes invalidate the review request', async () => {
  for (const mode of ['policy', 'repository', 'target', 'range']) {
    const s = await started(), root = '/repos/example/project';
    if (mode === 'policy') {
      const policy = JSON.parse(Buffer.from(s.f.data[`${root}/contents/.changeplane.json?ref=${base}`].content, 'base64'));
      policy.protectedPaths.requireApproval.push('new/**');
      s.f.data[`${root}/contents/.changeplane.json?ref=${base}`].content = Buffer.from(JSON.stringify(policy)).toString('base64');
    } else if (mode === 'repository') s.f.pr.id++;
    else if (mode === 'target') {
      s.f.pr.base.sha = 'd'.repeat(40);
      s.f.data[`${root}/compare/${s.f.pr.base.sha}...${head}?per_page=1`] = { merge_base_commit: { sha: mergeBase }, base_commit: { sha: s.f.pr.base.sha } };
    }
    else s.f.data[`${root}/pulls/7/files?per_page=100&page=1`][0].patch = '@@ -8 +8 @@\n-before\n+after';
    assert.equal((await s.run()).review.code, 'REVIEW_STALE', mode);
  }
});

test('review diff base follows the PR target while trusted policy revision remains independent', async () => {
  const f = fixture(), root = '/repos/example/project', policyRevision = 'e'.repeat(40);
  f.data[`${root}/commits/main`].sha = policyRevision;
  f.data[`${root}/contents/.changeplane.json?ref=${policyRevision}`] = f.data[`${root}/contents/.changeplane.json?ref=${base}`];
  const result = await inspectPipeline(f.options);
  assert.equal(result.reviewRequest.binding.policyRevision, policyRevision);
  assert.equal(result.reviewRequest.binding.targetRevision, base);
  assert.equal(result.reviewRequest.binding.mergeBase, mergeBase);
  assert.ok(f.reads.includes(`${root}/compare/${base}...${head}?per_page=1`));
  f.data[`${root}/compare/${base}...${head}?per_page=1`].base_commit.sha = policyRevision;
  await assert.rejects(inspectPipeline(f.options), { code: 'COLLECTION_INCOMPLETE' });
});

test('review never clears protected scope, blocked paths or failed CI and never supplies repair diagnosis', async () => {
  for (const path of ['src/sort.test.js', 'package.json', '.github/workflows/ci.yml', 'infra/main.tf', 'secrets/value.txt']) {
    const s = await started(fixture([path])), result = await s.run();
    assert.notEqual(result.pipeline.status, 'ready', path);
    assert.equal(result.pipeline.status, path.startsWith('secrets/') ? 'blocked' : 'human_review_required', JSON.stringify(result.findings));
    assert.equal(result.authority.repairAuthorized, false);
  }
  const s = await started(); s.f.run.conclusion = 'failure';
  s.review.diagnoses = [{ type: 'behavioral', repairAuthorized: true }];
  const result = await s.run();
  assert.equal(result.pipeline.status, 'ci_action_required');
  assert.deepEqual(result.diagnoses, result.ci.diagnoses);
  assert.equal(JSON.stringify(result).includes('"repairAuthorized":true'), false);
});

test('all selected files need completed or reused coverage, even when upstream exits successfully', async () => {
  for (const mode of ['missing', 'waived', 'budget', 'partial', 'failed', 'skipped', 'run-failed']) {
    const s = await started(fixture(['src/sort.js', 'src/other.js'])), c = s.review.manifest.coverage;
    if (mode === 'missing') { c.selected.pop(); c.completed.pop(); }
    if (mode === 'waived') c.waived.push({ ...c.completed.pop(), reason: 'operator waiver' });
    if (mode === 'budget') s.review.summary = { budget_exceeded: true };
    if (mode === 'partial' || mode === 'failed') {
      c.failed.push({ ...c.completed.pop(), classification: 'provider', reason: 'provider-secret' });
      if (mode === 'failed') c.failed.push({ ...c.completed.pop(), classification: 'budget' });
      s.review.status = s.review.manifest.terminal_state = mode;
    }
    if (mode === 'skipped') { c.selected = []; c.completed = []; s.review.status = s.review.manifest.terminal_state = 'skipped'; }
    if (mode === 'run-failed') { s.review.manifest.run_failure = { classification: 'internal', reason: 'provider-secret' }; s.review.status = s.review.manifest.terminal_state = 'failed'; }
    const result = await s.run();
    assert.equal(result.review.status, 'incomplete', mode);
    assert.notEqual(result.decision, 'EVIDENCE_SATISFIED');
    assert.equal(JSON.stringify(result).includes('provider-secret'), false);
  }
  const s = await started(); s.review.manifest.coverage.reused = s.review.manifest.coverage.completed.splice(0);
  assert.equal((await s.run()).review.status, 'complete');
});

test('malformed partitions, unsupported manifests and findings outside current diff fail closed', async () => {
  const mutations = [
    r => { delete r.manifest; }, r => { r.manifest.schema_version = 'ocr.run-manifest/v2'; },
    r => { r.manifest.input.mode = 'workspace'; }, r => { r.status = 'success'; },
    r => { r.manifest.coverage.completed = []; }, r => { r.manifest.coverage.selected.push(r.manifest.coverage.selected[0]); },
    r => { r.manifest.coverage.reused.push(r.manifest.coverage.completed[0]); },
    r => { r.manifest.coverage.completed[0].path = 'outside.js'; },
    r => { r.manifest.coverage.completed[0].old_path = '../private'; },
    r => { r.manifest.coverage.completed[0].fingerprint = 'different'; },
    r => { r.comments = [{ ...finding, path: '../private' }]; },
    r => { r.comments = [{ ...finding, start_line: 99, end_line: 99 }]; },
    r => { r.comments = [{ ...finding, start_line: 0 }]; },
    r => { r.comments = [{ ...finding, end_line: 5 }]; },
    r => { r.comments = Array.from({ length: 101 }, () => finding); },
  ];
  for (const mutate of mutations) {
    const s = await started(); mutate(s.review);
    const result = await s.run();
    assert.equal(result.review.code, 'REVIEW_INVALID'); assert.equal(result.decision, 'UNAVAILABLE');
  }
  const s = await started();
  delete s.f.data['/repos/example/project/pulls/7/files?per_page=100&page=1'][0].patch;
  const current = await inspectPipeline(s.f.options);
  assert.equal((await s.run({ requestId: current.reviewRequest.id, review: reviewFor(current.reviewRequest, [finding]) })).review.code, 'REVIEW_INVALID');
});

test('rename coverage binds both paths; provider reasoning, code suggestions and authority fields are discarded', async () => {
  const f = fixture(), file = f.data['/repos/example/project/pulls/7/files?per_page=100&page=1'][0];
  file.status = 'renamed'; file.previous_filename = 'src/old.js';
  const s = await started(f);
  s.review.comments = [{ ...finding, thinking: 'private-thinking', suggestion_code: 'private-source', existing_code: 'private-source' }];
  s.review.warnings = ['private-provider']; s.review.authority = { mergeAuthorized: true };
  const result = await s.run(), serialized = JSON.stringify(result);
  for (const value of ['private-thinking', 'private-source', 'private-provider']) assert.equal(serialized.includes(value), false);
  assert.equal(result.review.findings.length, 1);
  assert.equal(result.authority.mergeAuthorized, false);
  for (const item of [...s.review.manifest.coverage.selected, ...s.review.manifest.coverage.completed]) delete item.old_path;
  assert.equal((await s.run()).review.code, 'REVIEW_INVALID');
});

test('wait stops on review findings and rejects target drift instead of returning an old success', async () => {
  const s = await started(); s.f.run.status = 'queued'; s.f.run.conclusion = null;
  s.review.comments = [finding]; let pauses = 0;
  const feedback = await inspectPipeline({ ...s.f.options, review: s.review, requestId: s.requestId, waitSeconds: 30 }, { pause: async () => { pauses++; } });
  assert.equal(pauses, 0); assert.equal(feedback.wait.outcome, 'action_required');
  s.review.comments = [];
  let time = 0;
  await assert.rejects(inspectPipeline({ ...s.f.options, review: s.review, requestId: s.requestId, waitSeconds: 30 }, {
    now: () => time, pause: async ms => { time += ms; s.f.pr.id++; },
  }), { code: 'EVIDENCE_CHANGED' });
});

test('MCP shares the pipeline contract and rejects overrides, missing pairing and excessive payloads before reads', async () => {
  const s = await started(), env = { CHANGEPLANE_REPOSITORY: 'example/project' };
  const result = await callAssessmentTool('changeplane_pipeline', { pullRequest: 7, review: s.review, requestId: s.requestId }, env, { read: s.f.read });
  assert.equal(result.pipeline.status, 'ready');
  const reads = s.f.reads.length;
  for (const args of [{}, { pullRequest: 7, repository: 'other/repo' }, { pullRequest: 7, token: 'private' },
    { pullRequest: 7, reviewPath: '/private' }, { pullRequest: 7, review: s.review },
    { pullRequest: 7, requestId: s.requestId }, { pullRequest: 7, review: [], requestId: s.requestId },
    { pullRequest: 7, review: { payload: 'x'.repeat(256001) }, requestId: s.requestId },
    { pullRequest: 7, waitSeconds: 61 }]) {
    await assert.rejects(callAssessmentTool('changeplane_pipeline', args, env, { read: s.f.read }), { code: 'INPUT_INVALID' });
  }
  assert.equal(s.f.reads.length, reads);
});

test('CLI request/import round trip preserves findings, revision and authority in every output format', async () => {
  const s = await started(), dir = mkdtempSync(join(tmpdir(), 'changeplane-pipeline-'));
  const path = join(dir, 'review.json');
  const cli = args => spawnSync(process.execPath, ['--input-type=module', '-e', `
    const data = ${JSON.stringify(s.f.data)};
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://api.github.com' || options.method !== 'GET') throw new Error('unexpected access');
      return Response.json(data[parsed.pathname + parsed.search]);
    };
    process.argv = [process.execPath, 'bin/changeplane.js', 'pipeline', ...${JSON.stringify(args)}];
    await import(${JSON.stringify(new URL('./cli.js', import.meta.url).href)});
  `], { encoding: 'utf8' });
  try {
    const initial = cli(['example/project', '7']); assert.equal(initial.status, 1, initial.stderr);
    assert.equal(JSON.parse(initial.stdout).reviewRequest.id, s.requestId);
    s.review.comments = [finding]; writeFileSync(path, JSON.stringify(s.review));
    for (const format of ['json', 'compact', 'text']) {
      const result = cli(['https://github.com/example/project/pull/7', '--review', path, '--request-id', s.requestId, '--format', format]);
      assert.equal(result.status, 1, result.stderr); assert.ok(result.stdout.includes(finding.content));
      assert.ok(result.stdout.includes(head)); assert.ok(result.stdout.includes(s.requestId));
      if (format !== 'text') assert.equal(JSON.parse(result.stdout).authority.mergeAuthorized, false);
    }
    s.review.comments = []; writeFileSync(path, JSON.stringify(s.review));
    assert.equal(cli(['example/project', '7', '--review', path, '--request-id', s.requestId]).status, 0);
    s.review.status = 'unsupported'; writeFileSync(path, JSON.stringify(s.review));
    assert.equal(cli(['example/project', '7', '--review', path, '--request-id', s.requestId]).status, 2);
    for (const args of [['--review', path], ['--request-id', s.requestId], ['--review', path, '--request-id', 'bad'], ['--wait', '61']]) {
      const result = cli(['example/project', '7', ...args]); assert.equal(result.status, 2); assert.equal(result.stdout, '');
    }
    const report = await s.run({ review: reviewFor(s.initial.reviewRequest) });
    const compact = JSON.parse(formatReport(report, 'compact'));
    assert.deepEqual(compact.reviewRequest, report.reviewRequest); assert.deepEqual(compact.review, report.review);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function approve(s, report) {
  const body = report.humanReview.reviewBody.replaceAll('REPLACE_WITH_YOUR_REASON', 'Inspected this change and verified its intent.');
  const review = { id: 42, state: 'APPROVED', user: { id: 20, login: 'maintainer', type: 'User' },
    submitted_at: '2026-09-20T01:00:00Z', commit_id: head, body };
  s.f.data['/repos/example/project/pulls/7/reviews?per_page=100&page=1'] = [review];
  s.f.data['/repos/example/project/collaborators/maintainer/permission'] = { permission: 'write', user: { id: 20 } };
  return review;
}
test('current authenticated human decisions resolve protected paths, unsupported coverage and individual false positives', async () => {
  const s = await started(fixture(['src/sort.js', 'src/sort.test.js', 'asset.bin']));
  s.review.comments = [finding];
  s.review.manifest.coverage.selected.pop(); s.review.manifest.coverage.completed.pop();
  const held = await s.run(); approve(s, held);
  const result = await s.run();
  assert.equal(result.pipeline.status, 'ready'); assert.equal(result.pipeline.humanReviewObserved, true);
  assert.equal(result.review.status, 'incomplete', 'human coverage never rewrites engine completion');
  assert.equal(result.ci.decision, 'REVIEW_REQUIRED', 'original scope assessment is retained');
  assert.equal(result.review.findings.length, 1, 'original findings remain visible');
  assert.equal(result.humanReview.unresolvedFindings.length, 0);
  assert.equal(result.authority.guardPublished, false); assert.equal(result.authority.mergeAuthorized, false);
});
test('author, bot, stale, wrong-report, read-only, empty-reason and dismissed reviews cannot clear holds', async () => {
  for (const mode of ['author', 'bot', 'head', 'request', 'report', 'permission', 'reason', 'dismissed', 'outside']) {
    const s = await started(fixture(['src/sort.test.js']));
    const approved = approve(s, await s.run());
    if (mode === 'author') approved.user.id = 10;
    if (mode === 'bot') approved.user.type = 'Bot';
    if (mode === 'head') approved.commit_id = 'd'.repeat(40);
    if (mode === 'request') approved.body = approved.body.replace(s.requestId, 'e'.repeat(64));
    if (mode === 'report') approved.body = approved.body.replace((await s.run()).review.reportDigest, 'e'.repeat(64));
    if (mode === 'permission') s.f.data['/repos/example/project/collaborators/maintainer/permission'].permission = 'read';
    if (mode === 'reason') approved.body = approved.body.replace('Inspected this change and verified its intent.', '');
    if (mode === 'dismissed') approved.state = 'DISMISSED';
    if (mode === 'outside') approved.body = approved.body.replace('src/sort.test.js', 'outside.js');
    assert.equal((await s.run()).pipeline.status, 'human_review_required', mode);
  }
});
test('changes requested, blocked scope, provider failure, exhausted budget and failed CI retain their holds', async () => {
  for (const mode of ['changes', 'blocked', 'provider', 'budget', 'ci']) {
    const s = await started(fixture([mode === 'blocked' ? 'secrets/value.txt' : 'src/sort.test.js']));
    if (mode === 'provider') { s.review.manifest.run_failure = { classification: 'configuration' }; s.review.status = s.review.manifest.terminal_state = 'failed'; }
    if (mode === 'budget') s.review.summary = { budget_exceeded: true };
    if (mode === 'ci') s.f.run.conclusion = 'failure';
    const approved = approve(s, await s.run());
    if (mode === 'changes') approved.state = 'CHANGES_REQUESTED';
    assert.notEqual((await s.run()).pipeline.status, 'ready', mode);
  }
});
test('review or permission drift during collection fails closed', async () => {
  const s = await started(fixture(['src/sort.test.js'])); approve(s, await s.run());
  let reads = 0;
  await assert.rejects(s.run({ read: async path => {
    const value = await s.f.read(path);
    if (path.endsWith('/permission') && ++reads === 2) value.permission = 'read';
    return value;
  } }), { code: 'EVIDENCE_CHANGED' });
});
test('a personal owner can record their own review without pretending to approve their PR', async () => {
  const s = await started(fixture(['src/sort.test.js']));
  const decision = approve(s, await s.run()); decision.state = 'COMMENTED'; decision.user.id = 10;
  s.f.data['/repos/example/project/collaborators/maintainer/permission'] = { permission: 'admin', user: { id: 10 } };
  assert.equal((await s.run()).pipeline.status, 'human_review_required', 'authorship alone is insufficient');
  s.f.data['/repos/example/project'].owner = { id: 10, type: 'User' };
  const result = await s.run();
  assert.equal(result.pipeline.status, 'ready'); assert.equal(result.humanReview.receipts[0].selfReview, true);
  assert.equal(result.humanReview.receipts[0].state, 'COMMENTED'); assert.equal(result.authority.mergeAuthorized, false);
  s.f.data['/repos/example/project'].owner.type = 'Organization';
  assert.equal((await s.run()).pipeline.status, 'human_review_required');
});
test('private sessions import job receipts, survive restart, avoid repeated model runs and invalidate new identity', async () => {
  const s = await started(), directory = mkdtempSync(join(tmpdir(), 'changeplane-session-'));
  try {
    const first = await followPipeline(s.f.options, { directory });
    assert.equal(first.session.resumed, false); assert.equal(existsSync(first.session.requestPath), true);
    writeFileSync(first.session.resultPath, JSON.stringify({ requestId: s.requestId, review: s.review }));
    const resumed = await followPipeline(s.f.options, { directory });
    assert.equal(resumed.pipeline.status, 'ready'); assert.equal(resumed.session.resumed, true);
    const retained = await followPipeline({ ...s.f.options, runReview: true }, { directory, runReview: () => assert.fail('must reuse the current receipt') });
    assert.equal(retained.pipeline.status, 'ready');
    s.f.pr.id++;
    const changed = await followPipeline(s.f.options, { directory });
    assert.equal(changed.review.status, 'required'); assert.equal(changed.session.invalidated, true);
    assert.notEqual(changed.session.resultPath, first.session.resultPath);
    assert.equal(JSON.parse(readFileSync(changed.session.requestPath)).id, changed.reviewRequest.id);
    mkdirSync(join(directory, changed.session.id, 'lock'));
    await assert.rejects(followPipeline(s.f.options, { directory }), { code: 'SESSION_BUSY' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('session accepts a bounded runner receipt, survives reader outage and rejects unsafe paths', async () => {
  const s = await started(), directory = mkdtempSync(join(tmpdir(), 'changeplane-session-'));
  try {
    let calls = 0, inspections = 0;
    await assert.rejects(followPipeline({ ...s.f.options, runReview: true }, { directory,
      inspect: async options => { if (++inspections === 2) throw new Error('reader offline'); return inspectPipeline(options); },
      runReview: async () => { calls++; return s.review; },
    }));
    const resumed = await followPipeline({ ...s.f.options, runReview: true }, { directory,
      runReview: async () => { calls++; return s.review; } });
    assert.equal(calls, 1); assert.equal(resumed.pipeline.status, 'ready');
    const state = join(directory, resumed.session.id, 'state.json'), outside = join(directory, 'outside');
    writeFileSync(outside, 'preserve'); rmSync(state); symlinkSync(outside, state);
    await assert.rejects(followPipeline(s.f.options, { directory }), { code: 'SESSION_UNAVAILABLE' });
    assert.equal(readFileSync(outside, 'utf8'), 'preserve');
    await assert.rejects(callAssessmentTool('changeplane_follow', { pullRequest: 7 }, { CHANGEPLANE_REPOSITORY: 'example/project' }, { read: s.f.read }), { code: 'INPUT_INVALID' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
