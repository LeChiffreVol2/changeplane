# Production release checklist

## Managed-v14 customer-readiness candidate — 2026-09-07

The items below apply to the current candidate. Historical checked items remain evidence only for their recorded revisions.

- [x] Record the founder's revised budget: USD 0 for current engineering preparation; USD 100 per month only at scale. Keep upgrades, paid add-ons and persistent database provisioning deferred. Preserve personal and organization support and all technical/legal customer-access gates. See [operating budget](operating-budget.md).
- [x] Qualify the actual journal adapter through a disposable Supabase Free runtime login with verified TLS, transaction-pool tenant isolation, concurrent exclusion, committed poison and fresh-login credential rotation. Delete the project and temporary credentials, and confirm existing projects and the Free plan are unchanged. This is local-operator evidence; Vercel connectivity, CA packaging, durability and live publication remain open. See [redacted runtime evidence](../evidence/changeplane-free-runtime-qualification.json).
- [x] Add per-pool provider CA configuration with no URL/file overrides or global trust changes. Verify both runtime adapters against real scratch PostgreSQL over TLS, including missing/wrong CA, hostname mismatch, invalid trust material and a bounded rotation bundle. Include `npm run test:postgres-tls` in the protected CI gate; live Vercel configuration and connectivity remain separate requirements.
- [x] Provision a separate Supabase Free Guard project at a quoted USD 0 and verify its complete schema, server TLS enforcement, explicit CA runtime login, tenant/role boundaries, concurrency, finite capacity and persistent poison. Ten catalog checks and the security advisor pass. No real repository is enrolled; this does not prove Vercel connectivity or durability. See [service qualification](../evidence/changeplane-guard-service-qualification.json).
- [ ] Complete explicit service-retention/Production-secret staging confirmation, GitHub owner reauthentication, and the live organization canary. Delete the temporary organization and repository after testing; remove temporary credential transport material after the approved transfer.

- [x] Preserve v13 Full and Verify Lite manifest hashes and upgrade each profile without widening authority.
- [x] Vendor scheduled/manual least-privilege recovery into both profiles, with failed-workflow notification signals and no ability to create PASS.
- [x] Test recovery budgets derived from trusted current default-branch policy: Verify/Observe permit five-minute recovery only with independently verified terminal owning-run evidence; healthy or unverifiable owners, Autonomous mode and absent helper context retain the 25-minute fallback. Cover exact boundaries, scheduled and administrator recovery, rejected caller shortening, owning-run and policy drift before mutation, and preserved contract/generation/PR markers. These deterministic tests do not close the publication race or establish live recovery latency.
- [x] Keep customer alpha/self-service closed when legal, principal separation, publication serialization or commercial runtime prerequisites are absent; explain the safe block in the UI.
- [x] Retain the authenticated contract through same-SHA generations and timeout reconciliation; revalidate target and generation after evidence/token work.
- [x] Add reproducible operator-attested pilot measurement; empty evidence remains `not_started` and incomplete reliability coverage remains unknown.
- [x] Measure GitHub `User` and `Organization` cohorts through explicit schema-2 Customer Account bindings while preserving schema-1 organization reports. Include both in product reliability and reject unbound/conflicting identity records; individual payments never satisfy the paying-organization gate. Output aggregates only, without private account/evidence identifiers.
- [x] Add finite operator-enrolled Verify Lite pilot admission, immutable per-attempt receipts and atomic monthly counters. Keep denied or unavailable allowances fail-closed through an acknowledged `action_required` Guard; never re-charge completion/recovery or infer invoice amounts from telemetry.
- [ ] Before enabling pilot admission, verify exact-release commercial database enrollment, tenant/role controls, concurrent final-slot admission, contract renewal and 90-day receipt replay closure, 13-month counter retention, cost limits and restore/rotation/deletion procedures. Public plans and outcome ingestion remain unavailable.
- [x] Add the candidate PostgreSQL journal around begin, completion and reconciliation: durable repository/revision ownership, execute-only transitions, no expiry takeover, and held/poisoned authority after uncertain writes. Keep Guard credentials server-side and exercise the adapter plus real scratch-PostgreSQL isolation/concurrency/restart scenarios with `npm run test:guard-journal`.
- [x] Require the journal for every hosted Guard write, including owner canary; reject missing/disabled configuration, shared Guard principals, invalid epoch/release binding, and PostgreSQL URLs without the sole `sslmode=verify-full` option. Keep configuration readiness separate from database-health or durability proof.
- [ ] Before promotion, provision the dedicated authority database and separate new Guard App, enroll the exact source SHA/epoch/repository scope, and verify least-privilege roles, certificate validation, finite capacity/cost controls and journal-aware rollback. No live database enrollment or deployment is implied by local tests.
- [ ] Prove zero loss of acknowledged authority across the selected live restore/failover topology, or demonstrate a halt and new-Guard-principal recovery. Interleave publication, cancellation and delayed external requests in the organization canary; do not remove `guardPublicationSerialized: false` on an operator attestation or configuration check alone.
- [ ] Prove organization-owned same-SHA Strict Head, new-head invalidation, actual scheduled recovery latency and failed-run notification delivery using the exact candidate release.
- [ ] Complete separate Guard App, legal entity/jurisdiction/contact/payment terms and signed design-partner order forms before alpha activation.
- [ ] Record reviewed CI, Preview denial, protected Production provenance, signed-out production smoke and rollback evidence for this candidate before calling it deployed.
- [ ] Collect the real 30-day customer outcomes. Do not substitute synthetic proof, local tests or a store schema for customer activation and payment.

