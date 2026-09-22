import { inspectSetup, planSetup } from './setup.js';
import { githubReader, inspectPullRequest, waitForPullRequest } from './github.js';
import { CollectionError } from './transport.js';
import { githubWorkflowFilePath } from '../src/lib/harness.js';

/** One read-only entry point from prerequisites to current evidence. Policy remains reviewed. */
export async function onboard({ repository, number, check, workflow, waitSeconds, token, signal, read, runtime },
  { prerequisites = inspectSetup, plan = planSetup, inspect = inspectPullRequest, wait = waitForPullRequest } = {}) {
  if (!Number.isSafeInteger(number) || number < 1 || (check === undefined) !== (workflow === undefined)
    || (check !== undefined && (typeof check !== 'string' || !check || check.length > 100 || /[\u0000-\u001f\u007f]/u.test(check)
      || check.includes('${{') || typeof workflow !== 'string' || workflow.length > 200 || githubWorkflowFilePath(workflow) !== workflow))
    || (waitSeconds !== undefined && (!Number.isSafeInteger(waitSeconds) || waitSeconds < 1 || waitSeconds > 60))) {
    throw new CollectionError('INPUT_INVALID');
  }
  const options = { repository, number, read: read ?? githubReader(token, fetch, signal), ...(runtime ? { runtime } : {}), signal };
  const setup = await prerequisites(options);
  let report;
  if (setup.decision === 'SETUP_REQUIRED' || check !== undefined) {
    report = await plan({ ...options, check, workflow });
    if (report.baseSha !== setup.baseSha) throw new CollectionError('EVIDENCE_CHANGED');
  } else if (setup.decision === 'CHECKS_PASSED') {
    report = await (waitSeconds === undefined ? inspect(options) : wait({ ...options, waitSeconds }));
    if (report.handback?.binding?.policyRevision !== setup.baseSha) throw new CollectionError('EVIDENCE_CHANGED');
  } else throw new CollectionError('RESPONSE_INVALID');
  const assessed = report.observation?.source === 'github-api';
  return { ...report, onboarding: { assessed, runtimeRevision: setup.runtimeRevision,
    stage: assessed ? 'assessed' : report.files?.some(file => file.change !== 'unchanged') ? 'configuration_review' : 'select_evidence',
    resume: ['onboard', repository, String(number)],
    nextAction: assessed ? 'Follow the current findings. Repeat onboard after CI, commits or reviews.'
      : 'Review the selected behavioral check and configuration PR. After it merges, repeat onboard for this PR; no extra setup step is needed.',
    checks: setup.checks } };
}
