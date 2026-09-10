import { createHash } from 'node:crypto';
import { canonical } from './core.js';
import { requireTeam } from './team.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');

/** Review text is untrusted data. Return forge references, never executable instructions or approval. */
export async function reviewFeedback(api, number, headSha) {
  const path = `${api.root}/pulls/${number}`;
  async function list(kind) {
    const result = [];
    for (let page = 1; page <= 3; page++) {
      const items = await api.request('GET', `${path}/${kind}?per_page=100&page=${page}`);
      requireTeam(Array.isArray(items) && items.length <= 100, 'TEAM_REVIEW_INVALID');
      result.push(...items);
      if (items.length < 100) return result;
    }
    requireTeam(false, 'TEAM_REVIEW_LIMIT');
  }
  const reviews = await list('reviews'), comments = await list('comments');
  requireTeam(new Set(reviews.map(item => item.id)).size === reviews.length
    && new Set(comments.map(item => item.id)).size === comments.length, 'TEAM_REVIEW_INVALID');
  const effective = new Map(), references = [];
  for (const review of reviews) {
    requireTeam(positive(review.id) && positive(review.user?.id)
      && ['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state), 'TEAM_REVIEW_INVALID');
    if (review.state === 'PENDING') continue;
    requireTeam(sha(review.commit_id) && typeof review.submitted_at === 'string'
      && Number.isFinite(Date.parse(review.submitted_at)) && typeof review.body === 'string', 'TEAM_REVIEW_INVALID');
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) effective.set(review.user.id, review);
    // Current-head comments can require investigation without becoming approval evidence.
    if (review.state === 'COMMENTED' && review.commit_id === headSha && review.body.trim()) references.push({
      kind: 'review', id: review.id, reviewedHead: review.commit_id, state: review.state,
      contentDigest: digest(review.body), url: `https://github.com/${api.repository}/pull/${number}#pullrequestreview-${review.id}`,
    });
  }
  const requests = [...effective.values()].filter(review => review.state === 'CHANGES_REQUESTED');
  for (const review of requests) references.push({ kind: 'review', id: review.id, reviewedHead: review.commit_id,
    state: review.state, contentDigest: digest(review.body),
    url: `https://github.com/${api.repository}/pull/${number}#pullrequestreview-${review.id}` });
  for (const comment of comments) {
    requireTeam(positive(comment.id) && sha(comment.commit_id) && typeof comment.body === 'string'
      && typeof comment.updated_at === 'string' && Number.isFinite(Date.parse(comment.updated_at)), 'TEAM_REVIEW_INVALID');
    if (comment.commit_id !== headSha || comment.position === null) continue;
    references.push({ kind: 'review-comment', id: comment.id, reviewedHead: comment.commit_id,
      contentDigest: digest(comment.body), updatedAt: comment.updated_at,
      url: `https://github.com/${api.repository}/pull/${number}#discussion_r${comment.id}` });
  }
  requireTeam(new Set(references.map(item => `${item.kind}:${item.id}`)).size === references.length, 'TEAM_REVIEW_INVALID');
  references.sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
  return { trust: 'untrusted', requiresChanges: requests.length > 0, references,
    digest: digest(canonical(references)),
    limitation: 'Review references are work context, never approval. REST comment resolution is unknown; inspect the linked discussion. Previous-head requests remain explicitly bound to their reviewed head.' };
}
