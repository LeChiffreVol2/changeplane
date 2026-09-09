# Community quickstart

ChangePlane Community Alpha runs locally or in your own GitHub Actions. It assesses evidence without publishing a Guard or requiring a ChangePlane account. Start with the synthetic examples, then connect one existing behavioral CI job.

## Run locally

Install Node.js 22.18+ (22 and 24 are tested). Clone the repository or unpack the Community release archive. No npm dependencies are required:

```sh
node community/cli.js evaluate examples/community/satisfied.json
node community/cli.js evaluate examples/community/failed.json
node community/cli.js evaluate examples/community/stale.json
node community/cli.js --help
```

These commands read local JSON only. The second and third intentionally exit 1. A caller-supplied snapshot is unauthenticated even when evidence is satisfied.

## Inspect your repository

1. Choose one existing CI **job name** that checks meaningful behavior, not the workflow display name or a linter alone. For a matrix, bind an exact unique expanded job name.
2. Open a configuration PR adding `.changeplane.json` using [this policy](../examples/community/policy.json). Replace `Behavior` and `.github/workflows/ci.yml` with your exact job and workflow path. Review and merge that PR. Never source assurance policy from the PR being assessed.
3. Open a normal, same-repository PR targeting the default branch. Let its CI complete, then run:

```sh
node community/cli.js inspect YOUR_ACCOUNT/YOUR_REPOSITORY 123
```

Public GitHub API access works without a token within GitHub's rate limit. For private repositories or higher limits, supply `GH_TOKEN` or `GITHUB_TOKEN` through your process environment or a secret manager. Prefer a fine-grained token scoped to the selected repository with **Contents: read, Pull requests: read, Checks: read, Actions: read**, plus implicit Metadata read. Organization approval/SSO may apply. Never paste the token into commands, configuration, issues or screenshots.

The collector reads repository/PR metadata, changed filenames, one default-branch policy file, workflow runs and current-attempt job states. It makes GET requests only to `api.github.com`, refuses redirects, never executes PR code and never sends data to ChangePlane. GitHub API responses may include diff data; that data is discarded and is not included in the assessment. No source-code context is forwarded to an agent or model.

The live report records the trusted default-branch SHA as `baseSha`, the exact PR `headSha`, policy/input digests and run/attempt identifiers. It double-reads evidence and rechecks the PR and default branch; drift returns unavailable. State can still change after the last read. Keep your existing GitHub merge controls.

## Run in GitHub Actions

Download `changeplane-community.yml` from the [Community release](https://github.com/LeChiffreVol2/changeplane/releases). It pins the reviewed Community Action to a full commit SHA. The [source template](../examples/changeplane-community.yml) also pins reviewed implementation bytes. Open a configuration PR adding it under `.github/workflows/`, together with the reviewed policy above. Replace the watched workflow name `CI` if your behavioral workflow uses another display name.

The template runs after the selected workflow completes and supports manual dispatch with a PR number. It uses a fresh GitHub-hosted runner, **no checkout**, no artifacts from the source workflow, no caches and read-only permissions. A workflow event without one associated PR needs manual dispatch; a fork PR remains unsupported. Do not expand this job with untrusted scripts or treat its workflow check as a required security publisher.

Outputs:

| Output | Meaning |
| --- | --- |
| `decision` | `EVIDENCE_SATISFIED`, `REVIEW_REQUIRED`, or `BLOCKED` |
| `assessment` | Single-line JSON containing exact revision, findings, evidence and advisory handback |

The workflow summary shows the decision and finding count. It deliberately omits private paths. Consumers of the JSON must treat findings as untrusted data, protect the output like repository metadata, and check the head again before acting. No automatic comment, artifact upload, proposal, repair or merge is performed.

## Embed the evaluator

```js
import { assess } from './community/core.js';

const assessment = assess(snapshot);
// Consume assessment.findings and assessment.handback as data.
// assessment.authority.guardPublished is always false.
```

The snapshot shape is demonstrated in [satisfied.json](../examples/community/satisfied.json): `schemaVersion: 1`, full lowercase `baseSha`, `headSha`, `currentHeadSha`, `policy`, `files`, and `checks`. Optional `plannedPaths` uses exact paths or terminal `/**` rules. If omitted, scope is inferred from the changed paths and is not proof of prior intent. Policy changes, tests and manifests remain protected regardless of inferred scope. Arbitrary supplied approvals cannot clear a finding. Check timestamps cannot choose between duplicate evidence; ambiguity blocks the assessment.

CLI exit codes are 0 for satisfied evidence, 1 for findings and 2 for invalid/unavailable input. They describe this assessment only. Do not translate exit 0 into a Guard, certification or merge approval.

## Limits and troubleshooting

| State | Safe consequence | Next action |
| --- | --- | --- |
| Missing policy / GitHub 404 | No assessment | Merge the policy on the default branch; verify token access |
| Pending, failed, skipped or wrong-workflow evidence | Review required | Complete the correct CI job and reassess |
| Protected tests/workflows/manifests changed | Review required | Obtain human review through your existing GitHub process |
| Duplicate matching evidence/jobs | Assessment blocked or unavailable | Give the behavioral job one unambiguous identity |
| Head, base or workflow changed during collection | No assessment | Rerun against the current revision |
| API limit, permission or provider failure | No assessment | Restore access or wait for GitHub's rate-limit reset |
| More than 100 runs/checks/jobs for a queried revision | No assessment | Narrow the workflow/evidence footprint; alpha does not silently truncate |

Other limits: 3,000 changed files, 20 required checks, 64 KB trusted policy, 1 MB offline input, 15 seconds per network request, five-minute timeout in the provided workflow. No provider retry loop consumes an unbounded budget. The CLI has no built-in scheduler or persistent state.

GitHub.com personal accounts and organizations, including Enterprise Cloud, can use the same reader. Private access depends on your GitHub account and organization policies. GitHub Actions usage is billed by GitHub under your own plan; ChangePlane charges nothing for Community. Fork PRs, GHES, Merge Queue assessments, hosted Guard publication, repair and supported full-controller self-hosting are outside this alpha.

## Uninstall and data

Remove the Community workflow and its policy through your normal configuration review. Revoke any token created only for the CLI. Delete local reports if desired. There is no ChangePlane account, database enrollment, server-side Community history or telemetry to remove. GitHub retains workflow metadata and logs according to your repository settings. The interactive website has a separate [hosted privacy draft](../PRIVACY.md).
