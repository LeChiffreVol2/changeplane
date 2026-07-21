# Security policy

ChangePlane's supported boundary is the repository-scoped GitHub autonomous harness described in the README. Managed model spend and merge authority are not supported. Scope-only installations remain in observe mode.

Report a suspected vulnerability privately to the repository owner or through the repository's private security-advisory channel. Do not include GitHub tokens, provider keys, private repository content, or other customer secrets in an issue.

## Security invariants

- GitHub and its branch protection remain the merge authority.
- The evaluator reads policy from the trusted base revision and binds decisions to an exact head SHA.
- A model can propose a patch but cannot issue `PASS`, approve, publish the required Check, or merge.
- BYOK plaintext is processed only long enough to verify the allowlisted model and seal the key with GitHub's repository public key. It is never persisted, echoed, or logged by ChangePlane.
- A provider key pasted into chat, an issue, a screenshot, or any other non-secret channel is treated as compromised even when repository and build scans are clean. The repository owner must revoke it at the provider, replace the repository Actions Secret with a new key, and verify fail-closed behavior before autonomous work resumes.
- Observe mode never dispatches a repair and never blocks a merge.
- Autonomous mode intentionally sends bounded failure evidence and text context only from controller-granted paths to the repository owner's selected OpenAI project. The proposal and validation helpers execute only from a trusted-base checkout; the pull-request checkout is treated as data. Observe-only evaluation and the public replay send no repository content to a model provider.
- The setup PR vendors versioned managed workflows and helpers into the selected repository. Repository-owned edits to reserved managed bytes are never overwritten automatically.
- Repository repair secrets begin inert. The controller derives a repository-bound HMAC and the proposal job receives no GitHub token, App key, controller master, Check authority, or push credential.
- A one-time exact-repository Contents-write installation token is minted only after the App-signed grant is claimed and revalidated immediately before a force-with-lease push. A fresh pull-request event must re-run evidence before PASS.
- `ChangePlane / review` is read-only, BYOK-gated, and bound to the exact diff. Findings must resolve to changed lines, are capped and deduplicated, and never approve, certify, repair, or contribute PASS.
- `.changeplane/assurance.md` is read only from the trusted default branch. Its repository-owned invariants and policy-pack guidance are untrusted context, not behavioral evidence.
- Agent handback Action outputs and receipt payloads carry findings and revision metadata only. They grant no GitHub credential, repair claim, controller authority, or certification.
- A preview URL is published only when its deployment SHA matches the evaluated head. A stale or unverifiable preview is omitted.
- `merge_group` is evaluated as a separate exact revision. Merge Queue runs publish guard evidence only and never invoke a proposal model or repair controller.

The GitHub App user-token installer is limited to user-triggered setup and protected configuration pull requests. Autonomous execution requires the dedicated App controller and short-lived installation tokens. The broad OAuth fallback remains observe-only.
