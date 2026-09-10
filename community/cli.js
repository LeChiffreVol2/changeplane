#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { assess, COMMUNITY_VERSION } from './core.js';
import { inspectPullRequest } from './github.js';
import { inspectMergeRequest } from './gitlab.js';
import { assessObservation } from './observation.js';
import { unavailable } from './transport.js';
import { githubReader } from './github.js';
import { formatReport } from './output.js';
import { planSetup, setupFailure, SetupError, writeSetupPlan } from './setup.js';
import { runTeamCli, teamFailure } from './team-cli.js';

const help = `ChangePlane Open Source ${COMMUNITY_VERSION}
Usage:
  changeplane evaluate snapshot.json [--format json|text|compact]
  changeplane inspect OWNER/REPO PR_NUMBER [--format json|text|compact]
  changeplane inspect https://github.com/OWNER/REPO/pull/123
  changeplane init OWNER/REPO --dry-run
  changeplane mcp
  changeplane team --help
  changeplane inspect-gitlab GROUP/PROJECT MR_NUMBER
  changeplane --version

From a source checkout: node bin/changeplane.js COMMAND
Existing node community/cli.js commands remain supported.
Start with evaluate, then init --help to prepare one reviewed configuration PR.
MCP uses CHANGEPLANE_REPOSITORY and exposes read-only PR assessment only.
Team coordination is opt-in; team --help documents its separate operator.

Zero dependencies. No model key. GitHub readers use fixed-origin GET requests only.
Set GH_TOKEN or GITHUB_TOKEN in the process environment for private read access.
The GitLab reader is a candidate; live qualification and enforcement are separate.
Assessment JSON is the default. Exit 0: advisory evidence satisfied; 1: findings;
2: invalid/unavailable input. No Guard, repair or merge authorization.
`;
const setupHelp = `Prepare one reviewed ChangePlane setup pull request:
  changeplane init OWNER/REPO --dry-run [--pr NUMBER]
  changeplane init OWNER/REPO --check "Behavior" --workflow .github/workflows/ci.yml --dry-run
  changeplane init OWNER/REPO --check "Behavior" --workflow .github/workflows/ci.yml --output NEW_DIRECTORY

Options:
  --pr NUMBER        Discover CI jobs from an open PR instead of current default-branch CI.
  --check NAME       Exact meaningful behavioral job, selected by the repository owner.
  --workflow PATH    Its trusted default-branch workflow path. Required with --check.
  --coordination     Also prepare the optional observer and review relay, for solo agents or teams.
  --max-active N     Coordination capacity 1–20; preserve existing capacity or default to 3.
  --dry-run          Print the plan only (default). No local or GitHub writes.
  --output DIRECTORY Stage reviewed-plan files in a NEW directory with an existing parent.
  --format text      Human summary. JSON is the default complete plan.

Existing policy requirements and protected paths are preserved. Different existing
workflows block generation. No code executes, credential is created, PR is opened,
or repository is installed. Templates use the committed runtime's exact SHA.
Exit 0: plan prepared; 1: choose a CI job; 2: invalid/unavailable setup.
`;

function setupOptions(args) {
  const [repository, ...rest] = args;
  const options = { repository };
  const names = { '--pr': 'number', '--check': 'check', '--workflow': 'workflow', '--max-active': 'maxActive', '--output': 'output' };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const name = flag === '--coordination' ? 'coordination' : flag === '--dry-run' ? 'dryRun' : names[flag];
    if (!name || Object.hasOwn(options, name)) throw new SetupError('SETUP_INPUT_INVALID');
    if (['coordination', 'dryRun'].includes(name)) options[name] = true;
    else {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw new SetupError('SETUP_INPUT_INVALID');
      if (['number', 'maxActive'].includes(name) && !/^[1-9][0-9]*$/u.test(value)) throw new SetupError('SETUP_INPUT_INVALID');
      options[name] = ['number', 'maxActive'].includes(name) ? Number(value) : value;
    }
  }
  if (options.output && options.dryRun) throw new SetupError('SETUP_INPUT_INVALID');
  return options;
}

