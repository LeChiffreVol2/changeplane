import { useEffect, useRef, useState } from 'react';
import { responseJson } from './lib/api-client.js';
import './live-workspace.css';

export default function LiveWorkspace({ repository }) {
  const [open, setOpen] = useState(false);
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
  return <section className="live-workspace" aria-label="Live pull requests">
    <div className="live-heading"><div><h2>Know what needs you next</h2><p>Inspect a real pull request in {repository}.</p></div>
      {!open && <button className="primary-action" type="button" onClick={() => { setOpen(true); void load(); }}>Open live pull requests</button>}</div>
    {open && <>
      <div className="live-toolbar"><button type="button" disabled={busy} onClick={() => load(null)}>Pull requests</button>
        <button type="button" disabled={busy} onClick={() => load(number)}>Refresh evidence</button>
        <label><input type="checkbox" disabled={busy || view?.status !== 'ci_pending'} checked={watch} onChange={event => setWatch(event.target.checked)} /> Refresh pending CI every 30 seconds while this page is visible</label></div>
      {busy && <p role="status">Reading current GitHub evidence…</p>}
      {error && <p role="alert">{error} Current evidence is unavailable. Refresh to try again.</p>}
      {!number && !busy && !error && <>
        {pulls.length === 0 ? <p>No open pull requests on this page. Open your next real change on GitHub, then refresh here.</p>
          : <ul className="live-pulls">{pulls.map(pr => <li key={pr.number}><button type="button" onClick={() => load(pr.number)}><strong>#{pr.number} {pr.title}</strong><span>{pr.draft ? 'Draft · ' : ''}Inspect current evidence →</span></button></li>)}</ul>}
        <div className="live-toolbar">{page > 1 && <button type="button" onClick={() => load(null, mode, page - 1)}>Previous page</button>}
          {nextPage && <button type="button" onClick={() => load(null, mode, nextPage)}>Next page</button>}</div>
      </>}
      {number && <label className="live-mode">Assessment <select disabled={busy} value={mode} onChange={event => load(number, event.target.value)}>
        <option value="evidence">CI evidence · no model key needed</option><option value="pipeline">Review handoff + CI</option></select></label>}
      {view && <article className="live-result" aria-live="polite">
        <span className="live-eyebrow">PR #{view.number} · {view.headSha ? view.headSha.slice(0, 12) : 'Revision not verified'}</span>
        <h3>{view.title}</h3><p><strong>Next: {view.nextAction}</strong></p>
        <p>Responsible: {view.owner}. {view.consequence}</p>
        <div className="live-toolbar"><a href={view.actions.reviewUrl} target="_blank" rel="noreferrer">Review on GitHub</a>
          <a href={view.actions.checksUrl} target="_blank" rel="noreferrer">Open CI checks</a>
          <button type="button" onClick={() => copy(view.actions.handoff, 'Agent handoff copied')}>Copy task for your agent</button></div>
        <p>{view.continuation}</p>
        {view.status === 'unavailable' && <p>Finish repository setup above if policy or read permissions are missing, then reassess this PR.</p>}
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
        <details><summary>Resume with your coding agent</summary><textarea aria-label="Agent handoff" readOnly value={view.actions.handoff} /></details>
        <details><summary>Optional model review: data, limits and control</summary>
          <p>This page reads evidence only. Enable model review in your own runtime with your own key. The isolated runner sends permitted changed-file context and bounded review evidence to OpenAI. Never paste keys into ChatGPT.</p>
          <p>Default: GPT-5.6 Luna, high reasoning, at most 24 requests, 4,096 output tokens per request, a 100,000 reported-token cutoff and a 330-second job limit. An in-flight call can cross the cutoff; this is not a guaranteed dollar cap.</p>
          <p>Stop the running CLI or agent task to cancel. A failed or incomplete review stays incomplete. Use the explicit retry command after investigating; current completed reports are reused.</p>
        </details>
        {copied && <p role="status">{copied}</p>}
      </article>}
    </>}
  </section>;
}
