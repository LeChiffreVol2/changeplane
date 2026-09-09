import { createHash } from 'node:crypto';
import { canonical } from './core.js';
import { evaluateChange, normalizeRepoPath } from '../src/lib/changeplane.js';
import { diagnoseEvidence, recoveryAction } from '../src/lib/recovery.js';
import { effectiveProtectedPaths } from '../examples/changeplane-evidence-policy.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(value);
const revision = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
const kinds = ['change_head', 'test_merge', 'merge_batch', 'artifact'];
const origins = { github: 'https://github.com', gitlab: 'https://gitlab.com', origin: 'https://cursor.com' };
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const requireValue = condition => { if (!condition) throw new Error('OBSERVATION_INVALID'); };
const producer = value => {
  requireValue(object(value) && text(value.kind) && text(value.id));
  return { kind: value.kind, id: value.id };
};
const paths = value => {
  requireValue(Array.isArray(value) && value.length <= 3000 && value.every(text));
  return value.map(path => {
    requireValue(!/[*?\[\]]/u.test(path.endsWith('/**') ? path.slice(0, -3) : path));
    return normalizeRepoPath(path.endsWith('/**') ? path.slice(0, -3) : path) + (path.endsWith('/**') ? '/**' : '');
  });
};
export function validateObservationPolicy(value) {
  requireValue(object(value) && value.schemaVersion === 2 && object(value.protectedPaths) && object(value.evidence)
    && Array.isArray(value.evidence.required) && value.evidence.required.length > 0 && value.evidence.required.length <= 20);
  const required = value.evidence.required.map(item => {
    requireValue(object(item) && text(item.name) && kinds.includes(item.subject));
    return { name: item.name, producer: producer(item.producer), subject: item.subject };
  });
  requireValue(new Set(required.map(canonical)).size === required.length);
  return { schemaVersion: 2, protectedPaths: { block: paths(value.protectedPaths.block), requireApproval: paths(value.protectedPaths.requireApproval) },
    evidence: { required, protectedPaths: paths(value.evidence.protectedPaths ?? []) } };
}

