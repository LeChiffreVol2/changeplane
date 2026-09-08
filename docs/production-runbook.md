# ChangePlane production runbook

## Managed-v14 candidate boundary

The deployed source baseline is `ddccd7ab7721c28542a0e4a36956cbc307832672`; the current v14 journal candidate is not a deployed customer release. Requested alpha/self-service mode does not grant access. Readiness reports `checks.rolloutAuthorized`, `checks.guardPublicationSerialized`, `checks.commercialRuntimeIntegrated`, `checks.guardJournalConfiguration` and `checks.guardJournalConfigured`; session provides a static `accessBlock` reason and one next action when customer access is paused. Serialization and commercial-runtime capabilities remain false in code, and no environment variable can override them.

The source now wraps begin, completion and reconciliation in a candidate PostgreSQL authority journal with durable exclusive ownership, no expiry takeover, and held/poisoned lanes after uncertain writes. Every `VERCEL=1` Guard write requires it, including owner-canary publication. Missing, disabled, invalid, unavailable or unenrolled journal authority stops the write; there is no unjournaled fallback. Do not promote this candidate before the dedicated database and a separate new Guard App are enrolled for its exact release and epoch.

Journal configuration requires enabled `true`, a distinct Guard App, a PostgreSQL URL whose only query pair is `sslmode=verify-full`, an epoch UUID, and a verified 40-character SHA matching the current protected source. Duplicate/extra URL options, fragments and encoded hosts are rejected. Invalid required configuration makes readiness return `configuration_required` with `guardJournalConfiguration: false` and `guardJournalConfigured: false`. Successful configuration performs no database connection or enrollment/health/durability probe; it is not evidence of zero-loss recovery or live serialization.

All external customer routes remain closed pending live journal topology, durability and concurrent begin/complete/reconcile canary evidence. After technical proof, alpha additionally requires exact-release legal approval, a distinct Guard App and a valid explicit allowlist. Hosted self-service also requires actual commercial ingestion and entitlement enforcement. Legal entity details and agreements remain unresolved drafts, and no live journal database has been provisioned or deployed. See [architecture and release blockers](automated-sdlc-architecture.md) and the [journal operating design](guard-publication-journal.md).

Both v14 installed profiles include the five-minute scheduled/manual reconciliation sweep and preserve their v13 profile during a reviewed upgrade. Scheduled and administrator recovery select the budget from validated managed policy on the current exact default-branch revision; a caller cannot choose a shorter mode. Verify and Observe become eligible for recovery at five minutes only when the exact owning workflow run attempt is independently verified terminal in GitHub. Running or unverifiable owners retain the conservative 25-minute fallback, as do Autonomous mode and helper calls without trusted mode context. Omitted policy harness settings retain the existing Observe default; owning-run completion is still required for early recovery. A timed-out Guard becomes `action_required`; the workflow fails to support GitHub failed-workflow notifications, which the owner must separately enable and test.

A human-reviewed change from Autonomous to Verify or Observe can revoke an in-flight repair's old authority: the repair controller compares the live policy digest with the signed authority before mutation. Recovery then follows the new trusted mode and verifies owning-run completion before using its shorter window. The immutable 15-minute campaign and 25-minute fallback are upper limits, not an entitlement to continue processing after authority is revoked.

For Verify and Observe whose owning run has already ended, the next five-minute sweep aims to close a stalled Guard between five and ten minutes after it starts. A healthy evaluation may run up to its existing ten-minute job limit and is not terminated by the early recovery rule. Later run completion, GitHub scheduling delay, outages and rate limits can extend recovery beyond ten minutes. Recovery cannot take over an occupied or poisoned journal lane. Record actual recovery latency and failed-run notification delivery in a protected live canary before claiming the ten-minute service target; the schedule and deterministic budget tests establish no ten-minute SLA. Live journal serialization and durability remain independent customer-release blockers.

## Supported boundary

The deployed managed-v13 baseline supports reviewed GitHub.com repository setup in `observe`, `verify`, or bounded `autonomous` mode and is protected-canary proven only for the exact revisions in `evidence/changeplane-v13-production-release.json`. The current source candidate adds the authority journal and later trust/commercial-readiness contracts but does not inherit that deployment proof. Requested customer rollout remains visible and closed until its independent technical and exact-release legal gates pass. GitHub remains the source of truth, audit surface, and merge authority; the deployed baseline has no managed commercial database, queue, merge service, or proprietary agent runtime.

Verify Lite is the default managed-v13 profile. It installs nine reviewed files, requires one exact behavioral Check and expected publisher, and maps to the blocking-capable dedicated-App assurance gate with repair dispatch and model-backed review absent. Its payload and workflow receive no provider key, repair webhook, controller HMAC, or controller installation credential and never mutate repository contents. The customer's coding agent owns repair and a new commit invalidates the previous decision.

Call Strict Head active only when runtime readiness reports `harness.enforcement.assuranceLevel: strict_head`; call Queue Certified active only for `queue_certified`. Both require one independently complete active default-branch Ruleset with no bypass actors, strict up-to-date checks, and publisher-bound Guard and behavioral evidence Checks. Queue Certified additionally requires Merge Queue. Ruleset ambiguity, bypasses, unsupported targeting, controls split across Rulesets, missing or misbound Checks, and malformed responses fail closed. Classic branch protection is insufficient. The GitHub-owned `ChangePlane guard` job is operational liveness only. The Installer App may apply only a freshly revalidated digest-bound plan after repository-admin approval.

