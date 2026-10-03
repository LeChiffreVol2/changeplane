import { useEffect, useRef, useState } from 'react';
import { responseJson } from './lib/api-client.js';
import { issuePlanSnapshot, repositoryLink, repositoryOverviewMatches, repositoryPlanningHandoff } from './lib/repository-workspace.js';
import './live-workspace.css';

export default function LiveWorkspace({ repository }) {
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState('repository'), [overview, setOverview] = useState(null), [issue, setIssue] = useState(null);
  const [pulls, setPulls] = useState([]), [page, setPage] = useState(1), [nextPage, setNextPage] = useState(null);
  const [number, setNumber] = useState(null), [mode, setMode] = useState('evidence');
  const [view, setView] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [copied, setCopied] = useState(''), [watch, setWatch] = useState(false);
  const [reasons, setReasons] = useState({});
  const lifetime = useRef(0), controller = useRef(null), latest = useRef({});
  latest.current = { number, mode, busy, page };
  useEffect(() => () => { lifetime.current += 1; controller.current?.abort(); }, []);

  async function load(selected = null, selectedMode = mode, selectedPage = page) {
    const id = ++lifetime.current; controller.current?.abort(); controller.current = new AbortController();
    setBusy(true); setError(''); setView(null); setCopied(''); setReasons({});
    setArea('pulls'); setOverview(null); setIssue(null);
    setNumber(selected); setMode(selectedMode);
    try {
      const query = new URLSearchParams({ action: selected ? 'workspace' : 'pulls', repository,
        ...(selected ? { number: String(selected), mode: selectedMode } : { page: String(selectedPage) }) });
      const data = await responseJson(await fetch(`/api/github?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.current.signal,
      }));
      if (id !== lifetime.current) return;
      if (selected) {
        if (data.kind !== 'changeplane.pr-workspace' || data.repository !== repository || data.number !== selected) throw new Error('The response does not match this pull request. Refresh to try again.');
        setView(data);
        if (data.status !== 'ci_pending') setWatch(false);
      } else { setPulls(data.pulls ?? []); setPage(selectedPage); setNextPage(data.nextPage); }
    } catch (failure) {
      if (id === lifetime.current && failure.name !== 'AbortError') { setError(failure.message); setWatch(false); }
    } finally { if (id === lifetime.current) setBusy(false); }
  }
  async function loadRepository(selectedIssue = null) {
    const id = ++lifetime.current; controller.current?.abort(); controller.current = new AbortController();
    setArea('repository'); setIssue(selectedIssue); setOverview(null); setView(null); setNumber(null);
    setBusy(true); setError(''); setCopied(''); setWatch(false); setReasons({});
    try {
      const query = new URLSearchParams({ action: 'repository', repository,
        ...(selectedIssue ? { issue: String(selectedIssue) } : {}) });
      const data = await responseJson(await fetch(`/api/github?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.current.signal,
      }));
      if (id !== lifetime.current) return;
      if (data.kind === 'changeplane.repository-overview' && data.repository === repository
        && selectedIssue && data.selectedIssueStatus === 'unavailable') throw new Error('This issue could not be read. Check its number and the GitHub App’s repository access.');
      if (!repositoryOverviewMatches(data, repository, selectedIssue)) throw new Error('The response does not match this repository and issue.');
      setOverview(data);
    } catch (failure) {
      if (id === lifetime.current && failure.name !== 'AbortError') setError(failure.message);
    } finally { if (id === lifetime.current) setBusy(false); }
  }
  useEffect(() => {
    if (!watch) return;
    const interval = setInterval(() => {
      const current = latest.current;
      if (document.visibilityState === 'visible' && !current.busy) void load(current.number, current.mode, current.page);
    }, 30000);
    return () => clearInterval(interval);
  }, [watch]);
  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); setCopied(label); }
    catch { setCopied('Copy from the text below. Clipboard access is unavailable.'); }
  }
  const humanDraft = view?.humanReview?.reviewBody;
  const reviewedPaths = view?.humanReview?.unreviewedPaths ?? [];
  const draft = humanDraft && reviewedPaths.every(path => reasons[path]?.trim().length >= 3)
    ? humanDraft.replace(/<!-- changeplane:review-decision:v1\s+([\s\S]*?)-->/u, (_marker, raw) => {
      try { const value = JSON.parse(raw); value.reviewedPaths = reviewedPaths.map(path => ({ path, reason: reasons[path].trim().replace(/\s+/gu, ' ') }));
        // Findings requiring a fix remain unresolved. Dismissal is a separate human decision in GitHub.
        value.dismissedFindings = [];
        return `<!-- changeplane:review-decision:v1\n${JSON.stringify(value, null, 2)}\n-->`; } catch { return ''; }
    }) : null;
  return <section className="live-workspace" aria-label="Live repository activity">
    <div className="live-heading"><div><h2>What needs you today?</h2><p>Follow issues, team handoffs and pull requests in {repository}.</p></div>
      {!open && <div className="live-toolbar"><button className="primary-action" type="button" onClick={() => { setOpen(true); void loadRepository(); }}>Open repository activity</button>
        <button type="button" onClick={() => { setOpen(true); void load(); }}>Open live pull requests</button></div>}</div>
    {open && <>
      <div className="live-toolbar"><button type="button" aria-pressed={area === 'repository'} disabled={busy} onClick={() => loadRepository()}>Repository activity</button>
        <button type="button" aria-pressed={area === 'pulls'} disabled={busy} onClick={() => load(null)}>Pull requests</button>
        <button type="button" disabled={busy} onClick={() => area === 'repository' ? loadRepository(issue) : load(number)}>{area === 'repository' ? 'Refresh repository' : 'Refresh evidence'}</button>
        {area === 'pulls' && <label><input type="checkbox" disabled={busy || view?.status !== 'ci_pending'} checked={watch} onChange={event => setWatch(event.target.checked)} /> Refresh pending CI every 30 seconds while this page is visible</label>}</div>
      {busy && <p role="status">{area === 'repository' ? 'Reading repository activity…' : 'Reading current GitHub evidence…'}</p>}
      {error && <p role="alert">{error} Current evidence is unavailable. Refresh to try again.</p>}
      {overview && <RepositoryActivity report={overview} onIssue={loadRepository} onPull={load} onRefresh={() => loadRepository(issue)} onCopy={copy} />}
      {area === 'pulls' && !number && !busy && !error && <>
        {pulls.length === 0 ? <p>No open pull requests on this page. Open your next real change on GitHub, then refresh here.</p>
          : <ul className="live-pulls">{pulls.map(pr => <li key={pr.number}><button type="button" onClick={() => load(pr.number)}><strong>#{pr.number} {pr.title}</strong><span>{pr.draft ? 'Draft · ' : ''}Inspect current evidence →</span></button></li>)}</ul>}
        <div className="live-toolbar">{page > 1 && <button type="button" onClick={() => load(null, mode, page - 1)}>Previous page</button>}
          {nextPage && <button type="button" onClick={() => load(null, mode, nextPage)}>Next page</button>}</div>
      </>}
      {number && <label className="live-mode">Assessment <select aria-label="Assessment" disabled={busy} value={mode} onChange={event => load(number, event.target.value)}>
        <option value="evidence">CI evidence · no model key needed</option>
        <option value="feedback">GitHub feedback + CI · no model key</option>
        <option value="pipeline">Optional model review handoff + CI</option></select></label>}
      {view && <article className="live-result" aria-live="polite">
        <span className="live-eyebrow">PR #{view.number} · {view.headSha ? view.headSha.slice(0, 12) : 'Revision not verified'}</span>
        <h3>{view.title}</h3><p><strong>Next: {view.nextAction}</strong></p>
        <p>Responsible: {view.owner}. {view.consequence}</p>
        {view.blockers.length > 0 && <ul>{view.blockers.slice(0, 3).map((item, index) => <li key={index}>{item.path && <code>{item.path}: </code>}{item.message}</li>)}</ul>}
        {view.blockers.length > 3 && <p>{view.blockers.length - 3} more findings under Evidence and coverage.</p>}
        <div className="live-toolbar">
          {view.actions.primary?.kind === 'refresh' ? <button className="primary-action" type="button" disabled={busy} onClick={() => load(number)}>Refresh this PR</button>
            : ['review', 'checks'].includes(view.actions.primary?.kind) ? <a className="live-primary" href={view.actions.primary.kind === 'review' ? view.actions.reviewUrl : view.actions.checksUrl} target="_blank" rel="noreferrer">{view.actions.primary.label}</a>
              : <button className="primary-action" type="button" onClick={() => copy(view.actions.handoff, 'Agent handoff copied')}>Copy task for your agent</button>}
        </div>
        <p>{view.continuation}</p>
        {view.status === 'unavailable' && <p>Finish repository setup above if policy or read permissions are missing, then reassess this PR.</p>}
        {view.feedback && <div className="live-feedback"><h4>Existing GitHub feedback</h4>
          <p>{view.feedback.limitation}</p>
          {view.feedback.references.length === 0 && view.feedback.previousReferences.length === 0
            ? <p>No published feedback references were found. This does not establish that a review ran or passed.</p>
            : <ul>{view.feedback.references.map(item => <li key={`${item.kind}:${item.id}`}>
              <a href={item.url} target="_blank" rel="noreferrer">{item.state === 'CHANGES_REQUESTED' ? 'Change request' : 'Comment'} #{item.id}</a>
              {' · '}{item.reviewedHead === view.headSha ? 'Current revision' : `Earlier revision ${item.reviewedHead.slice(0, 12)}`}</li>)}</ul>}
          {view.feedback.previousReferences.length > 0 && <details><summary>Older or outdated comments ({view.feedback.previousReferences.length})</summary>
            <p>These have not been verified against this revision. Check the discussion before deciding whether a change is needed.</p>
            <ul>{view.feedback.previousReferences.map(item => <li key={`${item.kind}:${item.id}`}><a href={item.url} target="_blank" rel="noreferrer">Comment #{item.id}</a>
              {' · '}Reviewed {item.reviewedHead.slice(0, 12)}{item.outdated ? ' · Outdated location' : ''}</li>)}</ul></details>}
        </div>}
        <details><summary>Evidence and coverage</summary>
          <p>{view.observedAt ? `Observed ${new Date(view.observedAt).toLocaleString()}. Refresh after changes.` : 'No current observation is available.'}</p>
          <ul>{view.evidence.map((item, index) => <li key={index}>{item.name} · {item.status} · {item.conclusion ?? 'Waiting'}</li>)}</ul>
          <ul>{view.blockers.map((item, index) => <li key={index}>{item.path && <code>{item.path} </code>}{item.message}</li>)}</ul>
          <p>Model review: {view.review.status.replaceAll('_', ' ')}. {view.review.quality}</p>
          {view.review.coverage && <p>Completed {view.review.coverage.completed}; reused {view.review.coverage.reused}; failed {view.review.coverage.failed}; missing {view.review.coverage.missingPaths.length}; waived {view.review.coverage.waived}.</p>}
        </details>
        {view.review.findings.length > 0 && <div><h4>Findings to investigate</h4>{view.review.findings.map(item => <div className="live-finding" key={item.id}>
          <strong>{item.severity} · {item.path}:{item.startLine}</strong><p>{item.content}</p>{item.count > 1 && <small>{item.count} matching findings grouped; original decisions retained.</small>}</div>)}</div>}
        {reviewedPaths.length > 0 && <details><summary>Prepare your human review</summary><p>Review each file on GitHub, then explain your decision. This prepares text; you submit the review yourself. Findings needing fixes remain unresolved.</p>
          {reviewedPaths.map(path => <label className="live-reason" key={path}>{path}<textarea maxLength={1000} value={reasons[path] ?? ''} onChange={event => setReasons(current => ({ ...current, [path]: event.target.value }))} placeholder="What did you verify?" /></label>)}
          <button type="button" disabled={!draft} onClick={() => copy(draft, 'Human review draft copied')}>Copy review draft</button>
          {draft && <textarea aria-label="Human review draft" readOnly value={draft} />}
          <p>{view.humanReview.nextAction}</p></details>}
        <details><summary>Other ways to continue</summary>
          <div className="live-toolbar"><a href={view.actions.reviewUrl} target="_blank" rel="noreferrer">Review on GitHub</a>
            <a href={view.actions.checksUrl} target="_blank" rel="noreferrer">Open CI checks</a>
            {view.actions.primary && view.actions.primary.kind !== 'handoff' && <button type="button" onClick={() => copy(view.actions.handoff, 'Agent handoff copied')}>Copy task for your agent</button>}</div>
          <textarea aria-label="Agent handoff" readOnly value={view.actions.handoff} /></details>
        <details><summary>Optional model review: data, limits and control</summary>
          <p>This page reads evidence only. Enable model review in your own runtime with your own key. The isolated runner sends permitted changed-file context and bounded review evidence to OpenAI. Never paste keys into ChatGPT.</p>
          <p>Default: GPT-5.6 Luna, high reasoning, at most 24 requests, 4,096 output tokens per request, a 100,000 reported-token cutoff and a 330-second job limit. An in-flight call can cross the cutoff; this is not a guaranteed dollar cap.</p>
          <p>Stop the running CLI or agent task to cancel. A failed or incomplete review stays incomplete. Use the explicit retry command after investigating; current completed reports are reused.</p>
        </details>
      </article>}
      {copied && <p role="status">{copied}</p>}
    </>}
  </section>;
}

const inputLabels = { acceptanceCriteria: 'acceptance criteria', context: 'enough context to plan the work' };
const sourceLabels = { issues: 'Issues', pullRequests: 'Pull requests', team: 'Team coordination', maintenance: 'Maintenance', release: 'Release preparation' };
const taskLabels = { planned: 'Waiting to be claimed', active: 'In progress', review: 'Review recorded', blocked: 'Blocked', merged: 'Merge recorded', cancelled: 'Cancelled' };

function RepositoryActivity({ report, onIssue, onPull, onRefresh, onCopy }) {
  const selected = report.selectedIssue;
  const snapshot = selected ? issuePlanSnapshot(report, selected) : null;
  const planningPrompt = selected ? repositoryPlanningHandoff(report, selected) : '';
  const root = `https://github.com/${report.repository}`;
  const observedAt = report.observedAt && Number.isFinite(Date.parse(report.observedAt))
    ? new Date(report.observedAt).toLocaleString() : 'Observation time unavailable';
  const issueAction = (item, label = 'Open issue') => <button type="button" onClick={() => onIssue(item.number)}>{label} #{item.number}</button>;
  const reconcile = ['Reconcile the ChangePlane team in ' + report.repository + ' using the trusted runtime and existing operator access.',
    `This page read coordination revision ${report.team.revision ?? 'unavailable'} against default revision ${report.binding.baseSha}.`,
    'Stored task states are not current PR evidence. Reobserve the issue, policy, dependency merges, PR head, feedback and CI before deciding the next handoff.',
    'Resume only the assigned task in its isolated workspace. Do not widen scope, start a new writer, issue approval or merge. Keep operator credentials outside the model.',
    'Report the blocker, responsible person or agent, and one next action. A stopped agent must be resumed in its own client.'].join('\n');
  const prompt = snapshot?.currentIssue ? [reconcile,
    `Focus on issue #${selected.number}. Revalidate the issue binding before continuing:`,
    JSON.stringify(selected.binding), `Accepted task IDs: ${snapshot.plan.tasks.join(', ')}.`,
    'Revalidate this accepted plan and any archived task receipts; never treat a stored task state as current evidence.',
    'After the linked PRs merge, verify each acceptance criterion and ask the operator to confirm delivery before updating the issue or its Project. An existing receipt needs revalidation; it does not grant merge authority.',
    'This copied handoff does not start an agent or change GitHub.'].join('\n') : planningPrompt;
  return <div className="repository-activity">
    <p className="live-eyebrow">Read from GitHub · {observedAt}</p>
    <p className="repository-scope">This page reads activity and prepares handoffs. Your enabled agents do the work; GitHub controls merge.</p>
    {selected ? <article className="repository-issue" aria-label={`Issue ${selected.number}`}>
      <button className="repository-back" type="button" onClick={() => onIssue(null)}>← All repository activity</button>
      <h3>#{selected.number} {selected.title}</h3>
      <p>{selected.assignees.length ? `Assigned to ${selected.assignees.join(', ')}` : 'No GitHub assignee yet'}
        {selected.priority.label ? ` · Priority label: ${selected.priority.label}` : ' · Priority not specified'}</p>
      {selected.missingInputs.length > 0 && <p className="repository-blocker">The intake check suggests adding {selected.missingInputs.map(item => inputLabels[item] ?? item).join(' and ')}. Review the issue before accepting a scoped plan. Add any missing details on GitHub, then refresh.</p>}
      {snapshot.plan && !snapshot.currentIssue && <p className="repository-blocker">The issue changed after its plan was accepted. Previous task assignments do not establish a plan for this revision. Prepare a new plan for review.</p>}
      <ol className="repository-lifecycle" aria-label="Issue lifecycle">
        <li><strong>Issue</strong><span>{selected.state === 'closed' ? 'Closed on GitHub; verify delivery' : selected.missingInputs.length ? 'Details to clarify' : 'Ready to plan'}</span></li>
        <li><strong>Accepted plan</strong><span>{snapshot.currentIssue ? `${snapshot.plan.tasks.length} task scopes recorded` : 'Operator acceptance needed'}</span></li>
        <li><strong>Work and review</strong><span>{snapshot.tasks.some(task => task.pullRequest) ? 'Inspect linked PRs below' : snapshot.currentIssue ? 'Refresh task history with operator' : 'Accept the plan first'}</span></li>
        <li><strong>Delivery</strong><span>{snapshot.currentIssue && snapshot.plan.receipt ? 'Confirmation recorded; refresh with operator' : 'Acceptance evidence needed'}</span></li>
      </ol>
      <div className="live-toolbar">{selected.missingInputs.length
        ? <a className="live-primary" href={`${root}/issues/${selected.number}`} target="_blank" rel="noreferrer">Clarify this issue on GitHub</a>
        : snapshot.currentIssue ? <button className="primary-action" type="button" onClick={() => onCopy(prompt, 'Issue handoff copied. Resume with the assigned person or agent after refreshing the task evidence.')}>Copy issue handoff</button>
          : <button className="primary-action" type="button" onClick={() => onCopy(prompt, 'Planning task copied. Paste it into your agent; the operator still needs to accept the plan.')}>Copy planning task</button>}</div>
      {selected.duplicateCandidates.length > 0 && <details><summary>Possible related issues ({selected.duplicateCandidates.length})</summary>
        <p>Similar titles are suggestions to investigate, not confirmed duplicates.</p><ul>{selected.duplicateCandidates.map(item => <li key={item.number}>{issueAction(item, 'Inspect related issue')} {item.title}</li>)}</ul></details>}
      {snapshot.currentIssue && <div className="repository-plan"><h4>Accepted task plan · recorded snapshot</h4>
        <TaskRows tasks={snapshot.tasks} onPull={onPull} />
        {snapshot.missingTasks.length > 0 && <p>Task history is not included for {snapshot.missingTasks.join(', ')}. The operator must load and verify the archived receipts before confirming delivery.</p>}
        <p>{snapshot.plan.receipt ? `Delivery confirmation was recorded by ${snapshot.plan.receipt.confirmedBy}. Verify it against current issue, policy and merged work before making further updates.`
          : 'Merging a PR does not confirm every acceptance criterion. The operator verifies delivery before closing the issue or updating its Project.'}</p>
      </div>}
      <details><summary>{snapshot.currentIssue ? 'Work handoff and revision' : 'Planning handoff and revision'}</summary>
        <p>{snapshot.currentIssue ? 'Refresh the accepted plan and task evidence before continuing. This handoff does not start an agent or change GitHub.' : 'This prepares a proposal for operator acceptance. It does not assign work, run an agent or update GitHub.'}</p>
        <textarea aria-label={snapshot.currentIssue ? 'Issue work handoff' : 'Issue planning handoff'} readOnly value={prompt} />
        <p>Issue revision <code>{selected.revision}</code> · Default revision <code>{report.binding.baseSha}</code></p></details>
    </article> : <>
      <section className="repository-section" aria-labelledby="repository-attention"><h3 id="repository-attention">Needs attention</h3>
        {report.needsAttention.length === 0 ? <p>No attention items were found in the sources read. Check coverage below before treating this as a complete picture.</p>
          : <ul className="repository-rows">{report.needsAttention.slice(0, 8).map((item, index) => <li key={`${item.kind}:${item.id}:${index}`}>
            <div><strong>{item.title}</strong><p>{item.reason}</p></div>
            {item.kind === 'issue' && Number.isSafeInteger(Number(item.id)) ? issueAction({ number: Number(item.id) }, 'Inspect issue')
              : item.kind === 'pull-request' && Number.isSafeInteger(Number(item.id)) ? <button type="button" onClick={() => onPull(Number(item.id))}>Inspect PR #{item.id}</button>
                : item.kind === 'task' ? <button type="button" onClick={() => onCopy(reconcile, 'Team reconciliation task copied. Resume it through your operator or existing agent.')}>Prepare team handoff</button>
                  : <button type="button" onClick={onRefresh}>Retry repository read</button>}</li>)}</ul>}
        {report.needsAttention.length > 8 && <p>{report.needsAttention.length - 8} more items appear in the work lists below.</p>}
      </section>
      <section className="repository-section" aria-labelledby="repository-issues"><h3 id="repository-issues">Issues to plan</h3>
        {report.issues.status !== 'available' ? <SourceUnavailable name="Issue" onRefresh={onRefresh} />
          : report.issues.items.length === 0 ? <p>No open issues were found in this read. <a href={`${root}/issues/new`} target="_blank" rel="noreferrer">Describe the next goal on GitHub</a>.</p>
            : <ul className="repository-rows">{report.issues.items.map(item => <li key={item.number}>
              <div><strong>#{item.number} {item.title}</strong><p>{item.missingInputs.length ? `Clarify ${item.missingInputs.map(input => inputLabels[input] ?? input).join(' and ')}.` : 'Review acceptance criteria and scope.'}
                {item.priority.label && ` Priority label: ${item.priority.label}.`}</p></div>{issueAction(item, 'Plan issue')}</li>)}</ul>}
      </section>
      <section className="repository-section" aria-labelledby="repository-team"><h3 id="repository-team">Team progress</h3>
        {report.team.status === 'not-enabled' ? <><p>Team coordination is not enabled in this repository. Have the operator review a setup proposal before assigning scoped work.</p>
          <button type="button" onClick={() => onCopy(`Prepare a reviewed ChangePlane team setup proposal for ${report.repository}. Read the trusted default-branch policy and current ChangePlane consumer skill. Propose team enablement and a bounded maximum number of active tasks in a protected configuration PR. Do not change source, install workflows, expand permissions or enable an agent without the operator's approval. No task has been assigned by this request.`, 'Team setup request copied. Have the operator review the configuration PR.')}>Prepare team setup request</button></>
          : report.team.status === 'not-started' ? <p>Team coordination is enabled, but no plan has been recorded. Start with an issue and have the operator accept its scope and acceptance criteria.</p>
            : report.team.status !== 'available' ? <SourceUnavailable name="Team coordination" onRefresh={onRefresh} /> : <>
          <p>Recorded coordination, not current assurance. Reconcile with GitHub before acting on a task.</p>
          {report.team.tasks.length === 0 ? <p>No scoped tasks are recorded. Start with an issue and have the operator accept a plan.</p>
            : <><TaskRows tasks={report.team.tasks} onPull={onPull} />
              <button type="button" onClick={() => onCopy(reconcile, 'Team reconciliation task copied. Resume it through your operator or existing agent.')}>Prepare team handoff</button></>}
        </>}
      </section>
      <section className="repository-section" aria-labelledby="repository-pulls"><h3 id="repository-pulls">Pull requests to follow</h3>
        {report.pullRequests.status !== 'available' ? <SourceUnavailable name="Pull request" onRefresh={onRefresh} />
          : report.pullRequests.items.length === 0 ? <p>No open pull requests were found in this read.</p>
            : <ul className="repository-rows">{report.pullRequests.items.map(item => <li key={item.number}>
              <div><strong>#{item.number} {item.title}</strong><p>{item.draft ? 'Draft · ' : ''}CI and feedback have not been assessed in this overview.</p></div>
              <button type="button" onClick={() => onPull(item.number)}>Inspect PR #{item.number}</button></li>)}</ul>}
      </section>
    </>}
    <details className="repository-section"><summary>Maintenance suggestions</summary>
      <p>Review these candidates before accepting new work. No maintenance task starts from this page.</p>
      {report.maintenance.status === 'partial' && <p>Some maintenance sources could not be read. Review source coverage below, then refresh for the missing evidence.</p>}
      {report.maintenance.status === 'unavailable' ? <SourceUnavailable name="Maintenance" onRefresh={onRefresh} />
        : report.maintenance.suggestions.length === 0 ? <p>No maintenance candidates were found in the sources read.</p>
          : <ul>{report.maintenance.suggestions.map((item, index) => <li key={index}><strong>{item.title}</strong><p>{item.reason}</p>
            {repositoryLink(item.url, report.repository) && <a href={repositoryLink(item.url, report.repository)} target="_blank" rel="noreferrer">Review candidate on GitHub</a>}</li>)}</ul>}
    </details>
    <details className="repository-section"><summary>Prepare release notes</summary>
      <p>Review the scope and repository release rules. These notes do not create a tag, change a version or publish a release.</p>
      {report.release.status === 'unavailable' ? <SourceUnavailable name="Release" onRefresh={onRefresh} />
        : report.release.draft ? <><h4>{report.release.draft.title}</h4><textarea aria-label="Release notes draft" readOnly value={report.release.draft.body} />
          <button type="button" onClick={() => onCopy(report.release.draft.body, 'Release notes copied. Review the scope and follow your repository release rules.')}>Copy release notes</button></>
          : <p>No release draft is available from this read.</p>}
    </details>
    <details className="repository-section"><summary>Read coverage and permissions</summary>
      <p>Observed {observedAt}. Refresh after changes. Sources may be bounded or unavailable; omitted work is not proof of completion.</p>
      <ul>{Object.entries(sourceLabels).map(([key, label]) => <li key={key}><strong>{label}:</strong> {report[key].status === 'available' ? 'Read' : report[key].status === 'unavailable' ? 'Unavailable' : report[key].status === 'not-enabled' ? 'Not enabled' : report[key].status === 'not-started' ? 'Not started' : 'Partial or limited'}
        {report[key].coverage === 'bounded-window' ? ' · bounded window' : report[key].coverage === 'complete' ? ' · complete for this source query' : ' · coverage not established'}
        {report[key].reasonCode && <span> · {report[key].reasonCode.replaceAll('_', ' ').toLowerCase()}</span>}
        {key === 'maintenance' && report[key].coverage && <ul>{Object.entries(report[key].coverage).map(([source, coverage]) => <li key={source}>{sourceLabels[source] ?? source}: {coverage === 'complete' ? 'complete for this source query' : coverage === 'bounded-window' ? 'bounded window' : 'unknown'}</li>)}</ul>}</li>)}</ul>
      <p>Default branch <code>{report.binding.defaultBranch}</code> at <code>{report.binding.baseSha}</code>. Team metadata is a stored snapshot and carries no source-write, approval or merge authority.</p>
    </details>
  </div>;
}

function SourceUnavailable({ name, onRefresh }) {
  return <div className="repository-blocker"><p>{name} data could not be read. This section cannot establish current work or completion. Check the GitHub App’s repository access if it remains unavailable.</p>
    <button type="button" onClick={onRefresh}>Retry {name.toLowerCase()} read</button></div>;
}

function TaskRows({ tasks, onPull }) {
  return <ul className="repository-rows">{tasks.map(task => <li key={task.id}>
    <div><strong>{task.title}</strong><p>{taskLabels[task.state] ?? 'State not established'} · {task.owner ? `Owner: ${task.owner}` : 'No owner recorded'}</p>
      {task.dependsOn.length > 0 && <p>Depends on: {task.dependsOn.join(', ')}</p>}
      <details><summary>Scope and acceptance</summary><p>Allowed paths: {task.paths.join(', ')}</p>
        {task.acceptanceCriteria?.length ? <ul>{task.acceptanceCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No acceptance criteria recorded.</p>}
        {task.outcome && <p>Last recorded outcome: {task.outcome.replaceAll('_', ' ').toLowerCase()}. Reconcile before acting.</p>}
        {task.headSha && <p>Recorded revision: <code>{task.headSha}</code></p>}</details></div>
    {task.pullRequest && <button type="button" onClick={() => onPull(task.pullRequest)}>Inspect PR #{task.pullRequest}</button>}
  </li>)}</ul>;
}
