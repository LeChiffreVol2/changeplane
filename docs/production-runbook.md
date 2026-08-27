# ChangePlane production runbook

## Supported boundary

This release supports one GitHub.com repository per reviewed setup in `observe`, `verify`, or bounded `autonomous` mode. A returning owner may repeat that setup for repositories across eligible personal and organization App installations. GitHub remains the source of truth, audit surface, and merge authority. ChangePlane has no database, queue, merge service, or proprietary agent runtime to operate.

Verify only requires one exact behavioral Check and expected publisher. It maps to the blocking-capable guard with repair dispatch and model-backed review disabled, receives no provider key, repair webhook, controller HMAC, or controller installation credential, and never mutates repository contents. The customer's coding agent owns repair and a new commit invalidates the previous decision. Call Verify only active enforcement only when runtime readiness reports `harness.enforcement.active: true`, proving strict classic branch protection requires `ChangePlane / guard` from the publisher observed on a live GitHub Check. The installer never mutates branch policy. GitHub ruleset readiness remains outside this release.

Autonomous mode requires the repository-scoped GitHub App with read-only Administration metadata, a repository admin, strict up-to-date required checks, one exact behavioral check and publisher, verified BYOK, and one reviewed setup PR. Merge Queue remains a guard-only exact-revision path and does not replace strict protection for activation. It allows only two attempts inside an immutable 15-minute campaign; protected, ambiguous, stale, provider-failed, or exhausted work stops for a human. `ChangePlane Managed` is a disabled reservation; a successful OpenAI adapter canary is not managed execution or billing.

The managed policy treats tests, evidence configuration, dependency manifests, and `evidence.protectedPaths` as human-review controls. Never remove the immutable defaults to make an autonomous repair pass. If a repository needs a different evidence boundary, add exact paths through a reviewed `.changeplane.json` configuration pull request; the defaults remain additive.

The managed setup also provides `ChangePlane / review`, repository-owned assurance memory, vendor-neutral agent handback, exact-head preview receipts, and exact-`merge_group` guard evaluation. Model-backed findings run only when repository BYOK exists; without it, the review Check remains neutral and makes no model call. Merge Queue evaluation never dispatches repair or a model.