Runtime readiness also returns a derived `sdlc` posture. Use it to explain which lifecycle controls are present; never use it as a substitute for the live exact-head `ChangePlane / guard`, the applicable GitHub rule, or production observability. `sdlc.authority.contributesToPass` must remain `false`, Delivery must remain informational and exact-SHA-only, Merge must remain owned by GitHub, and Operate must remain external until a separately reviewed production-observation capability exists.

Autonomous is a controlled beta and uses the 21-file Full profile. It requires an installed Verify Lite profile, the repository-scoped Installer App with Administration write, a repository admin, Queue Certified assurance, one exact behavioral Check and publisher, verified BYOK, and a separate reviewed authority-expansion pull request. A fresh repository cannot install Full directly. A `github-actions` evidence Check in Verify or Autonomous must also bind its exact `.github/workflows/*.yml` or `.yaml` path. Merge Queue evaluates its own exact revision and never invokes model or repair work. Autonomous allows only two attempts inside an immutable 15-minute campaign; protected, ambiguous, stale, provider-failed, or exhausted work stops for a human. `ChangePlane Managed` is a disabled reservation; a successful OpenAI adapter canary is not managed execution or billing.

The managed policy treats tests, evidence configuration, dependency manifests, and `evidence.protectedPaths` as human-review controls. Never remove the immutable defaults to make an autonomous repair pass. If a repository needs a different evidence boundary, add exact paths through a reviewed `.changeplane.json` configuration pull request; the defaults remain additive.

The Full profile also provides `ChangePlane / review`, repository-owned assurance memory, vendor-neutral agent handback, exact-head preview receipts, and exact-`merge_group` guard evaluation. Verify Lite intentionally omits the standalone review, provider, proposal, ledger, controller, and repair-workflow files while retaining deterministic findings for agent handback. Model-backed findings run only in Full when repository BYOK exists; without it, the review Check remains neutral and makes no model call. Merge Queue evaluation never dispatches repair or a model in either profile.

The current preparation phase has a USD 0 spending limit; the USD 100 ceiling is reserved for later scale. Vercel Hobby is restricted to personal, non-commercial use, so completing free engineering qualification does not authorize customer rollout. `CHANGEPLANE_SELF_SERVE_ENABLED=true` requests GitHub App onboarding but cannot override this candidate's customer capability gates. Keep the disposable repository as the controlled public release canary; its Guard writes also require journal enrollment. Never substitute the private RouteThai production installation for public QA or evidence capture. RouteThai is a separately operated production use case. Hosting-plan changes remain deferred. See the [phase budget](operating-budget.md) and [Vercel Hobby eligibility](https://vercel.com/docs/plans/hobby).