let format = 'json', command;
try {
  const argv = process.argv.slice(2);
  const index = argv.indexOf('--format');
  if (index !== -1) {
    format = argv[index + 1];
    argv.splice(index, 2);
    if (!['json', 'text', 'compact'].includes(format) || argv.includes('--format')) throw new Error('USAGE_INVALID');
  }
  const args = argv.slice(1); command = argv[0];
  if (!command || command === '--help' || command === '-h') process.stdout.write(help);
  else if (command === '--version' && args.length === 0) process.stdout.write(`${COMMUNITY_VERSION}\n`);
  else if (command === 'mcp') {
    if (args[0] === '--help' && args.length === 1) process.stdout.write('Set CHANGEPLANE_REPOSITORY=OWNER/REPO in the operator environment, then run changeplane mcp. Read-only GitHub assessment; use a read-only credential for private access.\n');
    else {
      if (args.length || index !== -1) throw new Error('USAGE_INVALID');
      const { serveAssessment } = await import('./mcp.js');
      await serveAssessment();
    }
  } else if (command === 'init') {
    if (args.length === 1 && args[0] === '--help') process.stdout.write(setupHelp);
    else {
      if (format === 'compact') throw new SetupError('SETUP_INPUT_INVALID');
      const options = setupOptions(args);
      const plan = await planSetup({ ...options, read: githubReader(process.env.GH_TOKEN || process.env.GITHUB_TOKEN) });
      if (options.output && plan.decision === 'REVIEW_REQUIRED') writeSetupPlan(plan, options.output);
      process.stdout.write(formatReport({ ...plan, staged: Boolean(options.output && plan.decision === 'REVIEW_REQUIRED') }, format));
      if (plan.decision === 'SELECTION_REQUIRED') process.exitCode = 1;
    }
  } else if (command === 'team') {
    if (index !== -1) throw new Error('USAGE_INVALID');
    try {
      const result = await runTeamCli(args);
      process.stdout.write(result.help ?? JSON.stringify(result, null, 2) + '\n');
      if (result.status === 'blocked') process.exitCode = 2;
    }
    catch (error) { process.stderr.write(JSON.stringify(teamFailure(error)) + '\n'); process.exitCode = 2; }
  } else {
    let report;
    if (command === 'evaluate' && args.length === 1) {
      const stat = statSync(args[0]);
      if (!stat.isFile() || stat.size > 1_000_000) throw new Error('INPUT_LIMIT');
      let snapshot;
      try { snapshot = JSON.parse(readFileSync(args[0], 'utf8')); }
      catch { throw new Error('INPUT_INVALID'); }
      report = { ...(snapshot.schemaVersion === 2 ? assessObservation(snapshot) : assess(snapshot)),
        observation: { source: 'provided-snapshot', authenticated: false } };
    } else if (command === 'inspect') {
      let [repository, number] = args;
      if (args.length === 1) {
        const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/u.exec(repository);
        if (!match) throw new Error('USAGE_INVALID');
        [, repository, number] = match;
      } else if (args.length !== 2) throw new Error('USAGE_INVALID');
      if (!/^[1-9][0-9]*$/u.test(number)) throw new Error('USAGE_INVALID');
      report = await inspectPullRequest({ repository, number: Number(number), token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
    } else if (command === 'inspect-gitlab' && args.length === 2 && /^[1-9][0-9]*$/u.test(args[1])) {
      report = await inspectMergeRequest({ project: args[0], number: Number(args[1]), token: process.env.GITLAB_TOKEN });
    } else throw new Error('USAGE_INVALID');
    process.stdout.write(formatReport(report, format));
    process.exitCode = ['EVIDENCE_SATISFIED', 'OBSERVED_SUCCESS'].includes(report.decision) ? 0 : 1;
  }
} catch (error) {
  // Never print filesystem paths, provider bodies, tokens or arbitrary exception text.
  const report = command === 'init' ? setupFailure(error) : unavailable(error);
  process.stderr.write(formatReport(report, ['text', 'compact'].includes(format) && command !== 'init' ? format : 'json'));
  process.exitCode = 2;
}
