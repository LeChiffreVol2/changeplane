import { setTimeout as delay } from 'node:timers/promises';

const messages = Object.freeze({
  REVIEW_RETRY_REQUIRED: ['RETRY_REVIEW_EXPLICITLY', 'A prior review invocation stopped without a receipt. Investigate it, then use follow --run-review --retry-review to permit one bounded retry.'],
  REVIEW_RETRY_NOT_NEEDED: ['FOLLOW_CURRENT_REVIEW', 'The current report is complete or has findings to address. Follow that result; no additional model call was started.'],
  REVIEW_RETRY_EXHAUSTED: ['INSPECT_REVIEW_FAILURE', 'Two review invocations have already been started for this request. Investigate the failure before deliberately replacing the stopped private session. No additional model call was started.'],
  PERMISSION_DENIED: ['CHECK_READ_PERMISSIONS', 'Check read access to the selected repository.'],
  NOT_FOUND: ['CHECK_TARGET_AND_POLICY', 'Check the target and its trusted default-branch policy.'],
  RATE_LIMITED: ['WAIT_FOR_RATE_LIMIT', 'Wait for the provider rate limit before reassessing.'],
  PROVIDER_UNAVAILABLE: ['RETRY_ASSESSMENT', 'Retry when the provider is reachable.'],
  RESPONSE_INVALID: ['INSPECT_PROVIDER_RESPONSE', 'The provider returned an unsupported response.'],
  COLLECTION_LIMIT: ['NARROW_COLLECTION', 'Evidence exceeds the bounded collection limit.'],
  INPUT_INVALID: ['CHECK_INPUT', 'Check the documented input, target and policy.'],
  POLICY_INVALID: ['REVIEW_TRUSTED_POLICY', 'Review the configuration on the trusted default branch.'],
  COLLECTION_INCOMPLETE: ['REOBSERVE_REVISION', 'Some required evidence or target metadata is missing or ambiguous. Reassess after it is available.'],
  EVIDENCE_CHANGED: ['REOBSERVE_REVISION', 'The revision, policy or execution changed during collection. Reassess current state.'],
  WAIT_TIMEOUT: ['REASSESS_CURRENT_PR', 'The bounded wait ended without a settled assessment. Inspect the current PR again when CI progresses.'],
  COLLECTION_CANCELLED: ['REASSESS_WHEN_READY', 'Inspection was cancelled. No assessment was issued; inspect again when ready.'],
  SESSION_UNAVAILABLE: ['CHECK_PRIVATE_SESSION', 'Use an operator-owned private state directory (0700 on Unix). Inspect a corrupt or unsafe session before retrying; no saved result establishes current evidence.'],
  SESSION_BUSY: ['RESUME_EXISTING_SESSION', 'Another process holds this PR session. Resume it, or stop it before removing its stranded lock and retrying.'],
  REVIEW_RUNNER_UNAVAILABLE: ['CONFIGURE_REVIEW_JOB', 'Enable the isolated review runner and your model key in the operator environment, then retry follow --run-review. Read-only inspection remains available.'],
  REVIEW_DOCKER_UNAVAILABLE: ['START_LOCAL_DOCKER', 'The local Docker daemon is unavailable. Start Docker and retry; no model review was started.'],
  REVIEW_IMAGE_UNAVAILABLE: ['BUILD_REVIEW_IMAGE', 'The pinned local review image is missing or has the wrong source label. Build the documented image and configure its immutable ID. No model review was started.'],
  REVIEW_SOURCE_UNAVAILABLE: ['PREPARE_REVIEW_SOURCE', 'The local checkout lacks the requested Git objects or exceeds bounded source scope. Fetch the current PR and trusted default branch, or narrow the PR, then retry. No model review was started.'],
  REVIEW_EXECUTION_UNAVAILABLE: ['INSPECT_REVIEW_JOB', 'The isolated job did not return a bounded report. Check Docker resources and operator model access before a deliberate retry. No complete review was recorded.'],
});
export class CollectionError extends Error {
  constructor(code, { provider = null, status = null } = {}) {
    super(code); this.code = code; this.provider = provider; this.status = status;
  }
}
export function unavailable(error) {
  const aliases = { POLICY_INVALID: 'POLICY_INVALID', GITLAB_OBSERVATION_INCOMPLETE: 'COLLECTION_INCOMPLETE',
    GITHUB_LIMIT: 'COLLECTION_INCOMPLETE', FILES_INCOMPLETE: 'COLLECTION_INCOMPLETE', RENAME_INCOMPLETE: 'COLLECTION_INCOMPLETE',
    JOB_AMBIGUOUS: 'COLLECTION_INCOMPLETE', WORKFLOW_AMBIGUOUS: 'COLLECTION_INCOMPLETE',
    EVIDENCE_CHANGED: 'EVIDENCE_CHANGED', FILES_CHANGED: 'EVIDENCE_CHANGED', REVISION_CHANGED: 'EVIDENCE_CHANGED' };
  const legacyCode = typeof error?.message === 'string' ? error.message.split(':', 1)[0] : '';
  const code = error instanceof CollectionError && Object.hasOwn(messages, error.code) ? error.code
    : Object.hasOwn(aliases, legacyCode) ? aliases[legacyCode] : 'INPUT_INVALID';
  const [nextAction, message] = messages[code];
  return { schemaVersion: 1, kind: 'changeplane.collection-outcome', decision: 'UNAVAILABLE',
    code, nextAction, message, ...(error instanceof CollectionError ? { provider: error.provider, status: error.status } : {}),
    authority: { advisory: true, guardPublished: false, repairAuthorized: false, mergeAuthorized: false } };
}