/** Pure consistency assessment of declared observations. Never authenticates a receipt or grants authority. */
export function assessObservation(input) {
  requireValue(object(input) && input.schemaVersion === 2 && object(input.identity) && object(input.revisions));
  const { forge, origin, repositoryId, sourceRepositoryId, changeId } = input.identity;
  requireValue(Object.hasOwn(origins, forge) && origin === origins[forge]
    && [repositoryId, sourceRepositoryId, changeId].every(text));
  const identity = { forge, origin, repositoryId, sourceRepositoryId, changeId };
  let mirror = null;
  if (input.mirror != null) {
    requireValue(object(input.mirror) && text(input.mirror.repositoryId)
      && ['github_mirror', 'detached', 'origin_only'].includes(input.mirror.mode)
      && (input.mirror.syncedHead == null || revision(input.mirror.syncedHead)));
    mirror = { repositoryId: input.mirror.repositoryId, mode: input.mirror.mode, syncedHead: input.mirror.syncedHead ?? null };
  }
  const revisions = {};
  for (const name of ['head', 'currentHead', 'target', 'currentTarget', 'mergeBase', 'diffStart', 'policy', 'currentPolicy']) {
    requireValue(revision(input.revisions[name])); revisions[name] = input.revisions[name];
  }
  const policy = validateObservationPolicy(input.policy);
  requireValue(Array.isArray(input.files) && input.files.length > 0 && input.files.length <= 3000);
  const files = input.files.map(file => {
    requireValue(object(file) && text(file.path) && (file.previousPath == null || text(file.previousPath)));
    return { path: normalizeRepoPath(file.path), ...(file.previousPath ? { previousPath: normalizeRepoPath(file.previousPath) } : {}) };
  });
  requireValue(new Set(files.map(file => file.path)).size === files.length);
  const plannedPaths = paths(input.plannedPaths ?? [...new Set(files.flatMap(file => [file.path, file.previousPath].filter(Boolean)))]);
  requireValue(plannedPaths.length > 0 && object(input.collection)
    && ['complete', 'stable', 'controlPathsComplete'].every(key => typeof input.collection[key] === 'boolean'));
  const collection = { complete: input.collection.complete, stable: input.collection.stable,
    controlPathsComplete: input.collection.controlPathsComplete, controlPaths: paths(input.collection.controlPaths ?? []) };
  if (input.collection.generation != null || input.collection.currentGeneration != null) {
    requireValue(['generation', 'currentGeneration'].every(key => Number.isSafeInteger(input.collection[key]) && input.collection[key] > 0));
    collection.generation = input.collection.generation; collection.currentGeneration = input.collection.currentGeneration;
  }
  requireValue(Array.isArray(input.evidence) && input.evidence.length <= 100);
  const evidence = input.evidence.map(item => {
    requireValue(object(item) && text(item.name) && object(item.execution) && text(item.execution.id)
      && text(item.execution.attempt) && object(item.subject)
      && [...kinds, 'unknown'].includes(item.subject.kind) && text(item.subject.id)
      && ['queued', 'in_progress', 'completed'].includes(item.status)
      && (item.conclusion == null || ['success', 'failure', 'cancelled', 'timed_out', 'startup_failure', 'action_required', 'neutral', 'skipped', 'stale'].includes(item.conclusion)));
    const subject = { kind: item.subject.kind, id: item.subject.id };
    for (const key of ['head', 'target']) if (item.subject[key] != null) {
      requireValue(revision(item.subject[key])); subject[key] = item.subject[key];
    }
    if (item.subject.members != null) {
      requireValue(Array.isArray(item.subject.members) && item.subject.members.length > 0 && item.subject.members.length <= 100
        && item.subject.members.every(revision)); subject.members = [...item.subject.members];
    }
    // Discard arbitrary diagnostics, verified flags, tokens, URLs and caller-provided failure classifications.
    return { name: item.name, producer: producer(item.producer), execution: { id: item.execution.id, attempt: item.execution.attempt },
      subject, status: item.status, conclusion: item.conclusion ?? null,
      diagnosis: diagnoseEvidence({ status: item.status, conclusion: item.conclusion }) };
  });
  const protectedPaths = effectiveProtectedPaths({ ...policy, evidence: { protectedPaths: policy.evidence.protectedPaths } }, files);
  protectedPaths.requireApproval = [...new Set([...protectedPaths.requireApproval, ...collection.controlPaths])].sort();
  const scope = evaluateChange({ plannedPaths, actualFiles: files, protectedPaths, baseSha: revisions.policy, headSha: revisions.head });
  const findings = [...scope.reasons];
  const add = (code, name) => findings.push({ code, ...(name ? { requirement: name } : {}) });
  if (!collection.complete) add('COLLECTION_INCOMPLETE');
  if (!collection.stable) add('EVIDENCE_CHANGED');
  if (!collection.controlPathsComplete) add('CONTROL_PATHS_UNRESOLVED');
  if (revisions.head !== revisions.currentHead) add('STALE_HEAD');
  if (revisions.policy !== revisions.currentPolicy) add('POLICY_CHANGED');
  if (collection.generation !== collection.currentGeneration) add('STALE_EVALUATION');
  // Mirror observations are not yet authenticated by a qualified live Origin adapter.
  if (input.mirror != null || forge === 'origin') add('ORIGIN_UNQUALIFIED');
  for (const requirement of policy.evidence.required) {
    const candidates = evidence.filter(item => item.name === requirement.name && canonical(item.producer) === canonical(requirement.producer));
    if (candidates.length !== 1) { add(candidates.length ? 'AMBIGUOUS_EVIDENCE' : 'EVIDENCE_MISSING', requirement.name); continue; }
    const item = candidates[0], subject = item.subject;
    if (item.diagnosis.code) add(item.diagnosis.code, requirement.name);
    if (subject.kind === 'unknown') { add('SUBJECT_UNVERIFIED', requirement.name); continue; }
    if (subject.kind !== requirement.subject || subject.head !== revisions.head) { add('SUBJECT_MISMATCH', requirement.name); continue; }
    if (subject.kind === 'change_head' && subject.id !== revisions.head) add('SUBJECT_MISMATCH', requirement.name);
    if (subject.kind !== 'change_head' && (subject.target !== revisions.target || revisions.target !== revisions.currentTarget)) add('STALE_TARGET', requirement.name);
    if (['test_merge', 'merge_batch'].includes(subject.kind) && !revision(subject.id)) add('SUBJECT_MISMATCH', requirement.name);
    if (subject.kind === 'merge_batch' && (!subject.members?.includes(revisions.head)
      || new Set(subject.members).size !== subject.members.length)) add('SUBJECT_MISMATCH', requirement.name);
    if (subject.kind === 'artifact' && !/^sha256:[a-f0-9]{64}$/u.test(subject.id)) add('SUBJECT_MISMATCH', requirement.name);
  }
  const observation = { schemaVersion: 2, identity, revisions, policy, files, plannedPaths, collection, evidence, mirror };
  const binding = { identity, revisions, mirror, policyDigest: digest(policy), observationDigest: digest(observation) };
  const authority = { advisory: true, authenticated: false, guardPublished: false, repairAuthorized: false, mergeAuthorized: false };
  const decision = scope.decision === 'BLOCKED' || findings.some(item => ['STALE_HEAD', 'STALE_TARGET', 'STALE_EVALUATION', 'POLICY_CHANGED', 'AMBIGUOUS_EVIDENCE', 'EVIDENCE_CHANGED'].includes(item.code))
    ? 'BLOCKED' : findings.length ? 'REVIEW_REQUIRED' : 'OBSERVED_SUCCESS';
  return { schemaVersion: 2, kind: 'changeplane.assessment', decision, binding, authority, evidence, findings,
    nextAction: recoveryAction(findings),
    claim: 'Consistency of supplied observations only. Subject provenance and publication authority are not authenticated.',
    handback: { schemaVersion: 2, kind: 'changeplane.handback', binding, authority,
      scope: { plannedPaths, intentObserved: input.plannedPaths != null, protectedPaths }, evidence, findings,
      nextAction: recoveryAction(findings), campaign: { sourceAttemptsAuthorized: 0, maxSourceAttempts: 2, maxDurationSeconds: 900 } } };
}