The ChangePlane source repository must keep its protected-`main` CI release gate. The private disposable canary on GitHub Free cannot enable branch protection; GitHub returns an upgrade-or-public requirement. That repository is limited to owner-controlled lab evidence with a manually reviewed setup pull request and no direct pushes by procedure. It cannot prove production enforcement, become a customer merge gate, or waive the protected-source release gate. Do not change its visibility or hosting phase to work around this limit. See [GitHub protected branch availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Managed v13 profiles

| Profile | Setup files | Model/provider path | Repair authority | Intended use |
| --- | ---: | --- | --- | --- |
| `verify-lite` | 9 | None | None | Default exact-head Verify or scope-only Observe |
| `full` | 21 | Repository BYOK | Separately credentialed controller | Autonomous controlled beta |

Both profiles carry a schema-v2 manifest with the exact managed hashes and profile name. Treat a profile change as an authority change. Verify Lite to Full must create and merge a protected expansion pull request before autonomous readiness can become active; never synthesize missing Full files at runtime or write them directly to the default branch. A Full-to-Lite contraction is not an automatic cleanup path in this candidate.

Managed payload v13 preserves the existing v12 repair credential domain. Full therefore continues to use `CHANGEPLANE_CONTROLLER_HMAC_V12` and the exact `managed-v12` repository activation marker. This is intentional domain stability, not evidence that the installed payload is v12; the schema-v2 manifest is the payload-version source of truth.

### Recovering a v11 or v12 evidence policy

When an otherwise pristine v11/v12 enforce policy names a `github-actions` evidence Check without the exact workflow path required by v13, preflight must classify it as a recovery upgrade. Do not preserve Autonomous or leave the installation unusable. A current repository administrator must choose the exact Check name, publisher, and `.github/workflows/*.yml` or `.yaml` path. ChangePlane creates one protected, human-reviewed upgrade pull request and includes `.changeplane.json` only for this required policy repair; a compliant upgrade leaves policy out.

Recovery defaults to Verify. Scope-only Observe is available only when the owner explicitly selects it. The migration never provisions a provider key, repair webhook, controller HMAC, controller installation ID, or autonomous worker switch. After merge, the owner must replace any legacy branch-policy binding that treated the `github-actions` publisher of `ChangePlane / guard` as authoritative. V13 guard authority belongs only to the dedicated ChangePlane App in the qualifying Ruleset; `ChangePlane guard` remains operational liveness.

## Dedicated-App guard lifecycle

Treat the two Check names as different signals:

| Signal | Owner | Purpose | Safe terminal condition |
| --- | --- | --- | --- |
| `ChangePlane guard` | GitHub Actions | Operational liveness for the trusted managed job; not merge authority. | The workflow job succeeds for the current exact revision. |
| `ChangePlane / guard` | Dedicated ChangePlane GitHub App | Carries the ordered exact-head assurance result and passport and is the ChangePlane authority required by the Ruleset. | The same OIDC-authenticated run and attempt that began the lifecycle completes the stable App Check after fresh validation. |

The App lifecycle starts before mutable decision inputs are evaluated. The begin request authenticates the exact repository, default-branch workflow path and SHA, event, ref, run ID, attempt, and current target. It creates or patches one stable Check identity for the repository, target type, and head SHA to `in_progress`, and supersedes older successful App Checks for that exact head. Do not treat an older completed App Check as current while a new evaluation is running or failed.

Completion may update only that stable Check and only when its ordered begin marker belongs to the same run ID and attempt. Immediately before mutation, the publisher re-fetches the trusted managed tree, policy, pull-request or merge-group target, and latest eligible evidence on the exact head. Evidence from `github-actions` must resolve through its canonical GitHub Actions run to the exact workflow path declared in trusted policy. A later run or attempt owns the lease; stale completion, missing begin, target drift, policy drift, malformed markers, a newer eligible evidence run, and publisher or workflow mismatch all fail closed. The service uses separate one-repository read-only and `checks:write` installation tokens and stores no lifecycle database.

Require the Guard-App `ChangePlane / guard` and every configured behavioral evidence Check with its expected integration ID in one strict, no-bypass default-branch Ruleset. Add Merge Queue for Queue Certified. A missing, `in_progress`, or non-successful App guard blocks. `ChangePlane guard` remains useful operational telemetry and carries no merge authority. The Installer App may create only the exact plan a repository administrator approved.

This lifecycle is deployed and protected-canary proven for exact-head success, stale-head re-evaluation, and protected-test refusal in managed v13; see `evidence/changeplane-v13-production-release.json`. The canary's active no-bypass Ruleset binds both required Checks to their integration IDs and supplies the live facts required for Strict Head. Queue Certified remains unproven because a personal-account repository cannot enable GitHub Merge Queue. Historical v9 records used a legacy `github-actions` guard and do not prove either the v13 dedicated publisher or Queue Certified.

## Delivery path

GitHub Actions is the code gate. The single `CI / verify` job installs from `package-lock.json`, asserts that no other workflow is active, runs tests (including the readiness contract), builds, runs the localhost-only Chromium onboarding suite, audits production dependencies, and serves the built UI on runner-local `127.0.0.1` for a smoke request. It has read-only repository permission, immutable action SHAs, one stale-run-canceling concurrency lane, a 12-minute timeout, and no artifacts or production network calls.

Each installed managed workflow has a separate five-minute reconciliation trigger and manual dispatch inside the same reviewed workflow file. A healthy run reports the number of open exact heads, in-progress Guards, safe timeout closures, and Guards still inside the window without returning repository names or source. A failed scheduled run is an operational alert: inspect the Actions run and request ID, keep Repair off, and do not weaken the required Guard. Run the manual dispatch during activation and rollback drills. The scheduler is best effort and its observed delay must be included in the monthly pilot report; it is not evidence of a contractual ten-minute SLA.

Vercel's Git integration is the deployment path; do not add a second token-bearing deploy workflow. Pull-request commits create Preview deployments and protected `main` creates Production deployments. Protect `main`, require `CI / verify`, and prohibit direct pushes and bypasses so Vercel cannot receive an unverified production commit. `vercel.json` fixes the install, build, output, and 60-second function ceiling used by this phase.

CI intentionally does not call a Vercel deployment. Before merge, use the same-repository Vercel Preview to prove the exact pull-request head builds, serves the root with security headers, and keeps every GitHub/OpenAI route fail-closed. Preview deployments must not receive production connector credentials or provider keys and can never satisfy protected-source provenance.

## Configuration and secret inventory

| Name | Location and scope | Secret | Owner / rotation effect |
| --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | Vercel Production only | No | Connector owner; rotate with the paired GitHub credential. |
| `GITHUB_CLIENT_SECRET` | Vercel Production only | Yes | Connector owner; revoke/rotate in GitHub after suspected disclosure. |
| `GITHUB_APP_SLUG` | Vercel Production only | No | Connector owner; unset means the explicitly limited OAuth observe fallback. |
| `CHANGEPLANE_GUARD_REUSE_GITHUB_APP` | Historical shared-principal migration setting | No | A shared Installer/Guard App cannot satisfy the journal candidate's hosted configuration, including the owner canary. Keep false and supply a distinct new Guard App before promotion. |
| `CHANGEPLANE_GUARD_APP_ID` | Vercel Production only | No | Guard-publisher owner; positive ID of the distinct Guard App. Its only write authority is Checks; repository, policy, workflow, and pull-request inputs are read-only. Reuse keeps paid readiness closed. |
| `CHANGEPLANE_GUARD_APP_SLUG` | Vercel Production only | No | Guard-publisher owner; exact lowercase slug paired with the guard App ID. `github-actions` is rejected. |
| `CHANGEPLANE_GUARD_APP_PRIVATE_KEY` | Vercel Production only | Yes | Guard-publisher owner; rotate after suspected disclosure and redeploy. Never expose to a workflow or repository secret and never share it with the Installer or Repair Controller App. |
| `CHANGEPLANE_GUARD_JOURNAL_ENABLED` | Vercel Production; mandatory for all Guard writes | No | Exact `true`; missing/false stops publication and never enables a legacy fallback. |
| `CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL` | Vercel Production only; dedicated authority database | Yes | PostgreSQL URL with exactly one query pair, `sslmode=verify-full`; no extra/duplicate options, fragment, or encoded host. Use the reviewed least-privilege runtime role; never log or return the URL. |
| `CHANGEPLANE_GUARD_JOURNAL_CA_CERT` | Vercel Production only; authority database pool | No, public trust material | Optional multiline PEM bundle of 1–4 CA certificates, at most 16 KiB, obtained through the selected provider's authenticated dashboard or verified official source. Omit for Node's trust roots. Empty/malformed values, leaf certificates, appended data, paths and URLs fail configuration. Never supply a private key. |
| `CHANGEPLANE_GUARD_JOURNAL_EPOCH` | Vercel Production and database enrollment | No | Exact enrollment UUID; rotation never clears occupied authority or fences an already-dispatched GitHub write. |
| `CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE` | Vercel Production and database enrollment | No | Exact 40-character protected source SHA matching `VERCEL_GIT_COMMIT_SHA`. This attestation is not a database-health or live-durability probe. |
| `CHANGEPLANE_COMMERCIAL_STORE_ENABLED` | Vercel Production only | No | Requests the separate candidate commercial store after its own migration/retention/budget drills. It does not connect the missing commercial ingestion runtime or satisfy journal requirements. |
| `CHANGEPLANE_DATABASE_URL` | Vercel Production only; separate candidate commercial store | Yes | Commercial PostgreSQL connection with the sole URL option `sslmode=verify-full`; it cannot configure or replace the authority journal. Rotate through the database provider and never log or return it. |
| `CHANGEPLANE_DATABASE_CA_CERT` | Vercel Production only; commercial database pool | No, public trust material | Optional provider CA bundle under the same validation rules as the journal CA, independently scoped. It does not share database credentials or grant Guard authority. |
| `CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE` | Vercel Production only | No | Exact 40-character protected Production source SHA that passed migration, forced-RLS tenant isolation, restore, deletion, credential-rotation, and cost-control drills. Must equal `VERCEL_GIT_COMMIT_SHA` for `commercialReady`. |
| `CHANGEPLANE_LEGAL_RELEASE_APPROVED` | Vercel Production only | No | Exact `true` only after Terms, Privacy, AUP, subprocessor, security, retention, and deletion materials are reviewed. |
| `CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE` | Vercel Production only | No | Exact protected Production source SHA reviewed for the legal release. Must equal `VERCEL_GIT_COMMIT_SHA`; a prior-release approval fails closed. |
| `CHANGEPLANE_SELF_SERVE_ENABLED` | Vercel Production | No | Release owner; `true` requests repository-scoped onboarding but does not override serialization, legal, principal or commercial-runtime gates. |
| `CHANGEPLANE_SESSION_SECRET` | Vercel Production; independent value per environment | Yes | ChangePlane owner; rotation invalidates every session in that environment. |
| `CHANGEPLANE_APP_ORIGIN` | Vercel Production; exact HTTPS origin, no path or trailing slash | No | ChangePlane owner; update with domain or callback changes. |
| `CHANGEPLANE_CANARY_REPOSITORY` | Vercel Production; exact disposable `owner/repository` | No | Repair owner; target used only when rollout mode is `controlled_canary`. |
| `CHANGEPLANE_ALPHA_REPOSITORIES_JSON` | Vercel Production; JSON array of 1–5 exact `owner/repository` values | No | Invite-only Verify Lite + Strict Head scope, normally one repository per accepted design-partner organization. Every repository and Guard request outside the list fails before mutation. Leave unset during the release-owner canary. |
| `CHANGEPLANE_REPAIR_REPOSITORY` | Vercel Production; exact disposable `owner/repository` | No | Repair owner; required to match the canary only in `controlled_canary` mode. Self-serve authority is verified-installation scoped. |
| `CHANGEPLANE_REPAIR_ENABLED` | Vercel Production | No | Repair owner; keep `false` until activation, restore `false` for containment, then redeploy. |
| `CHANGEPLANE_REPAIR_GENERATION` | Vercel Production; positive integer | No | Repair owner; advance to invalidate grants during rollback or compromise containment. |
| `GITHUB_APP_ID` | Vercel Production; dedicated repair-publisher App | No | GitHub App owner; must identify the same App as `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY`. |
| `GITHUB_APP_PRIVATE_KEY` | Vercel Production only | Yes | GitHub App owner; rotate in GitHub after suspected disclosure and redeploy. Never expose to a workflow. |
| `CHANGEPLANE_CONTROLLER_SECRET` | Vercel Production only; independent 32+ character master | Yes | Repair owner; derives repository-bound HMACs. Rotation requires reprovisioning each repository HMAC. |
| `CHANGEPLANE_MANAGED_OPENAI_API_KEY` | Vercel Production only, private canary only | Yes | Provider owner; omit unless the private verification canary is approved. Never copy to a repository. |
| `CHANGEPLANE_LOG_REQUESTS` | Vercel environment configuration | No | ChangePlane owner; `true` enables structured, redacted request metadata. |
| `CHANGEPLANE_CONTROLLER_INSTALLATION_ID` | Connected repository Actions Secret | Yes | GitHub App owner; positive installation ID for the exact repository-scoped App installation. |
| `CHANGEPLANE_REPAIR_ENABLED` | Connected repository Actions Secret | Yes | Repair owner; independent worker kill switch. It is written `false` before other authority and then set only to the retained repair-domain activation marker `managed-v12` after complete Full-profile provisioning and fresh authorization checks. Managed payload v13 intentionally does not rotate this credential domain. |
| `CHANGEPLANE_REPAIR_GENERATION` | Connected repository Actions Secret | Yes | Repair owner; must equal the active Vercel generation. |
| `CHANGEPLANE_REPAIR_PUBLIC_KEYS` | Connected repository Actions Secret | Yes | GitHub App owner; JSON map from the pinned PS256 key ID to its SPKI public key. |
| `CHANGEPLANE_CONTROLLER_HMAC_V12` | Connected repository Actions Secret | Yes | Repair owner; v12-domain repository-bound derived secret, never the Vercel master secret. V11 and earlier cannot read this name. Rotate with the controller master, a repair credential-domain change, or repository/App identity. |
| `CHANGEPLANE_CONTROLLER_HMAC` | Connected repository Actions Secret | No | Legacy credential slot. Full-profile provisioning overwrites it with a non-secret tombstone before writing the v12-domain credential; never restore a legacy HMAC. |
| `OPENAI_API_KEY` | Connected repository Actions Secret | Yes | Repository owner; verified BYOK for bounded repair proposals and advisory review in Full. Omit for Verify Lite and Observe. |
| `GITHUB_TOKEN` | GitHub Actions job, issued automatically | Yes | GitHub; ephemeral and read-only in the apply job. Never use it for a repair push because GitHub suppresses fresh workflow triggers. |
| One-time repair push token | Trusted apply job runner temp only | Yes | GitHub App installation token; exact repository and Contents write only. Mint after signed claim validation, use only for force-with-lease push, then delete on every exit. |

`VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_PROVIDER`, `VERCEL_GIT_REPO_OWNER`, `VERCEL_GIT_REPO_SLUG`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_DEPLOYMENT_ID`, and `VERCEL_URL` are Vercel-provided metadata, not operator secrets. A Vercel release is ready only when it is the `production` environment, comes from GitHub repository `LeChiffreVol2/changeplane` on `main`, carries a valid 40-character source commit, and reports `checks.guardPublisher: true`; readiness reports the source SHA's first 12 characters. CLI source uploads, preview/branch deployments, and deployments without a configured dedicated guard App therefore keep onboarding or repository mutation closed. An emergency Vercel redeploy of an existing attributed Git production deployment may apply a closed kill-switch value only when the new deployment retains the exact original Git metadata and readiness still reports that protected source. A deployment ID may still appear as diagnostic metadata when Git provenance is missing, but readiness returns `503`. Record an owner and last-rotation date for each real secret outside the repository. Never put secret values in tickets, release notes, shell history, screenshots, or this file.

## Release and readiness

1. Complete `docs/release-checklist.md`. The release owner records the commit SHA, Vercel deployment ID, connector mode, CI run URL, rollback target, and approver.
2. Confirm from Vercel deployment metadata that the Preview is built from the pull request's exact head SHA. Preview receives no connector, provider, session, or controller secrets.
3. Check the Preview root and API fail-closed contract, never Production, before merge. The root must serve with the security headers; readiness must return `503` with `checks.sourceProvenance: false`; and an external connector route must return `503` before GitHub access:

   ```sh
   trusted_preview="https://REPLACE_WITH_TRUSTED_PREVIEW"
   readiness_headers="$(mktemp)"
   trap 'rm -f "$readiness_headers"' EXIT

   root_headers="$(curl --fail --silent --show-error --dump-header - --output /dev/null "${trusted_preview}/")"
   printf '%s' "$root_headers" | grep -qi '^content-security-policy:'
   printf '%s' "$root_headers" | grep -qi '^x-content-type-options: nosniff'
   printf '%s' "$root_headers" | grep -qi '^x-frame-options: DENY'

   readiness_status="$(curl --silent --show-error --dump-header "$readiness_headers" --output /tmp/changeplane-preview-readiness.json --write-out '%{http_code}' \
     "${trusted_preview}/api/github?action=readiness")"
   test "$readiness_status" = "503"
   node -e 'const fs = require("node:fs"); const result = JSON.parse(fs.readFileSync("/tmp/changeplane-preview-readiness.json", "utf8")); if (result.status !== "configuration_required" || result.checks?.sourceProvenance !== false) process.exit(1);'
   grep -qi '^cache-control: no-store' "$readiness_headers"
   grep -qi '^x-request-id:' "$readiness_headers"

   connector_status="$(curl --silent --show-error --output /tmp/changeplane-preview-connector.json --write-out '%{http_code}' \
     "${trusted_preview}/api/github?action=repos")"
   test "$connector_status" = "503"
   ```

   A Preview readiness `200`, a connector response other than `503`, malformed redacted metadata, or missing security headers blocks the release. Remove the two temporary JSON files after the check. A Preview can prove build integrity and denial behavior only; it cannot prove Production connector readiness.
4. Merge only after the required GitHub check passes. Confirm the resulting Vercel Production deployment source is the protected `main` SHA.
5. After deployment, make one read-only Production readiness request. First complete a protected disposable-repository Verify Lite run without BYOK and prove the nine-file manifest, qualifying Ruleset with its Guard App and publisher-bound evidence Checks, the begin transition to `in_progress`, latest-generation completion, older-generation rejection, same-SHA fresh rerun, latest workflow-bound exact-head evidence, and failed-evidence handback. Then, as a separate controlled-beta gate, expand that installation to Full through a protected pull request and complete one autonomous run from failed evidence through the same Guard-App lifecycle on a fresh head. Stop if any payload hash, App-signed grant, ordered marker, clean apply, synchronize event, evidence freshness check, or recheck differs from the verified Preview contract.
6. Keep the immediately previous known-good Production deployment available for rollback.

## Autonomous harness activation

The repair controller remains fail-closed unless every setting and live identity agrees. Separate installation authority by phase: the provisioning token requests repository Secrets write; the live controller token requests only Actions read, Checks write, Contents write, and Pull requests read. Workflow write is installer-only for the reviewed setup or expansion pull request and is absent from the live controller token. Before provisioning, require a repository admin and strict up-to-date branch policy, then recheck both immediately before activation. Before provisioning or dispatching, mint a short-lived installation token constrained by `repository_ids` and confirm GitHub returns exactly that repository ID.

1. Record the reviewed Production deployment's full 40-character Git source SHA. Confirm its first 12 characters equal the readiness `release` value.
2. Confirm the Installer App installation has `administration: write` and the Guard App is a distinct principal whose only write authority is Checks. Require the selected user to remain a repository admin. Activate Strict Head from one strict, no-bypass publisher-bound Ruleset; require Queue Certified before Autonomous. Classic branch protection and the GitHub-owned `ChangePlane guard` liveness job cannot satisfy this gate.
3. From an installed Verify Lite profile with the qualifying gate active, create one manually reviewed Verify-Lite-to-Full expansion pull request for the 21-file managed-v13 Full profile, including the guard, repair workflow, and reviewed helpers. The workflows execute only the exact live default-branch controller revision and treat the pull-request checkout as data. Reject repository-owned modifications to reserved managed bytes rather than overwriting them.
4. Configure the positive generation, App ID/private key, and independent controller master secret with Vercel `CHANGEPLANE_REPAIR_ENABLED=false`. With a token constrained to the exact repository plus Secrets write, store the repository worker switch as `false` first, overwrite the legacy `CHANGEPLANE_CONTROLLER_HMAC` slot with its non-secret tombstone, then store the installation ID, identical generation, PS256 public-key map, v12-domain `CHANGEPLANE_CONTROLLER_HMAC_V12`, and verified `OPENAI_API_KEY`. Recheck repository identity/admin and strict branch policy, then write only the retained repair-domain activation marker `managed-v12`. A partial run remains disabled and safe to rerun; v11 and earlier workflows know neither this marker nor the v12 credential name while the Full expansion pull request is pending.
5. Merge the managed setup, upgrade, or expansion pull request while the Vercel controller switch remains false. Verify the default branch now contains the exact schema-v2, managed-v13 Full manifest and hashes; rerun setup if needed so the repository marker is `managed-v12`.
6. Deploy the reviewed disabled configuration. Readiness must remain observe-ready while reporting repair `enabled: false`, `configured: false`; its nested checks must identify only the disabled switch as false. Empty or malformed requests to `repair`, `repair-claim`, `repair-validate`, and `repair-push-token` must return `503` without GitHub access.
7. Before activation, verify the exact App identity, repository-scoped token, workflow sandbox, pinned release, strict branch policy, and static fail-closed coverage for replay, stale heads, path boundaries, and the attempt/deadline budget. The workflow's model-proposal job has no forge write permission and cannot publish `PASS`.
8. Change the Vercel switch to `true` and deploy only the reviewed protected-source commit. Do not replace the repository marker with the legacy value `true`. Stop unless readiness reports `repairController.enabled: true`, `configured: true`, and every nested repair check true for the expected release.
9. Run one deterministic scope-repair canary first. Require that live run to create and anchor the App-signed generation-bound ledger and prove replay denial, stale-head denial, path boundaries, and the attempt/deadline budget. Treat GitHub Actions receipt comments as audit output only; they never authorize controller repair or contract continuation. Add the verified provider secret and run evidence repair only after the scope path and kill switch have passed. Never reuse the stale observe pull request as repair evidence.

The canary provisioner is intentionally target-agnostic and refuses the historical private GitHub Free canary. Supply an eligible disposable repository with one qualifying Ruleset, its numeric repository and installation IDs, the dedicated guard App ID, every expected evidence integration binding, an administrator's short-lived GitHub token through `CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH`, and the App/controller secrets through absolute file paths. Run first with `CHANGEPLANE_ENABLE_REPAIR=false`; merge and verify the managed-v13 Full setup or expansion; only then rerun with the provider-key path and `CHANGEPLANE_ENABLE_REPAIR=true`. The script proves human admin, App repository identity, and the exact qualifying Ruleset both before any secret write and immediately before `managed-v12` activation. Never pass secret values directly on the command line.

The operator contract for `node scripts/provision-repair-canary.mjs` is:

| Input | Requirement |
| --- | --- |
| `CHANGEPLANE_GITHUB_APP_ID` | Positive App ID for the reviewed production GitHub App. |
| `CHANGEPLANE_GUARD_APP_ID` | Positive integration ID for the dedicated ChangePlane guard App required by the qualifying Ruleset. |
| `CHANGEPLANE_CANARY_REPOSITORY` | Exact eligible disposable `owner/repository`; never the historical Free canary. |
| `CHANGEPLANE_CANARY_REPOSITORY_ID` | Positive numeric ID for that exact repository. |
| `CHANGEPLANE_CANARY_INSTALLATION_ID` | Positive installation ID scoped to that exact repository. |
| `CHANGEPLANE_CANARY_EVIDENCE_CHECKS_JSON` | JSON array of 1–100 unique `{ "name", "integrationId" }` bindings for every behavioral evidence Check required by that same Ruleset. |
| `CHANGEPLANE_REPAIR_GENERATION` | Positive integer exactly equal to the active Vercel generation; never reset it to an older value. |
| `CHANGEPLANE_GITHUB_APP_PRIVATE_KEY_PATH` | Absolute path to the App private-key file. |
| `CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH` | Absolute path to a short-lived token for a current human repository admin. |
| `CHANGEPLANE_CONTROLLER_SECRET_PATH` | Absolute path to the active controller master-secret file. |
| `CHANGEPLANE_ENABLE_REPAIR` | Exact `false` for inert provisioning, or `true` only after the managed-v13 Full merge and verification gates pass. |
| `CHANGEPLANE_OPENAI_KEY_PATH` | Absolute provider-key path; required whenever repair is enabled and otherwise optional. |

Export only these identifiers, booleans, positive numbers, and absolute secret-file paths in the operator shell; keep the secret values inside their files. The JSON result records the non-secret repository, installation ID, generation, key ID, and configuration booleans for the evidence record.

The private GitHub Free canary has no enforceable branch protection. A human owner must review and merge the workflow setup PR, keep all direct pushes prohibited by procedure, and treat every result as controlled lab evidence only. Do not describe this path as customer-ready production repair.

## Review, handback, preview, and Merge Queue operations

- Keep `.changeplane/assurance.md` in the protected setup/configuration pull-request path. Review its invariants and policy-pack guidance like code; never accept a generated memory change directly on the default branch.
- Run `ChangePlane / review` only when `OPENAI_API_KEY` is configured. Confirm findings point to changed lines, remain within the configured cap, and carry the evaluated head. A missing key skips advisory review and must not weaken or fail the guard.
- Treat every agent handback Action output or receipt payload as a finding envelope, not an authorization token. Consumers must re-read the current head before acting; stale findings are discarded.
- Treat `assurance_passport` as portable evidence, not portable authority. Recompute its domain-separated digest for local integrity, then use the live verifier to require the exact-head `ChangePlane / guard` from the configured dedicated App, matching completed run marker, passport marker and locator digest, compatible conclusion, trusted policy digest, latest policy-bound evidence publishers, and the current pull-request revision. Separately confirm readiness proves one qualifying Ruleset binds that guard and every behavioral evidence Check to the expected integration IDs; the proof locator alone does not establish merge enforcement. Never accept an offline passport as approval, repair authorization, or proof that a PR is still current.
- Include an existing preview in the receipt only after its GitHub Deployment SHA equals the evaluated head. Omit stale, missing, or unverifiable preview URLs.
- On `merge_group`, run the GitHub-owned `ChangePlane guard` operational-liveness job and have the dedicated App begin then complete `ChangePlane / guard` for the same authenticated queue run and attempt. The qualifying Ruleset treats only the dedicated-App guard and bound behavioral evidence as authority. Do not run review, proposal, repair, apply, or handback jobs for the queue event. A new merge-group SHA requires a new lifecycle and decision.

### Repair kill switch and rollback

Containment is repository-first because it does not wait for a Vercel deployment:

1. Replace the repository Actions Secret `CHANGEPLANE_REPAIR_ENABLED` with `false` and cancel active repair workflow runs. Do not delete ledger refs or artifacts; preserve them as evidence.
2. Set Vercel `CHANGEPLANE_REPAIR_ENABLED=false`, advance `CHANGEPLANE_REPAIR_GENERATION` to a new positive integer, and deploy a reviewed disabled source commit. Mirror the new generation to the repository while leaving its worker switch false.
3. Confirm readiness reports repair disabled and unconfigured, and confirm all four repair endpoints return `503` before GitHub mutation or provider access. A normal observe readiness `200` does not mean repair is enabled.
4. If identity or secret material may be compromised, revoke/rotate the GitHub App private key, controller master secret and derived repository HMAC, and provider key before any retry.
5. Do not use Instant Rollback alone as a repair kill switch: a prior deployment may carry an enabled repair configuration. Keep the repository switch false through rollback, then deploy and verify a disabled configuration.

## Logs, signals, and free-tier controls

Production request logs are structured JSON with a ChangePlane request ID, route, method, status, duration, and upstream GitHub status/request ID when available. Request bodies, cookies, OAuth tokens, repository names, provider keys, and upstream response bodies must never be logged. Any secret or repository identifier in logs is a security incident.

There is no external log drain, synthetic monitor, pager, or claimed 24/7 alerting in this release. GitHub Checks/comments are the durable decision record. Vercel runtime logs are short-lived, so the release owner watches them during onboarding and captures only redacted request IDs and timestamps needed for an incident record. Treat these observed conditions as incidents:

- Readiness returns non-`200` twice in succession.
- GitHub returns `429` or repeated `5xx`, or authorization callbacks fail repeatedly.
- An eligible pull request has no observe receipt within 15 minutes.
- Either required ChangePlane Check is missing, attached to an unexpected publisher, or remains non-terminal beyond the managed job timeout; an App Check that stays `in_progress` after a failed job is a safe block but still needs operator investigation.
- A Vercel quota notice, paused project, unexpected function timeout, or production `5xx` occurs.

Before any public onboarding, publish one Vercel WAF fixed-window rate-limit rule for `/api/github`, keyed by source IP, returning `429`. Choose and record the threshold, then verify a bounded burst receives `429` while the normal readiness and sign-in paths still work. Treat this dashboard rule as release configuration: record its owner and review it after every route change. See [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

Use the native Vercel Usage page/email notices and GitHub budget notices. The CI job avoids matrices, scheduled runs, artifacts, and custom runners; stale commits are canceled. Keep deployment activity below the current free limits and stop nonessential pushes before a ceiling rather than creating retry churn. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [Vercel limits](https://vercel.com/docs/limits).

Review Vercel usage before each controlled canary and GitHub Actions usage weekly. At 80% of either included allowance, stop new onboarding and nonessential reruns. At exhaustion, fail closed and wait for reset; do not bypass limits with extra accounts. Do not run load tests against Vercel without authorization.

## Incident containment

The founding engineering owner is incident commander until a named on-call rotation exists. Record UTC start time, affected release/deployment, redacted request IDs, observed impact, containment owner, and recovery decision. Do not copy customer repository names or credentials into the incident record.

### Bad deployment

1. Stop onboarding and record the bad deployment ID and exact commit.
2. Use Vercel Instant Rollback to return the production domain to the immediately previous verified deployment available in the current phase.
3. Confirm rollback status, make a read-only readiness request, and inspect only structured redacted logs.
4. Keep automatic production-domain assignment disabled after rollback until the fix passes CI and the Preview build/header/fail-closed checks.
5. Promote the fixed verified deployment and record recovery. Do not rebuild the old commit and call it a rollback.

Instant Rollback restores the previous build configuration; it does not apply newly rotated environment variables. If configuration or a secret is implicated, rotate it and create a new verified deployment instead. See [Vercel rollback behavior](https://vercel.com/docs/deployments/rollback-production-deployment).

### Web session or GitHub authorization compromise

1. Disable new GitHub authorization/onboarding and, if necessary, remove the production domain while containing exposure.
2. Rotate `GITHUB_CLIENT_SECRET` and `CHANGEPLANE_SESSION_SECRET`; redeploy because rollback does not apply new values.
3. Revoke affected GitHub App user authorizations or OAuth fallback authorizations in GitHub. Session-secret rotation does not revoke GitHub tokens.
4. Verify the credential-free Preview build/header/fail-closed contract, deploy, and review redacted Production request IDs.
5. Notify affected design partners before re-enabling onboarding.

### Customer provider-key concern

1. Disconnect BYOK or delete `OPENAI_API_KEY` from the repository's Actions Secrets.
2. Rotate or revoke the key at the provider.
3. Review GitHub audit events for secret updates and workflow runs.
4. Reconnect only after the repository owner confirms the new key and allowed workflows.

ChangePlane cannot recover a provider key because plaintext is never persisted.

### GitHub, provider, or quota outage

1. Stop onboarding and repair experiments; do not loosen readiness or policy gates.
2. Record provider status, relevant upstream request IDs, Vercel usage, and GitHub Actions usage.
3. Let requests fail closed. There is no queue to drain and no polling service to restart.
4. Resume only after the Preview build/header/fail-closed contract and one disposable-repository observe evaluation succeed.

## Repository support handoff

Every connected repository needs one customer repository owner and one ChangePlane owner. Record the installation identity, selected repository boundary, contacts, and rollback decision before onboarding. A handoff is incomplete without access to GitHub authorization revocation, Vercel rollback, provider-key revocation, and the release record.
