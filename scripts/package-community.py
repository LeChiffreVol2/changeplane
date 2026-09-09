#!/usr/bin/env python3
"""Build an allowlisted, dependency-free release from an exact committed tree."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile

revision, destination = sys.argv[1:]
if not re.fullmatch(r'[a-f0-9]{40}', revision):
    raise SystemExit('Supply a full committed SHA and an output directory.')
subprocess.run(['git', 'cat-file', '-e', revision + '^{commit}'], check=True)
output = Path(destination)
output.mkdir(parents=True, exist_ok=True)

def source(name):
    return subprocess.check_output(['git', 'show', revision + ':' + name])

version_match = re.search(rb"COMMUNITY_VERSION = '([^']+)'", source('community/core.js'))
version = version_match.group(1).decode()
prefix = 'changeplane-community-' + version
paths = [
    'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md',
    'community/core.js', 'community/github.js', 'community/cli.js',
    'community/action.js', 'community/action.yml', 'community/core.test.js',
    'src/lib/changeplane.js', 'src/lib/harness.js', 'examples/changeplane-evidence-policy.js',
    'examples/community/satisfied.json', 'examples/community/failed.json',
    'examples/community/stale.json', 'examples/community/policy.json',
]
files = {name: source(name) for name in paths}
files['package.json'] = (json.dumps({'name': 'changeplane-community', 'version': version,
    'type': 'module', 'private': True, 'license': 'Apache-2.0', 'engines': {'node': '>=22.18'}}, indent=2) + '\n').encode()
files['README.md'] = f'''# ChangePlane Open Source {version}

Keep GitHub. Let agents ship.

Apache-2.0. Node.js 22.18+; no npm dependencies, model key or hosted account.
Source commit: `{revision}`

```sh
node community/cli.js evaluate examples/community/satisfied.json
node community/cli.js evaluate examples/community/failed.json
node community/cli.js evaluate examples/community/stale.json
node --test community/core.test.js
```

Expected exits: 0, 1, 1. Invalid input exits 2. Assessments are advisory;
they do not publish a Guard, authorize repair or approve a merge.
After merging a reviewed default-branch policy, inspect your own open PR:

```sh
node community/cli.js inspect YOUR_ACCOUNT/YOUR_REPOSITORY 123
```

Use GH_TOKEN or GITHUB_TOKEN via your environment for private GitHub read access.
Never put tokens on the command line. Offline mode has no network access;
live mode contacts only GitHub through bounded GET requests.

[Setup, limits and uninstall](https://github.com/LeChiffreVol2/changeplane/blob/{revision}/docs/community.md)
[Security](https://github.com/LeChiffreVol2/changeplane/security/advisories/new)
'''.encode()
files['SOURCE.json'] = (json.dumps({'repository': 'LeChiffreVol2/changeplane', 'commit': revision,
    'communityVersion': version, 'files': {name: hashlib.sha256(body).hexdigest() for name, body in files.items()}}, indent=2) + '\n').encode()
raw = io.BytesIO()
with tarfile.open(fileobj=raw, mode='w', format=tarfile.USTAR_FORMAT) as archive:
    for name, body in sorted(files.items()):
        entry = tarfile.TarInfo(prefix + '/' + name)
        entry.size = len(body)
        entry.mode = 0o644
        entry.mtime = 0
        archive.addfile(entry, io.BytesIO(body))
bundle = output / (prefix + '.tar.gz')
bundle.write_bytes(gzip.compress(raw.getvalue(), mtime=0))
workflow = output / 'changeplane-community.yml'
template = source('examples/changeplane-community.yml').decode()
template = re.sub(r'(?<=changeplane/community@)(?:COMMUNITY_RELEASE_SHA|[a-f0-9]{40})', revision, template)
workflow.write_text(template)
manifest = output / 'SHA256SUMS'
manifest.write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n' for path in [bundle, workflow]))
print(json.dumps({'source': revision, 'version': version, 'assets': [str(bundle), str(workflow), str(manifest)]}))
