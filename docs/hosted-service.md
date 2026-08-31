# Hosted service boundary

ChangePlane is delivered as a hosted GitHub App at [changeplane.vercel.app](https://changeplane.vercel.app/). This document separates the customer workflow, optional preview evidence, and ChangePlane's own deployment authority.

## Customer workflow

A customer does not need a Vercel account, ChangePlane CLI, database, worker service, or self-hosted deployment.

1. Install the repository-scoped ChangePlane GitHub App on a personal account or organization.
2. Choose one writable repository from an installation visible to the signed-in user.
3. Review the safety preflight and create one protected nine-file Verify Lite setup pull request. Scope-only Observe uses the same minimal profile without claiming behavioral proof. A fresh repository cannot install or select Autonomous directly.
4. Merge the setup after reviewing the managed files and chosen evidence Check. Verify Lite requires an exact behavioral Check and publisher, but its workflow and payload contain no model-backed review job, standalone proposal/controller helper, repair workflow, or controller credential path.
5. After Verify Lite is merged and its complete Ruleset authority is active, an eligible repository administrator may request the separate protected 21-file Full expansion pull request for Autonomous controlled beta. Add repository BYOK only after that reviewed expansion is installed; a write collaborator receives redacted secret status and cannot mutate it.

GitHub Actions, Checks, comments, artifacts, refs, and repository secrets remain the operational and audit surface. GitHub remains the merge authority.

The managed-v13 Verify Lite candidate participates in a blocking-capable exact-revision gate and never dispatches repair or model-backed review. The dedicated ChangePlane App alone owns the authoritative `ChangePlane / guard`. The managed GitHub Actions job named `ChangePlane guard` remains visible operational liveness only; it is not a merge-authority key and cannot substitute for the App guard. Cursor, Codex, Claude Code, or another customer-selected coding agent owns the fix and pushes a new commit for a fresh evaluation. Enabling Autonomous from an installed Verify Lite profile creates a separate protected expansion pull request for the Full payload; configuration alone does not silently add repair authority.

ChangePlane does not describe an installed gate as active enforcement until read-only GitHub inspection proves that one unambiguous active no-bypass default-branch Ruleset has strict required checks, a `merge_queue` rule, the App-owned guard bound to the dedicated ChangePlane App integration ID, and every configured behavioral evidence Check bound to its expected integration ID. Classic branch protection, controls split across Rulesets, GitHub Actions job success, Ruleset ambiguity, bypasses, missing or mismatched publisher identities, malformed data, and unsupported targeting fail closed. The installer never edits Rulesets.

The signed-out Cursor Origin boundary proof runs twelve synthetic contract scenarios through the same deterministic evaluator and bounded-patch validator used by the product. Three fixtures model the documented GitHub-mirrored Origin path and six assertions check authority retention, authoring-surface neutrality, stale-head rejection, protected-capability review, exact-head guard eligibility, and the fact that eligibility is neither publication nor merge. Its `guardEligible` field describes only the local evaluator result. It publishes no Check, contacts neither a customer repository, Origin, GitHub, nor a model provider, and is not presented as live rollout evidence or an external benchmark.

Every successfully completed App guard emits a redacted `proof_locator`. An authenticated read-only proof request uses that locator's Check Run ID, passport digest, and selected repository to re-fetch the dedicated-App guard, trusted-base policy, latest eligible passport-bound evidence Checks, and current pull request from GitHub. The result distinguishes current evidence from valid historical evidence, invalid evidence, and unavailable evidence. This proves the selected App-owned assurance envelope, not that the required no-bypass Ruleset is active or that every configured evidence Check is publisher-bound there. It grants no Check, repair, approval, or merge authority; see [Cursor Origin boundary and proof](cursor-origin-boundary.md).

The managed workflow cannot publish the App guard directly. It receives `actions: read`, `checks: read`, and `id-token: write`; Actions read resolves a candidate `github-actions` Check to its exact workflow run and policy path, while GitHub OIDC authenticates each lifecycle request to the fixed production endpoint. Before evaluation, a begin request binds the repository, trusted default-branch workflow path and SHA, event, ref, run ID, attempt, and current pull-request or merge-group target. The publisher creates one immutable exact-SHA evaluation lease by putting `ChangePlane / guard` in `in_progress`. A repeated begin from its owning run and attempt is idempotent; a competing run or attempt is rejected.

Completion must come from the same authenticated run ID and attempt that owns the immutable lease. The publisher re-fetches the managed tree, trusted policy, current target, and latest eligible exact-head evidence before updating the same Check to its terminal conclusion. For evidence from `github-actions`, enforce policy requires an exact workflow path; the Action resolves the Check to its GitHub Actions run and verifies both that path and the head SHA. Competing runs or attempts, stale targets, a missing begin, malformed markers, stale evidence IDs, newer eligible evidence, and publisher or workflow mismatch fail closed. Starting a rerun after completion invalidates the App guard to `action_required` and requires a new commit; it cannot replace or inherit the completed decision on the same SHA. The hosted service mints separate read-only and `checks:write` installation credentials scoped to one repository and keeps no lifecycle database.

GitHub's `ChangePlane guard` job remains visible operational liveness only. If begin or completion fails, the App Check remains non-successful regardless of that job's result. Readiness and onboarding return configuration-required until the single complete no-bypass Ruleset, dedicated-App guard binding, `merge_queue`, and every configured evidence binding can be proved together. A `merge_group` receives a fresh exact-revision App guard and inherits no pull-request lease or decision. This v13 lifecycle is implemented and locally tested only. It has not been deployed or exercised in a protected v13 canary, and historical v9 `github-actions` guard evidence does not prove it.

## Agentic SDLC projection

Repository readiness includes a top-level `sdlc` object derived from the already-verified managed profile, harness mode, named behavioral Checks, live GitHub enforcement inspection, and autonomous readiness gates. It is a read-only explanation layer with `contributesToPass: false`; it creates no Check, credential, storage, queue, webhook, or mutation path.

The signed-out RouteThai workspace also derives a per-revision lifecycle explainer from synthetic, receipt-shaped fixture facts. It is a contract reconstruction, not a stored production-run replay; it is not returned by the hosted API, written into the managed Action receipt, or presented as live repository evidence in this candidate. Intent and scope are declared context, review is advisory or remains in GitHub, Verify reflects deterministic exact-head fixture state, Delivery appears only for a matching full SHA, Merge remains a GitHub decision, and Operate is explicitly not observed. The pure projection helper fails closed unless its intent, diff observation, and passing evidence result are independently bound to the current full SHA; it compares review and deployment provenance separately, restarts every checkpoint for a new full SHA, and unit-covers a separate `merge_group` that inherits no pull-request review, repair, or approval state.

See [Agentic SDLC assurance](agentic-sdlc.md) for the complete authority matrix and non-goals.

## Customer Vercel previews

ChangePlane does not connect to, host, proxy, or control a customer's Vercel project. No Vercel token is requested or stored.

When a repository already uses Vercel's GitHub integration, Vercel may publish a GitHub Deployment for a pull-request revision. ChangePlane can include that existing preview URL in an exact-head receipt only when the GitHub Deployment SHA equals the revision being evaluated. A stale, missing, or unverifiable deployment is omitted and cannot influence PASS.

The Vercel project that hosts ChangePlane itself is unrelated to any customer Vercel project.

## ChangePlane production provenance

Every API route that can contact GitHub or OpenAI requires all of the following in the Vercel runtime:

- environment: `production`;
- Git provider: `github`;
- repository owner: `LeChiffreVol2`;
- repository: `changeplane`;
- branch: protected `main`; and
- a full 40-character Git commit SHA supplied by Vercel Git integration.

Fork deployments, preview deployments, CLI uploads, and deployments without this source provenance fail closed before an OAuth redirect, credential exchange, repository lookup, provider request, or repository mutation. The public example and readiness endpoint remain readable without granting connector authority.

Production configuration is documented in [`.env.example`](../.env.example). Secret values belong in the hosted environment or the selected repository's GitHub Actions Secrets; they never belong in source control or Preview deployments.

## Self-hosting boundary

The repository is publicly visible for transparency and evaluation, but it is proprietary and `UNLICENSED`. Self-hosting, commercial operation, copying, modification, and redistribution are not granted. A fork also lacks the production source identity required for GitHub writes, even if it supplies environment variables with similar names.

Authorized ChangePlane operators release through a protected pull request, required CI, Vercel Git deployment, exact-source readiness verification, signed-out smoke test, and documented rollback path. See the [production runbook](production-runbook.md) and [release checklist](release-checklist.md).
