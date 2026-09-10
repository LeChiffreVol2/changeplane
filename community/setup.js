import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { githubReader } from './github.js';
import { validatePolicy, canonical } from './core.js';
import { CollectionError, unavailable } from './transport.js';
import { githubWorkflowFilePath } from '../src/lib/harness.js';

const sha = /^[a-f0-9]{40}$/u;
const positive = value => Number.isSafeInteger(value) && value > 0;
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 100
  && !/[\u0000-\u001f\u007f]/u.test(value) && !value.includes('${{');
const digest = value => createHash('sha256').update(value).digest('hex');
const authority = { advisory: true, repositoryModified: false, guardPublished: false, repairAuthorized: false, mergeAuthorized: false };
const messages = {
  SETUP_INPUT_INVALID: 'Use init --help. Select one exact job and workflow together; capacity requires coordination.',
  SETUP_SELECTION_REQUIRED: 'Choose a meaningful behavioral CI job from candidates, then repeat with --check and --workflow. No candidate is selected automatically.',
  SETUP_CHECK_NOT_FOUND: 'Run the selected CI job on this revision, or use --pr with an open PR that has run it. Then select its exact job name and trusted workflow path.',
  SETUP_CHECK_CONFLICT: 'Existing policy binds this job differently. Review that requirement manually; setup will not replace it.',
  SETUP_WORKFLOW_EXISTS: 'A target workflow already exists with different bytes. Review it manually; setup will not overwrite it.',
  SETUP_WORKFLOW_INVALID: 'Review the selected workflow on the default branch. Setup requires an active, unambiguous workflow identity and a plain workflow name.',
  SETUP_RUNTIME_INVALID: 'Use a verified release bundle or a committed ChangePlane checkout with unchanged workflow templates.',
  SETUP_OUTPUT_EXISTS: 'Choose a new output directory with an existing parent. Existing files and directories are never overwritten.',
  SETUP_OUTPUT_FAILED: 'Could not finish the new staging directory. Inspect any partial files and retry with a new directory; no repository was changed.',
};
export class SetupError extends Error { constructor(code) { super(code); this.code = code; } }
const requireSetup = (condition, code = 'SETUP_INPUT_INVALID') => { if (!condition) throw new SetupError(code); };
export function setupFailure(error) {
  if (!(error instanceof SetupError)) return unavailable(error);
  return { schemaVersion: 1, kind: 'changeplane.setup-plan', decision: 'UNAVAILABLE', code: error.code,
    nextAction: messages[error.code], authority };
}

const templatePaths = ['examples/changeplane-community.yml', 'examples/changeplane-team.yml', 'examples/changeplane-team-review-signal.yml'];
export function setupRuntime() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    let revision, inventory;
    try {
      const manifest = JSON.parse(readFileSync(resolve(root, 'SOURCE.json'), 'utf8'));
      requireSetup(manifest.repository === 'LeChiffreVol2/changeplane' && sha.test(manifest.commit), 'SETUP_RUNTIME_INVALID');
      revision = manifest.commit; inventory = manifest.files;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const git = args => execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    if (!revision) revision = git(['rev-parse', 'HEAD']).trim();
    requireSetup(sha.test(revision), 'SETUP_RUNTIME_INVALID');
    const templates = Object.fromEntries(templatePaths.map(path => {
      const content = readFileSync(resolve(root, path), 'utf8');
      requireSetup(inventory ? inventory[path] === digest(content) : git(['show', `${revision}:${path}`]) === content, 'SETUP_RUNTIME_INVALID');
      return [path, content];
    }));
    return { revision, templates };
  } catch { throw new SetupError('SETUP_RUNTIME_INVALID'); }
}

function list(response, key) {
  if (!response || !Array.isArray(response[key]) || !Number.isSafeInteger(response.total_count)
    || response.total_count < 0 || response.total_count > 100 || response[key].length !== response.total_count) {
    throw new CollectionError('COLLECTION_LIMIT');
  }
  return response[key];
}
async function fileAt(read, root, path, revision, optional = false) {
  let file;
  try { file = await read(`${root}/contents/${path}?ref=${revision}`); }
  catch (error) {
    if (optional && error instanceof CollectionError && error.code === 'NOT_FOUND') return null;
    throw error;
  }
  if (file?.type !== 'file' || file.encoding !== 'base64' || !Number.isSafeInteger(file.size)
    || file.size < 0 || file.size > 64_000 || typeof file.content !== 'string' || file.content.length > 90_000) {
    throw new CollectionError('RESPONSE_INVALID');
  }
  return Buffer.from(file.content, 'base64').toString('utf8');
}

