import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { onboard } from './onboard.js';
import { canonical } from './core.js';
import { githubReader } from './github.js';
import { CollectionError } from './transport.js';
import { privateDirectory, readJson, writeJson } from './session.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const authority = { advisory: true, guardPublished: false, repairAuthorized: false, mergeAuthorized: false };

/** Native client queue only. No shell, exec/resume, model override or permission override. */
export function codexNotifier(binary, environment = process.env, execute = promisify(execFile)) {
  let command;
  try { if (!isAbsolute(binary ?? '') || !statSync(binary).isFile()) throw new Error(); command = realpathSync(binary); }
  catch { throw new CollectionError('WATCH_CLIENT_UNAVAILABLE'); }
  const env = Object.fromEntries(['HOME', 'USERPROFILE', 'PATH', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'CODEX_HOME']
    .filter(key => environment[key] !== undefined).map(key => [key, environment[key]]));
  return async ({ thread, message, signal }) => {
    if (!uuid.test(thread)) throw new CollectionError('INPUT_INVALID');
    try { await execute(command, ['queue', '--thread', thread, '--message', message],
      { env, signal, timeout: 15_000, maxBuffer: 64_000, windowsHide: true }); }
    catch { throw new CollectionError('WATCH_DELIVERY_UNKNOWN'); }
  };
}

