/** Offline, opt-in human labels. No source collection, model calls or telemetry. */
export function reviewQuality(input) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.cases) || input.cases.length > 10000) throw new Error('Invalid quality dataset');
  const ids = new Set();
  const result = { schemaVersion: 1, status: input.cases.length ? 'observed' : 'not_started', cases: input.cases.length,
    completeReviews: 0, incompleteReviews: 0, actionable: 0, falsePositive: 0, unresolved: 0,
    knownDefects: 0, detectedKnownDefects: 0, unmeasuredRecallCases: 0, actionability: null, knownDefectRecall: null,
    limitation: 'Operator-supplied human labels. Actionability is not proof of correctness. Known-defect recall excludes unmeasured cases; no production or comparative claim follows from this report.' };
  for (const item of input.cases) {
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.complete !== 'boolean'
      || !Array.isArray(item.findings) || item.findings.length > 10000) throw new Error('Invalid quality case');
    ids.add(item.id); result[item.complete ? 'completeReviews' : 'incompleteReviews'] += 1;
    const findings = new Set();
    for (const finding of item.findings) {
      if (typeof finding.id !== 'string' || !finding.id || findings.has(finding.id)
        || !['actionable', 'false_positive', 'unresolved'].includes(finding.verdict)) throw new Error('Invalid finding label');
      findings.add(finding.id);
      result[{ actionable: 'actionable', false_positive: 'falsePositive', unresolved: 'unresolved' }[finding.verdict]] += 1;
    }
    if (item.knownDefects == null) { result.unmeasuredRecallCases += 1; continue; }
    if (!Array.isArray(item.knownDefects) || item.knownDefects.some(id => typeof id !== 'string' || !id)
      || new Set(item.knownDefects).size !== item.knownDefects.length || !Array.isArray(item.detectedKnownDefects)
      || new Set(item.detectedKnownDefects).size !== item.detectedKnownDefects.length
      || item.detectedKnownDefects.some(id => !item.knownDefects.includes(id))) throw new Error('Invalid defect ground truth');
    result.knownDefects += item.knownDefects.length; result.detectedKnownDefects += item.detectedKnownDefects.length;
  }
  const adjudicated = result.actionable + result.falsePositive;
  result.actionability = adjudicated ? result.actionable / adjudicated : null;
  result.knownDefectRecall = result.knownDefects ? result.detectedKnownDefects / result.knownDefects : null;
  return result;
}
