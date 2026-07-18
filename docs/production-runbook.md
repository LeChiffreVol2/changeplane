# ChangePlane production runbook

## Supported boundary

This release supports one-repository GitHub.com rollouts in `observe` mode. GitHub remains the source of truth, audit surface, and merge authority. ChangePlane has no database, queue, merge service, or production repair runtime to operate.

Do not enable `enforce`, make `ChangePlane / guard` required, or install a repair adapter in a customer repository until every corresponding gate in the release checklist is complete. `ChangePlane Managed` is a disabled reservation; a successful private DeepSeek credential canary is not managed execution or billing.

Vercel Hobby is suitable only for a controlled, non-commercial canary. Vercel restricts Hobby to personal, non-commercial use, provides no production SLA, pauses projects that exhaust included usage, and does not let a Hobby project connect to a GitHub organization-owned repository. Use a personal disposable repository for the free canary. A paid design-partner, organization-owned repository, or other commercial rollout requires Vercel Pro or another approved host before onboarding. See [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel limits](https://vercel.com/docs/limits), and [Vercel plan behavior](https://vercel.com/docs/plans).

GitHub Free can protect public repositories, but private-repository branch protection requires GitHub Pro, Team, Enterprise Cloud, or Enterprise Server. A private pilot without an eligible plan cannot meet the required CI gate and must not ship. See [GitHub protected branch availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

## Delivery path

GitHub Actions is the code gate. The single `CI / verify` job installs from `package-lock.json`, asserts that no other workflow is active, runs tests (including the readiness contract), builds, audits production dependencies, and serves the built UI on runner-local `127.0.0.1` for a smoke request. It has read-only repository permission, immutable action SHAs, one stale-run-canceling concurrency lane, a 12-minute timeout, and no artifacts or production network calls.

Vercel's Git integration is the deployment path; do not add a second token-bearing deploy workflow. Pull-request commits create Preview deployments and protected `main` creates Production deployments. Protect `main`, require `CI / verify`, and prohibit direct pushes and bypasses so Vercel cannot receive an unverified production commit. `vercel.json` fixes the install, build, output, and 60-second function ceiling supported by Hobby.

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
| `CHANGEPLANE_MANAGED_DEEPSEEK_API_KEY` | Vercel Production only, private canary only | Yes | Provider owner; omit unless the private verification canary is approved. Never copy to a repository. |
| `CHANGEPLANE_LOG_REQUESTS` | Vercel environment configuration | No | ChangePlane owner; `true` enables structured, redacted request metadata. |
| `DEEPSEEK_API_KEY` | Customer repository Actions Secret | Yes | Customer repository owner; Enterprise BYOK only. ChangePlane sends it once to GitHub's encrypted-secret API. |
| `GITHUB_TOKEN` | GitHub Actions job, issued automatically | Yes | GitHub; ephemeral. Never create or store a replacement token for CI. |

`VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`, and `VERCEL_URL` are Vercel-provided metadata, not operator secrets. A Vercel release is ready only when `VERCEL_GIT_COMMIT_SHA` is a valid 40-character source commit; readiness reports its first 12 characters. A deployment ID may still appear as diagnostic metadata when Git provenance is missing, but readiness returns `503` and repository mutation routes stay disabled. Record an owner and last-rotation date for each real secret outside the repository. Never put secret values in tickets, release notes, shell history, screenshots, or this file.

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

## Logs, signals, and free-tier controls

Production request logs are structured JSON with a ChangePlane request ID, route, method, status, duration, and upstream GitHub status/request ID when available. Request bodies, cookies, OAuth tokens, repository names, provider keys, and upstream response bodies must never be logged. Any secret or repository identifier in logs is a security incident.

There is no paid log drain, synthetic monitor, pager, or claimed 24/7 alerting in this pilot. GitHub Checks/comments are the durable decision record. Vercel Hobby runtime logs are short-lived, so the release owner watches them during onboarding and captures only redacted request IDs and timestamps needed for an incident record. Treat these observed conditions as incidents:

- Readiness returns non-`200` twice in succession.
- GitHub returns `429` or repeated `5xx`, or authorization callbacks fail repeatedly.
- An eligible pull request has no observe receipt within 15 minutes.
- A Vercel quota notice, paused project, unexpected function timeout, or production `5xx` occurs.

Before any public onboarding, publish one Vercel WAF fixed-window rate-limit rule for `/api/github`, keyed by source IP, returning `429`. Hobby currently includes one rate-limit rule and the first 1,000,000 allowed requests; choose and record the threshold, then verify a bounded burst receives `429` while the normal readiness and sign-in paths still work. Treat this dashboard rule as release configuration: record its owner and review it after every route change. See [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

Use the native Vercel Usage page/email notices and GitHub budget notices. The CI job avoids matrices, scheduled runs, artifacts, and paid runners; stale commits are canceled. Public repositories receive standard-runner Actions usage without minute charges, while private repositories consume the owner's included allowance. Hobby also limits deployment builds to 32 per hour; stop nonessential pushes before that ceiling rather than creating retry churn. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [Vercel limits](https://vercel.com/docs/limits).

Review Vercel usage before each design-partner onboarding and GitHub Actions usage weekly. At 80% of either included allowance, stop new onboarding and nonessential reruns. At exhaustion, fail closed and wait for reset or approve a plan change; do not bypass limits with extra accounts. Do not run load tests against Vercel without authorization.

## Incident containment

The founding engineering owner is incident commander until a named on-call rotation exists. Record UTC start time, affected release/deployment, redacted request IDs, observed impact, containment owner, and recovery decision. Do not copy customer repository names or credentials into the incident record.

### Bad deployment

1. Stop onboarding and record the bad deployment ID and exact commit.
2. Use Vercel Instant Rollback to return the production domain to the immediately previous verified deployment. Hobby can roll back only to that immediately previous Production deployment.
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

Every pilot repository needs one customer repository owner and one ChangePlane owner. Record the installation identity, selected repository boundary, contacts, plan eligibility, and rollback decision before onboarding. A handoff is incomplete without access to GitHub authorization revocation, Vercel rollback, provider-key revocation, and the release record.
