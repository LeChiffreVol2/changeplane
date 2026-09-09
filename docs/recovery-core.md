# Open-source diagnosis and recovery core

Source version 0.2.0 adds structured failure diagnosis, portable observations and a GitLab.com reader candidate. Immutable published 0.1.0-alpha.1 assets retain their original behavior; source changes do not update installed Action pins. This document describes the new source and its qualification boundaries.

## Behavior

Pending, cancelled, timed-out, skipped, infrastructure, configuration and unclassified failed evidence cannot request a source-repair attempt. A generic `failure`, even with assertion-like prose, needs diagnosis first. Explicitly classified behavioral evidence retains the bounded proposal path in the trusted pure harness. Live GitHub collectors do not yet supply that classification, so ordinary failed Checks no longer trigger automatic code repair. This is an intentional safety restriction.

The GitHub reader accepts available fork identities without executing contributor code or reading contributor policy. It binds the target default-branch policy and immutable source/target repository IDs. The GitLab.com reader collects MR metadata, trusted target policy, diff paths, the latest associated pipeline and current job IDs. Neither reader executes code, downloads logs/artifacts, publishes statuses, reruns CI, applies patches or merges.

Safe transient API reads get at most three attempts, respecting short `Retry-After` guidance and a sixty-second/200-request reader budget. Longer rate guidance returns a specific next action. A retry does not spend or reset a code-repair campaign.

GitLab remains a reader candidate until live consumer qualification. Tested checkout provenance, transitive CI include closure, exclusive publisher identity and merge enforcement remain unverified; its report consequently requires review even when a job is green. Native Origin and GitHub-to-Origin mirrors remain unqualified. No subscription or model call is needed for this increment.

## Run

Node 22.18 or 24; no package installation, hosted account or model key:

```sh
node community/cli.js evaluate community/fixtures/observation.json
node community/cli.js inspect YOUR_ACCOUNT/YOUR_REPOSITORY 123
node community/cli.js inspect-gitlab YOUR_GROUP/YOUR_PROJECT 123
node --test community/*.test.js
```

For GitLab, merge the reviewed [v2 policy](../examples/community/gitlab-policy.json) into the target default branch. Replace producer ID `1` with the project ID whose CI evidence you intend to observe and `Behavior` with the exact job name. Add known included CI controls to `evidence.protectedPaths`; this does not verify unresolved remote includes. Supply a read-only `GITLAB_TOKEN` through the environment. The reader uses `PRIVATE-TOKEN`, not `CI_JOB_TOKEN`; endpoint coverage for other token types is not assumed. Never put credentials in arguments or reports.

Run from a trusted local checkout or separately reviewed, pinned collector. Do not add a parent-project token to fork-controlled GitLab CI: its configuration may come from the contributor. Until a trusted GitLab installation is qualified, local execution is the documented candidate path. GitHub's no-checkout, read-only Action template remains available with an immutable implementation pin.

## Contract

V1 snapshots and advisory `EVIDENCE_SATISFIED` remain compatible. Their `subjectBinding` explicitly says `revision-association-only`. The nested handback now has its own schema version 2: policy/input bindings, scope, protected paths, evidence, diagnosis and a machine-readable next action. Live GitHub handbacks additionally bind immutable repository/change IDs and execution identities in an observation digest.

The [v2 example](../community/fixtures/observation.json) distinguishes:

| Field | Meaning |
| --- | --- |
| `identity` | Forge origin, immutable target/source repository IDs and native change ID |
| `revisions` | Proposed/current head, target/current target, merge base, diff start and policy/current policy |
| `evidence[].subject` | Declared source, test-merge, merge-batch or artifact; `unknown` means missing executed-subject proof |
| `producer` / `execution` | Native producer and execution/attempt identity; duplicate names cannot select a winner |
| `collection` | Completeness, stability, CI control coverage and optional generation pair |
| `mirror` | Optional observed Origin repository, mode and synchronized head; never inherited authority |

`OBSERVED_SUCCESS` means the supplied declarations match the policy. It does **not** authenticate them. Caller-supplied `verified`, `failureKind`, arbitrary diagnostics and authority fields are discarded. Output always has `authenticated: false`, `guardPublished: false`, `repairAuthorized: false` and `mergeAuthorized: false`. No controller may consume this report as a grant or authenticated receipt. Digest equality alone cannot verify an artifact's builder or behavioral correctness.

Exit 0 means advisory v1 satisfaction or v2 observed consistency; 1 means findings; 2 means unavailable/invalid input. The CLI writes structured unavailable outcomes to stderr. The Action also writes `decision=UNAVAILABLE` and an assessment output on collection errors.

## Validation and next gates

The [versioned corpus](../community/fixtures/recovery-cases.json) contains 36 synthetic cases labeled against explicit architecture invariants, including positive cases so a blanket failure implementation cannot pass. Expected results are not generated from evaluator outputs. External incident owners have not validated these labels. Additional tests cover collectors, transport and controller regressions.

Passing tests does not measure human time saved, real-incident diagnosis accuracy, model effectiveness or competitive superiority. Real personal/organization installations, fork event wiring and GitLab credentials/endpoints need separate qualification. Paid GitLab capabilities, self-managed instances and native Origin need their own evidence.

The next authority milestone is an independently operated controller with qualified credential separation, same-SHA writer fencing, uncertain-write recovery, revocation and restore behavior. This increment does not make the vendor-bound hosted controller portable. Auto-repair remains a repository opt-in within two attempts/fifteen minutes after those controls qualify.

Reports stay with the operator; there is no automatic ChangePlane telemetry. CI retention follows repository settings. This increment makes no model calls. Future BYOK features may incur operator costs; licensing does not make CI or model usage universally free.

Provider references reviewed 2026-09-10: [GitLab MR API](https://docs.gitlab.com/api/merge_requests/), [Jobs API](https://docs.gitlab.com/api/jobs/), [MR pipeline trust](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/), [GitHub PR checkout](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request), [Origin mirroring](https://cursor.com/docs/origin/mirror-github). Provider documentation does not replace live ChangePlane qualification.
