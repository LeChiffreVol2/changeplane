#!/usr/bin/env python3
"""Verify release bytes and run the shipped tests outside the source checkout."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile

assets, destination = map(Path, sys.argv[1:])
assert not destination.exists(), 'Use a new scratch directory.'
for line in (assets / 'SHA256SUMS').read_text().splitlines():
    digest, name = line.split()
    assert Path(name).name == name
    assert hashlib.sha256((assets / name).read_bytes()).hexdigest() == digest, 'Asset checksum mismatch.'
archives = list(assets.glob('changeplane-community-*.tar.gz'))
assert len(archives) == 1
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
expected = set(manifest['files']) | {'SOURCE.json'}
actual = {path.relative_to(root).as_posix() for path in root.rglob('*') if path.is_file()}
assert actual == expected, 'Archive file inventory differs from SOURCE.json.'
for name, digest in manifest['files'].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, 'Source checksum mismatch.'
package = json.loads((root / 'package.json').read_text())
assert not package.get('dependencies') and not package.get('devDependencies')
for document in root.rglob('*.md'):
    for target in re.findall(r'\]\(([^)]+)\)', document.read_text(encoding='utf-8')):
        if '://' not in target and not target.startswith('#'):
            assert (document.parent / target.split('#')[0]).exists(), 'Broken local documentation link.'
tests = sorted(str(path.relative_to(root)) for path in (root / 'community').glob('*.test.js'))
assert tests
subprocess.run(['node', '--test', *tests], cwd=root, check=True)
print('Release checksums, inventory, documentation links and isolated tests passed.')
