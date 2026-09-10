# Open Source quickstart

ChangePlane Open Source runs locally or in your own GitHub Actions. It assesses evidence without publishing a Guard or requiring a ChangePlane account. Start with the synthetic examples, then connect one existing behavioral CI job.

Choose **Individual** for read-only PR/CI assessment. If you run several agents yourself, enable optional parallel coordination; **Teams** starts with coordination selected. Both use the same repository engine and support personal and organization repositories with appropriate permissions. The usage choice does not identify the repository owner or grant access.

Version 0.4.1 includes the CLI, setup generator, read-only MCP, agent skill, Individual and Teams settings, and [parallel task coordination, resumable work, review feedback and operator diagnostics](team-operator.md). It builds on structured diagnosis, read-only fork collection and a GitLab reader candidate. See [recovery core](recovery-core.md) for source-versus-live qualification and v2 contracts.

## Settings for Individual and Teams

Open **Settings** from the website's public landing, hosted setup or synthetic workspace. **Individual** defaults to read-only assessment; enabling parallel agents starts at 2 active tasks. **Teams** starts with coordination enabled and 3 active tasks. Adjust coordination capacity from 1–20; each usage choice retains its own draft capacity.

Settings prepare a local draft, not a connected account or installed repository configuration. For read-only use, follow [Inspect your repository](#inspect-your-repository) below. For coordination, choose **Copy coordination settings**, then open a reviewed configuration PR changing only the `team` field in the existing default-branch `.changeplane.json`. Preserve the existing evidence requirements, protected paths and other policy fields. If no policy exists, create the baseline policy through the assessment setup first, then follow [parallel setup](team-operator.md).

Before disabling existing coordination, stop participating writers and the observer. Preserve reservations, local journals, worktrees and source branches; resolve unfinished work with its owner before merging the policy change. Switching the Settings draft to Individual does not stop running operators or remove repository state.

## Run locally

Install Node.js 22.18+ (22 and 24 are tested). Clone the repository or unpack the Open Source release archive. No npm dependencies are required:

```sh
node bin/changeplane.js evaluate examples/community/satisfied.json
node bin/changeplane.js evaluate examples/community/failed.json
node bin/changeplane.js evaluate examples/community/stale.json
node bin/changeplane.js --help
```

These commands read local JSON only. The second and third intentionally exit 1. A caller-supplied snapshot is unauthenticated even when evidence is satisfied.

## Install the command

Download the archive, workflow templates and `SHA256SUMS` from [ChangePlane 0.4.1](https://github.com/LeChiffreVol2/changeplane/releases/latest). This is the single published release and includes the command wrapper, guided setup and read-only MCP. Its release notes and bundled `SOURCE.json` identify the exact source commit; `--version` alone does not identify routine updates. If you saved an earlier 0.4.1 archive, download the consolidated bundle and review the changed source commit before upgrading.

To evaluate changes after the published release, open a successful **main** run in [CI](https://github.com/LeChiffreVol2/changeplane/actions/workflows/ci.yml) and download its `changeplane-source-COMMIT-attempt-N` artifact. GitHub requires sign-in for CI artifact downloads. These artifacts expire after seven days; the release assets remain the primary download. A source checkout at an exact commit also works with `node bin/changeplane.js`.

Check the archive and workflow files against `SHA256SUMS`, then extract the `.tar.gz`. If using a CI artifact, extract its outer zip first. Run from the extracted directory with `node bin/changeplane.js`, or install its dependency-free command into your existing writable npm prefix:

```sh
npm install --global --offline --ignore-scripts --no-audit --no-fund "/absolute/path/to/extracted/changeplane-community-0.4.1"
changeplane --help
```

This installs a **local verified bundle**, not a registry package. Do not run this command on the full web-app source checkout. A global install needs a writable npm prefix; using `node bin/changeplane.js` needs no global write access. Uninstall the command with `npm uninstall --global changeplane-community`; preserve any reports and active worktrees you still need.

## Prepare setup files

From the ChangePlane runtime directory, discover job names on your repository's current default revision:

```sh
node bin/changeplane.js init OWNER/REPO --dry-run --format text
```

If your CI runs only on PRs, add `--pr NUMBER` for an open PR targeting the default branch. Discovery lists candidates; it does not select one or establish that a test checks meaningful behavior. Have the repository owner choose the exact behavioral job and its trusted workflow path, then prepare the files:

```sh
node bin/changeplane.js init OWNER/REPO --check "Behavior" --workflow .github/workflows/ci.yml --dry-run
node bin/changeplane.js init OWNER/REPO --check "Behavior" --workflow .github/workflows/ci.yml --output ../changeplane-setup-review
```

Replace `Behavior` and the path with a discovered job. Use the same `--pr NUMBER` on subsequent commands when applicable. `--dry-run` is also the default; it writes nothing. `--output` requires a new directory with an existing parent and cannot be combined with `--dry-run`.

The generator reads policy and workflow files from one exact default-branch commit, preserves existing requirements and protected paths, and appends the selected check if missing. Different existing ChangePlane workflows stop generation for manual review. Templates pin the runtime's exact source commit. The staging directory contains `.changeplane.json`, the reviewed public assessment workflow, and `changeplane-setup.json` recording the base and previous file digests. It contains no credential or installed operator.

Review the selected CI behavior and file changes. Apply the listed configuration files on one feature branch based on the recorded `baseSha`, then open a setup PR with your existing GitHub tools. Keep the local plan manifest out of the consumer repository unless you intend to retain it. If default-branch state changes, regenerate and review before applying. The tool does not execute repository code, commit, push, open a PR or install anything remotely.

For several agents or teammates, add `--coordination` and optionally `--max-active 2` (1–20). Existing capacity is preserved, or a new setup defaults to 3. This also stages the observer and review-relay workflows. Complete the separate [operator and credential-isolation setup](team-operator.md); generated files do not create that boundary. Omitting `--coordination` preserves any existing team policy and does not disable installed operators.

Setup exits 0 for a prepared review plan, 1 when a CI selection is needed and 2 for invalid/unavailable input. This differs from assessment exit codes and never establishes evidence success. `init --help` lists all options. Permission failures, ambiguous jobs, missing trusted workflows and changing revisions require the reported next action before trying again.

## Use with an agent

The read-only stdio MCP exposes only `changeplane_inspect`. The operator fixes the repository; callers provide one PR number. It uses the same GitHub collector as the CLI, with structured results and advisory authority. It has no coordination or source-write tools.

For clients using `mcpServers`, configure a trusted runtime path:

```json
{
  "mcpServers": {
    "changeplane-read": {
      "command": "node",
      "args": ["/absolute/path/to/changeplane/bin/changeplane.js", "mcp"],
      "env": { "CHANGEPLANE_REPOSITORY": "OWNER/REPO" }
    }
  }
}
```

For private access, supply a repository-scoped **read-only** `GH_TOKEN` or `GITHUB_TOKEN` through the operator environment or your client's secret mechanism. Do not embed credentials in shared JSON, prompts or committed files. Project MCP configuration is a client configuration surface, not credential isolation. Keep the credentialed process outside any untrusted coding sandbox.

Install the whole [consumer skill folder](../skills/changeplane/SKILL.md) into a skill location supported by your client, such as `.agents/skills/changeplane/` for a compatible client. Review and preserve existing repository instructions. The skill is self-contained; it distinguishes read-only PR diagnosis from an already configured team operator. Root `AGENTS.md` is for contributing to ChangePlane itself.

Ask the agent to inspect one PR, read the reported revision and next action, and reassess after any change. The complete JSON remains the default CLI output; `--format text` is a human summary and `--format compact` omits the repeated full handback while retaining findings, revision and advisory authority. Summaries cannot replace full evidence verification.

For already configured coordination, use the [separate team MCP](repository-team.md#cursor-and-other-mcp-clients). Existing eight-tool clients retain their interface. The new read-only tool does not activate that operator. Protocol and fixture tests do not establish live Cursor installation, native Origin access or process-level credential isolation.

## Inspect your repository

1. Choose one existing CI **job name** that checks meaningful behavior, not the workflow display name or a linter alone. For a matrix, bind an exact unique expanded job name.
2. Open a configuration PR adding `.changeplane.json` using [this policy](../examples/community/policy.json). Replace `Behavior` and `.github/workflows/ci.yml` with your exact job and workflow path. Review and merge that PR. Never source assurance policy from the PR being assessed.
3. Open a normal, same-repository PR targeting the default branch. Let its CI complete, then run:

```sh
node bin/changeplane.js inspect YOUR_ACCOUNT/YOUR_REPOSITORY 123
```

Public GitHub API access works without a token within GitHub's rate limit. For private repositories or higher limits, supply `GH_TOKEN` or `GITHUB_TOKEN` through your process environment or a secret manager. Prefer a fine-grained token scoped to the selected repository with **Contents: read, Pull requests: read, Checks: read, Actions: read**, plus implicit Metadata read. Organization approval/SSO may apply. Never paste the token into commands, configuration, issues or screenshots.

The collector reads repository/PR metadata, changed filenames, one default-branch policy file, workflow runs and current-attempt job states. It makes GET requests only to `api.github.com`, refuses redirects, never executes PR code and never sends data to ChangePlane. GitHub API responses may include diff data; that data is discarded and is not included in the assessment. No source-code context is forwarded to an agent or model.

The live report records the trusted default-branch SHA as `baseSha`, the exact PR `headSha`, policy/input digests and run/attempt identifiers. It double-reads evidence and rechecks the PR and default branch; drift returns unavailable. State can still change after the last read. Keep your existing GitHub merge controls.

## Run in GitHub Actions

Download `changeplane-community.yml` from the [Open Source release](https://github.com/LeChiffreVol2/changeplane/releases). It pins the reviewed Action to a full commit SHA. The [source template](../examples/changeplane-community.yml) also pins reviewed implementation bytes. Open a configuration PR adding it under `.github/workflows/`, together with the reviewed policy above. Replace the watched workflow name `CI` if your behavioral workflow uses another display name.

The template runs after the selected workflow completes and supports manual dispatch with a PR number. It uses a fresh GitHub-hosted runner, **no checkout**, no artifacts from the source workflow, no caches and read-only permissions. A workflow event without one associated PR needs manual dispatch. The reader can diagnose fork PRs from a trusted operator, but automatic fork event wiring remains separately unqualified. Do not expand this job with untrusted scripts or treat its workflow check as a required security publisher.

Outputs:

| Output | Meaning |
| --- | --- |
| `decision` | `EVIDENCE_SATISFIED`, `REVIEW_REQUIRED`, `BLOCKED`, or `UNAVAILABLE` (new source) |
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
| More than 100 runs/checks/jobs for a queried revision | No assessment | Narrow the workflow/evidence footprint; the reader does not silently truncate |

Other limits: 3,000 changed files, 20 required checks, 64 KB trusted policy, 1 MB offline input, 15 seconds per network request, five-minute timeout in the provided workflow. The new source permits at most three safe-read attempts within a sixty-second/200-request reader budget. Long rate-limit guidance returns unavailable. Assessment commands have no persistent state. Opt-in team commands maintain repository-owned Git metadata and offer bounded observation; the reviewed team template supplies GitHub scheduling.

GitHub.com personal accounts and organizations, including Enterprise Cloud, can use the same reader. Private access depends on your GitHub account and organization policies. GitHub Actions usage is billed by GitHub under your own plan; ChangePlane charges nothing for Open Source. Team writes exclude forks. Fork reading and GitLab reading have their own [qualification boundaries](recovery-core.md). GHES, Merge Queue assessments, hosted Guard publication, automatic source repair and supported full-controller self-hosting remain outside this open-source release.

See the [QA and DevOps audit](open-source-qa-audit.md) for the tested platform matrix, fixed setup issues and remaining operating limits.

## Uninstall and data

Remove the assessment workflow and its policy through your normal configuration review. Revoke any token created only for the CLI. Delete local reports if desired. There is no ChangePlane account, database enrollment, server-side assessment history or telemetry to remove. GitHub retains workflow metadata and logs according to your repository settings. The interactive website has a separate [hosted privacy draft](../PRIVACY.md).

For team uninstall, stop participating writers and the observer first. Preserve any worktrees and active task branches. After the owner has confirmed no writers remain, archive the coordination history or remove `changeplane/team-state` through the repository’s normal maintenance process; remove operator credentials and configuration. Do not delete another developer’s worktree or active reservation as a cleanup shortcut.
