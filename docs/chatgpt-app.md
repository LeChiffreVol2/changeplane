# ChangePlane in ChatGPT

The read-only ChatGPT integration uses the same current-PR evaluator as the website and Open Source CLI. Its initial archetype is **tool-only**: useful conversational results and GitHub links, with no embedded widget required. No new database, queue, model account, or managed model spend is introduced.

## What the person can do

Connect GitHub, select an installed repository, check setup, list open PRs, inspect one PR and prepare a task for an existing coding agent. A result names the exact observed revision, blocker, responsible role and next action. Refresh after a commit, CI rerun or human review. A handoff is returned for copying; it does not launch or message an agent.

`evidence` mode needs no model key. `pipeline` mode prepares the optional review request and human-review draft using fresh GitHub data. The remote app does not read a local Docker session or import an operator's local OCR report. Model review continues in the explicitly enabled operator runtime. Pipeline coverage is incomplete until the corresponding report is supplied there; CI evidence alone is not complete model review.

| Tool | Purpose |
| --- | --- |
| `list_repositories` | List only the user's accessible App repositories inside the hosted rollout scope. |
| `check_repository_setup` | Check trusted policy and workflow prerequisites before the first real assessment. |
| `list_pull_requests` | Page through open PRs; inventory entries are explicitly unassessed. |
| `inspect_pull_request` | Explain one fresh assessment and its limitations. |
| `prepare_agent_handoff` | Return revision-bound instructions to the existing authorized writer. |

All tools are read-only, non-destructive and limited to the authenticated account's permitted repositories. No tool can accept credentials, approve, publish Guard, run paid review or merge. Repository titles, findings and comments remain untrusted data, never tool instructions.

## Connect a deployed instance

The endpoint is `https://YOUR_ORIGIN/api/chatgpt`. OAuth discovery is exposed at `/.well-known/oauth-protected-resource/api/chatgpt` and `/.well-known/oauth-authorization-server` (also available via the endpoint's `resource` and `metadata` actions).

1. Deploy through the existing protected Git/Vercel release process. The existing GitHub App client ID/secret, session secret, canonical HTTPS origin and rollout configuration must be valid. Preview and unattributed deployments fail closed. No additional GitHub callback is required: the integration reuses `/api/github?action=callback`.
2. In ChatGPT's developer settings, add the remote MCP endpoint with OAuth. Use the predefined **public** client ID `changeplane-chatgpt`, no client secret, and scope `changeplane:read`. The authorization server advertises issuer identification and accepts exactly `https://chatgpt.com/connector_platform_oauth_redirect`. Verify the management page shows that exact redirect before connecting; other redirects fail closed.
3. Read the consent page, continue with GitHub and return to ChatGPT. Use the GitHub App's selected-repository settings to control repository access. An installation outside the signed-in user's access or the hosted rollout allowlist is unavailable.
4. Ask “Which repositories can I inspect?”, then “Check setup and inspect PR 7 in OWNER/REPO.” Ask for a handoff if the current observation needs agent work. Refresh the connection after tool metadata changes.

The implementation follows the official SDK's stateless Streamable HTTP example and [OpenAI tool guidance](https://developers.openai.com/apps-sdk/plan/tools). See [MCP setup](https://developers.openai.com/apps-sdk/build/mcp-server), [OAuth requirements](https://developers.openai.com/apps-sdk/build/auth), [optional UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui) and [submission](https://developers.openai.com/apps-sdk/deploy/submission).

## Credential and data contract

GitHub owns single-use authorization codes and rotating refresh tokens. The broker seals the code and its exact client, redirect, resource and PKCE binding. The client verifier is checked locally and forwarded to GitHub; a repeated upstream code is not redeemable. Access tokens use a distinct encryption purpose, are bound to `changeplane:read` and the canonical MCP resource, and expire within an hour. Refresh credentials expire within thirty days or the shorter provider lifetime. They cannot be used as website sessions or controller grants.

Every MCP request rechecks the GitHub user and live App installations. Repository tools additionally revalidate the installation-to-repository binding and existing rollout scope. GitHub revocation or installation removal prevents subsequent access. Disconnect through ChatGPT and revoke the App authorization in GitHub to invalidate the provider credential; no independent immediate-revocation registry is claimed.

After explicit connection consent, requested repository/PR metadata, changed paths, evidence and handoff text are sent to ChatGPT. No provider key, GitHub token, raw source diff or CI log is returned in tool output. Credentials are sealed inside OAuth tokens, not model-readable content. The product does not collect raw conversation history or automatically start model review. ChatGPT's own data controls and retention apply to received tool results; no zero-retention claim is made.

## Qualification and release boundary

Local tests exercise OAuth consent/PKCE, code replay, refresh rotation, resource/client/purpose rejection, HTTP MCP discovery and tool calls, user isolation, schema rejection, and browser handling of new heads, late responses and unavailable evidence. Synthetic provider responses do not establish live ChatGPT OAuth qualification or public-directory approval.

The hosted controlled-canary restrictions remain in force. A real ChatGPT developer-mode login and current-PR assessment are separate release evidence. Public listing additionally needs a verified publisher, effective privacy/support information, review credentials and OpenAI approval. The privacy notice is still an approval draft; do not submit it as an effective notice. Existing paid-service accounts may connect under current platform rules; no digital subscription checkout or upsell is included in this app.
