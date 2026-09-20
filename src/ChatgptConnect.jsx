export default function ChatgptConnect() {
  const endpoint = `${window.location.origin}/api/chatgpt`;
  return <main className="live-workspace" style={{ maxWidth: 760, margin: '48px auto' }}>
    <a href="/">ChangePlane</a><h1>Understand your PRs in ChatGPT</h1>
    <p>Read current CI evidence, understand what needs attention and prepare the next task for your coding agent.</p>
    <p>Developer connection · the hosted repository rollout restrictions still apply. This is not a public directory listing.</p>
    <ol><li>Connect the ChangePlane GitHub App to the repositories you want to inspect.</li>
      <li>In ChatGPT developer settings, add a remote MCP connection using the endpoint below and OAuth.</li>
      <li>Use public client ID <code>changeplane-chatgpt</code>, no client secret, and scope <code>changeplane:read</code>.</li>
      <li>Read the consent screen, authorize through GitHub and return to ChatGPT.</li></ol>
    <label>Endpoint<input aria-label="ChatGPT MCP endpoint" readOnly value={endpoint} style={{ display: 'block', width: '100%', padding: 12, boxSizing: 'border-box' }} /></label>
    <p>Start with: “List my connected repositories, then check setup and inspect a pull request.”</p>
    <p>You choose which repository data to request. GitHub credentials and model keys are never placed in the chat. This connection reads evidence and prepares handoffs; GitHub retains review and merge authority.</p>
    <p><a href="https://github.com/LeChiffreVol2/changeplane/blob/main/docs/chatgpt-app.md" target="_blank" rel="noreferrer">Connection guide and current qualification</a></p>
  </main>;
}
