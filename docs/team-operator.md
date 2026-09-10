# Set up parallel agents for yourself or a team

Give each feature a scoped task and a separate worktree, whether you run several agents yourself or develop with teammates. ChangePlane follows PR, CI and review outcomes and returns the next action to the assigned writer. Your existing coding agent develops the feature; GitHub applies the repository's checks, reviews and merge rules. For one developer who only needs PR/CI findings, start with [Individual read-only assessment](https://github.com/LeChiffreVol2/changeplane/blob/main/docs/community.md#inspect-your-repository).

This guide uses a trusted local operator plus a repository-owned GitHub Actions observer. It requires GitHub.com access, Git, Node.js 22.18+ and an existing behavioral CI job. It adds no ChangePlane service or model spend. GitHub Actions and any coding agents remain subject to your own plans. For a credential-free first look, use the [local quickstart](https://github.com/LeChiffreVol2/changeplane#try-it-in-one-minute).

## Choose your settings

Open **Settings** on the website and choose **Individual** or **Teams**. Individual starts with read-only assessment; enable parallel agents for coordination with a default capacity of 2. Teams starts with coordination selected and capacity 3. Either capacity can be 1–20. These are usage preferences for the same engine, independent of personal versus organization repository ownership.

Use **Copy coordination settings** to prepare the `team` field for review. Settings remain a local draft and confer no permissions. Merge that field into the existing `.changeplane.json` through a setup PR, preserving all evidence requirements, protected paths and other policy. The JSON fragment alone is not an installation; complete the operator and workflow setup below.

## 1. Prepare one repository

Choose a personal or organization repository and a person responsible for setup. Organization approval, SSO, Actions restrictions and rulesets still apply. Start with two independent features, not a migration of all existing work.

Use a reviewed ChangePlane release or trusted source checkout outside the coding sandbox. Keep a separate trusted clone of the target repository, with an `origin` matching `https://github.com/OWNER/REPO.git` or `git@github.com:OWNER/REPO.git`. Configure Git authentication for that clone separately from the API credential.

If the target has no `.changeplane.json`, start from the [assessment setup guide](https://github.com/LeChiffreVol2/changeplane/blob/main/docs/community.md#inspect-your-repository). Choose one meaningful CI job by its exact job name, publisher and workflow path. Add this field to the existing policy, preserving its evidence and protected paths:

```json
"team": { "enabled": true, "maxActive": 3 }
```

This example uses the Teams default. A solo parallel setup can use `maxActive: 2`, or the capacity selected in Settings.

The [setup generator](community.md#prepare-setup-files) can stage the policy, observer and review relay with `--coordination`, preserving existing policy. Review its exact base and runtime revision. It does not configure the credentialed operator described below.

Open and review one setup PR. Include `changeplane-team.yml` and `changeplane-team-review-signal.yml` from the same release under the target repository's `.github/workflows/`. Keep the observer's runtime pinned to that release's full SHA. If using source templates, replace `CHANGEPLANE_TEAM_RELEASE_SHA` with the reviewed full commit SHA. Change the observer's watched `CI` name to your behavioral workflow's display name; retain `ChangePlane review signal`.

The observer runs pinned runtime without contributor code. The separate review signal has no permissions, checkout or secrets. Its completion wakes the observer; its payload and artifacts are not evidence. General PR comments run the trusted observer directly. Reviews, inline comments and missed events are also discovered by the scheduled sweep. Never add `pull_request_review` directly to the credentialed observer: GitHub runs that event's workflow definition from the PR merge commit. [GitHub's event trust model](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target) explains this distinction.

Merge the setup PR through your normal review. Keep required behavioral CI and human review rules; do not require the observer's green job as proof of correctness. A team reservation does not grant a model permission to push, approve or merge.

## 2. Check the trusted operator

The operator needs a repository-scoped GitHub App installation token with Contents write and Pull requests, Actions and Checks read. The scheduled observer uses its repository-scoped Actions token. Supply credentials only to the trusted operator process through your existing secret manager. Do not put tokens in task JSON, shared MCP configuration, an agent's shell or source files.

| Operator setting | Value |
| --- | --- |
| `CHANGEPLANE_TEAM_REPOSITORY` | `OWNER/REPO` |
| `CHANGEPLANE_TEAM_WRITE` | `true` |
| `CHANGEPLANE_TEAM_MEMBER` | One stable member label |
| `CHANGEPLANE_TEAM_CHECKOUT` | Absolute path to the trusted target clone |
| `GH_TOKEN` or `GITHUB_TOKEN` | Scoped credential injected by the operator's secret manager |
| `CHANGEPLANE_WORKSPACE_ROOT` | Absolute directory for new worktrees, required for MCP |

Run from the ChangePlane runtime directory:

```sh
node community/cli.js team doctor OWNER/REPO
node community/cli.js team status OWNER/REPO
```

Doctor reads setup and Git state without creating a task, reserving a workspace or changing a branch. Fix its reported next action, then run it again. It cannot prove token write permission, repository-rule compatibility or operating-system isolation; the first synthetic task below exercises the metadata write path.

The coding sandbox must not read the operator's credentials, environment or runtime. A stdio MCP connection does not create that boundary. Use the isolation your existing agent runtime provides, with the operator outside that sandbox; if it cannot enforce the boundary, keep credentialed coordination with the trusted operator and use the agent only for separately authorized source work. There is no qualified universal Cursor/container deployment recipe in this release.

## 3. Start two small tasks

Create a task file for one feature, with paths that fit the real codebase:

```json
{"id":"search-api","title":"Add search API","paths":["src/search/**"],"dependsOn":[]}
```

```sh
node community/cli.js team start OWNER/REPO task.json YOUR_MEMBER_LABEL
node community/cli.js team worktree OWNER/REPO search-api /absolute/path/to/new-worktree
```

Retain the returned task, branch, workspace ID and path. Worktree creation does not install dependencies or run repository scripts; Git checkout filters are disabled. Perform trusted repository setup with your existing tools. Develop and open a same-repository PR from the assigned branch to the default branch.

Have your second agent or another member start a task in a different scope and its own worktree. Each running agent must retain its exact task and workspace IDs and continue only that work, even when one person's member label owns several tasks. An overlapping task must wait. Declare a dependency if the second feature needs the first PR merged. Path separation helps coordination but does not establish semantic independence.

```sh
node community/cli.js team reconcile OWNER/REPO
node community/cli.js team next OWNER/REPO
```

Reconciliation discovers each task's PR by its branch. The next report is addressed to the configured member: `work` contains freshly observed unfinished context, including work acknowledged before a restart; `handoffs` contains pending receipts only. Resume the existing assigned workspace from `work`. An empty receipt list is not completion. Let the existing agent handle its own findings within scope, then push and re-observe. Use the [agent task loop](../examples/changeplane-team-agent.md) and [MCP configuration](repository-team.md#cursor-and-other-mcp-clients) when your runtime can enforce operator isolation. ChangePlane does not wake a closed IDE or launch another model.

## 4. Prove the loop before relying on it

Use synthetic source and the same permissions and CI settings you intend to operate. Confirm both independent PRs appear, an overlapping task waits, failed CI returns work to the correct existing writer, and a new commit replaces the old evidence. Add a review comment and confirm a fresh observation includes it. Test acknowledgement followed by client restart, interrupted workspace creation, and an API permission failure. None may create another writer or claim a successful repair.

Merge through native GitHub controls. Confirm merged ancestry releases dependent work, then run `team archive OWNER/REPO TASK` for merged or cancelled-before-start tasks. The receipt remains in coordination history, referenced dependencies still work and the old task ID cannot be reused. Required human reviews remain human decisions. Keep the first week's task outcomes locally: time to first task, interventions per PR, unrecovered interruptions and useful decisions. Passing synthetic tests is not a measured reduction in team effort.

## Recover an interruption

Stop new writers for the affected task and inspect it first:

```sh
node community/cli.js team doctor OWNER/REPO TASK
node community/cli.js team status OWNER/REPO
```

| Situation | Safe consequence and next step |
| --- | --- |
| API permission, missing policy or rate limit | No success is established. Follow the specific doctor or command next action; retain the reservation. |
| Rejected competing metadata write | Read current state before making a new decision. Never replay a stale write. |
| Unknown write acknowledgement | The write may have succeeded. Inspect the shared reservation and local intent before retrying. |
| Existing worktree or branch | Preserve its contents and uncommitted work. Continue only in the verified assigned workspace. |
| Missing or mismatched local journal | Keep the reservation. Have the owner investigate the original machine; do not create another writer. |
| Closed, unmerged PR or abandoned writer | Contain the writer first. Closing a PR or waiting for a timeout does not fence it or release its scope. |
| Changed trusted policy | Review the change against the task scope and actual workspace before authorizing continuation. Re-reading status alone does not accept new policy. |
| Cancelled prerequisite | Cancel the dependent unstarted task and plan replacement work with new IDs and dependencies; recorded contracts are immutable. |
| Deferred observation | The current sweep made no assessment for deferred tasks. Re-observe after other work or the provider settles; a green observer does not certify them. |

After reviewing a changed policy, the trusted operator for the task owner may run `team adopt-policy OWNER/REPO TASK EXPECTED_POLICY_SHA`, using the exact current full default-branch SHA that was reviewed. Adoption clears stale handoff context while retaining task scope, generation, branch and workspace. Read `team next` again afterward. This is a policy-adoption decision, not an approval of source changes, and it must not be delegated to untrusted review text or a proposal model.

There is no automatic expiry, arbitrary branch reset or cross-machine takeover. The owner must resolve uncertain writers before manually repairing coordination. Preserve the metadata history as an audit record. Before disabling coordination, stop participating writers and the observer, preserve reservations and local journals, and resolve unfinished work with its owner. Change only the `team` field through a reviewed policy PR; changing the Settings draft does not stop installed operators. For uninstall, revoke dedicated credentials and remove reviewed workflows, preserving worktrees and source branches.

## Upgrade existing installations

The lifecycle update migrates board schema 1 to schema 2. Stop observers and participating task loops, preserve the coordination ref and local intent journals, and upgrade every operator plus both workflow templates to one reviewed release. Old 0.3.x writers reject schema 2; mixed versions cannot cooperate. Run doctor and status, recover the existing assigned workspaces, then restart the observer and task loops. Updating a local checkout does not update immutable workflow pins. Preserve archived receipts when exporting or restoring coordination history.

## Qualification boundary

The [repository qualification record](repository-team-qualification.md) identifies live synthetic exercises; the source tests qualify additional deterministic behavior separately. GitHub.com personal and organization access depend on the operator's permissions. Native Cursor installation, long-running unattended teams, GitLab writes, native Origin and independently operated Guard/source-repair controllers require their own qualification. The interface supports agentic teamwork; it does not establish that any agent or repository can run without human intervention.
