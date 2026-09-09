const messages = Object.freeze({
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
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  const started = now();
  let requests = 0;
  const fail = (code, status = null) => new CollectionError(code, { provider, status });
  return async path => {
    if (typeof path !== 'string' || /[\\\r\n#]/u.test(path)) throw fail('INPUT_INVALID');
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith(prefix)
      || /(?:^|\/)\.\.(?:\/|$)/u.test(decodeURIComponent(url.pathname))) throw fail('INPUT_INVALID');
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = 60_000 - (now() - started);
      if (++requests > 200 || remaining <= 0) throw fail('COLLECTION_LIMIT');
      let response;
      try { response = await fetchImpl(url.href, { method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(Math.min(15_000, remaining)), headers }); }
      catch {
        if (attempt < 2) { await sleep(250 * (attempt + 1)); continue; }
        throw fail('PROVIDER_UNAVAILABLE');
      }
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
          && now() - started + delay < 60_000) { await sleep(delay); continue; }
        throw fail(rateLimited ? 'RATE_LIMITED' : [401, 403].includes(response.status) ? 'PERMISSION_DENIED'
          : response.status === 404 ? 'NOT_FOUND' : transient ? 'PROVIDER_UNAVAILABLE' : 'RESPONSE_INVALID', response.status);
      }
      const chunks = []; let size = 0;
      try {
        const stream = response.body.getReader();
        for (;;) {
          const { done, value } = await stream.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4_000_000) { await stream.cancel(); throw fail('COLLECTION_LIMIT'); }
          chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (error) {
        if (error instanceof CollectionError) throw error;
        throw fail('RESPONSE_INVALID');
      }
    }
  };
}
