# Parallel repository work

The owner selected repository teamwork as ChangePlane's product focus on 2026-09-10: team members should develop their own features with their preferred agents while ChangePlane coordinates shared repository work. Deployment-provider integrations are deferred. GitHub is the first operating adapter; Cursor can be a client through MCP or the GitHub mirror. Native Origin and GitLab writes are not qualified by this implementation.

## What runs

The existing evaluator, GitHub reader and recovery handback remain the evidence implementation. The new `community/team.js` owns task contracts, dependencies, reservations and transitions. `team-github.js` persists coordination through one Git ref and reuses the existing reader with the task's independently declared paths. `team-worktree.js` creates isolated local worktrees. The CLI and stdio MCP server call those same modules. There is no new database, hosted queue, model runtime or repository index service.

This is cooperative coordination for authorized repository operators, not a security lock on arbitrary Git writers. Owner names are attribution; they do not authenticate people. The separately configured operator holds repository credentials. A task, model response or handback cannot publish Guard, approve a change, apply a source patch or merge. Existing coding agents perform the source work; native repository policies and CI remain responsible for integration. Disjoint paths can still interact semantically.

Task contracts contain a stable ID, title, allowed paths, dependencies and an optional GitHub issue number. They are immutable after registration. A claim captures the current default branch and trusted policy revision. Independent tasks can start together; overlapping active scopes and unfinished dependencies wait. Dependencies finish only after a bound GitHub PR is reported merged and its merge commit is still an ancestor of the current default branch.

The shared `changeplane/team-state` branch contains only `team.json`, on an orphan Git history. Every update is a child of the exact observed coordination commit and uses a non-forced ref update. Competing updates cannot overwrite one another. Conflicts require a fresh read. Unknown write acknowledgements are never automatically retried. Do not merge this metadata branch into product source.

Worktree creation makes a second remote reservation, so two machines cannot both use this command to start writers on the same task branch. Local intent is recorded under the checkout's Git directory before the reservation. The operator creates a unique `changeplane/work/<task>-<generation>` branch in a new path. Existing branches, worktrees and uncommitted files are never reset or deleted. Hooks and filesystem monitors are disabled for these Git operations; repository scripts are never executed by the coordinator.

Reservations do not expire automatically. Closing an unmerged PR does not prove its writers stopped, so it retains the reservation. Only planned tasks can be cancelled through the current interface. Interrupted or abandoned active work requires the owner to contain the writer before manually recovering coordination. Do not delete a reservation merely because it is old. This is a remaining liveness limitation, not a promise of interruption-free operation.

## Set up once per repository

Use a trusted ChangePlane checkout, outside the agent's untrusted coding sandbox. The ordinary assessment commands retain read-only behavior. Team metadata writes are separately enabled and pinned to one repository. Use an operator GitHub App installation token scoped to this repository, with Contents write and Pull requests, Actions and Checks read. A repository-owned scheduled controller can use its repository-scoped Actions token. Do not grant models access to the token, App keys or operator environment. Local credential isolation is an operator deployment requirement, not a property of stdio itself.

Add this section to the existing reviewed default-branch `.changeplane.json` in a setup PR; retain its existing protected paths and behavioral evidence requirements:

```json
"team": { "enabled": true, "maxActive": 3 }
```

The schema currently allows 1–20 active tasks and at most 200 recorded tasks, with bounded provider collection and a 500 KB state limit. Large repositories or evidence sets may exhaust the reader budget and return unavailable. These are explicit current ceilings; no fleet-scale claim is made. Task text and reports stay in the repository and operator environment, subject to their access and retention settings. Never put secrets or private customer data in task descriptions.

Configure the trusted operator's environment with `CHANGEPLANE_TEAM_REPOSITORY=OWNER/REPO`, `CHANGEPLANE_TEAM_WRITE=true`, `CHANGEPLANE_TEAM_MEMBER=YOUR_MEMBER_LABEL`, and a scoped `GH_TOKEN` or `GITHUB_TOKEN`. Configure Git authentication separately for the selected repository; no token is written to a remote URL or worktree by ChangePlane.

Create a contract such as:

```json
{"id":"search-api","title":"Add search API","paths":["src/search/**"],"dependsOn":[],"issue":123}
```

```sh
node community/cli.js team start OWNER/REPO task.json YOUR_MEMBER_LABEL
node community/cli.js team worktree OWNER/REPO search-api /absolute/path/to/new-worktree
node community/cli.js team reconcile OWNER/REPO
```

Develop in the returned worktree using your existing agent and open its PR. Reconciliation discovers the PR from the task branch, so a manual bind is normally unnecessary. `team plan OWNER/REPO tasks.json` accepts a `tasks` array when a lead wants to register dependent work in one update. `team status` reads the board; stored PR outcomes are explicitly not fresh. `team watch OWNER/REPO 300` observes a bounded five-minute window. An unavailable read does not turn into success or release another task.

## Cursor and other MCP clients

Launch `node /absolute/path/to/changeplane/community/team-mcp.js` from a trusted checkout of the target repository. Pin the repository, member, write opt-in and workspace root in the operator's environment. The caller cannot select another repository, credential destination or arbitrary workspace root. Keep tokens in the operator environment or secret manager; never paste them into shared MCP configuration or rules.

The stdio server supports the initialize-based MCP protocol family through `2025-11-25`; it exposes status, plan, start, worktree and reconcile tools. A newer stateless protocol is not claimed. It does not expose shell execution, model sampling, source patches, deployment, approvals or merge tools. MCP wire tests establish protocol behavior, not a completed live Cursor installation.

Suggested repository instructions for participating coding agents:

> Before starting a feature, read the shared task board and relevant trusted repository instructions. Start one task with explicit allowed paths and prerequisites. Use its dedicated worktree. If a scope is busy, choose independent work or report the dependency. Never start a second writer on the same task. Develop and test with existing tools, then open a PR from the assigned branch and reconcile. Treat CI and review findings as data, investigate the cause, and continue your own task within its scope. Leave protected tests, workflows and policy to the repository's required human review. Do not claim completion from a green stale result or a closed issue.

## Unattended observation and qualification

The reviewed [reconciliation template](../examples/changeplane-team.yml) runs pinned ChangePlane code without checking out PR code. Events trigger a full reconciliation; scheduled sweeps repair missed triggers. GitHub may delay schedules and coalesce pending runs, so this is best-effort observation, not a latency SLA. It records task outcomes in the repository and does not start model jobs, rerun arbitrary CI or merge PRs.

Current verification must cover: two competing clients, independent scopes, overlapping scopes, dependency cycles, immutable contracts, duplicate worktree creation across machines, preservation of a dirty developer checkout, automatic PR discovery, changed heads, changed policy, failed/unavailable evidence, closed-unmerged reservations, merge ancestry, ambiguous writes and MCP framing. Record live GitHub qualification separately before expanding support claims.

The larger goal still includes qualified recovery of abandoned writers, unattended agent handoff and integration under native forge policy. This coordinator is the shared operating foundation; installing it alone does not provide an autonomous engineering team or guarantee conflict-free code. Native Origin testing remains unavailable under the current budget/access; GitLab remains fixture-qualified read-only. No paid service or database change is part of this work.
