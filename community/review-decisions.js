import { canonical } from './core.js';
import { CollectionError } from './transport.js';

const marker = 'changeplane:review-decision:v1';
const protectedCode = 'PROTECTED_PATH_REQUIRES_APPROVAL';
const hex = /^[a-f0-9]{64}$/u;
const reason = value => typeof value === 'string' && value.trim().length >= 3 && value.length <= 1000
  && !/[\u0000-\u001f\u007f]/u.test(value) && value !== 'REPLACE_WITH_YOUR_REASON';
function decision(body) {
  if (typeof body !== 'string' || body.length > 64_000) return null;
  const parts = [...body.matchAll(/<!-- changeplane:review-decision:v1\s+([\s\S]*?)-->/gu)];
  if (parts.length !== 1) return null;
  try {
    const value = JSON.parse(parts[0][1]);
    if (!hex.test(value.requestId) || !(value.reportDigest === null || hex.test(value.reportDigest))) return null;
    for (const [key, identity] of [['reviewedPaths', 'path'], ['dismissedFindings', 'id']]) {
      if (!Array.isArray(value[key]) || value[key].length > 3000
        || value[key].some(item => !item || typeof item[identity] !== 'string' || !reason(item.reason))
        || new Set(value[key].map(item => item[identity])).size !== value[key].length) return null;
    }
    return value;
  } catch { return null; }
}

/** Only live repository-writer reviews may resolve advisory holds. No caller-supplied approvals. */
export async function collectHumanReviews(read, root, number, authorId, personalOwnerId) {
  const latest = new Map(); let complete = false;
  for (let page = 1; page <= 4; page++) {
    const batch = await read(`${root}/pulls/${number}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length > 100 || page === 4 && batch.length) throw new CollectionError('COLLECTION_LIMIT');
    for (const review of batch) {
      const selfReview = review?.state === 'COMMENTED' && review.user?.id === authorId && authorId === personalOwnerId && decision(review.body);
      if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review?.state) && !selfReview) continue;
      if (!Number.isSafeInteger(review.id) || review.id < 1 || !Number.isSafeInteger(review.user?.id)
        || !Number.isFinite(Date.parse(review.submitted_at))) throw new CollectionError('COLLECTION_INCOMPLETE');
      if (review.user.type !== 'User' || review.user.id === authorId && !selfReview) continue;
      const prior = latest.get(review.user.id);
      if (!prior || Date.parse(review.submitted_at) > Date.parse(prior.submitted_at)
        || review.submitted_at === prior.submitted_at && review.id > prior.id) latest.set(review.user.id, review);
    }
    if (batch.length < 100) { complete = true; break; }
  }
  if (!complete) throw new CollectionError('COLLECTION_LIMIT');
  const result = [];
  for (const review of latest.values()) {
    const resolution = decision(review.body);
    if (review.state === 'DISMISSED' || review.state === 'APPROVED' && !resolution) continue;
    if (!Number.isSafeInteger(authorId) || !/^[A-Za-z0-9-]{1,39}$/u.test(review.user.login)) throw new CollectionError('COLLECTION_INCOMPLETE');
    const permission = await read(`${root}/collaborators/${encodeURIComponent(review.user.login)}/permission`);
    if (permission.user?.id !== review.user.id) throw new CollectionError('COLLECTION_INCOMPLETE');
    if (!['write', 'maintain', 'admin'].includes(permission.permission)) continue;
    result.push({ id: review.id, reviewer: review.user.login, state: review.state, headSha: review.commit_id, resolution,
      selfReview: review.state === 'COMMENTED' });
  }
  return result.sort((a, b) => a.id - b.id);
}

export function sameReviews(first, second) {
  if (canonical(first) !== canonical(second)) throw new CollectionError('EVIDENCE_CHANGED');
}

export function resolveHumanReview(ci, review, request, observations = []) {
  const paths = new Set(request.binding.files.flatMap(file => [file.path, file.previousPath].filter(Boolean)));
  const ids = new Set(review.findings.map(item => item.id));
  const reviewed = new Set(), dismissed = new Set(), receipts = [];
  const changesRequested = observations.filter(item => item.state === 'CHANGES_REQUESTED');
  for (const observed of observations) {
    const value = observed.resolution;
    if (!(observed.state === 'APPROVED' || observed.state === 'COMMENTED' && observed.selfReview) || observed.headSha !== request.binding.headSha || !value
      || value.requestId !== request.id || value.reportDigest !== (review.reportDigest ?? null)
      || value.reviewedPaths.some(item => !paths.has(item.path)) || value.dismissedFindings.some(item => !ids.has(item.id))) continue;
    value.reviewedPaths.forEach(item => reviewed.add(item.path));
    value.dismissedFindings.forEach(item => dismissed.add(item.id));
    receipts.push({ ...observed, resolution: value });
  }
  // A changes-requested review always holds the advisory pipeline, including when older than the head.
  if (changesRequested.length) { reviewed.clear(); dismissed.clear(); }
  const unresolvedCi = ci.findings.filter(item => item.code !== protectedCode || !reviewed.has(item.path));
  const unresolvedFindings = review.findings.filter(item => !dismissed.has(item.id));
  const missing = [...new Set([...(review.coverage?.missingPaths ?? []), ...(review.coverage?.waivedPaths ?? [])])];
  const coverageResolved = ['complete', 'findings'].includes(review.status)
    || review.status === 'incomplete' && review.humanReviewEligible === true && missing.every(path => reviewed.has(path));
  const requiredPaths = [...new Set([...unresolvedCi.filter(item => item.code === protectedCode).map(item => item.path), ...missing.filter(path => !reviewed.has(path))])];
  const template = { requestId: request.id, reportDigest: review.reportDigest ?? null,
    reviewedPaths: requiredPaths.map(path => ({ path, reason: 'REPLACE_WITH_YOUR_REASON' })),
    dismissedFindings: unresolvedFindings.map(item => ({ id: item.id, reason: 'REPLACE_WITH_YOUR_REASON' })) };
  return { unresolvedCi, complete: coverageResolved && !unresolvedFindings.length && !changesRequested.length,
    observation: { source: 'github-api', receipts, changesRequested, unresolvedFindings, unreviewedPaths: requiredPaths,
      nextAction: 'A human repository writer reviews the listed paths and findings, removes findings that need fixes, replaces each reason, and submits this body as an Approve review at the current head. A personal repository owner who authored the PR can instead submit a Comment review: it records an advisory owner decision, not GitHub approval. ChangePlane only reads the review. Reassess afterward; a new revision invalidates the decision.',
      reviewUrl: `https://github.com/${ci.observation.repository}/pull/${ci.observation.pullRequest}/files`,
      reviewBody: `<!-- ${marker}\n${JSON.stringify(template, null, 2)}\n-->`,
      limitation: 'Resolves advisory pipeline holds only. Original CI scope findings and repository approval/Guard/merge requirements remain intact.' } };
}
