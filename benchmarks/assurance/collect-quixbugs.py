#!/usr/bin/env python3
"""Execute the pinned, unmodified upstream tests. No network or model calls by this runner."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

PIN = '4257f44b0ff1181dedaedee6a447e133219fcebf'
SOURCE = 'https://github.com/jkoppel/QuixBugs'

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def collect(root, output):
    if output.exists():
        raise SystemExit('Use a new output path; recorded experiments are not overwritten.')
    if git(root, 'rev-parse', 'HEAD') != PIN or git(root, 'status', '--porcelain', '--untracked-files=all'):
        raise SystemExit('Use a clean checkout of the documented QuixBugs commit.')
    tests = sorted(path for path in git(root, 'ls-files', 'python_testcases/test_*.py').splitlines())
    if len(tests) != 40:
        raise SystemExit('Expected all 40 upstream Python program suites.')
    # Do not inherit credentials, project settings, third-party pytest plugins or user PYTHONPATH.
    environment = {key: os.environ[key] for key in ['PATH', 'SYSTEMROOT', 'WINDIR'] if key in os.environ}
    environment.update(PYTEST_DISABLE_PLUGIN_AUTOLOAD='1', PYTHONDONTWRITEBYTECODE='1',
                       PYTHONHASHSEED='0', TZ='UTC', LANG='C.UTF-8')
    rows = []
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='changeplane-quixbugs-') as scratch:
        for test_file in tests:
            program = Path(test_file).stem.removeprefix('test_')
            for variant in ['buggy', 'reference']:
                junit = Path(scratch) / f'{program}-{variant}.xml'
                command = [sys.executable, '-m', 'pytest', '-p', 'pytest_timeout', '-p', 'no:cacheprovider',
                           '--timeout=2', '--timeout-method=signal', '--junitxml=' + str(junit),
                           '-q', '--tb=no', test_file] + (['--correct'] if variant == 'reference' else [])
                before = time.monotonic()
                try:
                    completed = subprocess.run(command, cwd=root, env=environment, capture_output=True, timeout=60)
                    exit_code = completed.returncode
                except subprocess.TimeoutExpired:
                    exit_code = None
                cases = []
                if junit.exists():
                    for case in ET.parse(junit).getroot().iter('testcase'):
                        failure, error, skipped = case.find('failure'), case.find('error'), case.find('skipped')
                        outcome = 'error' if error is not None else 'skipped' if skipped is not None else 'passed'
                        if failure is not None:
                            outcome = 'timeout' if 'Timeout >' in (failure.get('message', '') + (failure.text or '')) else 'failed'
                        cases.append({'name': case.get('name'), 'outcome': outcome})
                counts = {name: sum(case['outcome'] == name for case in cases)
                          for name in ['passed', 'failed', 'timeout', 'error', 'skipped']}
                if exit_code is None:
                    outcome = 'timed_out'
                elif exit_code not in [0, 1] or not cases or counts['error']:
                    outcome = 'unavailable'
                elif counts['timeout']:
                    outcome = 'timed_out'
                elif exit_code == 1 or counts['failed']:
                    outcome = 'failure'
                elif counts['passed']:
                    outcome = 'success'
                else:
                    outcome = 'unavailable'
                program_file = ('correct_python_programs' if variant == 'reference' else 'python_programs') + f'/{program}.py'
                rows.append({'program': program, 'variant': variant, 'sourceSha256': sha(root / program_file),
                             'testSha256': sha(root / test_file), 'outcome': outcome, 'exitCode': exit_code,
                             'seconds': round(time.monotonic() - before, 6), 'counts': counts, 'tests': cases})
                print(f'{program}/{variant}: {outcome} {counts}', flush=True)
    if git(root, 'diff', '--name-only', 'HEAD'):
        raise SystemExit('Benchmark source changed while running; discard this run.')
    result = {'schemaVersion': 1, 'benchmark': 'QuixBugs Python upstream suites', 'source': SOURCE, 'sourceCommit': PIN,
              'python': platform.python_version(), 'platform': platform.system(), 'architecture': platform.machine(),
              'packages': {name: importlib.metadata.version(name) for name in ['pytest', 'pytest-timeout', 'iniconfig', 'packaging', 'pluggy', 'Pygments']},
              'runnerSha256': sha(Path(__file__)), 'perTestTimeoutSeconds': 2, 'perSuiteTimeoutSeconds': 60,
              'slowTests': 'Upstream defaults; knapsack and levenshtein slow cases remain explicitly skipped.',
              'seconds': round(time.monotonic() - started, 6), 'rows': rows}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n')
    if any(row['outcome'] == 'unavailable' for row in rows):
        raise SystemExit('Recorded unavailable suites; inspect and report them, never count them as detected bugs.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('checkout', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    collect(args.checkout.resolve(), args.output.resolve())
