# ChangePlane

Connect GitHub, choose a writable repository, and create one atomic setup pull request for an observe-mode pilot. After that PR is merged, ChangePlane evaluates every eligible pull request from trusted base code and publishes `ChangePlane / guard` directly on the pull request's exact head SHA. The self-serve pilot is best suited to GitHub projects that already run at least one meaningful automated test on pull requests.

ChangePlane is a GitHub-native exact-head assurance layer for AI-written code. It does not replace the forge, coding-agent runtime, or human merge authority, and it never lets a model approve its own work. The protocol is designed to remain runtime-independent; this pilot supports GitHub.com only.

The source repository is public for product evaluation and pilot transparency. It is source-visible, not open source: no license to copy, modify, distribute, or operate the software is granted. All rights are reserved.

**Current production boundary:** observe only. The installed Action rejects `mode: enforce`. It may report that a finding is repairable, but it cannot dispatch or apply a repair.

## What works now

- A GitHub App-first install and authorization flow that verifies the returned installation against the signed-in user, then lists writable repositories only from that installation. A broad OAuth App connector remains available only as an observe-pilot fallback.
- Enterprise BYOK provisioning that first verifies `deepseek-v4-flash`, then encrypts the customer key with GitHub's repository public key and stores it only as the `DEEPSEEK_API_KEY` Actions Secret. ChangePlane never persists or returns the plaintext key.
- Optional server-side DeepSeek credential verification for a private canary. Production currently leaves Managed reserved; autonomous execution, spend, metering, limits, and billing are intentionally not enabled in the observe pilot.
- A readiness endpoint, structured redacted request telemetry, browser security policy, transient-read retry boundary, and immutable-SHA CI workflow for the production shell.
- A setup PR that vendors the Action, trusted-base workflow, and starter policy in one commit. It never writes directly to the default branch or overwrites reserved ChangePlane paths.
- A read-only repository preflight that must pass before the setup button is enabled. It verifies the target is active, checks every reserved path for conflicts, and exposes the exact no-impact observe boundary.
- A deterministic scope and protected-path evaluator bound to base SHA, head SHA, policy, contract, inputs, and evaluator version. Required evidence can be bound to an expected GitHub App slug, so a same-name check from another source cannot satisfy policy.
- Zero-touch contracts for ordinary pull requests: the first observed head's exact paths and title are bound into the trusted receipt automatically. Teams can still declare a broader prefix contract explicitly; changes above 50 paths route to a split-or-declare exception.
- One GitHub-native execution lane per pull request. A new head or review event cancels stale evaluation before it can consume more CI, while deployment events remain exact-SHA bound and stale deployments are skipped.
- Rate-limit-aware GitHub reads that honor `Retry-After` and short reset windows, retry bounded transient failures, and fail closed instead of holding a serverless function through a distant reset.
- One idempotent Change Receipt on the pull request plus an explicit Check Run on the exact head revision.
- A best-effort concurrent-change advisory that uses one bounded GitHub GraphQL query to surface up to five open pull requests touching the same files. It never auto-merges changes or alters the decision.
- The latest successful GitHub Deployment preview for that exact head, refreshed automatically by `deployment_status`. Missing preview metadata is advisory and never changes the decision.
- Observe mode that reports the real decision and evidence without blocking merge or dispatching a repair.
- A bounded repair contract, PS256-signed two-attempt ledger primitive intended for the dedicated GitHub App publisher, and inactive controlled-canary template for lab validation only. No production repair adapter or dispatch path is enabled.

The ship verdict is deliberately narrow: **ready for the bound one-repository observe canary after the GitHub connector, server environment, external rate limit, and release-checklist gates are verified; not ready for production enforcement.** The current Vercel deployment stays on the free phase constraint; hosting-plan work is intentionally outside this release.

## Self-serve GitHub setup

Create a private, repository-scoped GitHub App for the owner-controlled canary. The current deployment keeps external installation disabled and accepts only the exact disposable repository. Use these URLs:

```text
Callback URL: https://YOUR_DOMAIN/api/github?action=callback
Setup URL:    https://YOUR_DOMAIN/api/github?action=installation
```

