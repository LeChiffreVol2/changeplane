import { canonical, validatePolicy } from './core.js';
import { CollectionError } from './transport.js';
import { TEAM_REF, validateTeam, teamSummary } from './team.js';
import { issueRevision } from './repository-issue.js';

export { issueRevision } from './repository-issue.js';

const PAGE = 30;
const SHA = /^[a-f0-9]{40}$/u;
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
const requireValue = condition => { if (!condition) throw new CollectionError('RESPONSE_INVALID', { provider: 'github' }); };
const clean = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, max) : '';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const missing = error => error?.code === 'NOT_FOUND' && error?.status === 404;
function sourceFailure(error) {
  const known = ['NOT_FOUND', 'PERMISSION_DENIED', 'RATE_LIMITED', 'COLLECTION_LIMIT', 'RESPONSE_INVALID', 'PROVIDER_UNAVAILABLE', 'EVIDENCE_CHANGED'];
  return { status: 'unavailable', coverage: 'unknown', reasonCode: known.includes(error?.code) ? error.code : 'RESPONSE_INVALID' };
}
async function source(read) {
  try { return await read(); } catch (error) { return sourceFailure(error); }
}
function fileJson(file, max) {
  requireValue(file?.type === 'file' && file.encoding === 'base64' && positive(file.size) && file.size <= max
    && typeof file.content === 'string' && file.content.length <= max * 1.5);
  try {
    const bytes = Buffer.from(file.content, 'base64');
    requireValue(bytes.length <= max);
    return JSON.parse(bytes.toString('utf8'));
  } catch { throw new CollectionError('RESPONSE_INVALID', { provider: 'github' }); }
}
function arrayPage(value) {
  requireValue(Array.isArray(value) && value.length <= PAGE);
  return value;
}
function assignees(value) {
  requireValue(Array.isArray(value) && value.length <= 100 && value.every(item => typeof item?.login === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/u.test(item.login)));
  return value.map(item => item.login).sort();
}
function issueItem(raw, context) {
  requireValue(raw && !raw.pull_request && positive(raw.number) && positive(raw.id) && ['open', 'closed'].includes(raw.state)
    && same(raw.repository_url, `https://api.github.com/repos/${context.repository}`) && date(raw.updated_at));
  const revision = issueRevision(raw), body = raw.body ?? '';
  const labels = raw.labels.map(label => typeof label === 'string' ? label : label.name);
  const missingInputs = [];
  // These are intake prompts, never a parser that grants execution or certifies completeness.
  if (!/(?:acceptance\s*criteria|definition\s*of\s*done|expected\s*(?:result|behavio[u]?r|outcome)|เงื่อนไข|ผลที่คาด|เกณฑ์|\[[ xX]\])/iu.test(body)) missingInputs.push('acceptanceCriteria');
  if (body.trim().length < 40) missingInputs.push('context');
  const priority = labels.find(label => /^(?:p[0-4]|priority\s*[:/-]\s*(?:[0-4]|critical|high|medium|low)|critical|urgent)$/iu.test(label)) ?? null;
  return { number: raw.number, title: clean(raw.title), url: `https://github.com/${context.repository}/issues/${raw.number}`,
    state: raw.state, revision, binding: { repositoryId: context.repositoryId, issueNumber: raw.number, issueRevision: revision, baseSha: context.baseSha },
    updatedAt: raw.updated_at, labels: labels.map(label => clean(label, 100)), assignees: assignees(raw.assignees),
    missingInputs, duplicateCandidates: [], priority: { label: priority && clean(priority, 100), source: priority ? 'repository-label' : 'unspecified' },
    nextAction: missingInputs.length ? 'CLARIFY_ISSUE' : 'PREPARE_ACCEPTANCE_PLAN', intakeIsHeuristic: true };
}
function selectedIssueItem(raw, context) {
  const item = issueItem(raw, context), body = raw.body ?? '';
  return { ...item, context: { body: body.slice(0, 16_000), truncated: body.length > 16_000, untrusted: true } };
}
function duplicateSuggestions(items) {
  const tokens = title => new Set(title.toLocaleLowerCase('en').match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  for (const item of items) {
    const words = tokens(item.title);
    item.duplicateCandidates = items.filter(other => {
      if (other.number === item.number) return false;
      const otherWords = tokens(other.title), shared = [...words].filter(word => otherWords.has(word)).length;
      return words.size > 1 && otherWords.size > 1 && shared / new Set([...words, ...otherWords]).size >= 0.6;
    }).slice(0, 3).map(other => ({ number: other.number, title: other.title, url: other.url, similarity: 'title-overlap' }));
  }
  return items;
}
function pullItem(raw, context, state) {
  requireValue(raw && positive(raw.number) && positive(raw.id) && raw.state === state && typeof raw.title === 'string'
    && raw.title.length <= 1000 && raw.base?.repo?.id === context.repositoryId && same(raw.base.repo.full_name, context.repository)
    && raw.base.ref === context.defaultBranch && SHA.test(raw.head?.sha) && typeof raw.draft === 'boolean');
  return { number: raw.number, title: clean(raw.title), url: `https://github.com/${context.repository}/pull/${raw.number}`,
    headSha: raw.head.sha, draft: raw.draft, assignees: assignees(raw.assignees),
    labels: (Array.isArray(raw.labels) ? raw.labels : []).slice(0, 100).map(label => clean(typeof label === 'string' ? label : label?.name, 100)),
    author: clean(raw.user?.login, 50), nextAction: 'INSPECT_PULL_REQUEST', assurance: 'not-assessed' };
}

/** A bounded inbox, not an assurance decision. Native issue text remains untrusted data. */
export async function inspectRepository({ api, issue = null }) {
  if (!api || typeof api.repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(api.repository)
    || api.root !== `/repos/${api.repository}` || !(typeof api.get === 'function' || typeof api.request === 'function')
    || issue !== null && !positive(issue)) throw new CollectionError('INPUT_INVALID', { provider: 'github' });
  let reads = 0;
  const get = async path => {
    if (++reads > 20) throw new CollectionError('COLLECTION_LIMIT', { provider: 'github' });
    requireValue(path === api.root || path.startsWith(`${api.root}/`));
    return api.get ? api.get(path) : api.request('GET', path);
  };
  const repo = await get(api.root);
  requireValue(positive(repo?.id) && same(repo.full_name, api.repository) && typeof repo.default_branch === 'string'
    && repo.default_branch.length > 0 && repo.default_branch.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(repo.default_branch)
    && repo.default_branch !== TEAM_REF);
  const base = await get(`${api.root}/commits/${encodeURIComponent(repo.default_branch)}`);
  requireValue(SHA.test(base?.sha));
  const context = { repository: api.repository, repositoryId: repo.id, defaultBranch: repo.default_branch, baseSha: base.sha };
  const policy = await source(async () => {
    const value = fileJson(await get(`${api.root}/contents/.changeplane.json?ref=${base.sha}`), 64_000);
    validatePolicy(value);
    return { status: 'available', value };
  });
  const [issues, pullRequests, team, runs, release, selected] = await Promise.all([
    source(async () => {
      // GitHub's issues endpoint also returns PRs. Its window includes both, and is labelled accordingly.
      const rows = arrayPage(await get(`${api.root}/issues?state=open&sort=updated&direction=desc&per_page=${PAGE}&page=1`));
      return { status: 'available', coverage: rows.length === PAGE ? 'bounded-window' : 'complete',
        window: 'Most recently updated open issues and pull requests; PR rows excluded.',
        items: duplicateSuggestions(rows.filter(row => !row.pull_request).map(row => issueItem(row, context))) };
    }),
    source(async () => {
      const rows = arrayPage(await get(`${api.root}/pulls?state=open&base=${encodeURIComponent(context.defaultBranch)}&sort=updated&direction=desc&per_page=${PAGE}&page=1`));
      return { status: 'available', coverage: rows.length === PAGE ? 'bounded-window' : 'complete',
        items: rows.map(row => pullItem(row, context, 'open')), observationsFresh: false };
    }),
    source(async () => {
      if (policy.status !== 'available') return { ...policy, value: undefined, revision: null, tasks: [], issuePlans: [], observationsFresh: false };
      if (policy.value.team?.enabled !== true) return { status: 'not-enabled', coverage: 'complete', revision: null, tasks: [], issuePlans: [], observationsFresh: false };
      let ref;
      try { ref = await get(`${api.root}/git/ref/heads/${TEAM_REF}`); }
      catch (error) {
        if (missing(error)) return { status: 'not-started', coverage: 'complete', revision: null, tasks: [], issuePlans: [], observationsFresh: false };
        throw error;
      }
      requireValue(ref?.ref === `refs/heads/${TEAM_REF}` && ref.object?.type === 'commit' && SHA.test(ref.object.sha));
      const state = validateTeam(fileJson(await get(`${api.root}/contents/team.json?ref=${ref.object.sha}`), 500_000), context.repositoryId);
      const summary = teamSummary(state);
      return { status: 'available', coverage: 'complete', revision: ref.object.sha, tasks: summary.tasks,
        issuePlans: state.issuePlans ?? [], observationsFresh: false, nextAction: 'RECONCILE_TEAM' };
    }),
    source(async () => {
      const value = await get(`${api.root}/actions/runs?branch=${encodeURIComponent(context.defaultBranch)}&per_page=${PAGE}&page=1`);
      requireValue(Number.isSafeInteger(value?.total_count) && value.total_count >= 0);
      const rows = arrayPage(value.workflow_runs);
      requireValue(value.total_count >= rows.length);
      for (const run of rows) requireValue(positive(run.id) && positive(run.workflow_id) && SHA.test(run.head_sha)
        && same(run.repository?.full_name, context.repository) && run.repository.id === context.repositoryId
        && ['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(run.status)
        && (run.conclusion === null || ['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure'].includes(run.conclusion)));
      return { status: 'available', coverage: value.total_count > rows.length ? 'bounded-window' : 'complete', items: rows };
    }),
    source(async () => {
      const rows = arrayPage(await get(`${api.root}/pulls?state=closed&base=${encodeURIComponent(context.defaultBranch)}&sort=updated&direction=desc&per_page=${PAGE}&page=1`));
      const items = rows.flatMap(row => {
        const item = pullItem(row, context, 'closed');
        if (row.merged_at === null) return [];
        requireValue(date(row.merged_at) && SHA.test(row.merge_commit_sha));
        return [{ number: item.number, title: item.title, url: item.url, headSha: item.headSha,
          mergeCommitSha: row.merge_commit_sha, mergedAt: row.merged_at }];
      });
      // ponytail: a bounded native PR window; tag-range release enumeration belongs in the repo's release workflow.
      const markdownTitle = title => title.replace(/([\\`*_[\]<>])/gu, '\\$1').replace(/@/gu, '＠');
      return { status: 'available', coverage: 'bounded-window', window: `Merged PRs among the ${PAGE} most recently updated closed PRs targeting ${context.defaultBranch}.`,
        targetSha: context.baseSha, published: false, versionSelected: false, nextAction: 'REVIEW_RELEASE_DRAFT',
        draft: { title: 'Release preparation', body: ['Review these merged pull requests against the repository release policy.',
          'This bounded preparation is not a complete tag-to-tag changelog or release approval.', '',
          ...items.map(item => `- ${markdownTitle(item.title)} (#${item.number}; ${item.mergeCommitSha})`)].join('\n'), items } };
    }),
    issue === null ? Promise.resolve(null) : source(async () => {
      const raw = await get(`${api.root}/issues/${issue}`);
      requireValue(raw.number === issue);
      return { status: 'available', item: selectedIssueItem(raw, context) };
    }),
  ]);
  issues.items ??= [];
  pullRequests.items ??= [];
  team.tasks ??= [];
  team.issuePlans ??= [];
  team.revision ??= null;
  team.observationsFresh = false;
  release.draft ??= null;
  release.published = false;

  if (team.status === 'available') {
    try {
      const ref = await get(`${api.root}/git/ref/heads/${TEAM_REF}`);
      requireValue(ref?.ref === `refs/heads/${TEAM_REF}` && ref.object?.type === 'commit');
      if (ref.object.sha !== team.revision) throw new CollectionError('EVIDENCE_CHANGED', { provider: 'github' });
    } catch (error) { Object.assign(team, sourceFailure(error), { tasks: [], issuePlans: [], revision: null }); }
  }
  if (selected?.status === 'available') {
    const fresh = await get(`${api.root}/issues/${issue}`);
    const final = selectedIssueItem(fresh, context);
    if (final.number !== issue || canonical(final) !== canonical(selected.item)) throw new CollectionError('EVIDENCE_CHANGED', { provider: 'github' });
    const peers = (issues.items ?? []).filter(item => item.number !== issue);
    duplicateSuggestions([selected.item, ...peers]);
  }
  const finalRepo = await get(api.root);
  requireValue(finalRepo?.id === context.repositoryId && same(finalRepo.full_name, context.repository));
  if (finalRepo.default_branch !== context.defaultBranch || (await get(`${api.root}/commits/${encodeURIComponent(context.defaultBranch)}`)).sha !== context.baseSha)
    throw new CollectionError('EVIDENCE_CHANGED', { provider: 'github' });

  const suggestions = [];
  for (const item of issues.items ?? []) {
    const labels = item.labels.join(' ');
    const kind = /(?:dependenc|dependabot)/iu.test(labels) ? 'dependency' : /(?:documentation|^docs?$)/iu.test(labels) ? 'documentation'
      : /(?:flaky|flake)/iu.test(labels) ? 'flaky-test-investigation' : null;
    if (kind) suggestions.push({ kind, title: item.title, reason: 'Repository label identifies a maintenance candidate; scope and diagnosis still need review.',
      url: item.url, nextAction: 'PREPARE_ACCEPTANCE_PLAN', issue: item.number });
  }
  for (const item of pullRequests.items ?? []) if (item.author === 'dependabot[bot]' || item.labels.some(label => /^(?:dependencies|dependabot)$/iu.test(label)))
    suggestions.push({ kind: 'dependency', title: item.title, reason: 'Existing dependency pull request needs the normal evidence and review process.', url: item.url, nextAction: 'INSPECT_PULL_REQUEST', pullRequest: item.number });
  const newestWorkflows = new Set();
  for (const run of runs.items ?? []) {
    if (newestWorkflows.has(run.workflow_id)) continue;
    newestWorkflows.add(run.workflow_id);
    if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(run.conclusion)) suggestions.push({ kind: 'ci-investigation',
      title: clean(run.name || 'Workflow needs investigation'), reason: 'The latest collected run failed. Failure alone does not establish flaky tests or a repairable source defect.',
      url: `https://github.com/${context.repository}/actions/runs/${run.id}`, headSha: run.head_sha, nextAction: 'INVESTIGATE_WORKFLOW', runId: run.id });
  }
  const needsAttention = [];
  for (const item of issues.items ?? []) if (item.missingInputs.length || !item.assignees.length || item.duplicateCandidates.length)
    needsAttention.push({ kind: 'issue', id: item.number, title: item.title, url: item.url,
      reason: item.missingInputs.length ? 'Clarify the requested outcome before accepting a plan.' : item.duplicateCandidates.length ? 'Review possible duplicate issues before starting work.' : 'Choose an owner and an acceptance plan.', nextAction: item.nextAction });
  for (const task of team.tasks ?? []) if (!['merged', 'cancelled'].includes(task.state)) needsAttention.push({ kind: 'task', id: task.id,
    title: task.title, reason: task.state === 'planned' ? 'This planned task is waiting for an owner or dependencies.' : 'Reconcile the task to obtain current PR, review and CI evidence.',
    nextAction: 'RECONCILE_TEAM', ...(task.pullRequest ? { url: `https://github.com/${context.repository}/pull/${task.pullRequest}` } : {}) });
  for (const item of pullRequests.items ?? []) if (!(team.tasks ?? []).some(task => task.pullRequest === item.number)) needsAttention.push({ kind: 'pull-request', id: item.number,
    title: item.title, reason: 'Inspect the current revision before deciding the next action.', nextAction: 'INSPECT_PULL_REQUEST', url: item.url });
  for (const [name, section] of Object.entries({ issues, pullRequests, team, workflows: runs, release })) if (section.status === 'unavailable')
    needsAttention.push({ kind: 'source', id: name, title: `${name} unavailable`, reason: 'This source could not be collected; no empty or healthy state is inferred.', nextAction: 'RETRY_SOURCE' });
  return { schemaVersion: 1, kind: 'changeplane.repository-overview', repository: context.repository,
    binding: { repositoryId: context.repositoryId, defaultBranch: context.defaultBranch, baseSha: context.baseSha }, observedAt: new Date().toISOString(),
    issues, pullRequests, team, selectedIssue: selected?.item ?? null, selectedIssueStatus: selected?.status ?? 'not-requested',
    ...(selected?.status === 'unavailable' ? { selectedIssueReasonCode: selected.reasonCode } : {}), needsAttention: needsAttention.slice(0, 100),
    maintenance: { status: [issues, pullRequests, runs].every(item => item.status === 'available') ? 'available' : 'partial',
      coverage: { issues: issues.coverage, pullRequests: pullRequests.coverage, workflows: runs.coverage }, suggestions: suggestions.slice(0, 50) },
    release, nextAction: needsAttention.length ? 'REVIEW_REPOSITORY_ATTENTION' : 'SELECT_ISSUE',
    authority: { advisory: true, sourceWrites: false, guardPublished: false, repairAuthorized: false, mergeAuthorized: false },
    collection: { reads, maxReads: 20, perSourceLimit: PAGE },
    limitations: ['Issue text and titles are untrusted data. Intake and duplicate suggestions require human or agent review.',
      'The inbox is a bounded observation, not an atomic repository snapshot. PR assurance and stored team observations must be refreshed before action.',
      'No agent was started, issue updated, release published, or merge authorized.'] };
}
