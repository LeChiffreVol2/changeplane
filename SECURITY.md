# Security policy

ChangePlane's current supported boundary is the limited GitHub observe pilot described in the README. Enforcement, managed model spend, and the repair template are not production-supported.

Report a suspected vulnerability privately to the repository owner or through the repository's private security-advisory channel. Do not include GitHub tokens, provider keys, private repository content, or other customer secrets in an issue.

## Security invariants

- GitHub and its branch protection remain the merge authority.
- The evaluator reads policy from the trusted base revision and binds decisions to an exact head SHA.
- A model can propose a patch but cannot issue `PASS`, approve, publish the required Check, or merge.
- Enterprise BYOK plaintext is processed only long enough to seal it with GitHub's repository public key. It is never persisted, echoed, or logged by ChangePlane.
- Observe mode never dispatches a repair and never blocks a merge.
- Enabling the inactive OpenAI repair canary intentionally sends bounded text context from controller-granted paths to the repository owner's selected OpenAI project. The proposal and validation helpers execute only from a trusted-base checkout; the pull-request checkout is treated as data. Observe-only evaluation and the public replay send no repository content to a model provider.
- Template workflows live outside `.github/workflows` so they cannot execute in this repository until deliberately installed.

The GitHub App user-token installer is limited to user-triggered setup. A separate trusted controller using short-lived installation tokens is still a launch gate for enforcement; the broad OAuth fallback is observe-only.
