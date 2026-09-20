import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspectPullRequest } from '../../community/github.js';
import { assessObservation } from '../../community/observation.js';
import { canonical } from '../../community/core.js';
import { CollectionError, unavailable } from '../../community/transport.js';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const PIN = '4257f44b0ff1181dedaedee6a447e133219fcebf';
const head = 'a'.repeat(40), newer = 'c'.repeat(40), base = 'b'.repeat(40);
const repository = 'benchmark/quixbugs', root = `/repos/${repository}`;
const workflow = '.github/workflows/benchmark.yml';
const policy = { protectedPaths: { requireApproval: ['python_testcases/**'], block: [] },
  evidence: { requiredChecks: [{ name: 'QuixBugs', appSlug: 'github-actions', workflowPath: workflow }] } };
export const SCENARIOS = [
  'measured', 'stale_success', 'wrong_publisher', 'newer_failure', 'newer_pending',
  'head_changed_during_read', 'policy_changed_during_read', 'workflow_mismatch',
  'evidence_changed_during_read', 'protected_test', 'missing_file_page', 'provider_failure',
  'skipped_job', 'neutral_job',
];
const shared = new Set(['measured', 'stale_success', 'wrong_publisher']);
const assumedRerun = new Set(['newer_failure', 'newer_pending']);
const allowedErrors = { head_changed_during_read: 'REVISION_CHANGED', policy_changed_during_read: 'REVISION_CHANGED',
  evidence_changed_during_read: 'EVIDENCE_CHANGED', missing_file_page: 'FILES_INCOMPLETE', provider_failure: 'PROVIDER_UNAVAILABLE' };

/** Explicit simplified native model; current state supplied by the scenario, not by ChangePlane. */
export function nativeRequiredCheck(state) {
  if (!state.upToDate || state.head !== state.currentHead) return false;
  const subject = state.testMergeSha ?? state.currentHead;
  const check = state.checks.filter(item => item.head === subject && item.name === 'QuixBugs' && item.app === state.expectedApp)
    .sort((a, b) => b.execution - a.execution)[0];
  return Boolean(check?.status === 'completed' && ['success', 'neutral', 'skipped'].includes(check.conclusion));
}

