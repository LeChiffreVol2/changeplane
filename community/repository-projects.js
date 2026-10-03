import { canonical } from './core.js';
import { operateTeam } from './team-github.js';
import { TeamError, requireTeam } from './team.js';
import { issueRevision } from './repository-issue.js';

const nodeId = value => typeof value === 'string' && /^[A-Za-z0-9_=-]{1,200}$/u.test(value);
const QUERY = `query ChangePlaneDeliveryProject($owner: String!, $name: String!, $issue: Int!, $project: ID!) {
  repository(owner: $owner, name: $name) { databaseId nameWithOwner
    issue(number: $issue) { id fullDatabaseId number
      projectItems(first: 20, includeArchived: false) { pageInfo { hasNextPage }
        nodes { id isArchived project { id }
          fieldValues(first: 30) { pageInfo { hasNextPage }
            nodes { ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2SingleSelectField { id } } } }
          }
        }
      }
    }
  }
  node(id: $project) { ... on ProjectV2 { id closed
    fields(first: 50) { pageInfo { hasNextPage } nodes { ... on ProjectV2SingleSelectField { id options { id } } } }
  } }
}`;
const MUTATION = `mutation ChangePlaneDeliveryProjectSync($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) {
    projectV2Item { id }
  }
}`;

function complete(connection, max) {
  requireTeam(connection?.pageInfo?.hasNextPage === false && Array.isArray(connection.nodes)
    && connection.nodes.length <= max && connection.nodes.every(node => node && typeof node === 'object'), 'PROJECT_COLLECTION_INCOMPLETE');
  return connection.nodes;
}

