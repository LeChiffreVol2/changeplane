import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('Action collection failures emit a structured outcome and a safe next action', () => {
  const directory = mkdtempSync(join(tmpdir(), 'changeplane-action-outcome-'));
  try {
    writeFileSync(join(directory, 'event.json'), JSON.stringify({ pull_request: { number: 7 } }));
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval',
      `globalThis.fetch = async () => new Response('PRIVATE_SYNTHETIC_RESPONSE', { status: 403 }); await import(${JSON.stringify(new URL('./action.js', import.meta.url).href)});`],
    { encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request_target',
      GITHUB_EVENT_PATH: join(directory, 'event.json'), GITHUB_REPOSITORY: 'example/project',
      GITHUB_OUTPUT: join(directory, 'output'), GITHUB_STEP_SUMMARY: join(directory, 'summary'), INPUT_TOKEN: 'synthetic' } });
    assert.equal(child.status, 2);
    const output = readFileSync(join(directory, 'output'), 'utf8');
    assert.match(output, /^decision=UNAVAILABLE\n/u);
    const report = JSON.parse(output.split('\n')[1].slice('assessment='.length));
    assert.equal(report.code, 'PERMISSION_DENIED');
    assert.equal(report.nextAction, 'CHECK_READ_PERMISSIONS');
    assert.equal(report.authority.guardPublished, false);
    assert.equal((output + child.stderr + readFileSync(join(directory, 'summary'), 'utf8')).includes('PRIVATE_SYNTHETIC_RESPONSE'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