See [automated SDLC architecture](automated-sdlc-architecture.md) and [launch measurement](launch-measurement.md).

## Product 1.0.0 / managed v13 protected release — 2026-09-01

Managed v13 and its dedicated GitHub App publisher are deployed from protected `main`. The live public canary proves exact-head success, publisher identity, stale-head re-evaluation, protected-evidence refusal, and the inputs required for Strict Head. Queue Certified remains unproven because the available personal-account repository cannot enable GitHub Merge Queue; the real Cursor Origin mirror canary is `BLOCKED_NO_SUBSCRIPTION`. See `evidence/changeplane-v13-production-release.json`.

- [x] Keep the previously recorded production freeze in place: release `88f67ab65a3f`, `controlled_canary`, repair `enabled: false`, and repair `configured: false`. This is historical production evidence, not evidence for the v13 worktree. See `evidence/changeplane-v1-pre-release-freeze.json`.
- [x] Generate the nine-file `verify-lite` profile for Verify and Observe. Its managed workflow has one guard job and no provider key, model-backed review job, standalone proposal/controller helper, repair workflow, repair webhook, controller HMAC, or controller installation credential; deterministic agent-handback findings remain inside the evaluator.
- [x] Generate the 21-file `full` profile only for the Autonomous controlled beta, and require a protected authority-expansion pull request when an installed Verify Lite repository opts into Autonomous.
- [x] Emit schema-v2 managed manifests with an exact `managedProfile`, preserve the immutable v12 hash catalog, and reject profile/path expansion outside a reviewed setup or upgrade pull request. Before runtime or BYOK authority is available, bind that profile to the exact default-branch Git tree, verify every managed blob and file mode, and reject unknown or Full-only reserved paths in Verify Lite. Re-bind immediately before BYOK/controller secret mutation, keep repair disabled across drift, tombstone the current controller HMAC during rotation, and write the usable credential last.
- [x] Preserve the v12 repair credential domain intentionally: Full continues to use `CHANGEPLANE_CONTROLLER_HMAC_V12` and `managed-v12`; the managed-v13 manifest, not the secret name, identifies payload version.
- [x] Compute Strict Head only when at least one independently complete active repository or inherited-organization default-branch Ruleset returned by the repository-scoped endpoint has validated parent selector shapes, no bypass actors, strict up-to-date required checks, the Guard-App-owned `ChangePlane / guard`, and every behavioral evidence Check bound to its expected integration ID. Compute Queue Certified only when that same complete Ruleset also requires Merge Queue. Fail closed on ambiguous targeting, bypasses, malformed data, controls split across Rulesets, and missing or misbound Checks. Classic branch protection is insufficient; GitHub-owned `ChangePlane guard` is operational liveness only.
- [x] Add the signed-out twelve-case Cursor Origin boundary proof with six assertions for deterministic exact-head, approval, scope, protected-path, publisher, evidence, malformed-patch, provider-failure, and GitHub-mirrored Origin contracts. Label its three Origin fixtures as synthetic and standalone Origin as unsupported/not tested; never present it as live Origin evidence or an external benchmark.
- [x] Emit a redacted proof locator only after the exact-head guard is successfully published. Add an authenticated read-only verifier that re-fetches the guard, policy, evidence Checks, and current pull-request revision, returns current/historical/invalid/indeterminate, and grants no mutation or merge authority.
- [x] Add a read-only Agentic SDLC projection to repository readiness and the exact-revision workspace. Keep it derived from existing facts, restart every checkpoint on a new commit, omit stale deployment metadata, carry no pull-request review into `merge_group`, and preserve deterministic-harness PASS, GitHub merge, and customer operation authority.
- [x] Gate every GitHub/OpenAI connector route on verified Vercel Production Git provenance; keep the production repair switch closed while the candidate is unverified.
- [x] Execute pull-request controllers from the exact live default-branch revision; reject retargeting, base drift, stale heads, and controller-SHA mismatch before provider, dispatch, or Check authority.
- [x] Remove App-guard publication authority from repository workflows while retaining the GitHub-owned `ChangePlane guard` job as operational liveness. Require GitHub OIDC for the exact trusted workflow, repository, SHA, event, ref, run ID, and attempt. Before evaluation, create or patch one stable exact-head `ChangePlane / guard` to `in_progress` and supersede older successful App results. Treat run ID and attempt as a monotonic Evaluation Generation; accept completion only from the latest generation after re-fetching managed tree, policy, target, and exact-head evidence. Reject missing begin, duplicate or older completion, target drift, newer evidence, and malformed markers. Mint separate exact-repository read and `checks:write` credentials.
- [x] Require enforce-mode `github-actions` evidence to declare an exact `.github/workflows/*.yml` or `.yaml` path. Resolve the Check's canonical GitHub Actions run, bind its head SHA and workflow path before evaluation, and reject non-latest same-name/App evidence before App-guard completion.
- [x] Add a five-minute and manually dispatched reconciliation path to the same reviewed managed workflow. Authenticate the exact default-branch workflow and repository with GitHub OIDC, bound the scan, revalidate every target before mutation, mint `checks:write` only when needed, and permit only expired App-owned `in_progress` Guards to end as `action_required`. Treat GitHub schedule timing as a measured target, not an SLA.
- [x] Recover pristine v11/v12 enforce policies that lack the required `github-actions` workflow path through one owner-authorized, protected upgrade pull request. Include `.changeplane.json` only when recovery is needed, bind the owner-selected exact Check, publisher, and workflow path, default to Verify or explicit scope-only Observe, provision no autonomous credential, and tell the owner to replace the legacy `github-actions` App-guard policy binding with the v13 dedicated-App guard in the qualifying Ruleset.
- [x] Run exact-candidate unit/integration tests, Origin boundary proof, production build, dependency audit, public-data scan, and complete Chromium onboarding and proof journeys on the protected candidate SHA.
- [ ] On the protected candidate SHA, capture the repository-level SDLC posture and one pull-request spine before and after a fresh commit; confirm the prior verified and delivery states are not reused and that no SDLC field can change the live guard conclusion.
- [ ] Exercise Verify Lite end to end without BYOK: review and merge exactly nine files, bind one behavioral Check, publisher, and exact workflow path when the publisher is `github-actions`; observe `ChangePlane guard`; observe the stable App-owned `ChangePlane / guard` transition to `in_progress`; complete it only from the latest Evaluation Generation and latest exact-head evidence; return a customer-agent handback on failure; and prove a newer generation can freshly re-evaluate the same SHA without inheriting prior PASS.
  - Live public PR #2 proves the nine-file setup, exact workflow-bound CI evidence, dedicated-App `in_progress` → `success`, and fresh evaluation after a new head. PR #3 proves protected test evidence returns `action_required`. A customer-agent repair handback remains outside this Verify Lite proof.
