#!/usr/bin/env python3
"""Build an allowlisted, dependency-free release from an exact committed tree."""
import gzip
import hashlib
import io
import json
import posixpath
from urllib.parse import quote
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
    'bin/changeplane.js', 'community/README.md', 'docs/README.md', 'docs/community.md',
    'skills/changeplane/SKILL.md',
    'community/setup.js', 'community/setup.test.js', 'community/output.js',
    'community/mcp.js', 'community/mcp-transport.js', 'community/entrypoints.test.js',
    'community/core.js', 'community/github.js', 'community/cli.js',
    'community/action.js', 'community/action.yml', 'community/core.test.js',
    'community/gitlab.js', 'community/gitlab.test.js', 'community/observation.js', 'community/observation.test.js',
    'community/transport.js', 'community/transport.test.js', 'community/action-output.test.js',
    'community/team.js', 'community/team.test.js', 'community/team-github.js', 'community/team-github.test.js',
    'community/team-feedback.js', 'community/team-doctor.js', 'community/team-budget.test.js', 'community/team-lifecycle.test.js',
    'community/team-cli.test.js', 'community/team-doctor.test.js', 'community/team-regression-review.test.js',
    'community/team-worktree.js', 'community/team-cli.js', 'community/team-mcp.js', 'community/team-mcp.test.js',
    'community/fixtures/observation.json', 'community/fixtures/recovery-cases.json',
    'src/lib/changeplane.js', 'src/lib/recovery.js', 'src/lib/harness.js', 'examples/changeplane-evidence-policy.js',
    'examples/community/satisfied.json', 'examples/community/failed.json',
    'examples/community/stale.json', 'examples/community/policy.json',
    'examples/community/gitlab-policy.json',
    'docs/team-operator.md', 'docs/repository-team.md', 'docs/repository-team-qualification.md',
    'examples/changeplane-team-review-signal.yml', 'examples/changeplane-team.yml', 'examples/changeplane-team-agent.md',
    'examples/changeplane-community.yml',
]
files = {name: source(name) for name in paths}
files['examples/changeplane-team.yml'] = files['examples/changeplane-team.yml'].replace(b'CHANGEPLANE_TEAM_RELEASE_SHA', revision.encode())
files['package.json'] = (json.dumps({'name': 'changeplane-community', 'version': version,
    'type': 'module', 'private': True, 'bin': {'changeplane': 'bin/changeplane.js'},
    'license': 'Apache-2.0', 'engines': {'node': '>=22.18'}}, indent=2) + '\n').encode()
files['README.md'] = f'''# ChangePlane Open Source {version}

Keep GitHub. Let agents ship.

Apache-2.0. Node.js 22.18+; no npm dependencies, model key or hosted account.
Source commit: `{revision}`

## Try it in one minute

```sh
node bin/changeplane.js evaluate examples/community/satisfied.json
node bin/changeplane.js evaluate examples/community/failed.json
node bin/changeplane.js evaluate examples/community/stale.json
node --test community/*.test.js
```

Use [setup, local command installation and read-only MCP](docs/community.md),
the [public runtime map](community/README.md), and the [consumer skill](skills/changeplane/SKILL.md).
The root source Action is the managed Guard; use the public `/community` Action subpath.

Expected exits: 0, 1, 1. Invalid input exits 2. Assessments are advisory;
they do not publish a Guard, authorize repair or approve a merge.
After merging a reviewed default-branch policy, inspect your own open PR:

```sh
node bin/changeplane.js inspect YOUR_ACCOUNT/YOUR_REPOSITORY 123
```

Use GH_TOKEN or GITHUB_TOKEN via your environment for private GitHub read access.
Never put tokens on the command line. Offline mode has no network access;
live readers use bounded fixed-origin GET requests. The GitLab reader candidate uses
`inspect-gitlab GROUP/PROJECT MR_NUMBER` and `GITLAB_TOKEN`; it does not claim verified
tested subjects, CI include closure, merge enforcement or live installation qualification.

[Individual PR assessment and settings](https://github.com/LeChiffreVol2/changeplane/blob/{revision}/docs/community.md)\n\n[Parallel setup for yourself or a team](docs/team-operator.md)\n\n[Setup, limits and uninstall](https://github.com/LeChiffreVol2/changeplane/blob/{revision}/docs/community.md)
[Security](https://github.com/LeChiffreVol2/changeplane/security/advisories/new)
'''.encode()
# Keep bundled operating guides usable offline; link unbundled reference material
# to the same source commit, never mutable main or a missing relative file.
for name, body in list(files.items()):
    if not name.endswith('.md'):
        continue
    def document_link(match):
        target = match.group(1)
        if '://' in target or target.startswith('#'):
            return match.group(0)
        path, separator, anchor = target.partition('#')
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), path))
        if resolved in files:
            return match.group(0)
        return '](' + f'https://github.com/LeChiffreVol2/changeplane/blob/{revision}/' + quote(resolved) + (separator + anchor if separator else '') + ')'
    text = body.decode().replace('https://github.com/LeChiffreVol2/changeplane/blob/main/',
                                 f'https://github.com/LeChiffreVol2/changeplane/blob/{revision}/')
    files[name] = re.sub(r'\]\(([^)]+)\)', document_link, text).encode()
files['SOURCE.json'] = (json.dumps({'repository': 'LeChiffreVol2/changeplane', 'commit': revision,
    'communityVersion': version, 'files': {name: hashlib.sha256(body).hexdigest() for name, body in files.items()}}, indent=2) + '\n').encode()
raw = io.BytesIO()
with tarfile.open(fileobj=raw, mode='w', format=tarfile.USTAR_FORMAT) as archive:
    for name, body in sorted(files.items()):
        entry = tarfile.TarInfo(prefix + '/' + name)
        entry.size = len(body)
        entry.mode = 0o755 if name == 'bin/changeplane.js' else 0o644
        entry.mtime = 0
        archive.addfile(entry, io.BytesIO(body))
bundle = output / (prefix + '.tar.gz')
bundle.write_bytes(gzip.compress(raw.getvalue(), mtime=0))
workflow = output / 'changeplane-community.yml'
template = source('examples/changeplane-community.yml').decode()
template = re.sub(r'(?<=changeplane/community@)(?:COMMUNITY_RELEASE_SHA|[a-f0-9]{40})', revision, template)
workflow.write_bytes(template.encode('utf-8'))
team_workflow = output / 'changeplane-team.yml'
team_workflow.write_bytes(source('examples/changeplane-team.yml').replace(b'CHANGEPLANE_TEAM_RELEASE_SHA', revision.encode()))
review_workflow = output / 'changeplane-team-review-signal.yml'
review_workflow.write_bytes(source('examples/changeplane-team-review-signal.yml'))
manifest = output / 'SHA256SUMS'
manifest.write_bytes(''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n' for path in [bundle, workflow, team_workflow, review_workflow]).encode())
print(json.dumps({'source': revision, 'version': version, 'assets': [str(bundle), str(workflow), str(team_workflow), str(review_workflow), str(manifest)]}))
