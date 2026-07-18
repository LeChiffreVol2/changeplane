# Production release checklist

## Release ownership and platform boundary

- [ ] Name the release owner, rollback owner, GitHub connector owner, and customer repository owner.
- [ ] Record the release commit SHA, CI run URL, Vercel deployment ID, connector mode, and immediately previous known-good deployment.
- [ ] Confirm the hosting plan permits this rollout. Vercel Hobby is non-commercial only and cannot connect to a GitHub organization-owned repository; use a personal disposable repository for the free canary. A paid design-partner, organization-owned repository, or commercial deployment requires Pro or another approved host.
- [ ] Confirm the GitHub plan supports branch protection for the selected repository. Private repositories require GitHub Pro, Team, Enterprise Cloud, or Enterprise Server.
- [ ] Keep the pilot to the GitHub connector, one GitHub Action, the pure evaluator, GitHub Checks/comments, and optional inactive repair templates. No database, queue, merge service, or paid observability is required.
- [ ] Confirm GitHub Merge Queue is not enabled for a repository that requires `ChangePlane / guard`.

## Source and CI gate

- [ ] Protect `main`, disallow direct pushes/bypasses, and require the pinned `CI / verify` job before merge.
- [ ] Confirm `CI / verify` is the exact required check name and the workflow has `contents: read`, immutable action SHAs, one canceling concurrency lane, a job timeout, and no deployment secret.
- [ ] Confirm the activation-boundary step finds only `.github/workflows/ci.yml`; observe and repair templates must remain under `examples/`.
- [ ] From a clean checkout, confirm `npm ci --cache .npm-cache`, `npm run verify`, and `npm run audit:prod` pass with Node `22.18.0`.
- [ ] Confirm CI serves `dist` only on runner-local `127.0.0.1` and smoke-checks the built root without calling Preview or Production.
- [ ] Review every dependency or pinned Action SHA change; do not waive a high/critical production audit finding without a written owner and expiry.
- [ ] Confirm Vercel's Git integration is the only deployment path, `main` is the Production branch, and the install/build/output settings match `vercel.json`.

## Configuration and secrets

