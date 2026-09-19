import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubEvidenceReader } from './github-evidence.js';
import { validateRequiredChecks } from '../src/lib/harness.js';

const head = 'a'.repeat(40);
const workflow = '.github/workflows/ci.yml';
function fixture(repository = 'example/repo') {
  const checks = ['Behavior', 'Integration'].map((name, index) => ({
    id: index + 1, name, head_sha: head, status: 'completed', conclusion: 'success',
    started_at: '2026-09-20T00:00:00.000Z', completed_at: '2026-09-20T00:01:00.000Z',
    app: { id: 15368, slug: 'github-actions' },
    details_url: `https://github.com/${repository}/actions/runs/12/job/${index + 1}`,
  }));
  const state = { checks, listed: checks, run: { id: 12, head_sha: head, path: workflow }, runError: null };
  const passport = { target: { repository, headSha: head }, evidence: checks.map(check => ({
    checkRunId: check.id, checkName: check.name, headSha: head,
    status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: check.completed_at,
    publisherAppId: check.app.id, actualPublisher: check.app.slug, expectedPublisher: check.app.slug,
  })) };
  const required = checks.map(check => ({ name: check.name, appSlug: check.app.slug, workflowPath: workflow }));
  const calls = [];
  const reader = createGitHubEvidenceReader({ repository, request: async path => {
    calls.push(path);
    assert.ok(path.startsWith(`/repos/${repository}/`), 'requests must retain their configured repository');
    const url = new URL(path, 'https://api.github.com');
    if (url.pathname.endsWith('/actions/runs/12')) {
      if (state.runError) throw state.runError;
      return structuredClone(state.run);
    }
    if (url.pathname.endsWith(`/commits/${head}/check-runs`)) {
      const name = url.searchParams.get('check_name');
      return { check_runs: structuredClone(state.listed.filter(check => !name || check.name === name)) };
    }
    const check = state.checks.find(check => url.pathname.endsWith(`/check-runs/${check.id}`));
    if (check) return structuredClone(check);
    throw new Error('Unexpected synthetic evidence read');
  } });
  return { reader, state, passport, required, calls };
}

test('a valid trusted workflow filename containing @ must not silently lose its provenance requirement', async () => {
  const f = fixture();
  f.required[0].workflowPath = '.github/workflows/build@night.yml';
  validateRequiredChecks(f.required, { mode: 'enforce' });
  const observations = await f.reader.freshness(f.passport, f.required);
  assert.equal(observations[0].current, false, 'an observed ci.yml run cannot satisfy the distinct trusted filename');
  assert.equal(observations[1].current, true);
});

test('workflow reads share one operation cache and re-read on the next operation', async () => {
  const f = fixture();
  const runReads = () => f.calls.filter(path => path.endsWith('/actions/runs/12')).length;
  assert.ok((await f.reader.freshness(f.passport, f.required)).every(item => item.current));
  assert.equal(runReads(), 1, 'two Checks and their recorded/latest observations share the same run read');
  f.state.run.path = '.github/workflows/other.yml';
  assert.ok((await f.reader.freshness(f.passport, f.required)).every(item => !item.current));
  assert.equal(runReads(), 2, 'the previous operation must not conceal changed workflow evidence');
});

test('readers with separate credentials do not share cached evidence and reject a foreign passport before reads', async () => {
  const allowed = fixture(), changed = fixture();
  changed.state.run.path = '.github/workflows/other.yml';
  const [first, second] = await Promise.all([
    allowed.reader.freshness(allowed.passport, allowed.required),
    changed.reader.freshness(changed.passport, changed.required),
  ]);
  assert.ok(first.every(item => item.current));
  assert.ok(second.every(item => !item.current));
  assert.equal(allowed.calls.filter(path => path.includes('/actions/runs/')).length, 1);
  assert.equal(changed.calls.filter(path => path.includes('/actions/runs/')).length, 1);
  const foreign = fixture('other/repo');
  await assert.rejects(foreign.reader.freshness(allowed.passport, allowed.required), /repository mismatch/);
  assert.deepEqual(foreign.calls, []);
});

test('repository casing in evidence does not change the configured read scope', async () => {
  const f = fixture('Example/Repo');
  f.passport.target.repository = 'example/repo';
  f.state.checks.forEach(check => { check.details_url = check.details_url.replace('Example/Repo', 'example/repo'); });
  assert.ok((await f.reader.freshness(f.passport, f.required)).every(item => item.current));
  assert.ok(f.calls.every(path => path.startsWith('/repos/Example/Repo/')));
  assert.equal(f.calls.filter(path => path.includes('/actions/runs/')).length, 1);
});

test('a newer pending eligible Check supersedes the recorded success while foreign-head Checks do not', async () => {
  const f = fixture();
  const newer = { ...f.state.checks[0], id: 99, status: 'queued', conclusion: null,
    started_at: '2026-09-20T00:02:00.000Z', completed_at: null };
  f.state.listed = [newer, ...f.state.checks];
  let observations = await f.reader.freshness(f.passport, f.required);
  assert.equal(observations[0].latest.id, 99);
  assert.equal(observations[0].current, false);
  assert.equal(observations[1].current, true);
  newer.head_sha = 'b'.repeat(40);
  observations = await f.reader.freshness(f.passport, f.required);
  assert.equal(observations[0].latest.id, 1);
  assert.equal(observations[0].current, true);
});

test('malformed or foreign run URLs cannot cause workflow fetches or satisfy provenance', async () => {
  for (const url of [
    'https://github.com.evil.invalid/example/repo/actions/runs/12',
    'https://user:private@github.com/example/repo/actions/runs/12',
    'https://github.com/other/repo/actions/runs/12',
    'https://github.com/example/repo/actions/runs/12?token=private',
    'https://github.com/example/repo/actions/runs/12#fragment',
    'http://github.com/example/repo/actions/runs/12',
    'https://github.com:8443/example/repo/actions/runs/12',
    'https://github.com/example/repo/actions/runs/0',
  ]) {
    const f = fixture();
    f.state.checks.forEach(check => { check.details_url = url; });
    assert.ok((await f.reader.freshness(f.passport, f.required)).every(item => !item.current), url);
    assert.equal(f.calls.some(path => path.includes('/actions/runs/')), false, url);
  }
});

test('missing run evidence blocks freshness and remains an error for setup discovery and repair', async () => {
  const f = fixture();
  f.state.runError = Object.assign(new Error('Synthetic missing run'), { status: 404 });
  assert.ok((await f.reader.freshness(f.passport, f.required)).every(item => !item.current));
  await assert.rejects(f.reader.workflows(f.state.checks), { status: 404 });
  await assert.rejects(f.reader.forRepair(head, f.required), { status: 404 });
});
