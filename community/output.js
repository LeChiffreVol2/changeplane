/** Optional views never replace the complete JSON evidence or confer authority. */
export function formatReport(report, format = 'json') {
  if (format === 'json') return JSON.stringify(report, null, 2) + '\n';
  const clean = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ');
  if (format === 'text' && report.kind === 'changeplane.setup-check') return [
    `ChangePlane prerequisites: ${report.decision}`,
    `Policy revision: ${report.baseSha}`,
    ...(report.checks ?? []).map(check => `${check.id}: ${check.status}`),
    `Next: ${report.nextAction}`,
    ...(report.unverified ?? []).map(item => `Not verified: ${item}`),
    'Prerequisites only. No PR assessment, Guard, repair or merge authority.',
  ].map(clean).join('\n') + '\n';
  if (format === 'text' && report.kind === 'changeplane.setup-plan') return [
    `ChangePlane setup: ${report.decision}`,
    `Default revision: ${report.baseSha ?? 'unavailable'}`,
    ...(report.decision === 'SELECTION_REQUIRED' ? report.candidates ?? [] : []).map(item => `Candidate: ${item.name} | ${item.workflowPath}`),
    ...(report.selectedCheck ? [`Selected: ${report.selectedCheck.name} | ${report.selectedCheck.workflowPath}`] : []),
    ...(report.files ?? []).map(item => `${item.change}: ${item.path}`),
    `Next: ${report.nextAction}`,
    report.staged ? 'Files staged locally for review. No repository changes.' : 'Plan only. No files or repository changes.',
  ].map(clean).join('\n') + '\n';
  // Keep the supplied binding intact: a policy revision, target revision and diff
  // base have different meanings. In particular, schema 2 has no legacy baseSha.
  const binding = report.binding ?? report.handback?.binding ?? null;
  const revisions = binding?.revisions;
  const summary = {
    schemaVersion: 1, kind: 'changeplane.assessment-summary', decision: report.decision,
    ...(report.code ? { code: report.code } : {}),
    headSha: revisions?.head ?? report.headSha ?? null,
    currentHeadSha: revisions?.currentHead ?? report.currentHeadSha ?? null,
    baseSha: report.baseSha ?? null,
    binding,
    subjectBinding: report.subjectBinding ?? null,
    claim: report.claim ?? null,
    capabilities: report.capabilities ?? null,
    observation: report.observation ?? null,
    ...(report.wait ? { wait: report.wait } : {}),
    ...(report.pipeline ? { pipeline: report.pipeline, review: report.review, reviewRequest: report.reviewRequest,
      humanReview: report.humanReview, ...(report.session ? { session: report.session } : {}),
      ci: { decision: report.ci.decision, findings: report.ci.findings, nextAction: report.ci.nextAction } } : {}),
    findingCount: report.findings?.length ?? null,
    findings: report.findings ?? [], diagnoses: report.diagnoses ?? [],
    nextAction: report.nextAction, nextActionCode: report.nextActionCode ?? (revisions ? report.nextAction : null),
    authority: report.authority,
    detail: 'Summary only. Use --format json for the complete evidence and handback. Reassess after changes.',
  };
  if (format === 'compact') return JSON.stringify(summary) + '\n';
  if (format !== 'text') throw new Error('USAGE_INVALID');
  return [
    `ChangePlane: ${report.decision}`,
    `Assessed revision: ${summary.headSha ?? 'unavailable'}`,
    `Current revision: ${summary.currentHeadSha ?? 'unavailable'}`,
    ...(binding?.identity ? [`Change request: ${binding.identity.forge} ${binding.identity.origin} repository ${binding.identity.repositoryId} change ${binding.identity.changeId}`,
      `Source repository: ${binding.identity.sourceRepositoryId}`] : []),
    ...(summary.baseSha ? [`Base revision: ${summary.baseSha}`] : []),
    ...[
      ['Policy revision', revisions?.policy ?? binding?.policyRevision],
      ['Current policy revision', revisions?.currentPolicy],
      ['Target revision', revisions?.target ?? binding?.targetRevision],
      ['Current target revision', revisions?.currentTarget],
      ['Merge base', revisions?.mergeBase],
      ['Diff start', revisions?.diffStart],
    ].filter(([, value]) => value != null).map(([label, value]) => `${label}: ${value}`),
    ...(summary.subjectBinding ? [`Subject binding: ${summary.subjectBinding}`] : []),
    ...(summary.claim ? [`Claim: ${summary.claim}`] : []),
    ...(summary.capabilities ? [`Capabilities: ${JSON.stringify(summary.capabilities)}`] : []),
    `Evidence: ${report.observation?.source ?? 'unavailable'}; point-in-time advisory assessment`,
    ...(report.pipeline ? [
      `Pipeline: ${report.pipeline.status}; CI: ${report.ci.decision}`,
      `Review: ${report.review.status}; operator-supplied, unauthenticated advisory data`,
      `Review request: ${report.reviewRequest.id}`,
      `Review engine source: ${report.reviewRequest.compatibleSource}`,
      `Review command (isolated trusted job): ${report.reviewRequest.command.join(' ')}`,
      ...(report.review.coverage ? [`Coverage: ${JSON.stringify(report.review.coverage)}`] : []),
      ...report.review.findings.map(item => `Review finding: ${item.path}:${item.startLine}–${item.endLine} [${item.severity}] ${item.content}`),
      ...(report.humanReview ? [`Human review: ${report.humanReview.receipts.length} current decisions; ${report.humanReview.changesRequested.length} changes requested`,
        `Review in GitHub: ${report.humanReview.reviewUrl}`] : []),
      ...(report.session ? [`Resume session: ${report.session.id}`, `Human review draft: ${report.session.humanReviewPath}`] : []),
    ] : []),
    ...(report.code ? [`Reason: ${report.code}`] : []),
    ...(report.wait ? [`Wait: ${report.wait.outcome}; ${report.wait.inspections} inspections within ${report.wait.secondsRequested} seconds requested`] : []),
    ...((report.findings ?? []).map(item => `Finding: ${item.code}`)),
    `Next: ${summary.nextActionCode === 'REOBSERVE_REVISION'
      ? 'Read the current PR revision and workflow attempt, then reassess fresh evidence.'
      : report.message ?? report.nextAction}`,
    'No Guard, repair or merge authority. Use --format json for complete evidence.',
  ].map(clean).join('\n') + '\n';
}
