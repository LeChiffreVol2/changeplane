import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { inspectPipeline, REVIEW_BYTES } from './pipeline.js';
import { CollectionError } from './transport.js';

const hex = /^[a-f0-9]{64}$/u;
const privateDirectory = path => {
  try { mkdirSync(path, { recursive: true, mode: 0o700 }); } catch { throw new CollectionError('SESSION_UNAVAILABLE'); }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077)) throw new CollectionError('SESSION_UNAVAILABLE');
};
function readJson(path, limit) {
  let fd;
  try {
    if (lstatSync(path).isSymbolicLink()) throw new CollectionError('SESSION_UNAVAILABLE');
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new CollectionError('SESSION_UNAVAILABLE');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw new CollectionError('SESSION_UNAVAILABLE'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
function writePrivate(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
const writeJson = (path, value) => writePrivate(path, JSON.stringify(value) + '\n');

/** Local continuation only. Every result re-reads GitHub; saved state has no approval authority. */
export async function followPipeline(options, { directory, inspect = inspectPipeline, runReview } = {}) {
  if (!isAbsolute(directory ?? '') || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(options.repository)
    || !Number.isSafeInteger(options.number) || options.number < 1) throw new CollectionError('INPUT_INVALID');
  const root = resolve(directory); privateDirectory(root);
  const id = createHash('sha256').update(`${options.repository.toLowerCase()}#${options.number}`).digest('hex');
  const slot = join(root, id); privateDirectory(slot);
  const lock = join(slot, 'lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new CollectionError('SESSION_BUSY'); }
  try {
    const statePath = join(slot, 'state.json');
    const saved = readJson(statePath, REVIEW_BYTES + 4096);
    if (saved && (saved.schemaVersion !== 1 || !hex.test(saved.requestId))) throw new CollectionError('SESSION_UNAVAILABLE');
    const { runReview: enabled, ...input } = options;
    let current = await inspect({ ...input, review: undefined, requestId: undefined, waitSeconds: undefined });
    const request = current.reviewRequest;
    const requestPath = join(slot, 'request.json'), resultPath = join(slot, `review-${request.id}.json`);
    writeJson(requestPath, request);
    const same = saved?.requestId === request.id;
    let review = input.review, requestId = input.requestId;
    if (review === undefined && same && saved.review !== undefined) { review = saved.review; requestId = saved.requestId; }
    if (review === undefined) {
      const receipt = readJson(resultPath, REVIEW_BYTES + 4096);
      if (receipt) {
        if (receipt.requestId !== request.id || receipt.review === undefined) throw new CollectionError('SESSION_UNAVAILABLE');
        review = receipt.review; requestId = receipt.requestId;
      }
    }
    if (enabled) {
      if (typeof runReview !== 'function') throw new CollectionError('REVIEW_RUNNER_UNAVAILABLE');
      if (current.ci.decision === 'BLOCKED') return current;
      if (review === undefined) {
        review = await runReview(request, { signal: input.signal }); requestId = request.id;
        // Capture the report before another network request so a transient GitHub error
        // never requires another model call. It is still untrusted on every resume.
        if (Buffer.byteLength(JSON.stringify(review)) > REVIEW_BYTES) throw new CollectionError('INPUT_INVALID');
        writeJson(resultPath, { requestId, review });
      }
    }
    if (review !== undefined) current = await inspect({ ...input, review, requestId });
    const accepted = current.reviewRequest.id === requestId && !['unavailable', 'stale'].includes(current.review.status);
    writeJson(statePath, { schemaVersion: 1, requestId: current.reviewRequest.id,
      ...(accepted ? { review } : {}), observedAt: new Date().toISOString() });
    if (current.reviewRequest.id !== request.id) writeJson(requestPath, current.reviewRequest);
    const humanReviewPath = join(slot, 'human-review.md');
    writePrivate(humanReviewPath, current.humanReview.reviewBody + '\n');
    return { ...current, session: { id, resumed: Boolean(same), invalidated: Boolean(saved && !same),
      requestPath, resultPath: join(slot, `review-${current.reviewRequest.id}.json`), humanReviewPath,
      nextAction: 'Repeat follow for this PR to resume against fresh GitHub state. Saved reports never authorize approval, repair or merge. Stop the current process before manually clearing a stranded lock; delete this private session directory to forget its reports.' } };
  } finally { rmSync(lock, { recursive: true, force: true }); }
}