- [ ] Prove both assurance levels. Strict Head requires one independently complete strict, no-bypass default-branch Ruleset with the Guard App and every evidence Check publisher-bound. Queue Certified adds Merge Queue and a fresh `merge_group` evaluation. Record inactive results for classic-only protection, ambiguous targets, controls split across Rulesets, bypass actors, non-strict policy, and missing or misbound publishers.
  - Ruleset `21956682` is active, strict, has no bypass actor, and binds `CI / test` to integration `15368` plus `ChangePlane / guard` to integration `4334716`; those live facts satisfy Strict Head. GitHub rejected the Merge Queue rule with `422` because Merge Queue is unavailable to this personal-account public repository; use an eligible organization-owned public repository for the remaining Queue Certified live gate.
- [ ] With the Vercel controller switch false, expand Verify Lite to the exact 21-file Full profile through a protected pull request, verify the managed-v13 hashes, and confirm no repair endpoint can act while the expansion is pending.
- [ ] Exercise Full-profile BYOK create/rotate/disconnect, a default-branch retarget/drift failure, a fresh-head autonomous canary, guard-only Merge Queue behavior, repository-first kill switch, generation invalidation, and rollback.
- [ ] Capture a live exact-head Assurance Passport anchor and verify its completed ordered-run marker, digest, dedicated-App publisher, head SHA, latest workflow-bound evidence identities, and conclusion directly from GitHub. Separately record the GitHub-owned `ChangePlane guard` operational-liveness Check and its publisher. Do not present an offline passport or one Check alone as authenticated merge enforcement.
- [ ] Run a real Origin-access canary on a GitHub-mirrored repository: record the same GitHub head in Origin and GitHub, a stale mirror transition, and a protected-test change; then re-run the live proof endpoint. Do not claim a native Origin integration, standalone Origin support, superior speed, or missing Origin controls from synthetic fixtures.
- [ ] Approve the distinct Installer, Guard, and Repair Controller App permissions and run a protected disposable-repository canary that records OIDC claims, GitHub-owned operational liveness, Guard-App `in_progress`, latest-generation completion, same-SHA rerun, older completion rejection, newer-evidence rejection, exact-head proof locator, and `VERIFIED_CURRENT` re-fetch. Confirm one qualifying Ruleset binds the Guard App and every behavioral evidence Check to expected integration IDs. Local implementation alone does not complete this release gate.
  - App installation `147492050` now includes the public v13 canary by explicit owner approval. Exact-head, protected-path, and stale transition evidence is live; Merge Queue, authenticated `VERIFIED_CURRENT`, newer-evidence rejection, and Full-profile activation remain open.
