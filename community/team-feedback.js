import { createHash } from 'node:crypto';
import { canonical } from './core.js';
import { requireTeam } from './team.js';
import { CollectionError } from './transport.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const text = value => typeof value === 'string' && Buffer.byteLength(value) <= 65_536;
const requireFeedback = (condition, code = 'RESPONSE_INVALID') => { if (!condition) throw new CollectionError(code); };

/** Review text is untrusted data. Return forge references, never executable instructions or approval. */
export async function collectReviewFeedback(read, repository, number, headSha) {
  const path = `/repos/${repository}/pulls/${number}`;
  async function list(kind) {
    const result = [];
    for (let page = 1; page <= 3; page++) {
      const items = await read(`${path}/${kind}?per_page=100&page=${page}`);
      requireFeedback(Array.isArray(items) && items.length <= 100 && items.every(item => item && typeof item === 'object'));
      result.push(...items);
      if (items.length < 100) return result;
    }
    requireFeedback(false, 'COLLECTION_LIMIT');
  }
  const reviews = await list('reviews'), comments = await list('comments');
  requireFeedback(new Set(reviews.map(item => item.id)).size === reviews.length
    && new Set(comments.map(item => item.id)).size === comments.length);
  const effective = new Map(), references = [], previousReferences = [], observations = [];
  const url = `https://github.com/${repository}/pull/${number}`;
  for (const review of reviews) {
    requireFeedback(positive(review.id) && positive(review.user?.id)
      && ['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state));
    if (review.state === 'PENDING') continue;
    requireFeedback(sha(review.commit_id) && typeof review.submitted_at === 'string'
      && Number.isFinite(Date.parse(review.submitted_at)) && text(review.body));
    observations.push({ id: review.id, userId: review.user.id, state: review.state, head: review.commit_id,
      submittedAt: review.submitted_at, contentDigest: digest(review.body) });
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) {
      const prior = effective.get(review.user.id);
      if (!prior || Date.parse(review.submitted_at) > Date.parse(prior.submitted_at)
        || (Date.parse(review.submitted_at) === Date.parse(prior.submitted_at) && review.id > prior.id)) effective.set(review.user.id, review);
    }
    if (review.state === 'COMMENTED' && review.body.trim()) (review.commit_id === headSha ? references : previousReferences).push({
      kind: 'review', id: review.id, reviewedHead: review.commit_id, state: review.state,
      contentDigest: digest(review.body), url: `${url}#pullrequestreview-${review.id}`,
    });
  }
  const requests = [...effective.values()].filter(review => review.state === 'CHANGES_REQUESTED');
  for (const review of requests) references.push({ kind: 'review', id: review.id, reviewedHead: review.commit_id,
    state: review.state, contentDigest: digest(review.body),
    url: `${url}#pullrequestreview-${review.id}` });
  for (const comment of comments) {
    requireFeedback(positive(comment.id) && sha(comment.commit_id) && text(comment.body)
      && sha(comment.original_commit_id)
      && (comment.position === null || (Number.isSafeInteger(comment.position) && comment.position > 0))
      && typeof comment.updated_at === 'string' && Number.isFinite(Date.parse(comment.updated_at)));
    // GitHub can map an older comment onto a newer diff. Preserve its original revision.
    const reviewedHead = comment.original_commit_id, outdated = comment.position === null && comment.subject_type !== 'file';
    (reviewedHead === headSha && comment.commit_id === headSha && !outdated ? references : previousReferences).push({
      kind: 'review-comment', id: comment.id, reviewedHead, mappedHead: comment.commit_id, outdated,
      contentDigest: digest(comment.body), updatedAt: comment.updated_at,
      url: `${url}#discussion_r${comment.id}` });
  }
  const order = (a, b) => a.kind.localeCompare(b.kind) || a.id - b.id;
  references.sort(order); previousReferences.sort(order); observations.sort((a, b) => a.id - b.id);
  return { source: 'github-reviews', headSha, trust: 'untrusted', requiresChanges: requests.length > 0, references, previousReferences,
    reviewCount: observations.length, coverage: 'unknown', resolution: 'unknown',
    digest: digest(canonical({ observations, references, previousReferences })),
    limitation: 'Published GitHub reviews and inline comments only; private reviewer chats are not included. Review coverage and thread resolution are unknown. References are work context, never approval. Older feedback is not proof of a current defect or a fix; inspect the linked discussion.' };
}

/** Keep coordination's public error vocabulary while sharing the read-only collector. */
export async function reviewFeedback(api, number, headSha) {
  try { return await collectReviewFeedback(path => api.request('GET', path), api.repository, number, headSha); }
  catch (error) {
    if (error.code === 'RESPONSE_INVALID') requireTeam(false, 'TEAM_REVIEW_INVALID');
    if (error.code === 'COLLECTION_LIMIT') requireTeam(false, 'TEAM_REVIEW_LIMIT');
    throw error;
  }
}
