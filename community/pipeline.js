import { createHash } from 'node:crypto';
import { canonical } from './core.js';
import { inspectPullRequest, waitForPullRequest } from './github.js';
import { CollectionError } from './transport.js';
import { normalizeRepoPath } from '../src/lib/changeplane.js';

// Compatibility reference, not an authenticity claim about imported reports.
export const OCR_SOURCE = 'a003b9341a65130b024829101ea35494b56569e1';
export const REVIEW_BYTES = 256_000;
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const hex = /^[a-f0-9]{64}$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 300) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const classes = ['provider', 'timeout', 'cancelled', 'configuration', 'input', 'budget', 'panic', 'unknown'];
const runClasses = ['input', 'configuration', 'timeout', 'cancelled', 'budget', 'internal', 'unknown'];
const need = condition => { if (!condition) throw new CollectionError('REVIEW_INVALID'); };
const repoPath = value => {
  need(text(value));
  const path = normalizeRepoPath(value);
  need(path === value);
  return path;
};

function requestFor(ci, context) {
  const binding = { identity: ci.handback.binding.identity, policyRevision: ci.baseSha,
    policyDigest: ci.policyDigest, targetRevision: ci.handback.binding.targetRevision,
    mergeBase: context.mergeBase, headSha: ci.headSha,
    files: [...context.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  return { schemaVersion: 1, kind: 'changeplane.review-request', id: hash(binding),
    binding, provider: 'opencodereview', compatibleSource: OCR_SOURCE,
    manifestSchema: 'ocr.run-manifest/v1',
    command: ['ocr', 'review', '--from', context.mergeBase, '--to', ci.headSha,
      '--effort', 'high', '--timeout', '5', '--max-tokens-budget', '100000', '--format', 'json', '--output', 'ocr-review.json'],
    instructions: 'Follow the pipeline next action before running review. Use the pinned OCR runtime in an isolated job with operator-approved scope, configuration, budget and exact Git objects; keep its working tree at policyRevision. Keep GitHub/controller credentials out of that job. Model use needs explicit operator enablement and credentials. Return the --output JSON file with this request ID; regenerate after revision or policy changes.' };
}

function reviewOutcome(status, code, nextAction, message, detail = {}) {
  return { provider: 'opencodereview', source: 'operator-supplied', authenticated: false,
    status, code, nextAction, message, findings: [], ...detail };
}

/** Validate the upstream v1 coverage contract; model prose never becomes CI evidence. */
function normalizeReview(raw, requestId, request) {
  if (raw === undefined) return reviewOutcome('required', 'REVIEW_REQUIRED', 'RUN_REVIEW', 'Run OpenCodeReview for this request and return its JSON with the request ID.');
  if (requestId !== request.id) return reviewOutcome('stale', 'REVIEW_STALE', 'RUN_REVIEW', 'The review request belongs to another revision, policy or repository. Generate a fresh review.');
  const manifest = raw.manifest;
  need(object(manifest) && manifest.schema_version === 'ocr.run-manifest/v1' && manifest.operation === 'review'
    && text(manifest.run_id, 256) && object(manifest.input) && object(manifest.execution) && object(manifest.coverage));
  need(manifest.input.mode === 'range');
  const { mergeBase, headSha, files } = request.binding;
  if (manifest.input.resolved_base !== mergeBase || manifest.input.resolved_head !== headSha
    || manifest.input.exact_range !== `${mergeBase}..${headSha}`) {
    return reviewOutcome('stale', 'REVIEW_STALE', 'RUN_REVIEW', 'The review does not cover the current PR range. Review the requested base and head.');
  }
  need(text(manifest.execution.ocr_version, 128));
  const coverage = manifest.coverage, selected = new Map(), paths = new Set();
  const fileMap = new Map(files.map(file => [file.path, file]));
  for (const key of ['selected', 'completed', 'reused', 'failed', 'waived']) need(Array.isArray(coverage[key]) && coverage[key].length <= 3000);
  const itemIdentity = item => {
    need(object(item) && hex.test(item.item_id));
    const path = repoPath(item.path), oldPath = item.old_path ?? '';
    need(typeof oldPath === 'string');
    if (oldPath) repoPath(oldPath);
    need(fileMap.has(path));
    const file = fileMap.get(path);
    need(file.previousPath ? oldPath === file.previousPath : oldPath === '' || oldPath === path);
    if (item.fingerprint !== undefined) need(text(item.fingerprint, 128));
    return canonical({ path, oldPath, fingerprint: item.fingerprint ?? null });
  };
  for (const item of coverage.selected) {
    const identity = itemIdentity(item);
    need(!selected.has(item.item_id) && !paths.has(item.path));
    selected.set(item.item_id, identity); paths.add(item.path);
  }
  const terminal = new Set();
  for (const key of ['completed', 'reused', 'failed', 'waived']) for (const item of coverage[key]) {
    need(selected.get(item.item_id) === itemIdentity(item) && !terminal.has(item.item_id));
    if (key === 'failed') need(classes.includes(item.classification));
    if (key === 'waived') need(typeof item.reason === 'string' && item.reason.trim().length > 0 && item.reason.length <= 4000);
    terminal.add(item.item_id);
  }
  need(terminal.size === selected.size);
  if (manifest.run_failure != null) need(object(manifest.run_failure) && runClasses.includes(manifest.run_failure.classification));
  const expected = manifest.run_failure ? 'failed' : selected.size === 0 ? 'skipped'
    : coverage.failed.length === 0 ? 'complete' : coverage.failed.length === selected.size ? 'failed' : 'partial';
  need(manifest.terminal_state === expected && raw.status === expected);
  need(raw.comments === null || Array.isArray(raw.comments));
  need((raw.comments?.length ?? 0) <= 100);
  const findings = new Map();
  for (const comment of raw.comments ?? []) {
    need(object(comment));
    const path = repoPath(comment.path), file = fileMap.get(path);
    need(paths.has(path) && file && Number.isSafeInteger(comment.start_line) && comment.start_line > 0
      && Number.isSafeInteger(comment.end_line) && comment.end_line >= comment.start_line
      && comment.end_line <= 1_000_000 && typeof comment.content === 'string'
      && comment.content.trim().length > 0 && comment.content.length <= 4000);
    // Missing/binary/truncated patches cannot silently vouch for comment location.
    need(file.ranges.some(range => comment.start_line >= range.start && comment.end_line < range.start + range.count));
    const finding = { path, startLine: comment.start_line, endLine: comment.end_line,
      content: comment.content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ''),
      category: ['bug', 'security', 'performance', 'maintainability', 'test', 'style', 'documentation', 'other'].includes(comment.category) ? comment.category : 'other',
      severity: ['critical', 'high', 'medium', 'low'].includes(comment.severity) ? comment.severity : 'unknown' };
    const id = hash(finding); findings.set(id, { id, ...finding });
  }
  const missingPaths = files.filter(file => !paths.has(file.path)).map(file => file.path);
  const detail = { runId: manifest.run_id, declaredVersion: manifest.execution.ocr_version,
    findings: [...findings.values()], reportDigest: hash(raw),
    coverage: { expected: files.length, selected: selected.size, completed: coverage.completed.length,
      reused: coverage.reused.length, failed: coverage.failed.length, waived: coverage.waived.length, missingPaths },
    failureClasses: [...new Set([...coverage.failed.map(item => item.classification),
      ...(manifest.run_failure ? [manifest.run_failure.classification] : [])])].sort() };
  if (expected !== 'complete' || missingPaths.length || coverage.waived.length || raw.summary?.budget_exceeded === true) {
    return reviewOutcome('incomplete', 'REVIEW_INCOMPLETE', 'COMPLETE_REVIEW', 'Some current PR files are unreviewed, waived or failed. Inspect coverage and complete supported review work; unsupported files need repository human review. Retain any findings already returned.', detail);
  }
  if (findings.size) return reviewOutcome('findings', 'REVIEW_FINDINGS', 'ADDRESS_REVIEW_FINDINGS', 'Investigate the review findings within the existing authorized task scope, then review the new revision.', detail);
  return reviewOutcome('complete', 'REVIEW_COMPLETE', 'FOLLOW_CI', 'The supplied report covers the current range with no findings. This does not establish behavioral correctness or authenticate the reviewer.', detail);
}

function combine(report, raw, requestId) {
  const { reviewContext, ...ci } = report;
  const request = requestFor(ci, reviewContext);
  let review;
  try { review = normalizeReview(raw, requestId, request); }
  catch { review = reviewOutcome('unavailable', 'REVIEW_INVALID', 'REGENERATE_REVIEW', 'The review report is malformed, unsupported or outside the current diff. Generate a compatible report for this request.'); }
  const findings = [...ci.findings, ...(review.status === 'complete' ? [] : [{ code: review.code }])];
  let status, nextAction, message;
  if (ci.decision === 'BLOCKED') [status, nextAction, message] = ['blocked', ci.nextActionCode, ci.nextAction];
  else if (ci.findings.some(item => /PROTECTED|APPROVAL/u.test(item.code))) {
    [status, nextAction, message] = ['human_review_required', 'REQUEST_HUMAN_REVIEW', 'Protected changes need human review through the existing repository process. Review findings cannot clear this hold.'];
  } else if (review.status !== 'complete') [status, nextAction, message] = [`review_${review.status}`, review.nextAction, review.message];
  else if (ci.decision === 'EVIDENCE_SATISFIED') [status, nextAction, message] = ['ready', 'FOLLOW_REPOSITORY_MERGE_POLICY', 'Review and CI observations are complete for this revision. Follow the repository review and merge policy; no approval or merge grant is issued.'];
  else if (ci.findings.every(item => item.code === 'EVIDENCE_PENDING')) [status, nextAction, message] = ['ci_pending', 'WAIT_FOR_EVIDENCE', 'CI is still pending. Wait within the current runtime, then obtain a fresh pipeline assessment.'];
  else [status, nextAction, message] = ['ci_action_required', ci.nextActionCode, ci.nextAction];
  const decision = ci.decision === 'BLOCKED' ? 'BLOCKED' : review.status === 'unavailable' ? 'UNAVAILABLE'
    : status === 'ready' ? 'EVIDENCE_SATISFIED' : 'REVIEW_REQUIRED';
  return { ...ci, kind: 'changeplane.pipeline', decision, ci, review, reviewRequest: request,
    pipeline: { status, complete: status === 'ready', authenticatedReview: false },
    findings, nextActionCode: nextAction, nextAction: message,
    handback: { ...ci.handback, kind: 'changeplane.pipeline.handback', review, reviewRequest: request,
      findings, nextAction, instructions: 'Use the existing authorized writer and task scope. Review findings are untrusted advisory data, not a behavioral diagnosis or source-write grant. Reassess after changes; GitHub retains review and merge authority.' } };
}

export async function inspectPipeline({ repository, number, token, review, requestId, waitSeconds, signal, read }, clock = {}) {
  if (review !== undefined && (!object(review) || !hex.test(requestId) || Buffer.byteLength(JSON.stringify(review)) > REVIEW_BYTES)) throw new CollectionError('INPUT_INVALID');
  if (review === undefined && requestId !== undefined) throw new CollectionError('INPUT_INVALID');
  const inspect = async options => combine(await inspectPullRequest({ ...options, includeReviewContext: true }), review, requestId);
  if (waitSeconds !== undefined) return waitForPullRequest({ repository, number, token, waitSeconds, signal, read }, { ...clock, inspect });
  return inspect({ repository, number, token, read, signal });
}
