import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { install } from '../bin/install.mjs';

test('installer pins successful main CI without npm, remotes, hooks or inherited Git settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'changeplane-install-test-')), source = join(root, 'source'); mkdirSync(source);
  const git = args => execFileSync('git', ['-C', source, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args], { encoding: 'utf8' }).trim();
  try {
    git(['init', '-q']);
    for (const path of ['bin/changeplane.js', 'community/pipeline.js', 'community/session.js', 'community/review-decisions.js', 'skills/changeplane/SKILL.md']) {
      mkdirSync(dirname(join(source, path)), { recursive: true }); writeFileSync(join(source, path), 'synthetic fixture\n');
    }
    git(['add', '.']); git(['commit', '-q', '-m', 'Fixture']); const revision = git(['rev-parse', 'HEAD']);
    const run = { id: 10, run_attempt: 1, head_sha: revision, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success',
      path: '.github/workflows/ci.yml', repository: { full_name: 'LeChiffreVol2/changeplane' }, head_repository: { full_name: 'LeChiffreVol2/changeplane' } };
    const options = { source, readMetadata: async path => path.includes('?') ? { workflow_runs: [run] } : run,
      executeGit: (command, args, options) => {
        assert.equal(options.env.GH_TOKEN, undefined); assert.equal(options.env.GIT_DIR, undefined);
        // Test-local transport only. The public CLI never permits file fetches.
        return execFileSync(command, args.map(arg => arg === 'protocol.file.allow=never' ? 'protocol.file.allow=always' : arg), options);
      } };
    const destination = join(root, 'installed'), result = await install(destination, options);
    assert.equal(result.sourceRevision, revision);
    assert.equal(execFileSync('git', ['-C', destination, 'remote'], { encoding: 'utf8' }), '');
    assert.equal(execFileSync('git', ['-C', destination, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), revision);
    await assert.rejects(install(destination, options));
    assert.equal(readFileSync(join(destination, 'bin/changeplane.js'), 'utf8'), 'synthetic fixture\n');
    const failed = join(root, 'failed');
    await assert.rejects(install(failed, { ...options, readMetadata: async path => path.includes('?') ? { workflow_runs: [run] } : { ...run, conclusion: 'failure' } }));
    assert.equal(existsSync(failed), false);
    await assert.rejects(install(join(root, 'fork'), { ...options, readMetadata: async () => ({ workflow_runs: [{ ...run, event: 'pull_request' }] }) }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