- [ ] Inventory `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `CHANGEPLANE_SESSION_SECRET`, `CHANGEPLANE_APP_ORIGIN`, controlled-rollout `CHANGEPLANE_CANARY_REPOSITORY`, optional `CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY`, and `CHANGEPLANE_LOG_REQUESTS`; record owners and last-rotation dates outside the repository.
- [ ] During a controlled canary, set `CHANGEPLANE_CANARY_REPOSITORY` to the exact disposable target and verify a different repository is hidden and rejected before any GitHub request.
- [ ] Use a 32+ character independent session secret per Vercel environment and an exact HTTPS `CHANGEPLANE_APP_ORIGIN` with no path, query, or trailing slash.
- [ ] Keep production connector credentials and all provider keys out of fork/untrusted Preview deployments. A trusted Preview uses isolated non-production connector credentials.
- [ ] Keep `CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY` server-side and absent unless the private canary is explicitly approved.
- [ ] Confirm plaintext provider keys never appear in localStorage, logs, responses, Vercel build output, screenshots, or release records.
- [ ] Publish and verify the Vercel WAF fixed-window rate limit for `/api/github` before public onboarding; record its threshold and owner, confirm excess traffic receives `429`, and keep total allowed requests inside the included allowance.
  - Evidence captured 2026-07-19: active fixed-window rule, 60 requests per 60 seconds per IP; a controlled 65-request burst returned 60 `200` responses and 5 `429` responses. Release-owner naming remains open.
- [ ] Confirm structured logs contain only the approved redacted metadata and request ID.

## Pre-release Preview verification

- [ ] Confirm the Vercel Preview deployment source equals the pull request's exact head SHA and its build succeeds.
- [ ] Confirm the required GitHub Check passed on that same SHA.
- [ ] On a trusted Preview, confirm `/api/github?action=readiness` returns `200`, `ready: true`, the expected connector mode, no secret values, and a release matching the Preview source SHA.
- [ ] Smoke the trusted Preview root and confirm security headers and API `Cache-Control: no-store` are present.
- [ ] Install into one disposable repository whose GitHub plan supports the required branch protection (public on GitHub Free, or private on an eligible paid plan) and confirm the read-only preflight reports no direct default-branch write, merge/deploy blocking, repair dispatch, pull-request-head execution, provider-secret access, or reserved-path overwrite.
  - Observe install evidence passed in private disposable repository `LeChiffreVol2/changeplane-disposable-canary-20260719`: setup [PR #1](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/1) changed six reserved files only and merged at `82c0f3f91f8c6f516c55e11c4e69491803430db7`. Branch-protection eligibility remains an open hosting-plan gate.
- [x] Confirm the atomic setup pull request exposes observe-only Action metadata, least-privilege permissions, no repair inputs, and no active repair workflow.
  - PR #1 installed a trusted-base workflow with read-only contents/deployments/statuses access plus Check/comment publication only. The installed Action exposes no enforce or repair-dispatch input.
- [x] Configure at least one meaningful deterministic check in `.changeplane.json`; the self-serve starter intentionally leaves `requiredChecks` empty and must not be presented as behavioral assurance until this is done.
  - [PR #3](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/3) bound required check `test` to source `github-actions` with a 120-second wait. The live canary exposed and fixed missing `statuses: read` through [PR #4](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/4).
- [x] Verify one exact-head receipt and neutral `ChangePlane / guard` Check Run in observe mode.
  - [PR #2](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/2) has one idempotently updated receipt on final head `bab424f625052aad5d0038de5bccb04e71b06053`; `test` and `ChangePlane observe` succeeded, `ChangePlane / guard` concluded neutral, and the receipt bound the successful `github-actions` evidence to that exact head.
- [ ] If Enterprise BYOK will be offered in this rollout, verify create, rotate, disconnect, provider-key revocation, and fail-closed DeepSeek model discovery without retaining plaintext. Otherwise keep provider funding out of the onboarding path and leave the managed key unset.

## Release and rollback

- [ ] Merge only after every required check above passes; do not deploy an unreviewed local build.
- [ ] Confirm the resulting Production deployment source is the protected `main` SHA and record its deployment ID.
- [ ] Make one read-only Production readiness request and repeat one disposable-repository observe evaluation; stop if either differs from Preview.
- [ ] Confirm the immediately previous Production deployment remains available for Instant Rollback.
- [ ] Exercise or review access to Vercel rollback, GitHub authorization revocation, session-secret rotation, and provider-key revocation.
- [ ] Confirm the release owner is watching native Vercel logs/usage and GitHub Actions usage during onboarding; no external monitor or paid pager is claimed.
- [ ] At 80% of a free included allowance, stop new onboarding and nonessential reruns. Keep Hobby deployment activity below the hard 32-builds-per-hour limit. At exhaustion, fail closed until reset or an approved plan change.

## Required before enforcement or agent repair

- [ ] Replace broad OAuth repository access with a least-privilege GitHub App and short-lived installation tokens.
- [x] Reject same-name evidence unless it originates from the policy's expected GitHub App slug.
- [ ] Verify expected-App evidence against live GitHub Check Runs in a disposable repository.
- [ ] Evaluate `merge_group` as its own exact revision and publish the required Check for GitHub Merge Queue.
- [ ] Add an App-signed, monotonic attempt/approval ledger outside repository-controlled workflows.
- [ ] Pin every Action in `examples/changeplane-repair.yml` to a reviewed full commit SHA before copying it into `.github/workflows`.
- [ ] Pass stale-head, expiry, path-boundary, replay, idempotency, fork, and sandbox escape tests in a disposable repository.
- [ ] Run the checkout-race canary end to end: expected-App evidence fails, the model proposes only an in-scope patch, the clean apply job creates a new head, the same evidence succeeds, and only then does `ChangePlane / guard` pass with zero human actions.
- [ ] Configure a kill switch for dispatch and enforce mode.
- [ ] Exercise provider outage, GitHub outage, exhausted attempts, and rollback incidents.

## Required before ChangePlane Managed

- [ ] Prove no repository workflow or browser can retrieve `CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY`.
- [ ] Provide tenant-isolated credentials and data paths.
- [ ] Provide usage metering, hard budgets, abuse controls, and cost alerts.
- [ ] Provide subscription lifecycle, invoices, refunds, and support ownership.
- [ ] Publish and implement data retention/deletion policy and customer-facing terms.
- [ ] Define measured provider failover and regional/privacy commitments.