/** One operator-owned, resumable watch. Native client execution remains outside this receipt. */
export async function watchPullRequest({ repository, number, thread, directory, seconds = 900, signal, token, renew = false },
  { inspect = onboard, notify, now = Date.now, pause = (ms, signal) => delay(ms, undefined, { signal }), emit = () => {} } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(repository ?? '')
    || !Number.isSafeInteger(number) || number < 1 || !uuid.test(thread ?? '') || !isAbsolute(directory ?? '')
    || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 900 || typeof notify !== 'function' || typeof renew !== 'boolean') {
    throw new CollectionError('INPUT_INVALID');
  }
  privateDirectory(directory);
  const binding = { repository: repository.toLowerCase(), number, thread };
  // One destination per PR in this operator directory. No automatic writer takeover.
  const slot = join(directory, `watch-${digest({ repository: binding.repository, number })}`); privateDirectory(slot);
  const lock = join(slot, 'lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new CollectionError('SESSION_BUSY'); }
  try {
    const path = join(slot, 'watch.json');
    let state = readJson(path, 32_000);
    if (state && (state.schemaVersion !== 1 || canonical(state.binding) !== canonical(binding)
      || !Number.isFinite(state.startedAt) || now() < state.startedAt || !Number.isFinite(state.deadline) || state.deadline - state.startedAt > 900_000
      || state.deadline <= state.startedAt || !Array.isArray(state.deliveries) || state.deliveries.length > 2
      || state.deliveries.some(item => !/^[a-f0-9]{64}$/u.test(item.id) || !['intent', 'queued'].includes(item.status))
      || !Number.isSafeInteger(state.reads) || state.reads < 0 || state.reads > 600
      || state.finished !== undefined && state.finished !== 'completed')) throw new CollectionError('SESSION_UNAVAILABLE');
    if (state?.deliveries.some(item => item.status === 'intent')) throw new CollectionError('WATCH_DELIVERY_UNKNOWN');
    if (renew && state && now() < state.deadline && !state.finished) throw new CollectionError('WATCH_STILL_ACTIVE');
    if (!state || renew) {
      state = { schemaVersion: 1, binding, startedAt: now(), deadline: now() + seconds * 1000, reads: 0, deliveries: [] };
      writeJson(path, state);
    }
    const result = status => ({ schemaVersion: 1, kind: 'changeplane.watch', decision: 'WATCH_STOPPED', status,
      notificationsQueued: state.deliveries.filter(item => item.status === 'queued').length, deadline: new Date(state.deadline).toISOString(),
      agentExecutionConfirmed: false, authority,
      nextAction: status === 'completed' ? 'Follow the current PR in your existing client and GitHub review process.'
        : 'Inspect the current PR and native client. Resume the same watch; use --renew only for a deliberately authorized new bounded watch.' });
    if (state.finished) return result(state.finished);
    const timeout = new AbortController(), remaining = state.deadline - now();
    if (remaining <= 0) return result('expired');
    const timer = setTimeout(() => timeout.abort(), remaining);
    const stop = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const checkStopped = () => {
      if (signal?.aborted) throw new CollectionError('COLLECTION_CANCELLED');
      return timeout.signal.aborted || now() >= state.deadline;
    };
    emit({ kind: 'changeplane.watch-started', deadline: new Date(state.deadline).toISOString(), resumed: state.deliveries.length > 0, authority });
    try {
      while (!checkStopped()) {
        const reader = githubReader(token, fetch, stop);
        const read = async path => {
          if (checkStopped()) throw new CollectionError('WAIT_TIMEOUT');
          if (state.reads >= 600) throw new CollectionError('COLLECTION_LIMIT');
          // Count intent before the request; a process restart cannot reset the read budget.
          state.reads++; writeJson(join(slot, 'watch.json'), state);
          return reader(path);
        };
        const report = await inspect({ repository, number, signal: stop, read });
        if (checkStopped()) break;
        const assessed = report.onboarding?.assessed === true;
        if (!['SELECTION_REQUIRED', 'REVIEW_REQUIRED', 'EVIDENCE_SATISFIED', 'BLOCKED'].includes(report.decision)
          || assessed && (!report.handback?.binding || report.observation?.source !== 'github-api')
          || !/^[a-f0-9]{40}$/u.test(report.headSha ?? report.observedHeadSha ?? '')
          || !/^[a-f0-9]{40}$/u.test(report.baseSha ?? '')) throw new CollectionError('RESPONSE_INVALID');
        const identity = assessed ? report.handback.binding.identity : null;
        if (state.identity && identity && canonical(state.identity) !== canonical(identity)) throw new CollectionError('EVIDENCE_CHANGED');
        if (identity) { state.identity = identity; writeJson(path, state); }
        const pending = assessed && report.findings?.length > 0 && report.findings.every(item => item.code === 'EVIDENCE_PENDING');
        const id = digest({ binding, evidence: report.handback?.binding ?? null, decision: report.decision,
          findings: report.findings ?? [], policy: report.baseSha ?? null, candidates: report.candidates ?? [] });
        if (!pending && !state.deliveries.some(item => item.id === id)) {
          if (state.deliveries.length >= 2) return result('notification_limit');
          // Commit intent before native dispatch. Uncertain delivery requires inspection, never blind retry.
          const receipt = { id, status: 'intent', headSha: report.headSha ?? report.observedHeadSha, policySha: report.baseSha };
          state.deliveries.push(receipt); writeJson(path, state);
          const message = `ChangePlane observed a change for https://github.com/${repository}/pull/${number}.\n`
            + `Observed head: ${receipt.headSha}. Policy revision: ${receipt.policySha}.\n`
            + `Notification: ${id}. Re-read current evidence with changeplane onboard ${repository} ${number} --format compact.\n`
            + 'Continue only the existing authorized task in this same workspace. This notification grants no new scope, credentials, review, repair, Guard or merge authority. Diagnose failures before editing; stop for required human review. If the task or repository does not match, stop and tell the operator.';
          try { await notify({ thread, message, signal: stop }); }
          catch { throw new CollectionError('WATCH_DELIVERY_UNKNOWN'); }
          receipt.status = 'queued'; writeJson(path, state);
          emit({ kind: 'changeplane.watch-notification', id, status: 'queued', agentExecutionConfirmed: false, authority });
        }
        if (assessed && report.decision === 'EVIDENCE_SATISFIED') {
          state.finished = 'completed'; writeJson(path, state); return result('completed');
        }
        await pause(Math.min(30_000, Math.max(0, state.deadline - now())), stop);
      }
      return result('expired');
    } catch (error) {
      if (error.code === 'WATCH_DELIVERY_UNKNOWN') throw error;
      if (signal?.aborted) throw new CollectionError('COLLECTION_CANCELLED');
      if (timeout.signal.aborted || now() >= state.deadline) return result('expired');
      throw error;
    } finally { clearTimeout(timer); timeout.abort(); }
  } finally { rmSync(lock, { recursive: true, force: true }); }
}