- [x] Record GitHub App permission approval, protected source SHA, `CI / verify` run, Preview and Production deployment IDs, readiness release, Verify Lite canary revisions, rollback target, and explicit remaining boundaries in `evidence/changeplane-v13-production-release.json`. Full-profile activation and a separate named launch-window watcher remain release-expansion work.

The protected managed-v13 release and dedicated-App publisher are live, but they are not Queue Certified, a real Cursor Origin interoperability result, or authorization for public Autonomous onboarding. Keep the production repair switch closed until every unchecked activation item has live evidence. The historical v9, v12 freeze, and 2026-07-21 release records below remain evidence only for their exact revisions; their legacy `github-actions` guard results do not prove the v13 Guard-App lifecycle or Queue Certified gate.

## Self-serve product release — 2026-07-21

- [x] Record the protected product release, exact CI job, GitHub deployment, Vercel Production deployment, direct readiness response, and previous rollback candidate in `evidence/build-week-product-release.json`.
  - Protected product source `cfd8aeef79e1d612b2fe819b8f77278d8e75845e` from [PR #37](https://github.com/LeChiffreVol2/changeplane/pull/37); [`CI / verify`](https://github.com/LeChiffreVol2/changeplane/actions/runs/29790822891/job/88512038372) passed on the exact release.
  - GitHub Production deployment `5530924912` points to that SHA. Vercel Production `dpl_FJHW94gj9WoZBafC3E5HMmTGYPyc` is `READY`, aliases `https://changeplane.vercel.app`, and previous Production `dpl_FGv73hZ4eFXJwBBEbXeEJE7CkcTp` remains a rollback candidate.
- [x] Capture a direct Production readiness response for the protected product release.
  - HTTP `200`, request ID `df966b64247dfbf27bb928c8`, `Cache-Control: no-store`, `status: ready`, `authMode: github_app`, `rolloutMode: self_serve`, release `cfd8aeef79e1`; every public connector and repair-controller readiness check is true.
- [x] Self-serve GitHub App onboarding supports eligible personal and organization installations and limits repository selection to the verified installation.
- [x] Current v13 onboarding requires a fresh repository to install Verify Lite first. Autonomous requires an installed Verify Lite profile, an active qualifying Ruleset gate, exact behavioral evidence, verified repository BYOK, and a separate protected Full expansion pull request; scope-only remains Observe.
- [x] The managed payload vendors the trusted harness, repair helpers, and workflows without a queue, database, proprietary workspace, or model-held GitHub credential.
- [x] Luna Responses transport uses a strict one-field patch schema; unified-diff, allowed-path, clean-apply, stale-head, two-attempt/15-minute, and deterministic re-validation gates remain independent.
- [x] Live synthetic Luna adapter evidence passed with redacted request ID and patch hash in `evidence/routethai-luna-adapter-canary.json`.
- [x] Capture the disposable repository's App-signed grant, redacted Luna request metadata, clean apply, App-authored push, synchronize event, new exact head, and `ChangePlane / guard` result.
  - Managed v9 [PR #31](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/31): `7b670f341662cfd97699d3957e6491a2bc026f9a` → `e053526676f0fb189b4fa87d8da4612725ffd9ee`; repair run `29788370891`; grant Check `88504652456`; final guard Check `88504854987`; zero human repair commits; closed without merge.

Unchecked items below are explicit rollout-expansion or destructive live-drill evidence. They are not represented as completed release claims.

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
- [x] Keep the release on the fixed free Vercel phase. Public repository discovery is limited to each signed-in user's eligible App installations, and controlled repair-canary routes remain bound to the exact disposable `CHANGEPLANE_CANARY_REPOSITORY`.
  - Direct Production readiness reports `self_serve`, `github_app`, valid canary scope, and configured exact-repository repair identity. Repository-isolation and non-canary pre-network rejection tests pass.
- [x] Confirm the ChangePlane source repository protects `main` and requires `CI / verify`. Record that the private GitHub Free disposable canary cannot enable branch protection and is owner-controlled lab evidence only; do not change its visibility or claim production enforcement.
- [x] Keep the release to the GitHub connector, one GitHub Action, the pure evaluator, GitHub Checks/comments, and reviewed managed repair helpers. No database, queue, merge service, or paid observability is required. Repair is active only in explicitly configured repository setups and the controlled canary.
- [x] Confirm the Merge Queue contract evaluates the exact `merge_group` SHA and does not dispatch review, proposal, repair, apply, or handback work.
  - Exact-revision, stale-base, and guard-only automated tests pass.
- [ ] Capture positive live Merge Queue evidence from an eligible organization repository and GitHub plan.
  - The private personal-account canary is ineligible. This is an evidence limit, not a claim that the live queue path has been proven.
- [x] Confirm `ChangePlane / review` runs only with repository BYOK, validates changed-line locations, caps and deduplicates findings, and never contributes PASS or approval.
  - Live canary [PR #25](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/25) published one advisory annotation through Check Run `88499084548`; guard remained independent and the PR closed without merge.
- [x] Confirm `.changeplane/assurance.md` is repository-owned, read from the trusted default branch, and changed only through a reviewed pull request.
  - Canary [PR #24](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/24) added the synthetic RouteThai assurance memory with the trusted review policy.
- [x] Confirm the agent-handback Action output and receipt payload carry no credential or authority and stale-head consumers stop safely.
  - Canary PR #31 bound the payload to the initial exact head and declared proposal-only authority with Git, Check, merge, and PASS all false.
- [ ] Capture a positive live receipt containing an exact-head preview. The automated contract passes, and PR #31 correctly omitted the preview because no matching deployment existed.

## Source and CI gate

- [x] Protect `main`, disallow direct pushes/bypasses, and require the pinned `CI / verify` job before merge.
- [x] Confirm `CI / verify` is the exact required check name and the workflow has `contents: read`, immutable action SHAs, one canceling concurrency lane, a job timeout, and no deployment secret.
- [x] Confirm the activation-boundary step finds only `.github/workflows/ci.yml`; observe and repair templates must remain under `examples/`.
- [x] From a clean checkout, confirm `npm ci --cache .npm-cache`, `npm run verify`, and `npm run audit:prod` pass with Node `22.18.0`.
- [x] Confirm CI serves `dist` only on runner-local `127.0.0.1` and smoke-checks the built root without calling Preview or Production.
- [x] Confirm the Chromium onboarding suite passes for controlled-canary isolation plus fresh, upgrade, pending, current, and owner-review repository states without making non-local requests.
- [x] Review every dependency and pinned Action SHA in the product release; no high/critical production audit finding is waived.
  - `npm audit --omit=dev --audit-level=high` reports zero vulnerabilities, and installed repair workflows pin third-party Actions to reviewed full SHAs.
- [x] Confirm Vercel's Git integration is the only deployment path, `main` is the Production branch, and the install/build/output settings match `vercel.json`.

## Configuration and secrets

- [ ] Inventory observe Vercel settings `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `CHANGEPLANE_SELF_SERVE_ENABLED`, `CHANGEPLANE_SESSION_SECRET`, `CHANGEPLANE_APP_ORIGIN`, optional `CHANGEPLANE_MANAGED_OPENAI_API_KEY`, and `CHANGEPLANE_LOG_REQUESTS`; record owners and last-rotation dates outside the repository.
- [x] Inventory repair Vercel setting names `CHANGEPLANE_REPAIR_REPOSITORY`, `CHANGEPLANE_REPAIR_ENABLED`, `CHANGEPLANE_REPAIR_GENERATION`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `CHANGEPLANE_CONTROLLER_SECRET`; record only active/inactive state, never values. The controlled v9 canary is active; containment restores the switch to false.
- [x] Inventory repository Actions Secret names `CHANGEPLANE_CONTROLLER_INSTALLATION_ID`, `CHANGEPLANE_REPAIR_ENABLED`, `CHANGEPLANE_REPAIR_GENERATION`, `CHANGEPLANE_REPAIR_PUBLIC_KEYS`, versioned `CHANGEPLANE_CONTROLLER_HMAC_V12`, legacy tombstone `CHANGEPLANE_CONTROLLER_HMAC`, and `OPENAI_API_KEY`; the historical worker switch was enabled only after complete provisioning. Secret values remain unreadable and absent from evidence.
- [x] During a controlled canary, set `CHANGEPLANE_CANARY_REPOSITORY` to the exact disposable target and verify a different repository is hidden and rejected before any GitHub request.
- [x] With `CHANGEPLANE_SELF_SERVE_ENABLED=true`, verify the signed-out root offers one `Install ChangePlane on GitHub` action, explains that GitHub owns the personal/organization choice, keeps a returning-user authorization path and the RouteThai example, lists only verified-installation repositories, starts fresh repositories with Verify Lite, and exposes protected Autonomous expansion only after the installed gate prerequisites are active.
- [x] Use a 32+ character Production session secret and an exact HTTPS `CHANGEPLANE_APP_ORIGIN` with no path, query, or trailing slash.
  - The public readiness endpoint validates both without returning either value. Preview environments receive neither value and remain connector-disabled.
- [ ] Keep production connector credentials, session/controller secrets, and all provider keys out of every Preview deployment. Preview proves build and fail-closed behavior only.
- [ ] Keep `CHANGEPLANE_MANAGED_OPENAI_API_KEY` server-side and absent unless the private canary is explicitly approved.
- [x] Confirm plaintext provider keys never appear in localStorage, logs, responses, tracked source, `dist`, screenshots, or release records.
  - BYOK response/log redaction tests and the repository data audit pass. Production evidence contains only secret names, booleans, bounded request IDs, and redacted metadata.
- [x] Publish and verify the Vercel WAF fixed-window rate limit for `/api/github`; record its threshold and owner, confirm excess traffic receives `429`, and keep total allowed requests inside the included allowance.
  - Evidence captured 2026-07-19: active fixed-window rule, 60 requests per 60 seconds per IP; a controlled 65-request burst returned 60 `200` responses and 5 `429` responses. Owner: `@LeChiffreVol2`.
- [x] Confirm structured logs contain only the approved redacted metadata and request ID.
  - Automated API/log tests pass, direct readiness returned a request ID, and the production runtime-log error review contained no application errors or secret-bearing record.

## Pre-release Preview verification

- [x] Confirm the Vercel Preview deployment source equals the pull request's exact head SHA and its build succeeds.
  - PR #37 Preview `dpl_4VJhr17yaiRkRFGgByvve7Qnd5nR` is `READY` on exact head `8eca0d5456b2b593baa6277e8bb32fa4d9e62215`.
- [x] Confirm the required GitHub Check passed on that same SHA.
  - [`CI / verify`](https://github.com/LeChiffreVol2/changeplane/actions/runs/29790687579/job/88511622382) passed on the PR #37 head.
- [ ] On the exact-head Preview, confirm `/api/github?action=readiness` returns `503`, `configuration_required`, `checks.sourceProvenance: false`, no secret values, `Cache-Control: no-store`, and a request ID.
- [ ] Smoke the Preview root for security headers and confirm a connector route returns `503` before any GitHub/OpenAI access.
- [x] Install observe mode into the one disposable repository through a manually reviewed pull request and confirm the read-only preflight reports no direct default-branch write, merge/deploy blocking, repair dispatch, pull-request-head execution, provider-secret access, or reserved-path overwrite. The private GitHub Free canary has no branch protection, so this is controlled evidence rather than a production merge gate.
  - Observe install evidence passed in private disposable repository `LeChiffreVol2/changeplane-disposable-canary-20260719`: setup [PR #1](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/1) changed six reserved files only and merged at `82c0f3f91f8c6f516c55e11c4e69491803430db7`.
- [x] Confirm the atomic setup pull request exposes observe-only Action metadata, least-privilege permissions, no repair inputs, and no active repair workflow.
  - PR #1 installed a trusted-base workflow with read-only contents/deployments/statuses access plus Check/comment publication only. The installed Action exposes no enforce or repair-dispatch input.
- [x] Configure at least one meaningful deterministic check in `.changeplane.json`, or explicitly label the setup scope-only. The current installer binds a check only after the owner confirms it; a name-based suggestion alone is not behavioral assurance.
  - The historical canary began scope-only. [PR #3](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/3) later bound required check `test` to source `github-actions` with a 120-second wait, and [PR #4](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/4) added the legacy-status permission needed by that observe release. Enforce now accepts only expected-App Check Runs.
- [x] Verify one exact-head receipt and neutral `ChangePlane / guard` Check Run in observe mode.
  - [PR #2](https://github.com/LeChiffreVol2/changeplane-disposable-canary-20260719/pull/2) has one idempotently updated receipt on final head `bab424f625052aad5d0038de5bccb04e71b06053`; `test` and `ChangePlane observe` succeeded, `ChangePlane / guard` concluded neutral, and the receipt bound the successful `github-actions` evidence to that exact head.
- [ ] Verify personal and organization BYOK create, rotate, disconnect, provider-key revocation, and fail-closed OpenAI model access without retaining plaintext. Keep the managed key unset.
  - Live status and Luna use passed; atomic create/rotation/deletion and key-redaction tests pass. Live deletion was not exercised because GitHub Secrets cannot be read back and no replacement key was available for safe restoration.

## Release and rollback

- [x] Merge only after every required check above passes; do not deploy an unreviewed local build.
- [x] Confirm the resulting Production deployment source is the protected `main` SHA and record its deployment ID.
- [x] Make one read-only Production readiness request and repeat one disposable-repository observe evaluation; stop if either differs from Preview.
- [x] Confirm the immediately previous Production deployment remains available for Instant Rollback.
- [ ] Exercise or review access to Vercel rollback, GitHub authorization revocation, session-secret rotation, and provider-key revocation.
- [ ] Confirm the release owner is watching native Vercel logs/usage and GitHub Actions usage during onboarding; no external monitor or pager is claimed.
- [ ] At 80% of a free included allowance, stop new onboarding and nonessential reruns. At exhaustion, fail closed until reset.

## Required before enforcement or agent repair

- [x] Replace broad OAuth repository access on the autonomous path with the dedicated repository-scoped GitHub App and short-lived installation tokens. The OAuth fallback remains explicitly observe-only.
- [x] Confirm `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_SLUG` belong to the same dedicated App. Provisioning requests repository Secrets write; the live controller separately requests only Actions read, Checks write, Contents write, and Pull requests read. Workflow write is installer-only.
  - Direct readiness reports the GitHub App identity and all controller identity checks configured; the live grant publisher is `changeplane-guard`.
- [x] Mint each short-lived token with phase-specific permissions and constrain it by `repository_ids`; confirm GitHub returns exactly the disposable repository ID, active and unarchived, before provisioning or dispatch.
  - Live canary PR #31 produced an App-authored exact-repository repair push only after the signed grant was claimed; cross-repository and installation-mismatch tests stop before GitHub mutation.
- [ ] Provision `CHANGEPLANE_REPAIR_ENABLED=false` before any secret so interruption or permission failure leaves an inert, safely rerunnable repository configuration.
- [x] Confirm Vercel `CHANGEPLANE_REPAIR_REPOSITORY` exactly equals `CHANGEPLANE_CANARY_REPOSITORY` and both generations are the same positive integer before activation.
  - Direct readiness reports repository scope, installation binding, and generation configured; the live canary passed both repository and generation gates before provider access and clean apply.
- [x] Derive `CHANGEPLANE_CONTROLLER_HMAC_V12` in the v12 credential domain from the independent Vercel controller secret plus the exact installation ID, repository ID, and repository name; never copy the master secret into GitHub, and never accept a legacy-domain signature.
  - Repository-binding and HMAC tamper tests pass, and the live App-signed ledger was accepted only for the disposable canary identity.
- [x] Confirm the repository PS256 public-key map validates the App-signed grant while the private key remains Vercel-only.
  - Live grant Check `88504652456` verified successfully; unknown-key, altered-signature, and replay tests fail closed.
- [x] Reject same-name evidence unless it originates from the policy's expected GitHub App slug.
- [x] Verify expected-App evidence against live GitHub Check Runs in a disposable repository.
  - Managed-v9 canary PR #31 rejected the original failing evidence, accepted only the configured publisher, and published PASS only after the new-head recheck.
- [ ] Exercise a live v13 `merge_group`; record the exact queue revision, GitHub-owned `ChangePlane guard` operational-liveness job and publisher, App-owned begin/complete marker and publisher, and terminal `ChangePlane / guard`; confirm the qualifying Ruleset binds the App guard and every behavioral evidence Check to the expected integration IDs, and that no repair or model request occurs.
- [x] Implement the PS256-signed monotonic ledger primitive intended for the App publisher, campaign-bound two-attempt/15-minute invariant, pinned-key verifier, and inactive workflow kill switch.
- [x] Bind inactive grants to the exact controller SHA, default base ref, policy digest/evaluator version, contract, protected-path denylist, and live pull-request revision; recheck the signed deadline immediately before push.
- [x] Reserve push credentials once in the App-signed ledger, mint only an exact-repository Contents-write token after claim revalidation, keep it in runner temp, and push with force-with-lease so `pull_request synchronize` starts fresh CI.
- [x] Wire ledger publication and dispatch to a dedicated GitHub App installation-token controller outside repository-controlled workflows.
- [x] Prove tampered signature, unknown key, future/expired grant, deadline reset, wrong repository/head/path, third attempt, fork, sequential replay, and concurrent replay all fail closed before provider access in the automated controller suite.
- [x] Record the active Vercel Production deployment's full 40-character source SHA and confirm its first 12 characters equal readiness `release`.
  - Product evidence captured 2026-07-21: Production source `cfd8aeef79e1d612b2fe819b8f77278d8e75845e`, readiness release `cfd8aeef79e1`, GitHub App self-serve enabled, and every repair-controller readiness check true. See `evidence/build-week-product-release.json`.
  - Autonomous runtime evidence captured 2026-07-20: Production source `0e8e093262a175d8ffa8284106c0c62ed2f68f65`, readiness release `0e8e093262a1`, repair enabled/configured with every nested check true. Later evidence-only documentation releases may advance the deployment SHA without changing these runtime bytes.
  - Observe-release evidence captured 2026-07-19: Production source `38d4c4d261ba43df7e6d580b56e797100519526e`, readiness release `38d4c4d261ba`. This is not authorization to reuse that SHA for a later repair install; pin the full active reviewed repair-capable release at activation time.
- [x] Install the v9 managed guard, repair workflow, review plane, assurance memory contract, provider request metadata, and reviewed helpers through upgrade PRs #23, #28, and #30; confirm the workflow runs trusted default-branch helpers and no placeholder, branch, tag, or mixed controller source remains.
- [x] Pin every third-party Action in the installed repair workflows to a reviewed full commit SHA.
- [ ] With both switches false, deploy the complete configuration; confirm readiness remains observe-ready, repair is disabled/unconfigured with only the enabled check false, and `repair`, `repair-claim`, `repair-validate`, and `repair-push-token` each fail closed with `503` before GitHub access.
- [ ] Pass stale-head, expiry, path-boundary, replay, idempotency, fork, and sandbox escape tests in a disposable repository.
- [x] Run the managed-v9 RouteThai synthetic service-window canary end to end: expected-App evidence fails on `7b670f3`, Luna proposes only `routethai/route-planning.js`, the clean apply job creates `e053526`, fresh evidence succeeds, and only then does `ChangePlane / guard` pass with zero human repair commits. See `evidence/changeplane-v9-production-release.json`.
- [x] Exercise the generation and repository kill-switch checks before provider access and again before clean apply in the disposable repair canary. Both gates passed in workflow run `29788370891`.
- [x] Historical v9 activation used repository value `true`. For v12, keep Vercel repair false through the managed upgrade, tombstone the legacy HMAC slot, write the repository marker `managed-v12`, verify exact managed hashes, then deploy the reviewed protected-source commit with the Vercel switch true; stop unless readiness reports repair enabled/configured with every nested check true for the expected release.
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
