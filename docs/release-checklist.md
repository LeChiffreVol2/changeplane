# Production release checklist

## Autonomous harness release record — 2026-07-21

- [ ] Record the protected release commit, CI run, Preview deployment, Production deployment, readiness request ID, and rollback target.
- [x] Self-serve GitHub App onboarding supports eligible personal and organization installations and limits repository selection to the verified installation.
- [x] Autonomous setup requires one exact behavioral check plus verified repository BYOK and creates one protected setup PR; scope-only remains observe mode.
- [x] The managed payload vendors the trusted harness, repair helpers, and workflows without a queue, database, proprietary workspace, or model-held GitHub credential.
- [x] Luna Responses transport uses a strict one-field patch schema; unified-diff, allowed-path, clean-apply, stale-head, two-attempt/15-minute, and deterministic re-validation gates remain independent.
- [x] Live synthetic Luna adapter evidence passed with redacted request ID and patch hash in `evidence/routethai-luna-adapter-canary.json`.
- [ ] Capture the disposable repository's App-signed grant, clean apply, synchronize event, new exact head, and `ChangePlane / guard` result from this release commit.

## Controlled-canary release record — 2026-07-19

- Production source: `d758005d3790b679f842a87d9745c34985051319` from [PR #19](https://github.com/LeChiffreVol2/changeplane/pull/19); required [CI / verify](https://github.com/LeChiffreVol2/changeplane/actions/runs/29681989165/job/88179651533), Vercel, and Vercel Preview Comments checks all passed before merge.
- Vercel Production: `dpl_2kBAs55hwUWRZCgeBAWSSTEB3acX`, aliased to `https://changeplane.vercel.app`; immediately previous known-good deployment `dpl_8daL5a7zcruWwuKB6xAMAhvJGCdD` remains available.
- Readiness: request ID `6f948fb1913b7e6637398404`, HTTP `200`, `status: ready`, `authMode: github_app`, `rolloutMode: controlled_canary`, release `d758005d3790`. Every readiness check is true; Managed remains reserved and repair reports `enabled: false` and `configured: false`.
- The fixed-endpoint OpenAI Responses boundary remains inactive behind the common patch harness. GitHub-hosted runner egress is not treated as sandbox-enforced; a strict network canary is required before repair activation.
- The public production root exposes an observe-only fictional exact-revision receipt and makes clear that it cannot access GitHub, change code, block merging, or repair. The terminal receipt keeps head `71b04c2` unchanged and names GitHub as merge authority.
- Positive owner-flow evidence passed in the private disposable repository `LeChiffreVol2/changeplane-pristine-canary-20260719`: read-only preflight reported fresh/installable, setup [PR #1](https://github.com/LeChiffreVol2/changeplane-pristine-canary-20260719/pull/1) changed only the seven expected policy/managed observe files, and exact head `89aac3c8da1d7c3f29013b084542c01dd7e780a5` merged as `d0f784d377624f68f9734b1f4ac377293ee0f859`.
- Normal [PR #2](https://github.com/LeChiffreVol2/changeplane-pristine-canary-20260719/pull/2) then published one `ChangePlane / guard` Check Run from `github-actions` with conclusion `neutral` and one idempotent receipt, both bound to exact head `602a367343688f9f4c36c0661aea85b398a674ca`. The receipt declared one actual file, no findings, scope-only evidence, no repair, and no merge blocking.
- For this owner-controlled canary, `@LeChiffreVol2` is the release, rollback, GitHub connector, and disposable-repository owner. Replace these assignments with named team roles before a design-partner rollout.

## Release ownership and platform boundary

- [x] Name the release owner, rollback owner, GitHub connector owner, and customer repository owner.
- [x] Record the release commit SHA, CI run URL, Vercel deployment ID, connector mode, and immediately previous known-good deployment.
- [x] Keep this release on the fixed free Vercel phase and bind every repository route to the one disposable `CHANGEPLANE_CANARY_REPOSITORY`; hosting-plan work and broader onboarding are out of scope.
- [x] Confirm the ChangePlane source repository protects `main` and requires `CI / verify`. Record that the private GitHub Free disposable canary cannot enable branch protection and is owner-controlled lab evidence only; do not change its visibility or claim production enforcement.
- [x] Keep the pilot to the GitHub connector, one GitHub Action, the pure evaluator, GitHub Checks/comments, and optional inactive repair templates. No database, queue, merge service, or paid observability is required.
- [ ] Confirm GitHub Merge Queue is not enabled for a repository that requires `ChangePlane / guard`.

## Source and CI gate

- [ ] Protect `main`, disallow direct pushes/bypasses, and require the pinned `CI / verify` job before merge.
- [x] Confirm `CI / verify` is the exact required check name and the workflow has `contents: read`, immutable action SHAs, one canceling concurrency lane, a job timeout, and no deployment secret.
- [x] Confirm the activation-boundary step finds only `.github/workflows/ci.yml`; observe and repair templates must remain under `examples/`.
- [x] From a clean checkout, confirm `npm ci --cache .npm-cache`, `npm run verify`, and `npm run audit:prod` pass with Node `22.18.0`.
- [x] Confirm CI serves `dist` only on runner-local `127.0.0.1` and smoke-checks the built root without calling Preview or Production.
- [x] Confirm the Chromium onboarding suite passes for controlled-canary isolation plus fresh, upgrade, pending, current, and owner-review repository states without making non-local requests.
- [ ] Review every dependency or pinned Action SHA change; do not waive a high/critical production audit finding without a written owner and expiry.
- [x] Confirm Vercel's Git integration is the only deployment path, `main` is the Production branch, and the install/build/output settings match `vercel.json`.

## Configuration and secrets

- [ ] Inventory observe Vercel settings `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `CHANGEPLANE_SELF_SERVE_ENABLED`, `CHANGEPLANE_SESSION_SECRET`, `CHANGEPLANE_APP_ORIGIN`, optional `CHANGEPLANE_MANAGED_OPENAI_API_KEY`, and `CHANGEPLANE_LOG_REQUESTS`; record owners and last-rotation dates outside the repository.
- [ ] Inventory repair Vercel settings `CHANGEPLANE_REPAIR_REPOSITORY`, `CHANGEPLANE_REPAIR_ENABLED`, `CHANGEPLANE_REPAIR_GENERATION`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `CHANGEPLANE_CONTROLLER_SECRET`; keep the switch false and keep all secret values out of the release record.
- [ ] Inventory repository Actions Secrets `CHANGEPLANE_CONTROLLER_INSTALLATION_ID`, `CHANGEPLANE_REPAIR_ENABLED`, `CHANGEPLANE_REPAIR_GENERATION`, `CHANGEPLANE_REPAIR_PUBLIC_KEYS`, `CHANGEPLANE_CONTROLLER_HMAC`, and `OPENAI_API_KEY`; write the worker switch false first and true only after complete provisioning.
- [x] During a controlled canary, set `CHANGEPLANE_CANARY_REPOSITORY` to the exact disposable target and verify a different repository is hidden and rejected before any GitHub request.
- [ ] With `CHANGEPLANE_SELF_SERVE_ENABLED=true`, verify the signed-out root offers Connect GitHub and the RouteThai example; personal and organization installations list only repositories in their verified App installations; autonomous setup remains gated by exact test + BYOK + protected setup PR.
- [ ] Use a 32+ character independent session secret per Vercel environment and an exact HTTPS `CHANGEPLANE_APP_ORIGIN` with no path, query, or trailing slash.
- [ ] Keep production connector credentials and all provider keys out of fork/untrusted Preview deployments. A trusted Preview uses isolated non-production connector credentials.
- [ ] Keep `CHANGEPLANE_MANAGED_OPENAI_API_KEY` server-side and absent unless the private canary is explicitly approved.
- [ ] Confirm plaintext provider keys never appear in localStorage, logs, responses, Vercel build output, screenshots, or release records.
- [ ] Publish and verify the Vercel WAF fixed-window rate limit for `/api/github` before public onboarding; record its threshold and owner, confirm excess traffic receives `429`, and keep total allowed requests inside the included allowance.
  - Evidence captured 2026-07-19: active fixed-window rule, 60 requests per 60 seconds per IP; a controlled 65-request burst returned 60 `200` responses and 5 `429` responses. Release-owner naming remains open.
- [ ] Confirm structured logs contain only the approved redacted metadata and request ID.

## Pre-release Preview verification

- [ ] Confirm the Vercel Preview deployment source equals the pull request's exact head SHA and its build succeeds.
- [ ] Confirm the required GitHub Check passed on that same SHA.
- [ ] On a trusted Preview, confirm `/api/github?action=readiness` returns `200`, `ready: true`, the expected connector mode, no secret values, and a release matching the Preview source SHA.
- [ ] Smoke the trusted Preview root and confirm security headers and API `Cache-Control: no-store` are present.
- [x] Install observe mode into the one disposable repository through a manually reviewed pull request and confirm the read-only preflight reports no direct default-branch write, merge/deploy blocking, repair dispatch, pull-request-head execution, provider-secret access, or reserved-path overwrite. The private GitHub Free canary has no branch protection, so this is controlled evidence rather than a production merge gate.
  - Observe install evidence passed in private disposable repository `LeChiffreVol2/changeplane-disposable-canary-20260719`: setup [PR #1](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/1) changed six reserved files only and merged at `82c0f3f91f8c6f516c55e11c4e69491803430db7`.
- [x] Confirm the atomic setup pull request exposes observe-only Action metadata, least-privilege permissions, no repair inputs, and no active repair workflow.
  - PR #1 installed a trusted-base workflow with read-only contents/deployments/statuses access plus Check/comment publication only. The installed Action exposes no enforce or repair-dispatch input.
- [x] Configure at least one meaningful deterministic check in `.changeplane.json`, or explicitly label the setup scope-only. The current installer binds a check only after the owner confirms it; a name-based suggestion alone is not behavioral assurance.
  - The historical canary began scope-only. [PR #3](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/3) later bound required check `test` to source `github-actions` with a 120-second wait, and [PR #4](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/4) added the legacy-status permission needed by that observe release. Enforce now accepts only expected-App Check Runs.
- [x] Verify one exact-head receipt and neutral `ChangePlane / guard` Check Run in observe mode.
  - [PR #2](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/2) has one idempotently updated receipt on final head `bab424f625052aad5d0038de5bccb04e71b06053`; `test` and `ChangePlane observe` succeeded, `ChangePlane / guard` concluded neutral, and the receipt bound the successful `github-actions` evidence to that exact head.
- [ ] Verify personal and organization BYOK create, rotate, disconnect, provider-key revocation, and fail-closed OpenAI model access without retaining plaintext. Keep the managed key unset.

## Release and rollback

- [x] Merge only after every required check above passes; do not deploy an unreviewed local build.
- [x] Confirm the resulting Production deployment source is the protected `main` SHA and record its deployment ID.
- [x] Make one read-only Production readiness request and repeat one disposable-repository observe evaluation; stop if either differs from Preview.
- [x] Confirm the immediately previous Production deployment remains available for Instant Rollback.
- [ ] Exercise or review access to Vercel rollback, GitHub authorization revocation, session-secret rotation, and provider-key revocation.
- [ ] Confirm the release owner is watching native Vercel logs/usage and GitHub Actions usage during onboarding; no external monitor or pager is claimed.
- [ ] At 80% of a free included allowance, stop new onboarding and nonessential reruns. At exhaustion, fail closed until reset.

## Required before enforcement or agent repair

- [ ] Replace broad OAuth repository access with a least-privilege GitHub App and short-lived installation tokens.
- [ ] Confirm `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_SLUG` belong to the same dedicated App. Provisioning requests repository Secrets write; the live controller separately requests only Actions read, Checks write, Contents write, and Pull requests read. Workflow write is installer-only.
- [ ] Mint each short-lived token with its phase-specific permissions and constrain it by `repository_ids`; confirm GitHub returns exactly the disposable repository ID, active and unarchived, before provisioning or dispatch.
- [ ] Provision `CHANGEPLANE_REPAIR_ENABLED=false` before any secret so interruption or permission failure leaves an inert, safely rerunnable repository configuration.
- [ ] Confirm Vercel `CHANGEPLANE_REPAIR_REPOSITORY` exactly equals `CHANGEPLANE_CANARY_REPOSITORY`, both generations are the same positive integer, and both repair switches remain false.
- [ ] Derive `CHANGEPLANE_CONTROLLER_HMAC` from the independent 32+ character Vercel master secret plus the exact installation ID, repository ID, and repository name; never copy the master secret into GitHub.
- [ ] Confirm the repository PS256 public-key map contains the App private key's expected key ID and no unreviewed key, and that the private key remains Vercel-only.
- [x] Reject same-name evidence unless it originates from the policy's expected GitHub App slug.
- [ ] Verify expected-App evidence against live GitHub Check Runs in a disposable repository.
- [ ] Evaluate `merge_group` as its own exact revision and publish the required Check for GitHub Merge Queue.
- [x] Implement the PS256-signed monotonic ledger primitive intended for the App publisher, campaign-bound two-attempt/15-minute invariant, pinned-key verifier, and inactive workflow kill switch.
- [x] Bind inactive grants to the exact controller SHA, default base ref, policy digest/evaluator version, contract, protected-path denylist, and live pull-request revision; recheck the signed deadline immediately before push.
- [x] Reserve push credentials once in the App-signed ledger, mint only an exact-repository Contents-write token after claim revalidation, keep it in runner temp, and push with force-with-lease so `pull_request synchronize` starts fresh CI.
- [x] Wire ledger publication and dispatch to a dedicated GitHub App installation-token controller outside repository-controlled workflows.
- [x] Prove tampered signature, unknown key, future/expired grant, deadline reset, wrong repository/head/path, third attempt, fork, sequential replay, and concurrent replay all fail closed before provider access in the automated controller suite.
- [x] Record the active Vercel Production deployment's full 40-character source SHA and confirm its first 12 characters equal readiness `release`.
  - Autonomous release evidence captured 2026-07-20: Production source `0e8e093262a175d8ffa8284106c0c62ed2f68f65`, readiness release `0e8e093262a1`, repair enabled/configured with every nested check true.
  - Observe-release evidence captured 2026-07-19: Production source `38d4c4d261ba43df7e6d580b56e797100519526e`, readiness release `38d4c4d261ba`. This is not authorization to reuse that SHA for a later repair install; pin the full active reviewed repair-capable release at activation time.
- [x] Install the v6 managed guard, repair workflow, and reviewed helper payload together through reviewed upgrade PRs; confirm the workflow runs trusted default-branch helpers and no placeholder, branch, tag, or mixed controller source remains.
- [x] Pin every third-party Action in the installed repair workflows to a reviewed full commit SHA.
- [ ] With both switches false, deploy the complete configuration; confirm readiness remains observe-ready, repair is disabled/unconfigured with only the enabled check false, and `repair`, `repair-claim`, `repair-validate`, and `repair-push-token` each fail closed with `503` before GitHub access.
- [ ] Pass stale-head, expiry, path-boundary, replay, idempotency, fork, and sandbox escape tests in a disposable repository.
- [x] Run the RouteThai synthetic service-window canary end to end: expected-App evidence fails on `a9d2058`, Luna proposes only `routethai/route-planning.js`, the clean apply job creates `9f9efd6`, fresh evidence succeeds, and only then does `ChangePlane / guard` pass with zero human repair commits. See `evidence/routethai-luna-github-canary.json`.
- [ ] Exercise the generation-based kill switch before provider access and again before clean apply in the disposable repair canary.
- [x] Activate in order: set the repository worker switch true, deploy the reviewed protected-source commit with the Vercel switch true, and stop unless readiness reports repair enabled/configured with every nested check true for the expected release.
- [ ] Run deterministic scope repair before adding or exercising `OPENAI_API_KEY`; never reuse the stale observe pull request as repair evidence.
- [ ] Exercise rollback in order: repository switch false, cancel runs, Vercel switch false, generation advanced and mirrored, disabled deployment verified, repair endpoints `503`. Do not rely on Instant Rollback alone because an older deployment may carry enabled configuration.
- [x] Record that GitHub Free provides no branch protection for the private disposable canary. Require manual PR review and no direct pushes by procedure, and treat the run as lab evidence rather than production enforcement.
- [ ] Exercise provider outage, GitHub outage, exhausted attempts, and rollback incidents.

## Required before ChangePlane Managed

- [ ] Prove no repository workflow or browser can retrieve `CHANGEPLANE_MANAGED_OPENAI_API_KEY`.
- [ ] Provide tenant-isolated credentials and data paths.
- [ ] Provide usage metering, hard budgets, abuse controls, and cost alerts.
- [ ] Provide subscription lifecycle, invoices, refunds, and support ownership.
- [ ] Publish and implement data retention/deletion policy and customer-facing terms.
- [ ] Define measured provider failover and regional/privacy commitments.
