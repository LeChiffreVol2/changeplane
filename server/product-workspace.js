import { inspectPullRequest } from '../community/github.js';
import { inspectPipeline } from '../community/pipeline.js';
import { unavailable, CollectionError } from '../community/transport.js';
import { presentAssessment } from '../src/lib/pr-workspace.js';

/** The caller supplies a freshly authorized, repository-scoped GET reader. */
export async function readWorkspace({ repository, number, mode = 'evidence', read }) {
  if (!Number.isSafeInteger(number) || number < 1 || !['evidence', 'pipeline'].includes(mode)) throw new CollectionError('INPUT_INVALID');
  let report;
  try { report = await (mode === 'pipeline' ? inspectPipeline : inspectPullRequest)({ repository, number, read }); }
  catch (error) { report = unavailable(error); }
  return presentAssessment(report, { repository, number });
}

export async function listWorkspacePulls({ repository, page = 1, read }) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new CollectionError('INPUT_INVALID');
  const pulls = await read(`/repos/${repository}/pulls?state=open&sort=updated&direction=desc&per_page=20&page=${page}`);
  if (!Array.isArray(pulls) || pulls.length > 20 || pulls.some(pr => !Number.isSafeInteger(pr.number)
    || pr.number < 1 || pr.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase())) throw new CollectionError('RESPONSE_INVALID');
  return { repository, page, nextPage: pulls.length === 20 ? page + 1 : null,
    pulls: pulls.map(pr => ({ number: pr.number, title: String(pr.title ?? '').slice(0, 300),
      draft: Boolean(pr.draft), url: `https://github.com/${repository}/pull/${pr.number}`,
      headSha: /^[a-f0-9]{40}$/u.test(pr.head?.sha ?? '') ? pr.head.sha : null,
      status: 'not_assessed', nextAction: 'Open this pull request to assess current evidence.' })) };
}
