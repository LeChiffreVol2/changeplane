#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { assess, COMMUNITY_VERSION } from './core.js';
import { inspectPullRequest } from './github.js';

const help = `ChangePlane Community ${COMMUNITY_VERSION}
Usage:
  node community/cli.js evaluate snapshot.json
  node community/cli.js inspect owner/repository PR_NUMBER
  node community/cli.js --version

Zero dependencies. No model key. inspect uses only GitHub GET requests.
Set GH_TOKEN or GITHUB_TOKEN in your environment for private repositories or rate limits.
JSON to stdout. Exit 0: evidence satisfied; 1: findings; 2: invalid/unavailable input.
An assessment is advisory, never ChangePlane / guard or merge authorization.
`;

try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') process.stdout.write(help);
  else if (command === '--version' && args.length === 0) process.stdout.write(`${COMMUNITY_VERSION}\n`);
  else {
    let report;
    if (command === 'evaluate' && args.length === 1) {
      const stat = statSync(args[0]);
      if (!stat.isFile() || stat.size > 1_000_000) throw new Error('INPUT_LIMIT: use a JSON file of at most 1 MB.');
      let snapshot;
      try { snapshot = JSON.parse(readFileSync(args[0], 'utf8')); }
      catch { throw new Error('INPUT_INVALID: snapshot must contain valid JSON.'); }
      report = { ...assess(snapshot), observation: { source: 'provided-snapshot', authenticated: false } };
    } else if (command === 'inspect' && args.length === 2 && /^[1-9][0-9]*$/u.test(args[1])) {
      report = await inspectPullRequest({ repository: args[0], number: Number(args[1]), token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
    } else throw new Error('USAGE_INVALID: run with --help for supported commands.');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.decision === 'EVIDENCE_SATISFIED' ? 0 : 1;
  }
} catch (error) {
  // Never print filesystem paths, provider bodies, tokens or arbitrary exception text.
  const safe = /^[A-Z_0-9]+(?:: [^\r\n]{1,240})?$/u.test(error.message) ? error.message : 'INPUT_INVALID: check the documented schema and permissions.';
  process.stderr.write(`${JSON.stringify({ error: safe, decision: 'UNAVAILABLE', guardPublished: false })}\n`);
  process.exitCode = 2;
}
