#!/usr/bin/env python3
"""Verify release bytes and run the shipped tests outside the source checkout."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import os
import shutil
import subprocess
import sys
import tarfile

assets, destination = map(Path, sys.argv[1:])
assert not destination.exists(), 'Use a new scratch directory.'
names = set()
for line in (assets / 'SHA256SUMS').read_text().splitlines():
    digest, name = line.split()
    assert Path(name).name == name and name not in names and re.fullmatch(r'[a-f0-9]{64}', digest)
    names.add(name)
    assert hashlib.sha256((assets / name).read_bytes()).hexdigest() == digest, 'Asset checksum mismatch.'
archives = list(assets.glob('changeplane-community-*.tar.gz'))
assert len(archives) == 1
assert names == {archives[0].name, 'changeplane-community.yml', 'changeplane-team.yml', 'changeplane-team-review-signal.yml'}
assert {path.name for path in assets.iterdir()} == names | {'SHA256SUMS'}, 'Unexpected release asset.'
with tarfile.open(archives[0]) as archive:
    members = archive.getmembers()
    assert len({item.name for item in members}) == len(members), 'Duplicate archive member.'
    for item in members:
        path = PurePosixPath(item.name)
        assert item.isfile() and not path.is_absolute() and '..' not in path.parts
    archive.extractall(destination, filter='data')
roots = list(destination.iterdir())
assert len(roots) == 1 and roots[0].is_dir()
root = roots[0]
manifest = json.loads((root / 'SOURCE.json').read_text())
assert manifest['repository'] == 'LeChiffreVol2/changeplane' and re.fullmatch(r'[a-f0-9]{40}', manifest['commit'])
assert root.name == 'changeplane-community-' + manifest['communityVersion']
assert 'changeplane/community@' + manifest['commit'] in (assets / 'changeplane-community.yml').read_text()
assert 'ref: ' + manifest['commit'] in (assets / 'changeplane-team.yml').read_text()
expected = set(manifest['files']) | {'SOURCE.json'}
actual = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file()}
assert actual == expected, 'Archive file inventory differs from SOURCE.json.'
for name, digest in manifest['files'].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, 'Source checksum mismatch.'
package = json.loads((root / 'package.json').read_text())
assert not package.get('dependencies') and not package.get('devDependencies')
assert package.get('bin') == {'changeplane': 'bin/changeplane.js'}
assert not package.get('scripts'), 'Consumer installation must not execute lifecycle scripts.'
# Test the actual local-package installation without a registry or web-app dependencies.
prefix = destination / 'command-prefix'
npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
assert npm, 'npm bundled with the tested Node runtime is required for installation verification.'
subprocess.run([npm, 'install', '--global', '--prefix', str(prefix), '--offline', '--ignore-scripts',
                '--no-audit', '--no-fund', str(root.resolve())], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
               env={**os.environ, 'npm_config_cache': str(destination / 'npm-cache')})
command = prefix / ('changeplane.cmd' if os.name == 'nt' else 'bin/changeplane')
result = subprocess.run([str(command.absolute()), 'evaluate', str((root / 'examples/community/satisfied.json').resolve())],
                        cwd=destination, check=True, capture_output=True, text=True)
assert json.loads(result.stdout)['decision'] == 'EVIDENCE_SATISFIED'
assert json.loads(result.stdout)['authority']['guardPublished'] is False
# The immutable runtime pin must work from an extracted bundle, without .git.
result = subprocess.run(['node', '--input-type=module', '-e',
                         "import { setupRuntime } from './community/setup.js'; console.log(setupRuntime().revision);"],
                        cwd=root, check=True, capture_output=True, text=True)
assert result.stdout.strip() == manifest['commit']

for document in root.rglob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)', document.read_text(encoding='utf-8')):
        if '://' not in target and not target.startswith('#'):
            assert (document.parent / target.split('#')[0]).exists(), 'Broken local documentation link.'
tests = sorted(str(path.relative_to(root)) for path in (root / 'community').glob('*.test.js'))
assert tests
subprocess.run(['node', '--test', *tests], cwd=root, check=True)
print('Release checksums, inventory, documentation links and isolated tests passed.')
