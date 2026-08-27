# Security policy

ChangePlane's supported boundary is the repository-scoped GitHub autonomous harness described in the README. Managed model spend and merge authority are not supported. Scope-only installations remain in observe mode.

Report a suspected vulnerability privately to the repository owner or through the repository's private security-advisory channel. Do not include GitHub tokens, provider keys, private repository content, or other customer secrets in an issue.

## Security invariants

- GitHub and its branch protection remain the merge authority.
- Autonomous activation requires a repository admin, the GitHub App's read-only Administration permission, and strict up-to-date required checks on the live default branch. Merge Queue is guard-only and does not replace this prerequisite. A write collaborator cannot inspect or mutate repository secret state.
- The evaluator reads policy from the trusted base revision and binds decisions to an exact head SHA.
- Pull-request jobs execute managed controller bytes from the live default branch. They revalidate the default ref and SHA, pull-request base and head, and checked-out controller immediately before provider access, repair dispatch, and Check publication. Retargeting or default-branch drift fails closed.
- A model can propose a patch but cannot issue `PASS`, approve, publish the required Check, or merge.
- BYOK plaintext is processed only long enough to verify the allowlisted model and seal the key with GitHub's repository public key. It is never persisted, echoed, or logged by ChangePlane.
- A provider key pasted into chat, an issue, a screenshot, or any other non-secret channel is treated as compromised even when repository and build scans are clean. The repository owner must revoke it at the provider, replace the repository Actions Secret with a new key, and verify fail-closed behavior before autonomous work resumes.
- Observe mode never dispatches a repair and never blocks a merge.
- Verify only requires expected-publisher behavioral evidence, publishes a blocking-capable exact-head guard, and returns fixable findings to the customer's coding agent without provider, repair-webhook, controller-HMAC, or installation credentials. ChangePlane reports enforcement active only after a repository administrator enables strict classic branch protection and requires the guard from its observed live publisher. Ruleset readiness is not verified in this release.
- Autonomous mode intentionally sends bounded failure evidence and text context only from controller-granted paths to the repository owner's selected OpenAI project. The proposal and validation helpers execute only from a trusted-base checkout; the pull-request checkout is treated as data. Observe-only evaluation and the public replay send no repository content to a model provider.
- Autonomous repair cannot modify tests, evidence configuration, dependency manifests, or repository-declared `evidence.protectedPaths`. The trusted evaluator routes those paths to human review, the signed grant carries the effective protection set, and the proposal plus clean-apply validators reject evidence-control edits again.
- The setup PR vendors versioned managed workflows and helpers into the selected repository. Repository-owned edits to reserved managed bytes are never overwritten automatically.
- Repository repair secrets begin inert. Provisioning writes `CHANGEPLANE_REPAIR_ENABLED=false` first and activates only the marker for the exact managed workflow version after a fresh admin and branch-protection check. An older workflow cannot consume a newer activation marker. The controller derives a repository-bound HMAC and the proposal job receives no GitHub token, App key, controller master, Check authority, or push credential.
- A one-time exact-repository Contents-write installation token is minted only after the App-signed grant is claimed and revalidated immediately before a force-with-lease push. A fresh pull-request event must re-run evidence before PASS.
- `ChangePlane / review` is read-only, BYOK-gated, and bound to the exact diff. Findings must resolve to changed lines, are capped and deduplicated, and never approve, certify, repair, or contribute PASS.
- `.changeplane/assurance.md` is read only from the trusted default branch. Its repository-owned invariants and policy-pack guidance are untrusted context, not behavioral evidence.
- Agent handback Action outputs and receipt payloads carry findings and revision metadata only. They grant no GitHub credential, repair claim, controller authority, or certification.
- The Assurance Passport binds policy, evaluator, evidence, decision, and fixed authority roles to one base and head revision with a domain-separated SHA-256. Offline verification proves integrity only; authenticity requires a completed live exact-head `ChangePlane / guard` with the exact passport marker, compatible conclusion, and policy-pinned GitHub App ID and slug. The passport carries no signer, credential, repair claim, approval, Check authority, or merge authority, and claimed agent identity never contributes to PASS.
- A preview URL is published only when its deployment SHA matches the evaluated head. A stale or unverifiable preview is omitted.
- `merge_group` is evaluated as a separate exact revision. Merge Queue runs publish guard evidence only and never invoke a proposal model or repair controller.

The GitHub App user-token installer is limited to user-triggered setup and protected configuration pull requests. Autonomous execution requires the dedicated App controller and short-lived installation tokens. The broad OAuth fallback remains observe-only.

Every hosted route that can contact GitHub or OpenAI first verifies Vercel Production Git provenance for protected `LeChiffreVol2/changeplane` `main`. Preview, fork, CLI, and unattributed deployments fail closed before an authorization redirect, token exchange, repository lookup, provider call, or repository mutation.