The current Vercel deployment is a fixed free-phase constraint. `CHANGEPLANE_SELF_SERVE_ENABLED=true` opens GitHub App onboarding to eligible personal and organization installations. Keep the disposable repository as the controlled public release canary; never substitute the private RouteThai production installation for public QA or evidence capture. RouteThai is a separately operated production use case. Hosting-plan work remains outside this release. See [Vercel limits](https://vercel.com/docs/limits).

The ChangePlane source repository must keep its protected-`main` CI release gate. The private disposable canary on GitHub Free cannot enable branch protection; GitHub returns an upgrade-or-public requirement. That repository is limited to owner-controlled lab evidence with a manually reviewed setup pull request and no direct pushes by procedure. It cannot prove production enforcement, become a customer merge gate, or waive the protected-source release gate. Do not change its visibility or hosting phase to work around this limit. See [GitHub protected branch availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Delivery path

GitHub Actions is the code gate. The single `CI / verify` job installs from `package-lock.json`, asserts that no other workflow is active, runs tests (including the readiness contract), builds, runs the localhost-only Chromium onboarding suite, audits production dependencies, and serves the built UI on runner-local `127.0.0.1` for a smoke request. It has read-only repository permission, immutable action SHAs, one stale-run-canceling concurrency lane, a 12-minute timeout, and no artifacts or production network calls.

Vercel's Git integration is the deployment path; do not add a second token-bearing deploy workflow. Pull-request commits create Preview deployments and protected `main` creates Production deployments. Protect `main`, require `CI / verify`, and prohibit direct pushes and bypasses so Vercel cannot receive an unverified production commit. `vercel.json` fixes the install, build, output, and 60-second function ceiling used by this phase.

CI intentionally does not call a Vercel deployment. Before merge, use the same-repository Vercel Preview to prove the exact pull-request head builds, serves the root with security headers, and keeps every GitHub/OpenAI route fail-closed. Preview deployments must not receive production connector credentials or provider keys and can never satisfy protected-source provenance.

## Configuration and secret inventory

| Name | Location and scope | Secret | Owner / rotation effect |
| --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | Vercel Production only | No | Connector owner; rotate with the paired GitHub credential. |
| `GITHUB_CLIENT_SECRET` | Vercel Production only | Yes | Connector owner; revoke/rotate in GitHub after suspected disclosure. |
| `GITHUB_APP_SLUG` | Vercel Production only | No | Connector owner; unset means the explicitly limited OAuth observe fallback. |
| `CHANGEPLANE_SELF_SERVE_ENABLED` | Vercel Production | No | Release owner; `true` opens repository-scoped onboarding across eligible personal and organization installations. |
| `CHANGEPLANE_SESSION_SECRET` | Vercel Production; independent value per environment | Yes | ChangePlane owner; rotation invalidates every session in that environment. |
| `CHANGEPLANE_APP_ORIGIN` | Vercel Production; exact HTTPS origin, no path or trailing slash | No | ChangePlane owner; update with domain or callback changes. |
| `CHANGEPLANE_CANARY_REPOSITORY` | Vercel Production; exact disposable `owner/repository` | No | Repair owner; target used only when rollout mode is `controlled_canary`. |
| `CHANGEPLANE_REPAIR_REPOSITORY` | Vercel Production; exact disposable `owner/repository` | No | Repair owner; required to match the canary only in `controlled_canary` mode. Self-serve authority is verified-installation scoped. |
| `CHANGEPLANE_REPAIR_ENABLED` | Vercel Production | No | Repair owner; keep `false` until activation, restore `false` for containment, then redeploy. |
| `CHANGEPLANE_REPAIR_GENERATION` | Vercel Production; positive integer | No | Repair owner; advance to invalidate grants during rollback or compromise containment. |
| `GITHUB_APP_ID` | Vercel Production; dedicated repair-publisher App | No | GitHub App owner; must identify the same App as `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY`. |
| `GITHUB_APP_PRIVATE_KEY` | Vercel Production only | Yes | GitHub App owner; rotate in GitHub after suspected disclosure and redeploy. Never expose to a workflow. |
| `CHANGEPLANE_CONTROLLER_SECRET` | Vercel Production only; independent 32+ character master | Yes | Repair owner; derives repository-bound HMACs. Rotation requires reprovisioning each repository HMAC. |
| `CHANGEPLANE_MANAGED_OPENAI_API_KEY` | Vercel Production only, private canary only | Yes | Provider owner; omit unless the private verification canary is approved. Never copy to a repository. |
| `CHANGEPLANE_LOG_REQUESTS` | Vercel environment configuration | No | ChangePlane owner; `true` enables structured, redacted request metadata. |
| `CHANGEPLANE_CONTROLLER_INSTALLATION_ID` | Connected repository Actions Secret | Yes | GitHub App owner; positive installation ID for the exact repository-scoped App installation. |
| `CHANGEPLANE_REPAIR_ENABLED` | Connected repository Actions Secret | Yes | Repair owner; independent worker kill switch. It is written `false` before other authority and then set only to the exact managed-version activation marker (v12: `managed-v12`) after complete provisioning and fresh authorization checks. |
| `CHANGEPLANE_REPAIR_GENERATION` | Connected repository Actions Secret | Yes | Repair owner; must equal the active Vercel generation. |
| `CHANGEPLANE_REPAIR_PUBLIC_KEYS` | Connected repository Actions Secret | Yes | GitHub App owner; JSON map from the pinned PS256 key ID to its SPKI public key. |
| `CHANGEPLANE_CONTROLLER_HMAC_V12` | Connected repository Actions Secret | Yes | Repair owner; v12-domain repository-bound derived secret, never the Vercel master secret. V11 and earlier cannot read this name. Rotate with the controller master, managed version, or repository/App identity. |
| `CHANGEPLANE_CONTROLLER_HMAC` | Connected repository Actions Secret | No | Legacy credential slot. V12 provisioning overwrites it with a non-secret tombstone before writing the v12 credential; never restore a legacy HMAC. |
| `OPENAI_API_KEY` | Connected repository Actions Secret | Yes | Repository owner; verified BYOK for bounded repair proposals and advisory review. Omit for observe-only assurance. |
| `GITHUB_TOKEN` | GitHub Actions job, issued automatically | Yes | GitHub; ephemeral and read-only in the apply job. Never use it for a repair push because GitHub suppresses fresh workflow triggers. |
| One-time repair push token | Trusted apply job runner temp only | Yes | GitHub App installation token; exact repository and Contents write only. Mint after signed claim validation, use only for force-with-lease push, then delete on every exit. |

`VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_PROVIDER`, `VERCEL_GIT_REPO_OWNER`, `VERCEL_GIT_REPO_SLUG`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_DEPLOYMENT_ID`, and `VERCEL_URL` are Vercel-provided metadata, not operator secrets. A Vercel release is ready only when it is the `production` environment, comes from GitHub repository `LeChiffreVol2/changeplane` on `main`, and carries a valid 40-character source commit; readiness reports its first 12 characters. CLI source uploads and preview/branch deployments therefore keep repository mutation routes disabled even if they contain a Git-looking SHA. An emergency Vercel redeploy of an existing attributed Git production deployment may apply a closed kill-switch value only when the new deployment retains the exact original Git metadata and readiness still reports that protected source. A deployment ID may still appear as diagnostic metadata when Git provenance is missing, but readiness returns `503`. Record an owner and last-rotation date for each real secret outside the repository. Never put secret values in tickets, release notes, shell history, screenshots, or this file.

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
5. After deployment, make one read-only Production readiness request, then complete one disposable-repository autonomous run from failed evidence through a fresh exact-head Check. Stop if the App-signed grant, clean apply, synchronize event, or recheck differs from the verified Preview contract.
6. Keep the immediately previous known-good Production deployment available for rollback.

## Autonomous harness activation

The repair controller remains fail-closed unless every setting and live identity agrees. Separate installation authority by phase: the provisioning token requests repository Secrets write; the live controller token requests only Actions read, Checks write, Contents write, and Pull requests read. Workflow write is installer-only for the reviewed setup PR and is absent from the live controller token. Before provisioning, require a repository admin and strict up-to-date branch protection, then recheck both immediately before activation. Before provisioning or dispatching, mint a short-lived installation token constrained by `repository_ids` and confirm GitHub returns exactly that repository ID.

1. Record the reviewed Production deployment's full 40-character Git source SHA. Confirm its first 12 characters equal the readiness `release` value.
2. Confirm the GitHub App installation has `administration: read`. Require the selected user to remain a repository admin and require strict up-to-date required checks on the current default branch. Merge Queue support does not waive this gate.
3. In one manually reviewed setup pull request, install the versioned managed guard, repair workflow, and reviewed helpers generated by the installer. The workflows execute only the exact live default-branch controller revision and treat the pull-request checkout as data. Reject repository-owned modifications to reserved managed bytes rather than overwriting them.
4. Configure the positive generation, App ID/private key, and independent controller master secret with Vercel `CHANGEPLANE_REPAIR_ENABLED=false`. With a token constrained to the exact repository plus Secrets write, store the repository worker switch as `false` first, overwrite the legacy `CHANGEPLANE_CONTROLLER_HMAC` slot with its non-secret tombstone, then store the installation ID, identical generation, PS256 public-key map, v12-domain `CHANGEPLANE_CONTROLLER_HMAC_V12`, and verified `OPENAI_API_KEY`. Recheck repository identity/admin and strict branch protection, then write only the exact managed activation marker (`managed-v12` for v12). A partial run remains disabled and safe to rerun; v11 and earlier workflows know neither the v12 marker nor the v12 credential name while the upgrade pull request is pending.
5. Merge the managed setup or upgrade pull request while the Vercel controller switch remains false. Verify the default branch now contains the exact v12 manifest and hashes; rerun setup if needed so the repository marker is `managed-v12`.
6. Deploy the reviewed disabled configuration. Readiness must remain observe-ready while reporting repair `enabled: false`, `configured: false`; its nested checks must identify only the disabled switch as false. Empty or malformed requests to `repair`, `repair-claim`, `repair-validate`, and `repair-push-token` must return `503` without GitHub access.
7. Before activation, verify the exact App identity, repository-scoped token, workflow sandbox, pinned release, strict branch policy, and static fail-closed coverage for replay, stale heads, path boundaries, and the attempt/deadline budget. The workflow's model-proposal job has no forge write permission and cannot publish `PASS`.
8. Change the Vercel switch to `true` and deploy only the reviewed protected-source commit. Do not replace the repository marker with the legacy value `true`. Stop unless readiness reports `repairController.enabled: true`, `configured: true`, and every nested repair check true for the expected release.
9. Run one deterministic scope-repair canary first. Require that live run to create and anchor the App-signed generation-bound ledger and prove replay denial, stale-head denial, path boundaries, and the attempt/deadline budget. Treat GitHub Actions receipt comments as audit output only; they never authorize controller repair or contract continuation. Add the verified provider secret and run evidence repair only after the scope path and kill switch have passed. Never reuse the stale observe pull request as repair evidence.

The canary provisioner is intentionally target-agnostic and refuses the historical private GitHub Free canary. Supply an eligible disposable repository with strict branch protection, its numeric repository and installation IDs, an administrator's short-lived GitHub token through `CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH`, and the App/controller secrets through absolute file paths. Run first with `CHANGEPLANE_ENABLE_REPAIR=false`; merge and verify the v12 managed setup; only then rerun with the provider-key path and `CHANGEPLANE_ENABLE_REPAIR=true`. The script proves human admin, App repository identity, and strict protection both before any secret write and immediately before `managed-v12` activation. Never pass secret values directly on the command line.

The operator contract for `node scripts/provision-repair-canary.mjs` is:

| Input | Requirement |
| --- | --- |
| `CHANGEPLANE_GITHUB_APP_ID` | Positive App ID for the reviewed production GitHub App. |
| `CHANGEPLANE_CANARY_REPOSITORY` | Exact eligible disposable `owner/repository`; never the historical Free canary. |
| `CHANGEPLANE_CANARY_REPOSITORY_ID` | Positive numeric ID for that exact repository. |
| `CHANGEPLANE_CANARY_INSTALLATION_ID` | Positive installation ID scoped to that exact repository. |
| `CHANGEPLANE_REPAIR_GENERATION` | Positive integer exactly equal to the active Vercel generation; never reset it to an older value. |
| `CHANGEPLANE_GITHUB_APP_PRIVATE_KEY_PATH` | Absolute path to the App private-key file. |
| `CHANGEPLANE_GITHUB_ADMIN_TOKEN_PATH` | Absolute path to a short-lived token for a current human repository admin. |
| `CHANGEPLANE_CONTROLLER_SECRET_PATH` | Absolute path to the active controller master-secret file. |
| `CHANGEPLANE_ENABLE_REPAIR` | Exact `false` for inert provisioning, or `true` only after the v12 merge and verification gates pass. |
| `CHANGEPLANE_OPENAI_KEY_PATH` | Absolute provider-key path; required whenever repair is enabled and otherwise optional. |

Export only these identifiers, booleans, positive numbers, and absolute secret-file paths in the operator shell; keep the secret values inside their files. The JSON result records the non-secret repository, installation ID, generation, key ID, and configuration booleans for the evidence record.

The private GitHub Free canary has no enforceable branch protection. A human owner must review and merge the workflow setup PR, keep all direct pushes prohibited by procedure, and treat every result as controlled lab evidence only. Do not describe this path as customer-ready production repair.

## Review, handback, preview, and Merge Queue operations

- Keep `.changeplane/assurance.md` in the protected setup/configuration pull-request path. Review its invariants and policy-pack guidance like code; never accept a generated memory change directly on the default branch.
- Run `ChangePlane / review` only when `OPENAI_API_KEY` is configured. Confirm findings point to changed lines, remain within the configured cap, and carry the evaluated head. A missing key skips advisory review and must not weaken or fail the guard.
- Treat every agent handback Action output or receipt payload as a finding envelope, not an authorization token. Consumers must re-read the current head before acting; stale findings are discarded.
- Treat `assurance_passport` as portable evidence, not portable authority. Recompute its domain-separated digest for local integrity, then require the live exact-head `ChangePlane / guard`, policy-pinned Check publisher, matching passport marker, and compatible conclusion before presenting it as authentic. Never accept an offline passport as approval, repair authorization, or proof that a PR is still current.
- Include an existing preview in the receipt only after its GitHub Deployment SHA equals the evaluated head. Omit stale, missing, or unverifiable preview URLs.
- On `merge_group`, publish `ChangePlane / guard` for the exact queue revision. Do not run review, proposal, repair, apply, or handback jobs for the queue event. A new merge-group SHA requires a new decision.

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