/** Fixed-origin GETs only; retries never imply a CI rerun or mutation permission. */
export function boundedReader({ provider, origin, prefix, headers = {}, fetchImpl = fetch,
  signal, sleep = ms => delay(ms, undefined, { signal }), now = Date.now }) {
  const started = now();
  let requests = 0;
  const fail = (code, status = null) => new CollectionError(code, { provider, status });
  const checkCancelled = () => { if (signal?.aborted) throw fail('COLLECTION_CANCELLED'); };
  const pause = async ms => {
    try { await sleep(ms); } catch (error) { checkCancelled(); throw error; }
    checkCancelled();
  };
  const read = async path => {
    checkCancelled();
    if (typeof path !== 'string' || /[\\\r\n#]/u.test(path)) throw fail('INPUT_INVALID');
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith(prefix)
      || /(?:^|\/)\.\.(?:\/|$)/u.test(decodeURIComponent(url.pathname))) throw fail('INPUT_INVALID');
    for (let attempt = 0; attempt < 3; attempt++) {
      checkCancelled();
      const remaining = 60_000 - (now() - started);
      if (++requests > 200 || remaining <= 0) throw fail('COLLECTION_LIMIT');
      let response;
      const timeout = AbortSignal.timeout(Math.min(15_000, remaining));
      try { response = await fetchImpl(url.href, { method: 'GET', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers }); }
      catch {
        checkCancelled();
        if (attempt < 2) { await pause(250 * (attempt + 1)); continue; }
        throw fail('PROVIDER_UNAVAILABLE');
      }
      if (signal?.aborted) { await response.body?.cancel(); checkCancelled(); }
      if (!response.ok) {
        const retryHeader = response.headers.get('retry-after');
        const rateLimited = response.status === 429 || (response.status === 403
          && (retryHeader != null || response.headers.get('x-ratelimit-remaining') === '0'));
        const transient = rateLimited || [502, 503, 504].includes(response.status);
        const reset = response.headers.get('x-ratelimit-reset');
        const delay = retryHeader == null ? rateLimited
          ? reset != null && /^\d+$/u.test(reset) ? Math.max(0, Number(reset) * 1000 - now()) : NaN
          : 250 * (attempt + 1)
          : /^\d+(?:\.\d+)?$/u.test(retryHeader) ? Number(retryHeader) * 1000 : Date.parse(retryHeader) - now();
        await response.body?.cancel();
        if (transient && attempt < 2 && Number.isFinite(delay) && delay >= 0 && delay <= 2000
          && now() - started + delay < 60_000) { await pause(delay); continue; }
        throw fail(rateLimited ? 'RATE_LIMITED' : [401, 403].includes(response.status) ? 'PERMISSION_DENIED'
          : response.status === 404 ? 'NOT_FOUND' : transient ? 'PROVIDER_UNAVAILABLE' : 'RESPONSE_INVALID', response.status);
      }
      const chunks = []; let size = 0;
      try {
        const stream = response.body.getReader();
        for (;;) {
          const { done, value } = await stream.read();
          if (signal?.aborted) { await stream.cancel(); checkCancelled(); }
          if (done) break;
          size += value.byteLength;
          if (size > 4_000_000) { await stream.cancel(); throw fail('COLLECTION_LIMIT'); }
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (error) {
        checkCancelled();
        if (error instanceof CollectionError) throw error;
        throw fail('RESPONSE_INVALID');
      }
    }
  };
  read.budget = () => ({ requestsRemaining: Math.max(0, 200 - requests), millisecondsRemaining: Math.max(0, 60_000 - (now() - started)) });
  return read;
}
