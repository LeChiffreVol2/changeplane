#!/usr/bin/env node
// Standalone bootstrap: inspect this file before running. No npm or lifecycle scripts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repository = 'LeChiffreVol2/changeplane';
const sha = /^[a-f0-9]{40}$/u;
const required = ['bin/changeplane.js', 'community/pipeline.js', 'community/session.js', 'community/review-decisions.js', 'skills/changeplane/SKILL.md'];
async function read(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'changeplane-installer', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('GitHub is unavailable or rate limited. Retry installation later.'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Installation metadata exceeds the limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks));
}

/** Install one CI-verified main revision into a new directory. Existing data is untouched. */
export async function install(destination, { readMetadata = read, executeGit = execFileSync, source = `https://github.com/${repository}.git` } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!(major === 22 && minor >= 18 || major === 24)) throw new Error('Use Node.js 22.18+ or 24.');
  if (!destination || destination.startsWith('-')) throw new Error('Supply a NEW runtime directory with an existing parent.');
  const root = resolve(destination);
  const metadata = await readMetadata('/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=1');
  const run = metadata.workflow_runs?.[0];
  const valid = item => item && Number.isSafeInteger(item.id) && item.id > 0 && sha.test(item.head_sha)
    && Number.isSafeInteger(item.run_attempt) && item.run_attempt > 0
    && item.head_branch === 'main' && item.event === 'push' && item.status === 'completed' && item.conclusion === 'success'
    && item.repository?.full_name === repository && item.head_repository?.full_name === repository
    && item.path === '.github/workflows/ci.yml';
  if (!valid(run)) throw new Error('No successful main CI revision is available. Retry after CI completes.');
  const scratch = mkdtempSync(join(tmpdir(), 'changeplane-install-'));
  let created = false;
  try {
    mkdirSync(root, { mode: 0o700 }); created = true;
    const env = { PATH: process.env.PATH, HOME: scratch, USERPROFILE: scratch,
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(scratch, 'no-config'), GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' };
    const git = args => executeGit('git', ['-c', 'core.hooksPath=' + scratch, '-c', 'credential.helper=', ...args], {
      cwd: root, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    git(['init', '--quiet', '--template=', '.']);
    git(['-c', 'protocol.file.allow=never', 'fetch', '--quiet', '--depth=1', '--no-tags', source, run.head_sha]);
    git(['checkout', '--quiet', '--detach', run.head_sha]);
    if (git(['rev-parse', 'HEAD']).trim() !== run.head_sha) throw new Error('Installed revision does not match CI.');
    for (const path of required) {
      if (!lstatSync(join(root, path)).isFile() || !readFileSync(join(root, path)).length) throw new Error('The verified revision lacks current capabilities. Wait for current main CI.');
    }
    const confirmed = await readMetadata(`/actions/runs/${run.id}`);
    if (!valid(confirmed) || confirmed.head_sha !== run.head_sha || confirmed.run_attempt !== run.run_attempt) throw new Error('CI changed during installation. Retry after it settles.');
    return { schemaVersion: 1, kind: 'changeplane.installation', repository, sourceRevision: run.head_sha,
      verifiedRun: `https://github.com/${repository}/actions/runs/${run.id}`, runtime: root,
      command: [process.execPath, join(root, 'bin/changeplane.js')], skill: join(root, 'skills/changeplane/SKILL.md'),
      nextAction: 'Give your agent this runtime and skill path, then run doctor for your target repository. No repository has been connected.' };
  } catch {
    if (created) rmSync(root, { recursive: true, force: true });
    throw new Error('Installation could not finish. Existing directories are preserved. Check Node, Git, network access and successful current main CI, then use a new directory.');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node install.mjs NEW_RUNTIME_DIRECTORY');
    process.stdout.write(JSON.stringify(await install(process.argv[2]), null, 2) + '\n');
  } catch (error) { process.stderr.write(JSON.stringify({ code: 'INSTALL_UNAVAILABLE', nextAction: error.message }) + '\n'); process.exitCode = 2; }
}