/** Operator controller only. Configuration and its credential must stay outside the model process. */
export async function syncProjectDelivery({ api, issue, expectedDigest, project, token, writeEnabled = false, fetchImpl = fetch }) {
  requireTeam(writeEnabled === true && typeof token === 'string' && token.length > 0, 'PROJECT_WRITES_DISABLED');
  requireTeam(api && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(api.repository)
    && api.root === `/repos/${api.repository}` && typeof api.request === 'function'
    && Number.isSafeInteger(issue) && issue > 0 && typeof expectedDigest === 'string' && /^[a-f0-9]{64}$/u.test(expectedDigest)
    && project && [project.id, project.fieldId, project.optionId].every(nodeId), 'PROJECT_INPUT_INVALID');
  const observe = async () => {
    const report = await operateTeam({ api, command: { action: 'delivery', issue } });
    requireTeam(report.kind === 'changeplane.issue-delivery' && report.repository === api.repository && report.issue === issue
      && Number.isSafeInteger(report.repositoryId) && report.repositoryId > 0 && Number.isSafeInteger(report.issueId) && report.issueId > 0
      && report.confirmed === true && report.readyForAcceptance === true && report.digest === expectedDigest
      && report.receipt?.digest === expectedDigest && Array.isArray(report.blockers) && report.blockers.length === 0,
    'PROJECT_DELIVERY_CHANGED');
    return report;
  };
  const report = await observe();
  const policyFile = await api.request('GET', `${api.root}/contents/.changeplane.json?ref=${report.policySha}`);
  requireTeam(policyFile?.type === 'file' && policyFile.encoding === 'base64' && Number.isSafeInteger(policyFile.size)
    && policyFile.size > 0 && policyFile.size <= 64_000 && typeof policyFile.content === 'string' && policyFile.content.length <= 96_000,
  'PROJECT_POLICY_DISABLED');
  let policy;
  try { policy = JSON.parse(Buffer.from(policyFile.content, 'base64').toString('utf8')); }
  catch { throw new TeamError('PROJECT_POLICY_DISABLED'); }
  requireTeam(policy.team?.projectSyncEnabled === true, 'PROJECT_POLICY_DISABLED');

  async function graph(query, variables, mutation = false) {
    const code = mutation ? 'PROJECT_WRITE_UNCERTAIN' : 'PROJECT_SOURCE_UNAVAILABLE';
    let response;
    try {
      response = await fetchImpl('https://api.github.com/graphql', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'changeplane-open-source' },
        body: JSON.stringify({ query, variables }) });
    } catch { throw new TeamError(code); }
    if (!response.ok) { await response.body?.cancel(); throw new TeamError(code); }
    try {
      const chunks = []; let size = 0;
      const stream = response.body.getReader();
      for (;;) {
        const { value, done } = await stream.read(); if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) { await stream.cancel(); throw new Error(); }
        chunks.push(value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requireTeam(result && !result.errors && result.data && typeof result.data === 'object', code);
      return result.data;
    } catch { throw new TeamError(code); }
  }
  const [owner, name] = api.repository.split('/');
  async function inspect() {
    const data = await graph(QUERY, { owner, name, issue, project: project.id });
    const repository = data.repository, target = repository?.issue;
    requireTeam(repository?.databaseId === report.repositoryId && repository.nameWithOwner?.toLowerCase() === api.repository.toLowerCase()
      && target?.number === issue && String(target.fullDatabaseId) === String(report.issueId) && nodeId(target.id), 'PROJECT_TARGET_INVALID');
    requireTeam(data.node?.id === project.id && data.node.closed === false, 'PROJECT_TARGET_INVALID');
    const fields = complete(data.node.fields, 50).filter(field => field.id === project.fieldId);
    requireTeam(fields.length === 1 && Array.isArray(fields[0].options) && fields[0].options.length <= 100
      && fields[0].options.filter(option => option?.id === project.optionId).length === 1, 'PROJECT_TARGET_INVALID');
    const items = complete(target.projectItems, 20).filter(item => item.project?.id === project.id);
    requireTeam(items.length === 1 && nodeId(items[0].id) && items[0].isArchived === false, 'PROJECT_TARGET_INVALID');
    const values = complete(items[0].fieldValues, 30).filter(value => value.field?.id === project.fieldId);
    requireTeam(values.length <= 1 && (!values.length || values[0].optionId === null || nodeId(values[0].optionId)), 'PROJECT_TARGET_INVALID');
    return { issueNodeId: target.id, itemId: items[0].id, optionId: values[0]?.optionId ?? null };
  }
  const initial = await inspect();
  const latest = await observe();
  const current = await inspect();
  requireTeam(canonical(initial) === canonical(current), 'PROJECT_ITEM_CHANGED');
  async function recheckBinding(code) {
    // Bound the complete pre-write observation without re-reading every merged PR.
    const repository = await api.request('GET', api.root);
    const base = await api.request('GET', `${api.root}/commits/${encodeURIComponent(repository.default_branch)}`);
    const ref = await api.request('GET', `${api.root}/git/ref/heads/changeplane/team-state`);
    const currentIssue = await api.request('GET', `${api.root}/issues/${issue}`);
    requireTeam(repository.id === report.repositoryId && repository.full_name?.toLowerCase() === api.repository.toLowerCase()
      && base.sha === report.baseSha && ref.ref === 'refs/heads/changeplane/team-state' && ref.object?.type === 'commit'
      && ref.object.sha === latest.revision && currentIssue.id === report.issueId && currentIssue.number === issue
      && currentIssue.repository_url?.toLowerCase() === `https://api.github.com${api.root}`.toLowerCase()
      && issueRevision(currentIssue) === report.issueRevision, code);
  }
  await recheckBinding('PROJECT_DELIVERY_CHANGED');
  const result = status => ({ schemaVersion: 1, kind: 'changeplane.project-delivery-sync', repository: api.repository, repositoryId: report.repositoryId,
    issue, issueId: report.issueId, deliveryDigest: expectedDigest, baseSha: report.baseSha, policySha: report.policySha,
    projectId: project.id, itemId: current.itemId, fieldId: project.fieldId, optionId: project.optionId, status,
    authority: { sourceWrites: false, guardPublished: false, repairAuthorized: false, mergeAuthorized: false },
    limitation: 'This updates one existing Project field from an operator-confirmed delivery receipt. It does not certify acceptance or provide an atomic lock over GitHub.' });
  if (current.optionId === project.optionId) return result('already-synced');
  const applied = await graph(MUTATION, { project: project.id, item: current.itemId, field: project.fieldId, option: project.optionId }, true);
  requireTeam(applied.updateProjectV2ItemFieldValue?.projectV2Item?.id === current.itemId, 'PROJECT_WRITE_UNCERTAIN');
  try {
    const after = await inspect();
    requireTeam(after.issueNodeId === current.issueNodeId && after.itemId === current.itemId && after.optionId === project.optionId, 'PROJECT_WRITE_UNCERTAIN');
    // Keep the shared 200-read budget bounded even for twenty archived tasks.
    await recheckBinding('PROJECT_WRITE_UNCERTAIN');
  } catch { throw new TeamError('PROJECT_WRITE_UNCERTAIN'); }
  return result('synced');
}
