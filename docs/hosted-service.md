# Hosted service boundary

ChangePlane is delivered as a hosted GitHub App at [changeplane.vercel.app](https://changeplane.vercel.app/). This document separates the customer workflow, optional preview evidence, and ChangePlane's own deployment authority.

## Customer workflow

A customer does not need a Vercel account, ChangePlane CLI, database, worker service, or self-hosted deployment.

1. Install the repository-scoped ChangePlane GitHub App on a personal account or organization.
2. Choose one writable repository from an installation visible to the signed-in user.
3. Review the safety preflight, choose Observe, Verify only, or Autonomous, and create one protected setup pull request. Repository-admin access is required for BYOK and autonomous setup; a write collaborator receives redacted secret status and cannot mutate it.
4. Merge the setup after reviewing the managed files and chosen evidence Check. Verify only requires an exact behavioral Check and publisher, but it requires no model key or repair-controller secret.
5. Add repository BYOK only when model-backed review or autonomous repair is wanted.

GitHub Actions, Checks, comments, artifacts, refs, and repository secrets remain the operational and audit surface. GitHub remains the merge authority.

Verify only publishes a blocking-capable `ChangePlane / guard` from exact deterministic evidence and never dispatches repair or model-backed review. Cursor, Codex, Claude Code, or another customer-selected coding agent owns the fix and pushes a new commit for a fresh evaluation. ChangePlane does not describe this as active enforcement until the repository owner separately makes that exact Check required in GitHub branch policy.

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
