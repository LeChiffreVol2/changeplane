# Changelog

## Unreleased

- Use ChangePlane Open Source across the website, documentation, CLI and Action. Existing version tags, downloads, JSON identifiers and assurance boundaries stay compatible.

## Open Source 0.1.0-alpha.1

- License the source under Apache-2.0 and add contribution, security and installation guidance.
- Add a zero-dependency CLI and read-only GitHub Action using the existing deterministic evaluator.
- Bind live assessments to default-branch policy, exact PR head and the latest observed workflow attempt; reject drift and incomplete evidence.
- Publish standalone release bundles with source manifests and SHA-256 checksums.
- Make Open Source the public entry point while hosted Guard and Repair remain closed to customers.


## Unreleased — managed payload v13 local candidate

This candidate is implemented in the local worktree. It has not been merged to protected `main`, deployed to Vercel Production, exercised in a live GitHub installation, or measured in an external benchmark.

### Added

- **Verify Lite** as the default setup profile: nine reviewed files, one exact-head guard workflow, and no provider key, model-backed review job, standalone proposal/controller helpers, repair workflow, controller HMAC, or controller installation credential.
- **Full** as the explicit 21-file profile for the Autonomous controlled beta. Expanding an installed Verify Lite repository proposes the additional managed surface through a separate protected pull request.
- Read-only, fail-closed GitHub Rulesets readiness for unambiguous active repository or inherited-organization branch rulesets returned for the selected repository. One independently complete supported Ruleset must target the default branch, have no bypass actors, require Merge Queue and strict status checks, and bind the dedicated-App `ChangePlane / guard` plus every configured behavioral evidence Check to its expected integration ID. Classic protection, controls split across Rulesets, unsupported shapes, and ambiguity remain inactive. The GitHub-owned `ChangePlane guard` job is operational liveness only.
- The signed-out **Cursor Origin boundary proof**, which executes twelve deterministic scenarios—including exact-head, stale-head, and protected-change GitHub-mirror fixtures—and six product assertions through the product evaluator and bounded-patch validator. It is an executable product contract with zero external requests, not a live Origin benchmark.
- A redacted Action `proof_locator` plus an authenticated read-only live verifier that re-fetches the guard, trusted-base policy, every evidence Check, and current pull-request revision from GitHub. Results distinguish `VERIFIED_CURRENT`, `VERIFIED_HISTORICAL`, `INVALID`, and `INDETERMINATE` without granting mutation or merge authority.
- A read-only **Agentic SDLC assurance** projection for repository readiness and exact revisions. The product now shows Intent, Change, Review, Verify, Delivery, Merge, and Operate as one bounded evidence spine while keeping the deterministic guard as the only ChangePlane PASS path, GitHub as merge authority, and customer systems as operations authority.
- An interactive exact-revision lifecycle explainer in the signed-out RouteThai workspace, including explicit new-commit invalidation, stale review and deployment omission, full-SHA comparison, and progressive disclosure for every checkpoint. The pure helper separately unit-covers guard-only Merge Queue behavior; this candidate does not add a live merge-group replay surface.
- A dedicated GitHub App guard publisher. The repository workflow requests a GitHub OIDC token but has no Checks-write authority. Before evaluation, the hosted publisher authenticates the exact trusted workflow run, re-fetches the managed tree and unique current same-repository target, and opens one immutable exact-SHA evaluation lease as an App-owned `ChangePlane / guard` Check in `in_progress`, invalidating an older success. Only the owning run and attempt may complete it after fresh latest exact-head, workflow-path-bound evidence. Same-attempt retries are idempotent and mint no write credential; competing or completed-run replays fail closed. The publisher uses separate exact-repository read and `checks:write` credentials.
- Production canary provisioning now mints and validates separate exact-repository `administration:read` and `secrets:write` installation credentials, rejects widened permissions or overlong lifetimes, and revalidates the complete Ruleset immediately before enabling repair.

### Changed

- Managed manifests use schema v2 and record either `verify-lite` or `full`; preserved v12 hashes continue to make upgrades exact and reviewable.
- Runtime and BYOK routes now trust that profile only after the exact default-branch Git tree matches every managed blob and contains no Full-only or unknown reserved path. A Lite tree with an injected repair workflow, forged Full manifest, missing file, mode drift, or modified byte fails closed before authority checks. BYOK storage and controller activation re-bind that exact tree immediately before secret mutation; controller rotation tombstones the usable HMAC and writes the fresh credential last.
- Onboarding recommends Verify Lite first and reveals model and repair controls only when a repository owner explicitly explores Autonomous.
- Enforcement status now distinguishes an installed workflow from active GitHub merge policy, requires the single complete Ruleset authority described above, and provides a direct recheck path; Full-only review and assurance-memory capabilities are no longer advertised as part of Verify Lite.
- The public RouteThai replay no longer represents a test file as agent-editable work. Tests, evidence controls, dependency manifests, managed workflows, and protected paths remain human-review-only throughout the SDLC view.
- Assurance Passport validation now rejects empty-evidence enforce-mode PASS claims, failed evidence disguised as PASS, duplicate passport markers, and receipt/passport revision-binding mismatches.
- Evidence authority is now self-protecting: `.changeplane.json`, every GitHub workflow, and the vendored `changeplane/**` runtime are unconditional human-review paths. Nested tests, test configuration, dependency manifests, and previous rename paths are materialized as exact protected paths, closing the two-pull-request policy-weakening route before evaluation or repair.

### Release boundary

- Managed payload v13 does not rotate the existing v12 repair credential domain: Full still uses `CHANGEPLANE_CONTROLLER_HMAC_V12` and the exact `managed-v12` activation marker.
- Live dedicated-App guard publication, Verify Lite, Rulesets, Autonomous expansion, Preview, Production, rollback, signed-out smoke evidence, and a real Origin-mirrored canary remain required before this candidate becomes a release or head-to-head competitive claim. Local implementation and synthetic contract proof are not live rollout evidence.

## 1.0.0 — 2026-08-27

ChangePlane 1.0.0 is the first release candidate positioned as an independent GitHub-native assurance plane for agent-authored pull requests.

### Added

- Agent-neutral **Verify only** alongside Observe and bounded Autonomous repair.
- Forge-anchored, machine-readable Assurance Passport v1 for pull requests and Merge Queue revisions.
- Exact customer-agent handbacks that carry no push, Check, merge, or PASS authority.
- Read-only merge-enforcement readiness for strict classic branch protection and the observed live guard publisher.

### Hardened

- Trusted-default-branch execution, retarget and base-drift rejection, exact controller binding, and secret-free Verify and Merge Queue paths.
- Repository-admin authorization for secret operations, versioned controller credentials, inert-before-activation provisioning, and fail-closed canary rotation.
- Production-only Vercel source provenance before GitHub or OpenAI access, public-data scanning, and production preview isolation.

### Supported boundary

GitHub.com personal accounts and organizations, including Enterprise Cloud organizations; same-repository pull requests; classic branch protection readiness; and guard-only Merge Queue evaluation. GitHub Enterprise Server, forks, cross-repository repair, ruleset readiness, managed model billing, and automatic merge are not included.
