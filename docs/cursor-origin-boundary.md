# Cursor Origin compatibility and proof boundary

**Evidence date: 2026-08-31.** This document separates official Cursor Origin capabilities from ChangePlane's executable claims. It is a product and verification boundary, not a claim that ChangePlane replaces Origin or wins a general forge benchmark.

## What Origin is

Cursor describes Origin as its Git forge. In Early Beta it can host repositories, serve standard Git clone/push/pull traffic, browse and search code, manage pull requests and Checks, apply repository protections, connect applications, and run Cursor cloud-agent and automation workflows. A native Origin repository can make Origin its source of truth.

Origin also offers a migration path from GitHub. A mirrored repository copies Git history, branches, tags, code, and pull requests into Origin; pull-request interactions sync in both directions and pushes continue to GitHub while GitHub remains the source of truth. GitHub Issues, Actions workflows, and secrets are not copied, and mirrored repositories keep CI on GitHub. Detaching the mirror converts the Origin copy into a standalone Origin repository without changing the GitHub repository.

The relevant official Cursor sources are:

- [Origin overview](https://cursor.com/docs/origin)
- [Origin Code Hosting announcement](https://cursor.com/changelog/origin-code-hosting)
- [Mirror a GitHub repository](https://cursor.com/docs/origin/mirror-github)
- [Origin pull requests](https://cursor.com/docs/origin/pull-requests)
- [Origin repository settings](https://cursor.com/docs/origin/settings)
- [Origin integrations](https://cursor.com/docs/origin/integrations)
- [Origin API](https://cursor.com/docs/api/origin)
- [Origin API changelog](https://cursor.com/docs/api/origin/changelog)
- [Git at any scale](https://cursor.com/blog/git-at-any-scale)
- [Cursor cloud-agent direction](https://cursor.com/blog/agent-computer-use)

Origin access is staged and limited to paid plans. Its product documentation calls Origin Early Beta, while its public API documentation and changelog warn that the API is early and subject to change. Cursor's published scale figures are vendor-run synthetic results, not a ChangePlane measurement or an independent service-level result.

## Parity is not differentiation

ChangePlane must not imply that Origin lacks basic revision or forge protections. As documented on 2026-08-31, Origin already provides the following primitives:

| Control | Documented Origin behavior | ChangePlane position |
| --- | --- | --- |
| Exact-revision Checks | A Check suite and run are attached to a full 40- or 64-character `headSha`. | Parity at the forge primitive. ChangePlane's difference is the evidence and authority contract behind its guard, not SHA attachment by itself. |
| Publisher identity | Required Checks match the installing Origin App plus stable suite and optional run keys; display names do not establish identity. | Parity in publisher-bound Check identity. ChangePlane must not claim that Origin trusts a same-name Check. |
| Stale update ordering | `externalUpdatedAt` prevents an older Check update from overwriting newer state. | Parity for Check-update ordering. ChangePlane additionally restarts its own assurance decision for a new GitHub revision. |
| Repository protections | Origin exposes pull-request, required-status-check, up-to-date-branch, deletion, and non-fast-forward rules through Rulesets. | Parity at the documented policy primitive. A configured Ruleset is not by itself proof of either product's complete assurance behavior. |
| Merge head guard | Origin's merge API can take `expectedHeadSha` and reject a moved head. | Parity when the caller supplies the field. ChangePlane leaves the merge operation to GitHub and never treats its guard as a merge. |
| Short-lived app credentials | Origin Apps use repository- and scope-constrained installation tokens that expire after at most 15 minutes. | Parity as a credential pattern. ChangePlane's controller separation remains a product-specific authority boundary. |

Absence from public Cursor documentation is not evidence that an Origin capability does not exist. No ChangePlane surface may turn an undocumented comparison into a failing Origin score.

## ChangePlane's competitive wedge

ChangePlane competes by making the existing GitHub delivery path safe for agent-authored work, not by building another Git host.

- **GitHub remains authority.** ChangePlane reads the GitHub pull request and trusted default-branch policy, publishes a GitHub Check, and leaves branch policy, Merge Queue, and merge to GitHub.
- **No second forge is required.** A team can use ChangePlane without copying its repository into an Origin namespace or adopting another code browser, pull-request database, or merge surface. Origin mirroring remains optional and is not characterized as a forced migration.
- **The authoring agent is not trusted as the evaluator.** Codex, Cursor, Claude Code, Copilot, Trae, OpenSWE, or another agent may author the same diff. Agent identity is context and cannot produce `PASS`.
- **Authority is separated.** A model may propose a bounded patch, the deterministic harness decides, a separately credentialed controller may apply an accepted patch, and fresh evidence on the new exact head is required before the guard passes.
- **Protected capabilities stay human-controlled.** Tests, evidence configuration, dependency manifests, managed workflow bytes, and repository-protected paths cannot be changed by an agent and then used to certify that same change.

These are ChangePlane contract claims. They do not establish that Origin is unsafe, slower, less reliable, or unable to host equivalent third-party controls.

## Proof tiers

### Tier 1: executable synthetic contract

Run:

```sh
npm run prove:origin-boundary
npm run prove:origin-boundary -- --json
```

The same result is available as JSON from `GET /api/github?action=origin-proof`.

This tier runs ChangePlane's deterministic evaluator against synthetic GitHub-mirror-shaped fixtures. It asserts that:

1. GitHub remains the source-of-truth and merge-authority boundary for every mirrored fixture;
2. the same exact change and evidence produce the same decision whether the authoring surface is ordinary GitHub or a Cursor Origin GitHub mirror;
3. a current exact GitHub head can become guard-eligible without an external write or evaluation-time repository mutation;
4. a stale mirror-visible head cannot become guard-eligible or mutate the repository;
5. a protected test change remains on the human-review path; and
6. guard eligibility is neither guard publication nor a merge.

The result is a reproducible ChangePlane product-contract proof. Its machine-readable `guardEligible` field means only that the synthetic evaluator identifies when a fixture could proceed to a separate publisher; this tier publishes no Check and makes zero GitHub, Cursor, Origin, or model-provider requests. It does not test Origin's runtime, sync freshness, availability, latency, security, or native repository behavior and therefore is not a head-to-head benchmark.

### Tier 2: live GitHub assurance verifier

For a real ChangePlane guard, an authenticated caller can request:

```text
GET /api/github?action=proof&repository=OWNER/REPOSITORY&checkRunId=CHECK_RUN_ID&passportDigest=PASSPORT_SHA256
```

The verifier re-fetches the selected GitHub Check Run, parses and integrity-checks its embedded Assurance Passport, binds it to the selected repository name and numeric ID, re-reads the trusted policy at its recorded source revision, re-fetches every identified behavioral Check, and compares the current pull-request base and full head. It returns one of:

- `VERIFIED_CURRENT` — the exact pull-request revision and all live evidence still match;
- `VERIFIED_HISTORICAL` — the re-fetched GitHub envelope matches but the recorded revision is no longer current, or is a transient Merge Queue revision;
- `INVALID` — at least one fetched fact conflicts with the passport; or
- `INDETERMINATE` — required live GitHub evidence could not be fetched.

This tier proves the live GitHub envelope for one ChangePlane receipt. It still grants no approval, repair, deployment, or merge authority.

### Dedicated publisher boundary

The managed workflow cannot publish `ChangePlane / guard` with its repository `GITHUB_TOKEN`. Its guard job has `actions: read`, `checks: read`, and `id-token: write`; Actions read is limited to exact workflow-run provenance, while a short-lived GitHub OIDC token for the fixed ChangePlane audience authenticates the passport sent to the production publisher endpoint.

The hosted controller accepts only the configured dedicated ChangePlane App ID and slug. Before mutation it verifies the GitHub-signed repository, default-branch workflow path and SHA, event, ref, run ID, and attempt; re-fetches the exact managed tree, policy, evidence Checks, default branch, and same-repository pull request or merge-group commit; and separates one exact-repository read token from a final `checks:write` token. The live verifier rejects the shared `github-actions` publisher, an arbitrary App publisher, a native Origin App publisher, and an Origin Check Run.

This v13 code path is deployed from protected source and exercised against the public canary recorded in `evidence/changeplane-v13-production-release.json`. The exact-head canary published `ChangePlane / guard` from App ID `4334716` / slug `changeplane-guard`; a new commit required a fresh App-owned Check, and a protected test change completed as `action_required` while deterministic CI remained green. That proves the dedicated App/OIDC publication boundary for those exact GitHub revisions. It does not complete Tier 2's authenticated `VERIFIED_CURRENT` re-fetch or the required Merge Queue authority gate: the available personal-account public repository cannot enable GitHub Merge Queue, and ChangePlane reports `merge_queue_required`.

## Supported and unsupported Origin paths

| Path | Current status | Meaning |
| --- | --- | --- |
| GitHub repository optionally mirrored into Origin | `CANDIDATE_THROUGH_GITHUB` | ChangePlane continues to evaluate and publish against GitHub in the synthetic contract. Origin may be an authoring, browsing, and mirror surface, but no Origin fact contributes to `PASS`; live interoperability remains pending. |
| Native or detached standalone Origin repository | `UNSUPPORTED_NOT_TESTED` | ChangePlane does not install an Origin App, read an Origin PR, publish an Origin Check, configure an Origin Ruleset, or merge an Origin PR. |
| Origin inbound-mirror partner API | Not used | Cursor documents most app writes, including Checks, PRs, reviews, and Rulesets, as unavailable while a mirror is in the relevant read-only state. ChangePlane uses GitHub directly instead. |

The supported-through-GitHub label describes an architectural boundary backed by synthetic contract cases. It must not be presented as live Origin interoperability until the canary below is complete.

## Required real Cursor Origin canary

**Current status: `BLOCKED_NO_SUBSCRIPTION`.** The repository owner confirmed on 2026-09-01 that no paid Cursor subscription with Origin Early Beta access is available. No Origin repository or mirror was created, no Origin API was called, and no live interoperability or competitive-win claim is made. The synthetic contract remains the only Origin-shaped evidence until access is available.

A genuine interoperability claim requires a disposable, redacted canary with paid Early Beta access. It must:

1. Create a disposable GitHub repository, install the repository-scoped ChangePlane GitHub App and managed Actions payload, configure one behavioral Check with its exact GitHub App publisher, and keep GitHub as source and merge authority.
2. Mirror that repository into Origin using Cursor's supported GitHub flow. Record the GitHub repository ID, GitHub installation ID, Origin repository ID, mirror direction/status, pull-request number, full base and head SHAs, and timestamps without recording tokens or private source.
3. Use the real Origin surface or a Cursor cloud agent attached to the mirror to create or update a same-repository branch and pull request. Confirm that the resulting GitHub pull request has the same current full head before ChangePlane evaluates it.
4. Exercise a clean exact-head case. Record the GitHub-owned `ChangePlane guard` as operational liveness. In one strict, no-bypass default-branch Ruleset with Merge Queue, require the dedicated-App `ChangePlane / guard` and every configured behavioral evidence Check on that exact GitHub SHA from their expected integration IDs; then require Tier 2 to return `VERIFIED_CURRENT` and readiness to confirm that Ruleset-bound authority.
5. Push a second commit through the supported Origin mirror path. Confirm the previous receipt becomes `VERIFIED_HISTORICAL` or otherwise cannot represent the current pull request, and confirm the old guard cannot be inherited by the new GitHub head.
6. Exercise a protected test or evidence-control change from the Origin-authored branch. Confirm ChangePlane returns human review, publishes no passing guard, requests no provider repair, and performs no repository mutation.
7. Exercise a same-name behavioral Check from the wrong GitHub App publisher. Confirm it does not satisfy the configured evidence requirement.
8. Confirm that GitHub branch policy—not ChangePlane or Origin—makes the final merge decision. The canary should not merge unless a separate, explicitly reviewed test step requires it.
9. Export redacted raw GitHub Check Run JSON, the integrity-checked passport, Tier 2 verifier output, relevant workflow run IDs, and Origin mirror metadata. Bind every artifact to the full SHA and record the exact ChangePlane production release provenance.
10. Run the public-data scan and remove the disposable installation, secrets, branches, and repositories according to the canary teardown plan.

Passing this canary would prove the GitHub-mirrored path for the tested configuration and date. It would not prove native Origin support, general Origin reliability, lower latency, higher scale, or superiority over Origin as a forge.

A standalone Origin canary is a separate product project. It would first require a reviewed Origin provider adapter, Origin App authentication, signed webhook handling, native PR and Check mapping, Ruleset enforcement inspection, trusted-policy sourcing, an Origin-specific publisher binding, and a new threat model. The current GitHub canary must not be relabeled to imply that work exists.

## Allowed competitive claims

Until the live canary passes, public copy may say:

- ChangePlane provides an executable synthetic proof that its GitHub assurance decision is independent of the authoring surface.
- ChangePlane requires no second forge and leaves GitHub as source, policy, and merge authority.
- ChangePlane separates proposal, deterministic evaluation, controlled apply, and merge authority.
- Standalone Origin is unsupported and untested.

Public copy must not say that ChangePlane is faster, safer, more scalable, or categorically better than Origin; that Origin accepts stale or same-name Checks; that Origin lacks Rulesets or exact-head merge protection; or that ChangePlane natively integrates with Origin. A comparative win requires the controlled live evidence described above and must remain scoped to the exact tested scenarios.
