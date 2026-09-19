import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildSetupFiles, managedVersionSnapshot, classifyManagedInstallationDigests } from '../api/github.js';

for (const mode of ['observe', 'verify', 'autonomous']) test(`generated ${mode} installation imports every shipped module without running a job`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'changeplane-managed-imports-'));
  try {
    const files = buildSetupFiles({ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }, mode);
    for (const file of files) {
      const destination = join(directory, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
    }
    const manifest = JSON.parse(files.find(file => file.path === 'changeplane/manifest.json').content);
    assert.equal(manifest.managedVersion, 17);
    const current = classifyManagedInstallationDigests({
      manifest: files.find(file => file.path === 'changeplane/manifest.json').content,
      digests: manifest.managedFiles,
      policyPresent: true,
      reservedEntries: Object.keys(manifest.managedFiles),
    });
    assert.equal(current.state, 'current');
    assert.equal(current.currentVersion, 17);
    assert.ok(manifest.managedFiles['changeplane/src/lib/assurance-passport.js']);
    assert.ok(manifest.managedFiles['changeplane/src/lib/recovery.js']);
    if (mode === 'autonomous') {
      for (const entry of ['claim', 'grant', 'proposal', 'review-run']) {
        assert.ok(manifest.managedFiles[`changeplane/examples/changeplane-${entry}.js`]);
      }
      assert.ok(manifest.managedFiles['changeplane/examples/changeplane-openai-response.js']);
      assert.ok(manifest.managedFiles['changeplane/server/github-evidence.js']);
    }
    const imports = files.filter(file => file.path.endsWith('.js'))
      .map(file => pathToFileURL(join(directory, file.path)).href);
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      globalThis.fetch = () => { throw new Error('Module import attempted network access'); };
      for (const entry of ${JSON.stringify(imports)}) await import(entry);
    `], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
      // Deliberately omit all credentials and provide an unreadable event. Direct-entry
      // guards must prevent jobs from running even inside a GitHub Actions environment.
      env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: join(directory, 'must-not-be-read.json') },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, '');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const version of [15, 16]) test(`v${version} manifests remain recognized as an upgradeable immutable release`, () => {
  for (const profile of ['full', 'verify-lite']) {
    const previous = managedVersionSnapshot(version, profile), current = managedVersionSnapshot(17, profile);
    assert.ok(previous);
    assert.ok(current);
    assert.equal(Object.hasOwn(previous.managedHashes, 'changeplane/src/lib/assurance-passport.js'), false);
    assert.notEqual(previous.managedHashes['changeplane/action/index.js'], current.managedHashes['changeplane/action/index.js']);
    if (version === 15) {
      assert.equal(Object.hasOwn(previous.managedHashes, 'changeplane/src/lib/recovery.js'), false);
    } else {
      assert.equal(previous.managedHashes['changeplane/action/index.js'],
        '385e055c20f0d8584fbd3c24cb32f52e17fc208fe51f8c5097edcde1dd09fc3a');
    }
    const result = classifyManagedInstallationDigests({ manifest: previous.manifest, digests: previous.managedHashes,
      policyPresent: true, reservedEntries: Object.keys(previous.managedHashes) });
    assert.equal(result.state, 'outdated');
    assert.equal(result.currentVersion, version);
    assert.equal(result.targetVersion, 17);
  }
});