function scenarioReader(row, scenario) {
  const customPublisher = scenario === 'wrong_publisher';
  const selectedPolicy = structuredClone(policy);
  if (customPublisher) selectedPolicy.evidence.requiredChecks = [{ name: 'QuixBugs', appSlug: 'benchmark-runner' }];
  const pr = { id: 70, number: 7, state: 'open', changed_files: scenario === 'missing_file_page' ? 2 : 1,
    head: { sha: head, ref: 'candidate', repo: { id: 1, full_name: repository } },
    base: { sha: base, ref: 'main', repo: { id: 1, full_name: repository } } };
  const run = (id, conclusion, status = 'completed') => ({ id, workflow_id: 10, run_number: id, run_attempt: 1,
    head_sha: head, path: workflow, status, conclusion, repository: { full_name: repository }, head_repository: { full_name: repository } });
  let conclusion = row.outcome === 'unavailable' ? 'action_required' : row.outcome;
  let runs = [run(1, conclusion)];
  if (scenario === 'stale_success') runs = [{ ...run(1, 'success'), head_sha: newer }];
  if (scenario === 'newer_failure') runs = [run(1, 'success'), run(2, 'failure')];
  if (scenario === 'newer_pending') runs = [run(1, 'success'), run(2, null, 'queued')];
  if (scenario === 'workflow_mismatch') runs = [{ ...run(1, 'success'), path: '.github/workflows/other.yml' }];
  if (['skipped_job', 'neutral_job'].includes(scenario)) runs = [run(1, 'success')];
  const transcript = [], counts = new Map(); let visibleRuns = runs;
  const read = async path => {
    const count = (counts.get(path) ?? 0) + 1; counts.set(path, count);
    if (scenario === 'provider_failure' && path.includes('/actions/runs?')) {
      transcript.push({ path, error: 'PROVIDER_UNAVAILABLE' }); throw new CollectionError('PROVIDER_UNAVAILABLE');
    }
    let response;
    if (path === root) response = { id: 1, full_name: repository, default_branch: 'main' };
    else if (path === `${root}/pulls/7`) response = { ...pr, head: { ...pr.head,
      sha: scenario === 'head_changed_during_read' && count === 2 ? newer : head } };
    else if (path === `${root}/commits/main`) response = { sha: scenario === 'policy_changed_during_read' && count === 2 ? newer : base };
    else if (path === `${root}/contents/.changeplane.json?ref=${base}`) response = { type: 'file', encoding: 'base64',
      size: Buffer.byteLength(JSON.stringify(selectedPolicy)), content: Buffer.from(JSON.stringify(selectedPolicy)).toString('base64') };
    else if (path === `${root}/pulls/7/files?per_page=100&page=1`) response = [{ filename:
      scenario === 'protected_test' ? `python_testcases/test_${row.program}.py` : `python_programs/${row.program}.py`, status: 'modified' }];
    else if (path === `${root}/pulls/7/files?per_page=100&page=2`) response = [];
    else if (path === `${root}/actions/runs?head_sha=${head}&per_page=100`) {
      const observed = scenario === 'evidence_changed_during_read' ? [run(1, count === 1 ? 'success' : 'failure')] : runs;
      visibleRuns = observed;
      response = { total_count: observed.length, workflow_runs: observed };
    } else if (path === `${root}/commits/${head}/check-runs?filter=latest&per_page=100`) response = {
      total_count: 1, check_runs: [{ id: 3, name: 'QuixBugs', head_sha: head, app: { id: 99, slug: 'lookalike' }, status: 'completed', conclusion: 'success' }] };
    else if (/\/actions\/runs\/\d+\/attempts\/1\/jobs\?per_page=100$/u.test(path)) {
      const id = Number(path.match(/\/runs\/(\d+)\//u)[1]);
      const execution = visibleRuns.find(item => item.id === id);
      if (!execution) throw new Error('Unspecified benchmark execution');
      const jobConclusion = scenario === 'skipped_job' ? 'skipped' : scenario === 'neutral_job' ? 'neutral' : execution.conclusion;
      response = { total_count: 1, jobs: [{ id: 100 + id, run_id: id, name: 'QuixBugs', head_sha: execution.head_sha, status: execution.status, conclusion: jobConclusion }] };
    } else throw new Error(`Unspecified benchmark reader path: ${path}`);
    transcript.push({ path, response: structuredClone(response) }); return structuredClone(response);
  };
  const native = { upToDate: true, head, currentHead: head, expectedApp: customPublisher ? 'benchmark-runner' : 'github-actions',
    checks: customPublisher ? [{ name: 'QuixBugs', head, app: 'lookalike', execution: 1, status: 'completed', conclusion: 'success' }]
      : runs.map(item => ({ name: 'QuixBugs', head: item.head_sha, app: 'github-actions', execution: item.run_number, status: item.status,
        conclusion: scenario === 'skipped_job' ? 'skipped' : scenario === 'neutral_job' ? 'neutral' : item.conclusion })) };
  return { read, transcript, native };
}

export function validatePublicResults(value) {
  assert.equal(value.sourceCommit, PIN); assert.equal(value.rows.length, 80);
  const programs = new Map();
  for (const row of value.rows) {
    assert.match(row.program, /^[a-z_]+$/u); assert.ok(['buggy', 'reference'].includes(row.variant));
    assert.ok(['success', 'failure', 'timed_out', 'unavailable'].includes(row.outcome));
    for (const key of ['sourceSha256', 'testSha256']) assert.match(row[key], /^[a-f0-9]{64}$/u);
    const variants = programs.get(row.program) ?? new Set(); assert.ok(!variants.has(row.variant));
    variants.add(row.variant); programs.set(row.program, variants);
  }
  assert.equal(programs.size, 40); assert.ok([...programs.values()].every(value => value.size === 2));
}

export async function replayPublicResults(value) {
  validatePublicResults(value);
  const rows = [], transcripts = [];
  for (const candidate of value.rows) for (const scenario of SCENARIOS) {
    const f = scenarioReader(candidate, scenario);
    let report;
    const start = performance.now();
    try { report = await inspectPullRequest({ repository, number: 7, read: f.read }); }
    catch (error) {
      const code = error instanceof CollectionError ? error.code : error.message.split(':', 1)[0];
      if (!allowedErrors[scenario] || code !== allowedErrors[scenario]) throw new Error(`Unexpected benchmark error at ${candidate.program}/${scenario}`, { cause: error });
      report = unavailable(error);
    }
    const milliseconds = performance.now() - start;
    const expectedEligible = scenario === 'measured' && candidate.outcome === 'success';
    const eligible = report.decision === 'EVIDENCE_SATISFIED';
    const policyDifference = ['skipped_job', 'neutral_job'].includes(scenario);
    const id = `${candidate.program}/${candidate.variant}/${scenario}`;
    rows.push({ id, scenario, measuredOutcome: candidate.outcome, effectiveEvidence: {
      baselineChecks: shared.has(scenario) || assumedRerun.has(scenario) || policyDifference ? f.native.checks : null,
      collectorEvidence: report.evidence ?? [] },
      transformation: scenario === 'measured' ? 'Measured conclusion encoded as a synthetic CI execution.' : `Synthetic fault/policy intervention: ${scenario}; transcript is authoritative for injected observations.`,
      expectedEligible, eligible, decision: report.decision,
      unavailable: report.decision === 'UNAVAILABLE', reasonCodes: report.findings?.map(item => item.code) ?? [report.code],
      authorityGranted: ['guardPublished', 'repairAuthorized', 'mergeAuthorized'].some(key => report.authority[key]),
      nativeEligible: shared.has(scenario) || assumedRerun.has(scenario) || policyDifference ? nativeRequiredCheck(f.native) : null,
      comparison: shared.has(scenario) ? 'shared' : assumedRerun.has(scenario) ? 'assumed_current_rerun' : policyDifference ? 'policy_difference' : 'outside_baseline',
      transcriptSha256: digest(f.transcript), milliseconds });
    transcripts.push({ id, requests: f.transcript });
  }
  return { rows, transcripts };
}

export const DIMENSIONS = ['freshHead', 'freshPolicy', 'freshGeneration', 'publisherMatches', 'subjectMatches',
  'complete', 'stable', 'controlsComplete', 'unprotected'];
export const OUTCOMES = ['success', 'failure', 'pending', 'cancelled', 'timed_out', 'skipped', 'neutral'];
export function observationFor(flags, outcome) {
  return { schemaVersion: 2, identity: { forge: 'github', origin: 'https://github.com', repositoryId: '1', sourceRepositoryId: '1', changeId: '7' },
    revisions: { head, currentHead: flags.freshHead ? head : newer, target: base, currentTarget: base,
      mergeBase: base, diffStart: base, policy: base, currentPolicy: flags.freshPolicy ? base : newer },
    policy: { schemaVersion: 2, protectedPaths: { block: [], requireApproval: ['tests/**'] },
      evidence: { required: [{ name: 'QuixBugs', producer: { kind: 'github-app', id: '1' }, subject: 'change_head' }] } },
    files: [{ path: flags.unprotected ? 'src/program.py' : 'tests/program.py' }],
    collection: { complete: flags.complete, stable: flags.stable, controlPathsComplete: flags.controlsComplete,
      controlPaths: [], generation: 1, currentGeneration: flags.freshGeneration ? 1 : 2 },
    evidence: [{ name: 'QuixBugs', producer: { kind: 'github-app', id: flags.publisherMatches ? '1' : '2' },
      execution: { id: '1', attempt: '1' }, subject: { kind: 'change_head', id: flags.subjectMatches ? head : newer, head: flags.subjectMatches ? head : newer },
      status: outcome === 'pending' ? 'in_progress' : 'completed', conclusion: outcome === 'pending' ? null : outcome }] };
}

const MUTATIONS = {
  'without-head-binding': [['if (revisions.head !== revisions.currentHead)', 'if (false)']],
  'without-policy-binding': [['if (revisions.policy !== revisions.currentPolicy)', 'if (false)']],
  'without-generation-binding': [['if (collection.generation !== collection.currentGeneration)', 'if (false)']],
  'without-publisher-binding': [[' && canonical(item.producer) === canonical(requirement.producer)', '']],
  'without-subject-binding': [
    ['if (subject.kind !== requirement.subject || subject.head !== revisions.head)', 'if (subject.kind !== requirement.subject)'],
    ["if (subject.kind === 'change_head' && subject.id !== revisions.head)", 'if (false)']],
  'without-protected-paths': [['actualFiles: files, protectedPaths, baseSha:', 'actualFiles: files, protectedPaths: { block: [], requireApproval: [] }, baseSha:']],
};

export async function enumerateStates() {
  const sourceUrl = new URL('../../community/observation.js', import.meta.url);
  const source = readFileSync(sourceUrl, 'utf8');
  const evaluators = { intact: { assess: assessObservation, sourceSha256: digest(source), substitutions: [] } };
  for (const [name, substitutions] of Object.entries(MUTATIONS)) {
    let code = source;
    for (const [before, after] of substitutions) { assert.equal(code.split(before).length, 2, `Ablation drift: ${name}`); code = code.replace(before, after); }
    const mutatedHash = digest(code);
    code = code.replace(/from '([^']+)'/gu, (_match, path) => `from '${new URL(path, sourceUrl).href}'`);
    const loaded = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    evaluators[name] = { assess: loaded.assessObservation, sourceSha256: mutatedHash, substitutions };
  }
  const summary = {}, rows = [];
  for (const [name, evaluator] of Object.entries(evaluators)) {
    const tally = { states: 0, expectedEligible: 0, eligible: 0, falseEligible: 0, falseHold: 0, authorityGranted: 0,
      sourceSha256: evaluator.sourceSha256, substitutions: evaluator.substitutions, firstCounterexample: null };
    for (let mask = 0; mask < 2 ** DIMENSIONS.length; mask++) for (const outcome of OUTCOMES) {
      const flags = Object.fromEntries(DIMENSIONS.map((key, bit) => [key, Boolean(mask & (1 << bit))]));
      const expectedEligible = Object.values(flags).every(Boolean) && outcome === 'success';
      const observation = observationFor(flags, outcome), report = evaluator.assess(observation);
      const eligible = report.decision === 'OBSERVED_SUCCESS';
      const authorityGranted = ['guardPublished', 'repairAuthorized', 'mergeAuthorized'].some(key => report.authority[key]);
      tally.states++; tally.expectedEligible += Number(expectedEligible); tally.eligible += Number(eligible);
      tally.falseEligible += Number(eligible && !expectedEligible); tally.falseHold += Number(!eligible && expectedEligible);
      tally.authorityGranted += Number(authorityGranted);
      if (eligible !== expectedEligible && !tally.firstCounterexample) tally.firstCounterexample = { flags, outcome, expectedEligible, observation, decision: report.decision };
      rows.push({ evaluator: name, mask, outcome, expectedEligible, eligible, authorityGranted });
    }
    summary[name] = tally;
  }
  return { summary, rows };
}
