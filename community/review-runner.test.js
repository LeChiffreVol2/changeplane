import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareReviewSource, configuredReviewRunner } from './review-runner.js';

test('review preparation preserves exact revisions while excluding credentials, unrelated blobs, rules and hooks', () => {
  const root = mkdtempSync(join(tmpdir(), 'changeplane-source-')), source = join(root, 'source'), isolated = join(root, 'isolated');
  mkdirSync(source);
  const git = (cwd, args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git(source, ['init', '-q']);
    writeFileSync(join(source, 'selected.js'), 'export const value = 1;\n');
    writeFileSync(join(source, 'unrelated.txt'), 'private unrelated content');
    mkdirSync(join(source, '.opencodereview')); writeFileSync(join(source, '.opencodereview', 'rule.json'), '{"untrusted":"rule"}');
    git(source, ['add', '.']); git(source, ['commit', '-q', '-m', 'Base']); const base = git(source, ['rev-parse', 'HEAD']);
    const unrelated = git(source, ['rev-parse', 'HEAD:unrelated.txt']);
    writeFileSync(join(source, 'selected.js'), 'export const value = 2;\n');
    git(source, ['add', '.']); git(source, ['commit', '-q', '-m', 'Change']); const head = git(source, ['rev-parse', 'HEAD']);
    git(source, ['config', 'remote.origin.url', 'https://private-token@example.test/repo.git']);
    const request = { binding: { headSha: head, mergeBase: base, policyRevision: base, files: [{ path: 'selected.js' }, { path: '.opencodereview/rule.json' }] } };
    prepareReviewSource(source, isolated, request);
    assert.equal(git(isolated, ['rev-parse', 'HEAD']), base);
    assert.equal(git(isolated, ['merge-base', base, head]), base);
    assert.ok(git(isolated, ['diff', base, head]).includes('export const value = 2'));
    assert.equal(readFileSync(join(isolated, 'selected.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(existsSync(join(isolated, 'unrelated.txt')), false);
    assert.equal(existsSync(join(isolated, '.opencodereview')), false);
    assert.throws(() => git(isolated, ['cat-file', 'blob', unrelated]));
    assert.equal(git(isolated, ['remote']), '');
    assert.equal(existsSync(join(isolated, '.git', 'hooks')), false);
    assert.throws(() => prepareReviewSource(source, join(root, 'unsafe'), { binding: { ...request.binding, files: [{ path: '.git/config' }] } }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('model runner rejects missing enablement, credentials, mutable images and unsupported models before Docker access', async () => {
  for (const env of [{}, { CHANGEPLANE_REVIEW_IMAGE: 'latest' },
    { CHANGEPLANE_REVIEW_IMAGE: 'sha256:' + 'a'.repeat(64), CHANGEPLANE_REVIEW_REPOSITORY: '/repo', OPENAI_API_KEY: 'synthetic-test-key', CHANGEPLANE_REVIEW_MODEL: 'other' }]) {
    await assert.rejects(configuredReviewRunner(env)({}), { code: 'REVIEW_RUNNER_UNAVAILABLE' });
  }
});
