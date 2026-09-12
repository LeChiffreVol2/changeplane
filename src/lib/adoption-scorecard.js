const DAY = 86_400_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const fail = () => { throw new TypeError('Adoption evidence is invalid.'); };
function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) fail();
}
function instant(value) {
  const result = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) fail();
  return result;
}
function identifier(value) { if (typeof value !== 'string' || !UUID.test(value)) fail(); }
function oneOf(value, choices) { if (!choices.includes(value)) fail(); }
function rows(value, fields) {
  if (!Array.isArray(value) || value.length > 10_000) fail();
  const ids = new Set();
  for (const row of value) {
    record(row, fields); identifier(row.id); identifier(row.evidenceId);
    if (ids.has(row.id)) fail();
    ids.add(row.id);
  }
  return value;
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Operator-attested OSS experiment; no collection, model calls or assurance authority. */
export function buildAdoptionScorecard(input, { now = new Date() } = {}) {
  record(input, ['schemaVersion', 'startedAt', 'coverage', 'installations', 'assessments', 'comparisons']);
  if (input.schemaVersion !== 1) fail();
  const nowMs = instant(now.toISOString()), start = input.startedAt === null ? null : instant(input.startedAt);
  if (start !== null && start > nowMs) fail();
  const end = start === null ? null : start + 30 * DAY, cutoff = end === null ? null : Math.min(end, nowMs);
  record(input.coverage, ['through', 'complete', 'evidenceId']);
  const through = input.coverage.through === null ? null : instant(input.coverage.through);
  if (typeof input.coverage.complete !== 'boolean') fail();
  if (input.coverage.evidenceId !== null) identifier(input.coverage.evidenceId);
  if (through !== null && (start === null || through < start || through > nowMs || !input.coverage.evidenceId)) fail();
  if (input.coverage.complete && through === null) fail();
  const installations = rows(input.installations,
    ['id', 'accountId', 'accountType', 'cohort', 'channel', 'startedAt', 'evidenceId']);
  const byId = new Map(), accounts = new Map();
  for (const row of installations) {
    identifier(row.accountId);
    oneOf(row.accountType, ['User', 'Organization']);
    oneOf(row.cohort, ['external', 'owner', 'synthetic']);
    oneOf(row.channel, ['founder', 'github', 'agent', 'community', 'referral', 'unknown']);
    const time = instant(row.startedAt);
    if (start === null || time < start || time > nowMs) fail();
    const account = `${row.accountType}:${row.cohort}`;
    if (accounts.has(row.accountId) && accounts.get(row.accountId) !== account) fail();
    accounts.set(row.accountId, account); byId.set(row.id, row);
  }
  const assessments = rows(input.assessments,
    ['id', 'installationId', 'occurredAt', 'source', 'outcome', 'feedback', 'correctness', 'evidenceId']);
  const comparisons = rows(input.comparisons,
    ['id', 'installationId', 'occurredAt', 'kind', 'basis', 'baselineMinutes', 'assistedMinutes', 'evidenceId']);
  for (const row of [...assessments, ...comparisons]) {
    if (!byId.has(row.installationId)) fail();
    const time = instant(row.occurredAt);
    if (time < instant(byId.get(row.installationId).startedAt) || time > nowMs) fail();
  }
  for (const row of assessments) {
    oneOf(row.source, ['github-api', 'fixture']);
    oneOf(row.outcome, ['EVIDENCE_SATISFIED', 'REVIEW_REQUIRED', 'BLOCKED', 'UNAVAILABLE']);
    oneOf(row.feedback, ['useful', 'not_useful', 'unreviewed']);
    oneOf(row.correctness, ['confirmed', 'incorrect', 'unreviewed']);
    if (row.feedback === 'useful' && (row.correctness !== 'confirmed' || row.outcome === 'UNAVAILABLE')) fail();
  }
  for (const row of comparisons) {
    oneOf(row.kind, ['ci_recovery', 'coordination']); oneOf(row.basis, ['observed', 'estimate']);
    for (const value of [row.baselineMinutes, row.assistedMinutes]) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) fail();
    }
  }
  if (start === null && (installations.length || assessments.length || comparisons.length || through !== null
    || input.coverage.evidenceId !== null || input.coverage.complete)) fail();
  const inWindow = time => start !== null && time >= start && time < end && time <= nowMs;
  const cohort = installations.filter(row => row.cohort === 'external' && inWindow(instant(row.startedAt)));
  const cohortIds = new Set(cohort.map(row => row.id));
  const observed = assessments.filter(row => cohortIds.has(row.installationId)
    && row.source === 'github-api' && inWindow(instant(row.occurredAt)));
  // Errors stay in the denominator. A fixture or unavailable response is not activation.
  const usable = observed.filter(row => row.outcome !== 'UNAVAILABLE' && row.correctness === 'confirmed');
  const first = new Map();
  for (const row of usable) {
    const time = instant(row.occurredAt);
    first.set(row.installationId, Math.min(first.get(row.installationId) ?? Infinity, time));
  }
  const mature = cohort.filter(row => instant(row.startedAt) + 28 * DAY <= cutoff);
  const retained = mature.filter(row => first.get(row.id) < instant(row.startedAt) + 21 * DAY
    && usable.some(event => event.installationId === row.id
    && instant(event.occurredAt) >= instant(row.startedAt) + 21 * DAY
    && instant(event.occurredAt) < instant(row.startedAt) + 28 * DAY));
  const coverageComplete = cutoff !== null && through !== null && through >= cutoff && input.coverage.complete;
  const reviewed = observed.filter(row => row.correctness !== 'unreviewed');
  const incorrect = observed.filter(row => row.correctness === 'incorrect');
  const samples = comparisons.filter(row => cohortIds.has(row.installationId) && inWindow(instant(row.occurredAt)));
  const pairs = samples.filter(row => row.basis === 'observed');
  const summarize = subset => {
    const ids = new Set(subset.map(row => row.id));
    const active = subset.filter(row => first.has(row.id));
    const eligible = mature.filter(row => ids.has(row.id));
    const returning = retained.filter(row => ids.has(row.id));
    return {
      installations: subset.length, accounts: new Set(subset.map(row => row.accountId)).size,
      activations: active.length, setupAttemptsWithoutActivation: subset.length - active.length,
      medianActivationMinutes: median(active.map(row => (first.get(row.id) - instant(row.startedAt)) / 60_000)),
      week4Eligible: eligible.length, week4Retained: returning.length,
      week4RetentionRate: coverageComplete && eligible.length ? returning.length / eligible.length : null,
    };
  };
  const adoption = summarize(cohort), useful = usable.filter(row => row.feedback === 'useful').length;
  const targetsMet = adoption.installations >= 5 && adoption.accounts >= 3 && adoption.activations >= 4
    && adoption.medianActivationMinutes !== null && adoption.medianActivationMinutes < 10
    && adoption.week4Retained >= 3 && useful >= 3;
  const complete = end !== null && nowMs >= end;
  const evidenceComplete = coverageComplete && observed.length > 0 && reviewed.length === observed.length;
  return {
    schemaVersion: 1, type: 'changeplane.adoption-scorecard', evidenceClass: 'operator_attested',
    state: start === null ? 'not_started' : incorrect.length ? 'review_required' : !complete ? 'collecting'
      : !evidenceComplete ? 'evidence_required' : targetsMet ? 'pilot_targets_met' : 'pilot_targets_unmet',
    window: { startedAt: input.startedAt, endsAt: end === null ? null : new Date(end).toISOString(), complete },
    coverageComplete,
    adoption,
    cohorts: Object.fromEntries(['User', 'Organization'].map(type => [type, summarize(cohort.filter(row => row.accountType === type))])),
    channels: Object.fromEntries(['founder', 'github', 'agent', 'community', 'referral', 'unknown']
      .map(channel => [channel, summarize(cohort.filter(row => row.channel === channel))])),
    quality: { observed: observed.length, unavailable: observed.filter(row => row.outcome === 'UNAVAILABLE').length,
      reviewed: reviewed.length, unreviewed: observed.length - reviewed.length, incorrect: incorrect.length,
      reviewedIncorrectRate: reviewed.length ? incorrect.length / reviewed.length : null, confirmedUseful: useful },
    intervention: { observedPairs: pairs.length, estimatesExcluded: samples.length - pairs.length,
      medianHumanMinutesSaved: median(pairs.map(row => row.baselineMinutes - row.assistedMinutes)),
      pairsWithMoreHumanTime: pairs.filter(row => row.assistedMinutes > row.baselineMinutes).length },
    excluded: { internalInstallations: installations.filter(row => row.cohort !== 'external').length,
      fixtureAssessments: assessments.filter(row => row.source === 'fixture').length },
    authority: { establishesProductMarketFit: false, authorizesLaunch: false, contributesToPass: false, acceptsPayment: false },
  };
}