Keep “Request user authorization during installation” off: ChangePlane starts the installation, validates the state at the Setup URL, then performs PKCE user authorization and verifies that the installation belongs to that user. For observe-only onboarding, grant Contents (read/write), Pull requests (read/write), Workflows (read/write), and Checks (read). Checks read lets setup discover a meaningful existing test without asking users to copy its publisher slug. Add Secrets (read/write) only if the optional Enterprise BYOK flow is enabled. The installed repository workflow receives its own least-privilege `GITHUB_TOKEN`; the connector does not need Deployments permission. Do not subscribe the App to webhook events until the trusted App controller exists.

Configure these server-side environment variables:

```text
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_APP_SLUG=changeplane
CHANGEPLANE_SESSION_SECRET=at-least-32-random-characters
CHANGEPLANE_APP_ORIGIN=https://YOUR_DOMAIN
CHANGEPLANE_CANARY_REPOSITORY=your-user/changeplane-disposable-canary
CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY=optional-private-pilot-key
```

`CHANGEPLANE_APP_ORIGIN` must be the exact public origin with no path. The GitHub App user token stays inside an encrypted, `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` session cookie, expires with the shorter provider/session lifetime, and is never returned to the browser. If `GITHUB_APP_SLUG` is omitted, ChangePlane falls back to the broad `repo workflow` OAuth pilot; use that fallback only with a consenting design partner and never for enforcement.

**Controlled-canary guard:** Set `CHANGEPLANE_CANARY_REPOSITORY` to one exact GitHub repository in `owner/repository` form—not a URL, branch, or organization name. Use a personal test repository containing no customer or production work and safe to delete after validation. While set, ChangePlane disables every new-install stage, lists only this repository for an already-authorized owner, and rejects every other repository before making a GitHub request. The public root shows only the fictional workspace; the owner uses the unlisted `?access=canary-owner` entry. Keep both the guard and the GitHub App's private setting for this entire phase.

`GET /api/github?action=readiness` returns `200` only when the required production configuration is present and `503` otherwise. It exposes configuration booleans and a release identifier, never values.

No ChangePlane CLI or TUI is required. The platform lead uses the web installer once; developers keep their current IDE, coding-agent CLI, and GitHub workflow. The operator flow is:

1. Install ChangePlane on the GitHub account or organization and choose the repositories it may access.
2. Select a writable repository.
3. Let the automatic read-only preflight confirm that the setup will use one PR, never overwrite reserved paths, never run pull-request code, never access provider secrets, and cannot block merge or deploy.
4. Create the observe setup PR.
5. Review and merge that PR in GitHub. Closing it stops installation; GitHub may retain the unmerged setup branch until you delete it.
6. Do not connect BYOK for the observe canary; it has no effect on observe receipts. Use it only in a separately approved repair canary after every repair gate passes.
7. Keep ChangePlane in observe mode until every enforcement release gate below has direct evidence.

Enterprise BYOK is optional for observe-only receipts and required only when a DeepSeek repair adapter is enabled. `ChangePlane Managed` can verify a server-side provider key for private pilots, but remains non-interactive until isolated execution, metering, budgets, and billing exist server-side.

The PR installs:

- `changeplane/` — the vendored Action and pure evaluator.
- `.changeplane.json` — repository policy.
- `.github/workflows/changeplane.yml` — trusted-base observe workflow.

## Automatic pull-request contract and evidence

Ordinary pull requests need no ChangePlane syntax. On the first eligible event, ChangePlane binds the PR title and up to 50 exact changed paths into a trusted receipt comment. Later commits can modify those files, but a new path becomes scope drift. This makes Codex, Claude Code, Cursor, and other agent-authored PRs work without a handoff or template change.

For intentionally broad work, the coding agent can declare a prefix contract in the pull-request body:

```md
<!-- changeplane
{
  "goal": "Make payment retries idempotent",
  "scope": ["src/payments/**", "tests/payments/**"]
}
-->
```

The policy can require existing GitHub checks on the same head revision:

```json
{
  "version": 1,
  "protectedPaths": {
    "requireApproval": [".github/workflows/**", "infra/**", "migrations/**"],
    "block": ["secrets/**"]
  },
  "evidence": {
    "requiredChecks": [
      { "name": "test", "appSlug": "github-actions" },
      { "name": "lint", "appSlug": "github-actions" }
    ],
    "timeoutSeconds": 120
  }
}
```