/** Read current GitHub state and prepare reviewable files. Never checks out or executes target code. */
export async function planSetup({ repository, number, check, workflow, coordination = false, maxActive,
  read = githubReader(), runtime = setupRuntime }) {
  requireSetup(typeof repository === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(repository)
    && (number === undefined || positive(number)) && typeof coordination === 'boolean'
    && (maxActive === undefined || (coordination && positive(maxActive) && maxActive <= 20))
    && ((check === undefined && workflow === undefined) || (label(check) && githubWorkflowFilePath(workflow) === workflow)));
  const root = `/repos/${repository}`;
  const repo = await read(root);
  requireSetup(positive(repo?.id) && repo.full_name?.toLowerCase() === repository.toLowerCase()
    && typeof repo.default_branch === 'string' && repo.default_branch.length > 0);
  const base = await read(`${root}/commits/${encodeURIComponent(repo.default_branch)}`);
  requireSetup(sha.test(base?.sha));
  const readTarget = async () => {
    if (!number) return base.sha;
    const pr = await read(`${root}/pulls/${number}`);
    requireSetup(pr?.number === number && pr.state === 'open' && pr.base?.ref === repo.default_branch
      && pr.base.repo?.id === repo.id && sha.test(pr.head?.sha));
    return pr.head.sha;
  };
  const headSha = await readTarget();
  const previousPolicy = await fileAt(read, root, '.changeplane.json', base.sha, true);
  let policy;
  try { policy = previousPolicy === null ? null : JSON.parse(previousPolicy); }
  catch { throw new CollectionError('POLICY_INVALID'); }
  if (policy) {
    try { validatePolicy(policy); }
    catch { throw new CollectionError('POLICY_INVALID'); }
  }
  else if (previousPolicy !== null) throw new CollectionError('POLICY_INVALID');
  const workflows = list(await read(`${root}/actions/workflows?per_page=100`), 'workflows')
    .filter(item => item.state === 'active' && positive(item.id) && label(item.name) && githubWorkflowFilePath(item.path) === item.path);
  const runs = list(await read(`${root}/actions/runs?head_sha=${headSha}&per_page=100`), 'workflow_runs');
  const newest = new Map();
  for (const run of runs) {
    if (run.head_sha !== headSha || !workflows.some(item => item.id === run.workflow_id && item.path === githubWorkflowFilePath(run.path))) continue;
    requireSetup(positive(run.id) && positive(run.run_number) && positive(run.run_attempt));
    const prior = newest.get(run.workflow_id);
    if (!prior || run.run_number > prior.run_number || (run.run_number === prior.run_number && run.run_attempt > prior.run_attempt)) newest.set(run.workflow_id, run);
  }
  if (newest.size > 20) throw new CollectionError('COLLECTION_LIMIT');
  const candidates = [];
  for (const run of newest.values()) {
    const known = workflows.find(item => item.id === run.workflow_id);
    const jobs = list(await read(`${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`), 'jobs');
    for (const job of jobs) {
      if (!label(job.name) || jobs.filter(item => item.name === job.name).length !== 1) continue;
      requireSetup(positive(job.id) && job.run_id === run.id && job.head_sha === headSha);
      candidates.push({ name: job.name, appSlug: 'github-actions', workflowPath: known.path, workflowName: known.name });
    }
  }
  const finish = async report => {
    const finalRepo = await read(root);
    const finalBase = await read(`${root}/commits/${encodeURIComponent(repo.default_branch)}`);
    if (finalRepo.id !== repo.id || finalRepo.default_branch !== repo.default_branch || finalBase.sha !== base.sha || await readTarget() !== headSha) {
      throw new CollectionError('EVIDENCE_CHANGED');
    }
    return { schemaVersion: 1, kind: 'changeplane.setup-plan', repository, baseSha: base.sha, observedHeadSha: headSha,
      candidates, authority, ...report };
  };
  if (!check) return finish({ decision: 'SELECTION_REQUIRED', code: 'SETUP_SELECTION_REQUIRED', files: [], nextAction: messages.SETUP_SELECTION_REQUIRED });
  const selected = candidates.filter(item => item.name === check && item.workflowPath === workflow);
  requireSetup(selected.length === 1, 'SETUP_CHECK_NOT_FOUND');
  const requirement = { name: check, appSlug: 'github-actions', workflowPath: workflow };
  policy ??= { protectedPaths: { requireApproval: ['infra/**'], block: ['secrets/**'] }, evidence: { requiredChecks: [] } };
  const requirements = policy.evidence.requiredChecks;
  requireSetup(!requirements.some(item => item.name === check && item.appSlug === requirement.appSlug
    && item.workflowPath !== workflow), 'SETUP_CHECK_CONFLICT');
  if (!requirements.some(item => canonical(item) === canonical(requirement))) requirements.push(requirement);
  if (coordination) {
    const capacity = maxActive ?? policy.team?.maxActive ?? 3;
    requireSetup(positive(capacity) && capacity <= 20);
    policy.team = { ...policy.team, enabled: true, maxActive: capacity };
  }
  validatePolicy(policy);
  const names = [];
  for (const item of requirements.filter(item => item.appSlug === 'github-actions')) {
    const matches = workflows.filter(entry => entry.path === item.workflowPath);
    requireSetup(matches.length === 1, 'SETUP_WORKFLOW_INVALID');
    await fileAt(read, root, item.workflowPath, base.sha);
    names.push(matches[0].name);
  }
  const { revision, templates } = runtime();
  requireSetup(sha.test(revision), 'SETUP_RUNTIME_INVALID');
  const sources = {
    '.changeplane.json': JSON.stringify(policy, null, 2) + '\n',
    '.github/workflows/changeplane-community.yml': templates[templatePaths[0]]
      .replace(/workflows: \[CI\]/u, `workflows: ${JSON.stringify([...new Set(names)])}`)
      .replace(/changeplane\/community@(?:COMMUNITY_RELEASE_SHA|[a-f0-9]{40})/gu, `changeplane/community@${revision}`),
  };
  if (coordination) {
    sources['.github/workflows/changeplane-team.yml'] = templates[templatePaths[1]]
      .replace(/ref: (?:CHANGEPLANE_TEAM_RELEASE_SHA|[a-f0-9]{40})/u, `ref: ${revision}`)
      .replace('workflows: [CI, ChangePlane review signal]', `workflows: ${JSON.stringify([...new Set([...names, 'ChangePlane review signal'])])}`);
    sources['.github/workflows/changeplane-team-review-signal.yml'] = templates[templatePaths[2]];
  }
  const files = [];
  for (const [path, content] of Object.entries(sources)) {
    const previous = path === '.changeplane.json' ? previousPolicy : await fileAt(read, root, path, base.sha, true);
    requireSetup(path === '.changeplane.json' || previous === null || previous === content, 'SETUP_WORKFLOW_EXISTS');
    files.push({ path, change: previous === null ? 'create' : previous === content ? 'unchanged' : 'update',
      previousDigest: previous === null ? null : digest(previous), content });
  }
  return finish({ decision: 'REVIEW_REQUIRED', runtimeRevision: revision, files,
    nextAction: 'Review these files and selected CI behavior, apply them on one feature branch based on baseSha, and open a configuration PR. Re-run setup if the default branch changes. No installation or assessment has occurred.' });
}

/** Stage a complete plan in a new directory; never update an existing checkout. */
export function writeSetupPlan(plan, destination) {
  requireSetup(plan.decision === 'REVIEW_REQUIRED' && plan.files?.length > 0);
  const root = resolve(destination);
  try { mkdirSync(root, { mode: 0o700 }); }
  catch { throw new SetupError('SETUP_OUTPUT_EXISTS'); }
  try {
    for (const file of plan.files) {
      requireSetup(['.changeplane.json', '.github/workflows/changeplane-community.yml', '.github/workflows/changeplane-team.yml',
        '.github/workflows/changeplane-team-review-signal.yml'].includes(file.path));
      const path = resolve(root, file.path);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, file.content, { flag: 'wx', mode: 0o600 });
    }
    writeFileSync(resolve(root, 'changeplane-setup.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch { throw new SetupError('SETUP_OUTPUT_FAILED'); }
}
