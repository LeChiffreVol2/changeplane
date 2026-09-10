import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Reuse the YAML parser already shipped by the locked Playwright test dependency.
const require = createRequire(import.meta.url);
const { yaml } = createRequire(require.resolve('playwright-core/package.json'))('./lib/utilsBundle.js');
function template(name) {
  const document = yaml.parseDocument(readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8'), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  return document.toJS({ maxAliasCount: 0 });
}
const observer = template('changeplane-team.yml');
const relay = template('changeplane-team-review-signal.yml');
const keys = (object, expected) => assert.deepEqual(Object.keys(object).sort(), [...expected].sort());
const compact = value => value.replace(/\s+/gu, '');

function observerBoundary(workflow) {
  keys(workflow, ['name', 'on', 'permissions', 'concurrency', 'jobs']);
  keys(workflow.on, ['pull_request_target', 'issue_comment', 'workflow_run', 'schedule', 'workflow_dispatch']);
  assert.ok(workflow.on.pull_request_target.types.includes('synchronize'));
  assert.ok(workflow.on.pull_request_target.types.includes('closed'));
  assert.deepEqual(workflow.on.issue_comment.types, ['created', 'edited', 'deleted']);
  assert.deepEqual(workflow.on.workflow_run.workflows, ['CI', relay.name]);
  assert.deepEqual(workflow.on.workflow_run.types, ['completed']);
  assert.deepEqual(workflow.permissions, { contents: 'write', 'pull-requests': 'read', actions: 'read', checks: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.concurrency.group, 'changeplane-team-observation');
  keys(workflow.jobs, ['reconcile']);
  const job = workflow.jobs.reconcile;
  keys(job, ['if', 'runs-on', 'timeout-minutes', 'steps']);
  assert.equal(compact(job.if), compact(`
    (github.event_name != 'issue_comment' || github.event.issue.pull_request) &&
    (github.event_name != 'workflow_run' || github.event.workflow_run.name != 'ChangePlane review signal' ||
     github.event.workflow_run.head_repository.full_name == github.repository)`));
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 5);
  assert.equal(job.steps.length, 3, 'No additional privileged artifact, cache or source-code step');
  const [checkout, node, observe] = job.steps;
  keys(checkout, ['uses', 'with']);
  assert.match(checkout.uses, /^actions\/checkout@[a-f0-9]{40}$/u);
  keys(checkout.with, ['repository', 'ref', 'path', 'persist-credentials']);
  assert.equal(checkout.with.repository, 'LeChiffreVol2/changeplane');
  assert.match(checkout.with.ref, /^(?:CHANGEPLANE_TEAM_RELEASE_SHA|[a-f0-9]{40})$/u);
  assert.equal(checkout.with.path, '_changeplane');
  assert.equal(checkout.with['persist-credentials'], false);
  keys(node, ['uses', 'with']);
  assert.match(node.uses, /^actions\/setup-node@[a-f0-9]{40}$/u);
  keys(node.with, ['node-version']);
  keys(observe, ['name', 'env', 'run']);
  assert.deepEqual(observe.env, { GH_TOKEN: '${{ github.token }}', CHANGEPLANE_TEAM_WRITE: 'true',
    CHANGEPLANE_TEAM_REPOSITORY: '${{ github.repository }}' });
  assert.doesNotMatch(observe.run, /\$\{\{|GITHUB_EVENT_PATH|workflow_run|artifacts|download-artifact|\b(?:curl|wget|fetch|exec|spawn)\b/u);
  assert.equal(observe.run.split('\n')[0], 'node _changeplane/community/cli.js team observe "$GITHUB_REPOSITORY" > "$RUNNER_TEMP/changeplane-team.json"');
}

function relayBoundary(workflow) {
  keys(workflow, ['name', 'on', 'permissions', 'concurrency', 'jobs']);
  keys(workflow.on, ['pull_request_review', 'pull_request_review_comment']);
  assert.deepEqual(workflow.on.pull_request_review.types, ['submitted', 'edited', 'dismissed']);
  assert.deepEqual(workflow.on.pull_request_review_comment.types, ['created', 'edited', 'deleted']);
  assert.deepEqual(workflow.permissions, {});
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.equal(workflow.concurrency.group, 'changeplane-review-signal-${{ github.event.pull_request.number }}');
  keys(workflow.jobs, ['signal']);
  const job = workflow.jobs.signal;
  keys(job, ['if', 'runs-on', 'timeout-minutes', 'steps']);
  assert.equal(job.if, 'github.event.pull_request.head.repo.full_name == github.repository');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 1);
  assert.equal(job.steps.length, 1);
  keys(job.steps[0], ['name', 'run']);
  assert.equal(job.steps[0].run, ':', 'PR-defined relay must be a fixed no-op, without secrets, event interpolation, checkout or actions');
}

test('review signals cannot directly execute the credentialed observer or select its runtime', () => {
  observerBoundary(observer);
  const unsafeChanges = [
    value => { value.on.pull_request_review = { types: ['submitted'] }; },
    value => { value.on.pull_request_review_comment = { types: ['created'] }; },
    value => { value.permissions.checks = 'write'; },
    value => { value.jobs.reconcile.steps[0].with.ref = '${{ github.event.pull_request.head.sha }}'; },
    value => { value.jobs.reconcile.steps[0].with.repository = '${{ github.repository }}'; },
    value => { value.jobs.reconcile.steps[0].with['persist-credentials'] = true; },
    value => { value.jobs.reconcile.steps[1].uses = 'actions/setup-node@main'; },
    value => { value.jobs.reconcile.steps.push({ uses: 'actions/download-artifact@' + 'a'.repeat(40) }); },
    value => { value.jobs.reconcile.steps[2].run += '\necho "${{ github.event.comment.body }}"'; },
    value => { value.jobs.reconcile.if += ' || true'; },
  ];
  for (const mutate of unsafeChanges) {
    const changed = structuredClone(observer); mutate(changed);
    assert.throws(() => observerBoundary(changed), assert.AssertionError);
  }
});

test('PR-defined review relay has no credentials, actions, checkout or executable event data', () => {
  relayBoundary(relay);
  const unsafeChanges = [
    value => { value.permissions.contents = 'read'; },
    value => { value.env = { TOKEN: '${{ secrets.OPERATOR_TOKEN }}' }; },
    value => { value.jobs.signal.permissions = { contents: 'write' }; },
    value => { value.jobs.signal.steps[0].env = { GH_TOKEN: '${{ github.token }}' }; },
    value => { value.jobs.signal.steps.push({ uses: 'actions/checkout@' + 'a'.repeat(40) }); },
    value => { value.jobs.signal.steps[0].run = 'echo "${{ github.event.review.body }}"'; },
    value => { value.jobs.signal.steps[0].run = 'node downloaded-artifact.js'; },
    value => { value.jobs.signal.if = 'true'; },
  ];
  for (const mutate of unsafeChanges) {
    const changed = structuredClone(relay); mutate(changed);
    assert.throws(() => relayBoundary(changed), assert.AssertionError);
  }
});

test('observer reports partial progress without false workflow failure or private task output', () => {
  const script = observer.jobs.reconcile.steps[2].run.match(/node --input-type=module -e '\n([\s\S]*)'\s*$/u)?.[1];
  assert.ok(script, 'Run the template\'s actual summary program against synthetic reports');
  const directory = mkdtempSync(join(tmpdir(), 'changeplane-observer-summary-'));
  try {
    const summary = join(directory, 'summary.md');
    for (const status of ['observed', 'partial', 'deferred', 'unavailable']) {
      writeFileSync(summary, '');
      writeFileSync(join(directory, 'changeplane-team.json'), JSON.stringify({ observerStatus: status,
        observations: [{ task: 'private-task-marker', title: 'private-title-marker', path: 'private-path-marker',
          state: status === 'unavailable' ? 'unavailable' : status === 'partial' || status === 'deferred' ? 'deferred' : 'review',
          ...(status === 'unavailable' ? { code: 'RATE_LIMITED' } : {}) }] }));
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        encoding: 'utf8', env: { RUNNER_TEMP: directory, GITHUB_STEP_SUMMARY: summary },
      });
      assert.equal(child.status, status === 'unavailable' ? 1 : 0, child.stderr);
      assert.doesNotMatch(child.stdout + child.stderr + readFileSync(summary, 'utf8'), /private-(?:task|title|path)-marker/u);
      assert.equal(JSON.parse(child.stdout).observerStatus, status);
      if (status === 'unavailable') assert.deepEqual(JSON.parse(child.stdout).codes, ['RATE_LIMITED']);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