The self-serve starter policy leaves `requiredChecks` empty because ChangePlane cannot safely guess which repository check proves behavior. Its first receipts therefore prove revision identity, declared scope, and protected-path policy only. A repository owner must add at least one meaningful deterministic check before treating the pilot as behavioral assurance or proposing enforcement.

The setup pull request contains the activation recipe: open an existing pull request's **Checks** tab, copy the exact meaningful check name and publisher, and add them to `.changeplane.json`. GitHub Actions uses the publisher slug `github-actions`. Repositories without automated tests may remain scope-only, but ChangePlane will not claim that their code works.

Use exact check names and GitHub App slugs. A policy may list at most 20 checks, may not list `ChangePlane / guard`, and may wait from 0 to 240 seconds. Strings remain accepted in observe mode for migration, but enforce requires every item to use `{ "name", "appSlug" }`. Missing, pending, failed, or wrong-source evidence becomes part of the receipt; observe mode still concludes neutrally.

ChangePlane also reads GitHub Deployment statuses for the pull request's exact head SHA and adds a sanitized successful HTTPS `environment_url` to the receipt. A `deployment_status` event re-runs the same evaluation without polling by resolving that commit to exactly one current, open, same-repository pull request; no or ambiguous matches are skipped. Query strings and fragments are removed, and localhost names plus every IP-literal host are rejected. Deployment/status IDs, status creator, task, and any status-level environment override are recorded as informational provenance, not a trust signal. ChangePlane does not host, open, or execute the preview; absent or unreadable deployment metadata remains advisory.

The workflow checks out only the trusted base SHA for pull-request events, or the repository default branch for a deployment event, and reads the pull-request diff through GitHub's API. It does not execute untrusted pull-request code with a write token. GitHub remains the audit and merge surface.

## Agent-scale operating model

ChangePlane does not compete with Origin on raw Git object throughput. It keeps agent churn away from the control plane until a pull-request revision exists, then applies structural admission control before expensive evidence or model work:

1. GitHub events trigger evaluation; ChangePlane does not poll repositories.
2. Workflow concurrency is keyed by pull-request number, so a newer revision cancels stale work in the same lane.
3. Exact-head, path count, protected-path, evidence, and attempt-budget checks run before any repair dispatch.
4. GitHub's repository-local `GITHUB_TOKEN` supplies the observe pilot's API budget; no shared central token becomes a cross-customer bottleneck.
5. Comments and Checks hold the pilot audit state. Add a durable queue only after measured webhook backlog or repair-delivery requirements exceed GitHub Actions.

Agent workspaces, micro-branches, and language-aware merge engines remain the coding-agent provider's concern. ChangePlane does not clone customer code into a proprietary staging layer or rewrite agent history. Teams that want a clean default-branch history should use GitHub's native squash merge or merge queue.

The self-serve connector now uses a GitHub App user token restricted by both the user's permissions and the selected installation. The enforcement controller still requires short-lived installation tokens and signed webhook processing. GitHub App quotas scale independently by installation, while the OAuth fallback shares the authorizing user's budget. Merge-queue enforcement is a separate correctness gate: `merge_group` revisions combine multiple pull requests and must be evaluated as their own exact revision before `ChangePlane / guard` can become required. The observe pilot intentionally does not claim that support yet.

## Observe promotion gate

Time never promotes a repository. Verify all of the following from real receipts before proposing enforcement:

- Every eligible pull request received a receipt and Check Run bound to its latest head SHA.
- Repository owners sampled every protected, blocked, and indeterminate result.
- No confirmed false positive would have blocked a safe merge.
- Automatic-contract exceptions and protected-path rules are acceptable to CODEOWNERS.
- Any repair adapter passed expiry, stale-head, path-boundary, replay/idempotency, and live sandbox tests.

**Enforce mode is not production-ready yet.** Keep `mode: observe`, `agent_dispatch: none`, and do not make the check blocking until ChangePlane has all of the following:

- A dedicated GitHub App with least-privilege installation tokens.
- Live expected-App evidence and trusted ChangePlane Check publication from the dedicated GitHub App.
- A dedicated GitHub App publisher that persists the implemented signed ledger outside repository-controlled workflows.
- Live sandbox and end-to-end stale-revision validation for the selected repair worker.

## Future repair canary — inactive until all enforcement gates pass

`examples/changeplane-repair.yml` is a controlled-lab template, not an active workflow and not part of the self-serve observe install. It accepts only a PS256-signed exact-revision grant intended for the dedicated GitHub App publisher, with a pinned public-key ID, exact controller SHA, default base ref, policy digest/evaluator version, protected-path denylist, fixed kill-switch generation, campaign-bound two-attempt/15-minute invariant, and one-time artifact claim reserved before provider access. Scope repair is generated deterministically from the trusted merge base. Evidence repair runs the proposal helper from a separate trusted-base checkout, treats the pull-request checkout only as untrusted data, sends bounded text context inside the controller-issued grant to `deepseek-v4-flash`, accepts only an existing-file unified patch inside that grant, and gives the proposal job no forge write permission. A separate write job re-verifies the signed grant, campaign deadline, generation, and live head; runs the validator again from the trusted-base checkout; applies the patch; rechecks the grant immediately before push; then dispatches a fresh evaluation. DeepSeek and pull-request code cannot issue a ChangePlane `PASS`.

The model is an interchangeable proposal worker, not the authority. The durable agentic backbone is the boundary around it: a PS256-signed append-only grant primitive intended for the App publisher, campaign-bound deadline, exact controller/base/head and policy binding, protected-path denial, provider-only egress with no forge write in the proposal job, deterministic clean-job validation, a separate stale-head-checked apply job, and an explicit `changeplane_recheck` dispatch after the push. The ledger and verifier are implemented but inactive; live replay resistance is not claimed until the dedicated GitHub App publisher and disposable-repository repair canary pass.

The product preview visualizes the Ready → Repairing → Re-verifying → PASS state machine locally. It never invokes the model in the browser; real model execution starts only from the lab adapter after enforce prerequisites are satisfied.

Only after the enforcement gates above are met:

1. Pin every third-party Action reference in the template to a reviewed commit SHA.
2. Vendor the reviewed ledger, grant verifier, proposal helper, and repair workflow together through one setup pull request; copying the workflow alone is intentionally unsupported.
3. Connect Enterprise BYOK. The canary verifies DeepSeek V4 Flash and creates or rotates `DEEPSEEK_API_KEY` without retaining the plaintext key.
4. Validate it in the disposable repository.
5. Only after the GitHub App gates are complete, grant the trusted controller the bounded dispatch/apply permissions and activate enforce in a separate reviewed release.

The HTTPS adapter code is retained for future customer-harness validation, but this pilot does not expose or dispatch it.

[Grok Build](https://github.com/xai-org/grok-build) should use the same bounded repair contract later. It is intentionally not in the production pilot while the open-source release is early beta and its sandbox is off by default; add it only after a strict-sandbox canary passes the same path, expiry, and stale-head tests.

## Verify locally

```sh
npm ci --cache .npm-cache
npm run verify
npm run audit:prod
```

Without GitHub connector configuration, local development provides the clickable VC walkthrough using browser-local fixture state. It is separate from the real GitHub installer and Action.

## Current limits

- GitHub.com and same-repository pull requests only.
- Maximum 3,000 changed files.
- Exact paths and directory-prefix rules ending in `/**`.
- File-level deterministic policy; no semantic proof or learned world model.
- No ChangePlane database, queue, agent runtime, or merge service.
- Concurrent-change discovery inspects only the 20 most recently updated open pull requests and the first 100 files in each. It is a high-signal advisory, not a completeness or conflict guarantee.
- No merge-queue `merge_group` receipt yet; keep the Check non-required for repositories that use GitHub Merge Queue.
- No public ChangePlane Managed model spend, subscription checkout, metering, or consolidated billing yet; only the authenticated server-side provider canary exists.
- The current free Vercel phase is fail-closed at its included limits and remains bound to the exact disposable canary repository.

Operational activation and incident steps live in [docs/production-runbook.md](docs/production-runbook.md); release gates are tracked in [docs/release-checklist.md](docs/release-checklist.md).
