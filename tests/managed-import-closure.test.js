import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildSetupFiles, managedVersionSnapshot, classifyManagedInstallationDigests } from '../api/github.js';

for (const mode of ['observe', 'verify', 'autonomous']) test(`generated ${mode} installation loads its vendored evaluator without the source checkout`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'changeplane-managed-imports-'));
  try {
    const files = buildSetupFiles({ name: 'Behavior', appSlug: 'github-actions', workflowPath: '.github/workflows/ci.yml' }, mode);
    for (const file of files) {
      const destination = join(directory, file.path); mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, file.content);
    }
    const entry = pathToFileURL(join(directory, 'changeplane/action/index.js')).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(entry)});`],
      { cwd: directory, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const manifest = JSON.parse(files.find(file => file.path === 'changeplane/manifest.json').content);
    assert.equal(manifest.managedVersion, 16);
    assert.ok(manifest.managedFiles['changeplane/src/lib/recovery.js']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('v15 manifests remain recognized as an upgradeable immutable release', () => {
  for (const profile of ['full', 'verify-lite']) {
    const previous = managedVersionSnapshot(15, profile), current = managedVersionSnapshot(16, profile);
    assert.ok(previous);
    assert.equal(Object.hasOwn(previous.managedHashes, 'changeplane/src/lib/recovery.js'), false);
    assert.notEqual(previous.managedHashes['changeplane/src/lib/changeplane.js'], current.managedHashes['changeplane/src/lib/changeplane.js']);
    const result = classifyManagedInstallationDigests({ manifest: previous.manifest, digests: previous.managedHashes,
      policyPresent: true, reservedEntries: Object.keys(previous.managedHashes) });
    assert.equal(result.state, 'outdated');
    assert.equal(result.currentVersion, 15);
    assert.equal(result.targetVersion, 16);
  }
});
