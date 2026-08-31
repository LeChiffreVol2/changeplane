# Data handling

This document describes the implemented technical boundary. It is not a claim of regulatory certification or a substitute for customer-specific legal terms.

## Signed-out public example

The RouteThai example uses synthetic data and makes no request to GitHub, OpenAI, RouteThai repositories, or RouteThai production systems. It contains no customer identity, coordinate, map URL, operating dataset, provider key, or private-repository screenshot.

## GitHub connection

- GitHub owns account and organization selection during App installation.
- ChangePlane lists only repositories visible through installations available to the signed-in GitHub user and retains the installation-to-repository binding in the sealed session.
- Session state is encrypted and authenticated in a secure, same-site, HTTP-only cookie with a bounded lifetime. ChangePlane has no product database.
- Setup and configuration changes are proposed through protected pull requests. The installer does not write directly to the default branch.
- GitHub stores the installed workflows, policy, receipts, Checks, comments, artifacts, refs, and repository secrets.
- The machine-readable Assurance Passport contains only repository/revision identifiers, policy and input digests, evaluator metadata, bounded Check names and GitHub App publishers, status/conclusion values, a decision, and fixed authority declarations. Legacy commit-status creators are normalized to `LEGACY_COMMIT_STATUS`; actor usernames beyond an owner login inherent in the repository identifier are excluded, together with diagnostics, source text, prompts, patches, preview URLs, provider responses, and credentials. Its digest is an integrity check, not an offline authenticity claim. Live proof verifies the guard marker, head, conclusion, and configured dedicated ChangePlane App identity, then separately re-fetches every policy-bound evidence publisher.
- The managed workflow sends a bounded passport and receipt summary to the fixed guard-publisher endpoint with a short-lived GitHub OIDC token. The token and GitHub App credentials are never returned to the browser, stored in a repository secret, embedded in the passport, or written to a ChangePlane database. Read and write installation tokens are minted separately for exactly one repository and kept only for the request lifetime.
- A `proof_locator` contains only the numeric repository and Check Run identifiers, target type, pull-request number when applicable, exact head SHA, and passport digest. The authenticated proof endpoint re-fetches GitHub metadata and the trusted policy, but its response omits repository names, source text, diagnostics, comments, patches, prompts, provider responses, and credentials. Proof results are computed per request and are not stored in a ChangePlane database.
- Repository-admin access is required before ChangePlane reads secret metadata or creates, rotates, or deletes BYOK and autonomous-controller secrets. Write collaborators receive a redacted `admin_required` state and no secret-backed readiness signal.

## Repository BYOK

The browser sends an OpenAI key once to the authenticated same-origin API. ChangePlane checks repository-admin authority, verifies access to the selected allowlisted model, rechecks that same repository and admin authority, encrypts the key with GitHub's repository public key, stores only `OPENAI_API_KEY` as a GitHub Actions Secret, and clears the browser field after the request.

Plaintext provider keys are not stored in localStorage, cookies, logs, API responses, screenshots, artifacts, source control, or a ChangePlane database. Deleting BYOK removes the GitHub Actions Secret; runtime policy remains and model-backed work fails closed.

## Model requests

Observe mode, Verify Lite, the Cursor Origin boundary proof, and the public example send no repository content to OpenAI. Verify Lite also receives no repair webhook, controller HMAC, or controller installation credential. Origin proof inputs are fixed synthetic contract cases and never contain a connected repository's content or identity.

When repository BYOK enables advisory review or autonomous repair, the trusted workflow sends bounded inputs to the repository owner's OpenAI project:

- the allowlisted model from trusted default-branch policy;
- exact failure evidence or the exact changed-line review context;
- source text only from allowed paths; and
- `store: false` in the Responses API request.

The proposal job receives no GitHub token or controller credential. ChangePlane records only allowlisted model metadata, bounded provider request IDs, workflow state, exact revisions, and redacted operational results. It does not log prompts, source context, patches, provider response bodies, cookies, OAuth tokens, repository names, or secret values.

OpenAI and GitHub process data under the repository owner's accounts and their respective terms. ChangePlane does not claim zero retention because provider and forge retention are controlled by those services and account settings.

## Removal and recovery

A repository owner can stop model-backed work by deleting `OPENAI_API_KEY`, disable autonomous repair through the managed repository switch and ChangePlane controller kill switch, revoke or uninstall the GitHub App, and remove the managed setup through a reviewed pull request. A leaked provider key must be revoked at the provider and replaced; deleting a local file alone is not sufficient.

Security concerns should follow [SECURITY.md](../SECURITY.md).
