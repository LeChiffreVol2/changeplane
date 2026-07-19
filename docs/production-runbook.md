# ChangePlane production runbook

## Supported boundary

This release supports one-repository GitHub.com rollouts in `observe` mode. GitHub remains the source of truth, audit surface, and merge authority. ChangePlane has no database, queue, merge service, or production repair runtime to operate.

Do not enable `enforce`, make `ChangePlane / guard` required, or install a repair adapter in a customer repository until every corresponding gate in the release checklist is complete. `ChangePlane Managed` is a disabled reservation; a successful private DeepSeek credential canary is not managed execution or billing.

The current Vercel deployment is a fixed free-phase constraint. Keep the GitHub App private, keep `CHANGEPLANE_CANARY_REPOSITORY` set to the exact disposable target, and let the public root expose only the fictional workspace; the owner signs in through the unlisted `?access=canary-owner` entry. The API rejects login, installation, and post-install callback stages, including in-flight state minted before the gate was enabled. Hosting-plan work and broader onboarding are outside this release. See [Vercel limits](https://vercel.com/docs/limits).

The ChangePlane source repository must keep its protected-`main` CI release gate. The private disposable canary on GitHub Free cannot enable branch protection; GitHub returns an upgrade-or-public requirement. That repository is limited to owner-controlled lab evidence with a manually reviewed setup pull request and no direct pushes by procedure. It cannot prove production enforcement, become a customer merge gate, or waive the protected-source release gate. Do not change its visibility or hosting phase to work around this limit. See [GitHub protected branch availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Delivery path

GitHub Actions is the code gate. The single `CI / verify` job installs from `package-lock.json`, asserts that no other workflow is active, runs tests (including the readiness contract), builds, audits production dependencies, and serves the built UI on runner-local `127.0.0.1` for a smoke request. It has read-only repository permission, immutable action SHAs, one stale-run-canceling concurrency lane, a 12-minute timeout, and no artifacts or production network calls.

Vercel's Git integration is the deployment path; do not add a second token-bearing deploy workflow. Pull-request commits create Preview deployments and protected `main` creates Production deployments. Protect `main`, require `CI / verify`, and prohibit direct pushes and bypasses so Vercel cannot receive an unverified production commit. `vercel.json` fixes the install, build, output, and 60-second function ceiling used by this phase.

CI intentionally does not call a Vercel deployment. Before merge, use a trusted Preview deployment for the external readiness check. Fork and untrusted pull-request previews must not receive production connector credentials or provider keys.

## Configuration and secret inventory

| Name | Location and scope | Secret | Owner / rotation effect |
| --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | Vercel Production; isolated value for trusted Preview only | No | Connector owner; rotate with the paired GitHub credential. |
| `GITHUB_CLIENT_SECRET` | Vercel Production; isolated non-production value for trusted Preview only | Yes | Connector owner; revoke/rotate in GitHub after suspected disclosure. |
| `GITHUB_APP_SLUG` | Vercel Production and trusted Preview | No | Connector owner; unset means the explicitly limited OAuth observe fallback. |
| `CHANGEPLANE_SESSION_SECRET` | Vercel Production; independent value per environment | Yes | ChangePlane owner; rotation invalidates every session in that environment. |
| `CHANGEPLANE_APP_ORIGIN` | Vercel Production; exact HTTPS origin, no path or trailing slash | No | ChangePlane owner; update with domain or callback changes. |
| `CHANGEPLANE_CANARY_REPOSITORY` | Vercel Production during controlled rollout; exact `owner/repository` | No | Release owner; hides and rejects every other repository before GitHub access. Remove only for an approved broader rollout. |
| `CHANGEPLANE_REPAIR_REPOSITORY` | Vercel Production; exact disposable `owner/repository` | No | Repair owner; must equal `CHANGEPLANE_CANARY_REPOSITORY` or repair stays unconfigured. |
| `CHANGEPLANE_REPAIR_ENABLED` | Vercel Production | No | Repair owner; keep `false` until activation, restore `false` for containment, then redeploy. |
| `CHANGEPLANE_REPAIR_GENERATION` | Vercel Production; positive integer | No | Repair owner; advance to invalidate grants during rollback or compromise containment. |
| `GITHUB_APP_ID` | Vercel Production; dedicated repair-publisher App | No | GitHub App owner; must identify the same App as `GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY`. |
| `GITHUB_APP_PRIVATE_KEY` | Vercel Production only | Yes | GitHub App owner; rotate in GitHub after suspected disclosure and redeploy. Never expose to a workflow. |
| `CHANGEPLANE_CONTROLLER_SECRET` | Vercel Production only; independent 32+ character master | Yes | Repair owner; derives repository-bound HMACs. Rotation requires reprovisioning each repository HMAC. |
| `CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY` | Vercel Production only, private canary only | Yes | Provider owner; omit unless the private verification canary is approved. Never copy to a repository. |
| `CHANGEPLANE_LOG_REQUESTS` | Vercel environment configuration | No | ChangePlane owner; `true` enables structured, redacted request metadata. |
| `CHANGEPLANE_CONTROLLER_INSTALLATION_ID` | Disposable repository Actions Variable | No | GitHub App owner; positive installation ID for the exact repository-scoped App installation. |
| `CHANGEPLANE_REPAIR_ENABLED` | Disposable repository Actions Variable | No | Repair owner; independent worker kill switch. Keep `false` until controlled activation. |
| `CHANGEPLANE_REPAIR_GENERATION` | Disposable repository Actions Variable | No | Repair owner; must equal the active Vercel generation. |
| `CHANGEPLANE_REPAIR_PUBLIC_KEYS` | Disposable repository Actions Variable | No | GitHub App owner; JSON map from the pinned PS256 key ID to its SPKI public key. |
| `CHANGEPLANE_CONTROLLER_HMAC` | Disposable repository Actions Secret | Yes | Repair owner; repository-bound derived secret, never the Vercel master secret. Rotate with the controller master or repository/App identity. |
| `DEEPSEEK_API_KEY` | Disposable repository Actions Secret | Yes | Repository owner; verified Enterprise BYOK for evidence repair only. Omit for deterministic scope repair. |
| `GITHUB_TOKEN` | GitHub Actions job, issued automatically | Yes | GitHub; ephemeral and read-only in the apply job. Never use it for a repair push because GitHub suppresses fresh workflow triggers. |
| One-time repair push token | Trusted apply job runner temp only | Yes | GitHub App installation token; exact repository and Contents write only. Mint after signed claim validation, use only for force-with-lease push, then delete on every exit. |

`VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_PROVIDER`, `VERCEL_GIT_REPO_OWNER`, `VERCEL_GIT_REPO_SLUG`, `VERCEL_GIT_COMMIT_REF`, `VERCEL_DEPLOYMENT_ID`, and `VERCEL_URL` are Vercel-provided metadata, not operator secrets. A Vercel release is ready only when it is the `production` environment, comes from GitHub repository `LeChiffreVol2/changeplane` on `main`, and carries a valid 40-character source commit; readiness reports its first 12 characters. CLI uploads and preview/branch deployments therefore keep repository mutation routes disabled even if they contain a Git-looking SHA. A deployment ID may still appear as diagnostic metadata when Git provenance is missing, but readiness returns `503`. Record an owner and last-rotation date for each real secret outside the repository. Never put secret values in tickets, release notes, shell history, screenshots, or this file.

## Release and readiness

1. Complete `docs/release-checklist.md`. The release owner records the commit SHA, Vercel deployment ID, connector mode, CI run URL, rollback target, and approver.
2. Confirm the Vercel Preview deployment is built from the pull request's exact head SHA. Use isolated Preview credentials only on a trusted same-repository release branch.
3. Check Preview readiness and the root/API headers, never Production, before merge. The expected release is the first 12 characters of the exact Preview source SHA:

   ```sh
   trusted_preview="https://REPLACE_WITH_TRUSTED_PREVIEW"
   expected_release="REPLACE_WITH_12_CHAR_SOURCE_SHA"
   export CHANGEPLANE_EXPECTED_RELEASE="$expected_release"
   readiness_headers="$(mktemp)"
   trap 'rm -f "$readiness_headers"' EXIT

   root_headers="$(curl --fail --silent --show-error --dump-header - --output /dev/null "${trusted_preview}/")"
   printf '%s' "$root_headers" | grep -qi '^content-security-policy:'
   printf '%s' "$root_headers" | grep -qi '^x-content-type-options: nosniff'
   printf '%s' "$root_headers" | grep -qi '^x-frame-options: DENY'

   curl --fail --silent --show-error --dump-header "$readiness_headers" \
     "${trusted_preview}/api/github?action=readiness" \
     | node -e 'let data=""; process.stdin.on("data", c => data += c).on("end", () => { const result = JSON.parse(data); if (result.status !== "ready" || !["github_app", "oauth"].includes(result.authMode) || result.release !== process.env.CHANGEPLANE_EXPECTED_RELEASE) process.exit(1); console.log(result.release, result.authMode); });'
   grep -qi '^cache-control: no-store' "$readiness_headers"
   grep -qi '^x-request-id:' "$readiness_headers"
   ```

   A `503`, malformed response, unexpected connector mode, or release that does not match the deployment source SHA blocks the release. The response may contain configuration booleans, connector mode, and release ID only.
4. Merge only after the required GitHub check passes. Confirm the resulting Vercel Production deployment source is the protected `main` SHA.
5. After deployment, make one read-only Production readiness request, then complete one disposable-repository observe install. Do not exercise repair or enforcement. Stop if either result differs from the verified Preview.
6. Keep the immediately previous known-good Production deployment available for rollback.

## Controlled repair canary activation

The repair controller is not part of observe onboarding and remains fail-closed unless every setting and live identity agrees. Use only the exact disposable repository. Separate installation authority by phase: the provisioning token requests Secrets (write) and Variables (write); the live controller token requests only Actions (read), Checks (write), Contents (write), and Pull requests (read). Workflow write is installer-only for the reviewed setup PR and is absent from the live controller token. Before provisioning or dispatching, mint a short-lived installation token constrained by `repository_ids` and confirm GitHub returns exactly that repository ID.

1. Record the reviewed Production deployment's full 40-character Git source SHA. Confirm its first 12 characters equal the readiness `release` value.
2. In one manually reviewed setup pull request, install both controlled-canary workflows and their reviewed helpers. Replace all six `__CHANGEPLANE_RELEASE_SHA__` occurrences across `examples/changeplane-repair-guard.yml` and `examples/changeplane-repair.yml` with that same full SHA. Reject a branch, tag, shortened SHA, placeholder, mixed SHA, or a SHA that does not back the active Production controller.
3. Configure the Vercel repair repository, positive generation, App ID/private key, and independent controller master secret with `CHANGEPLANE_REPAIR_ENABLED=false`. With a token constrained to the exact repository plus Secrets (write) and Variables (write), write the repository worker switch as `false` first, then the installation ID, identical generation, PS256 public-key map, and finally the repository-derived HMAC. A partial run must therefore remain disabled and safe to rerun. Add `DEEPSEEK_API_KEY` only for an explicitly approved evidence-repair run.
4. Deploy the reviewed disabled configuration. Readiness must remain observe-ready while reporting repair `enabled: false`, `configured: false`; its nested checks must identify only the disabled switch as false. Empty or malformed requests to `repair`, `repair-claim`, `repair-validate`, and `repair-push-token` must return `503` without GitHub access.
5. Before activation, verify the exact App identity, repository-scoped token, workflow sandbox, pinned release, and static fail-closed coverage for replay, stale heads, path boundaries, and the attempt/deadline budget. The workflow's model-proposal job has no forge write permission and cannot publish `PASS`.
6. Set the repository worker switch to `true`, then change the Vercel switch to `true` and deploy only the reviewed protected-source commit. Stop unless readiness reports `repairController.enabled: true`, `configured: true`, and every nested repair check true for the expected release.
7. Run one deterministic scope-repair canary first. Require that live run to create and anchor the App-signed generation-bound ledger and prove replay denial, stale-head denial, path boundaries, and the attempt/deadline budget. Treat GitHub Actions receipt comments as audit output only; they never authorize controller repair or contract continuation. Add the verified provider secret and run evidence repair only after the scope path and kill switch have passed. Never reuse the stale observe pull request as repair evidence.

The private GitHub Free canary has no enforceable branch protection. A human owner must review and merge the workflow setup PR, keep all direct pushes prohibited by procedure, and treat every result as controlled lab evidence only. Do not describe this path as customer-ready production repair.

### Repair kill switch and rollback

Containment is repository-first because it does not wait for a Vercel deployment:

1. Set the repository Actions Variable `CHANGEPLANE_REPAIR_ENABLED=false` and cancel active repair workflow runs. Do not delete ledger refs or artifacts; preserve them as evidence.
2. Set Vercel `CHANGEPLANE_REPAIR_ENABLED=false`, advance `CHANGEPLANE_REPAIR_GENERATION` to a new positive integer, and deploy a reviewed disabled source commit. Mirror the new generation to the repository while leaving its worker switch false.
3. Confirm readiness reports repair disabled and unconfigured, and confirm all four repair endpoints return `503` before GitHub mutation or provider access. A normal observe readiness `200` does not mean repair is enabled.
4. If identity or secret material may be compromised, revoke/rotate the GitHub App private key, controller master secret and derived repository HMAC, and provider key before any retry.
5. Do not use Instant Rollback alone as a repair kill switch: a prior deployment may carry an enabled repair configuration. Keep the repository switch false through rollback, then deploy and verify a disabled configuration.

## Logs, signals, and free-tier controls

Production request logs are structured JSON with a ChangePlane request ID, route, method, status, duration, and upstream GitHub status/request ID when available. Request bodies, cookies, OAuth tokens, repository names, provider keys, and upstream response bodies must never be logged. Any secret or repository identifier in logs is a security incident.

There is no external log drain, synthetic monitor, pager, or claimed 24/7 alerting in this pilot. GitHub Checks/comments are the durable decision record. Vercel runtime logs are short-lived, so the release owner watches them during onboarding and captures only redacted request IDs and timestamps needed for an incident record. Treat these observed conditions as incidents:

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
4. Keep automatic production-domain assignment disabled after rollback until the fix passes CI and a trusted Preview readiness check.
5. Promote the fixed verified deployment and record recovery. Do not rebuild the old commit and call it a rollback.

Instant Rollback restores the previous build configuration; it does not apply newly rotated environment variables. If configuration or a secret is implicated, rotate it and create a new verified deployment instead. See [Vercel rollback behavior](https://vercel.com/docs/deployments/rollback-production-deployment).

### Web session or GitHub authorization compromise

1. Disable new GitHub authorization/onboarding and, if necessary, remove the production domain while containing exposure.
2. Rotate `GITHUB_CLIENT_SECRET` and `CHANGEPLANE_SESSION_SECRET`; redeploy because rollback does not apply new values.
3. Revoke affected GitHub App user authorizations or OAuth fallback authorizations in GitHub. Session-secret rotation does not revoke GitHub tokens.
4. Verify Preview readiness with isolated credentials, deploy, and review redacted request IDs.
5. Notify affected design partners before re-enabling onboarding.

### Customer provider-key concern

1. Disconnect Enterprise BYOK or delete `DEEPSEEK_API_KEY` from the repository's Actions Secrets.
2. Rotate or revoke the key at the provider.
3. Review GitHub audit events for secret updates and workflow runs.
4. Reconnect only after the repository owner confirms the new key and allowed workflows.

ChangePlane cannot recover a provider key because plaintext is never persisted.

### GitHub, provider, or quota outage

1. Stop onboarding and repair experiments; do not loosen readiness or policy gates.
2. Record provider status, relevant upstream request IDs, Vercel usage, and GitHub Actions usage.
3. Let requests fail closed. There is no queue to drain and no polling service to restart.
4. Resume only after Preview readiness and one disposable-repository observe evaluation succeed.

## Pilot support handoff

Every pilot repository needs one customer repository owner and one ChangePlane owner. Record the installation identity, selected repository boundary, contacts, and rollback decision before onboarding. A handoff is incomplete without access to GitHub authorization revocation, Vercel rollback, provider-key revocation, and the release record.
