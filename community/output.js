/** Optional views never replace the complete JSON evidence or confer authority. */
export function formatReport(report, format = 'json') {
  if (format === 'json') return JSON.stringify(report, null, 2) + '\n';
  const clean = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ');
  if (format === 'text' && report.kind === 'changeplane.setup-plan') return [
    `ChangePlane setup: ${report.decision}`,
    `Default revision: ${report.baseSha ?? 'unavailable'}`,
    ...(report.candidates ?? []).map(item => `Candidate: ${item.name} | ${item.workflowPath}`),
    ...(report.files ?? []).map(item => `${item.change}: ${item.path}`),
    `Next: ${report.nextAction}`,
    report.staged ? 'Files staged locally for review. No repository changes.' : 'Plan only. No files or repository changes.',
  ].map(clean).join('\n') + '\n';
  const summary = {
    schemaVersion: 1, kind: 'changeplane.assessment-summary', decision: report.decision,
    ...(report.code ? { code: report.code } : {}),
    headSha: report.headSha ?? null, currentHeadSha: report.currentHeadSha ?? null, baseSha: report.baseSha ?? null,
    subjectBinding: report.subjectBinding ?? null,
    observation: report.observation ?? null,
    findingCount: report.findings?.length ?? null,
    findings: report.findings ?? [], diagnoses: report.diagnoses ?? [],
    nextAction: report.nextAction, nextActionCode: report.nextActionCode ?? null,
    authority: report.authority,
    detail: 'Summary only. Use --format json for the complete evidence and handback. Reassess after changes.',
  };
  if (format === 'compact') return JSON.stringify(summary) + '\n';
  if (format !== 'text') throw new Error('USAGE_INVALID');
  return [
    `ChangePlane: ${report.decision}`,
    `Assessed revision: ${report.headSha ?? 'unavailable'}`,
    `Current revision: ${report.currentHeadSha ?? 'unavailable'}`,
    `Evidence: ${report.observation?.source ?? 'unavailable'}; point-in-time advisory assessment`,
    ...(report.code ? [`Reason: ${report.code}`] : []),
    ...((report.findings ?? []).map(item => `Finding: ${item.code}`)),
    `Next: ${report.nextActionCode === 'REOBSERVE_REVISION'
      ? 'Read the current PR revision and workflow attempt, then reassess fresh evidence.'
      : report.message ?? report.nextAction}`,
    'No Guard, repair or merge authority. Use --format json for complete evidence.',
  ].map(clean).join('\n') + '\n';
}
