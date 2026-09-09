import { appendFileSync, readFileSync } from 'node:fs';
import { inspectPullRequest } from './github.js';

try {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!['pull_request_target', 'workflow_run', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) {
    throw new Error('Use the documented trusted-default-branch workflow.');
  }
  const explicit = process.env['INPUT_PULL-REQUEST'];
  const eventNumber = event.pull_request?.number ?? (event.workflow_run?.pull_requests?.length === 1 ? event.workflow_run.pull_requests[0].number : null);
  const number = explicit && process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? Number(explicit) : eventNumber;
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('No unique PR found. Dispatch this workflow with an open PR number.');
  const report = await inspectPullRequest({ repository: process.env.GITHUB_REPOSITORY, number, token: process.env.INPUT_TOKEN });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `decision=${report.decision}\nassessment=${JSON.stringify(report)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `# ChangePlane Community\n\n**${report.decision}** · revision \`${report.headSha}\`\n\n${report.findings.length} finding(s). Read the assessment output for exact-revision handback.\n\nRead-only assessment; no App-owned Guard, repair, or merge authorization.\n`);
  console.log(`ChangePlane Community: ${report.decision}; ${report.findings.length} finding(s).`);
  if (report.decision !== 'EVIDENCE_SATISFIED') process.exitCode = 1;
} catch {
  console.error('ChangePlane Community: assessment unavailable. Check the default-branch policy, supported event and read permissions. No Guard was published.');
  process.exitCode = 2;
}
