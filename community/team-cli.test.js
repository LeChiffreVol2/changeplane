import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { teamFailure, runTeamCli } from './team-cli.js';
import { CollectionError } from './transport.js';

test('team errors preserve safe provider conditions without exposing exception details', () => {
  for (const code of ['RATE_LIMITED', 'PERMISSION_DENIED', 'PROVIDER_UNAVAILABLE']) {
    const error = new CollectionError(code, { provider: 'github', status: 403 });
    error.message = 'synthetic-private-marker';
    const report = teamFailure(error);
    assert.equal(report.code, code);
    assert.doesNotMatch(JSON.stringify(report), /synthetic-private-marker/);
  }
  assert.doesNotMatch(JSON.stringify(teamFailure(new Error('synthetic-private-marker'))), /synthetic-private-marker/);
  const policy = teamFailure(new Error('POLICY_INVALID: synthetic-private-marker'));
  assert.equal(policy.code, 'POLICY_INVALID'); assert.doesNotMatch(JSON.stringify(policy), /synthetic-private-marker/);
});

test('task-file and usage errors identify the local repair before any provider request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'changeplane-team-cli-'));
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No provider access expected'); };
  try {
    const malformed = join(root, 'malformed.json'); writeFileSync(malformed, '{');
    await assert.rejects(runTeamCli(['start', 'example/repo', join(root, 'missing.json'), 'alice']), { code: 'TEAM_TASK_FILE_MISSING' });
    await assert.rejects(runTeamCli(['plan', 'example/repo', malformed]), { code: 'TEAM_TASK_JSON_INVALID' });
    await assert.rejects(runTeamCli(['unknown', 'example/repo']), { code: 'TEAM_COMMAND_INVALID' });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; rmSync(root, { recursive: true, force: true }); }
});

test('team CLI help is readable text and missing member configuration names its next action', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CHANGEPLANE_') && !['GH_TOKEN', 'GITHUB_TOKEN'].includes(key)));
  const help = spawnSync(process.execPath, ['community/cli.js', 'team', '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /^Repository teamwork/); assert.doesNotMatch(help.stdout, /\\n/);
  const next = spawnSync(process.execPath, ['community/cli.js', 'team', 'next', 'example/repo'], { env, encoding: 'utf8' });
  assert.equal(next.status, 2);
  assert.equal(JSON.parse(next.stderr).code, 'TEAM_MEMBER_NOT_CONFIGURED');
  assert.match(JSON.parse(next.stderr).nextAction, /CHANGEPLANE_TEAM_MEMBER/);
});
