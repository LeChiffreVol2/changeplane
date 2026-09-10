#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { assess, COMMUNITY_VERSION } from './core.js';
import { inspectPullRequest } from './github.js';
import { inspectMergeRequest } from './gitlab.js';
import { assessObservation } from './observation.js';
import { unavailable } from './transport.js';
import { runTeamCli, teamFailure, teamHelp } from './team-cli.js';

const help = `ChangePlane Open Source ${COMMUNITY_VERSION}
Usage:
  node community/cli.js evaluate snapshot.json
  node community/cli.js inspect owner/repository PR_NUMBER
  node community/cli.js inspect-gitlab GROUP/PROJECT MR_NUMBER
  node community/cli.js --version

${teamHelp}

Zero dependencies. No model key. Provider readers use fixed-origin GET requests only.
Set GH_TOKEN or GITHUB_TOKEN in your environment for private repositories or rate limits.
The GitLab reader candidate uses GITLAB_TOKEN; live qualification and enforcement are separate.
JSON to stdout. Exit 0: advisory evidence/observations satisfied; 1: findings; 2: invalid/unavailable input.
An assessment is advisory, never ChangePlane / guard or merge authorization.
`;

try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') process.stdout.write(help);
  else if (command === '--version' && args.length === 0) process.stdout.write(`${COMMUNITY_VERSION}\n`);
  else if (command === 'team') {
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
      if (!stat.isFile() || stat.size > 1_000_000) throw new Error('INPUT_LIMIT: use a JSON file of at most 1 MB.');
      let snapshot;
      try { snapshot = JSON.parse(readFileSync(args[0], 'utf8')); }
      catch { throw new Error('INPUT_INVALID: snapshot must contain valid JSON.'); }
      report = { ...(snapshot.schemaVersion === 2 ? assessObservation(snapshot) : assess(snapshot)),
        observation: { source: 'provided-snapshot', authenticated: false } };
    } else if (command === 'inspect' && args.length === 2 && /^[1-9][0-9]*$/u.test(args[1])) {
      report = await inspectPullRequest({ repository: args[0], number: Number(args[1]), token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
    } else if (command === 'inspect-gitlab' && args.length === 2 && /^[1-9][0-9]*$/u.test(args[1])) {
      report = await inspectMergeRequest({ project: args[0], number: Number(args[1]), token: process.env.GITLAB_TOKEN });
    } else throw new Error('USAGE_INVALID: run with --help for supported commands.');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = ['EVIDENCE_SATISFIED', 'OBSERVED_SUCCESS'].includes(report.decision) ? 0 : 1;
  }
} catch (error) {
  // Never print filesystem paths, provider bodies, tokens or arbitrary exception text.
  process.stderr.write(`${JSON.stringify(unavailable(error))}\n`);
  process.exitCode = 2;
}
