# From an issue to verified delivery

ChangePlane connects the work in one GitHub repository: intake, an accepted plan, scoped people/agent tasks, PR feedback and CI, delivery acceptance, and maintenance preparation. GitHub retains review and merge authority. The existing coding client performs development; ChangePlane does not launch arbitrary agents or replace their runtime.

## Start with what needs attention

```sh
changeplane repository OWNER/REPO --format text
changeplane repository OWNER/REPO --issue 42
```

The read-only MCP equivalent is `changeplane_repository({issue:42})`, with repository scope fixed by the operator. The website's connected repository activity and ChatGPT's `inspect_repository` use the same reader. Hosted rollout and repository access restrictions still apply; the open-source CLI is independently operable.

The reader returns bounded issue/PR inventory, task owners and dependencies, missing-input prompts, possible duplicate issues, priority from existing repository labels, maintenance candidates and an unpublished release draft. Missing permissions and incomplete windows are explicit. Duplicate and missing-input suggestions are heuristics. A stored team outcome is not fresh assurance; reconcile before action. Private issue access additionally needs Issues read permission.

Explicitly selecting an issue returns up to 16,000 characters of its body as untrusted context, with a truncation flag; the digest binds the complete goal. The general inbox does not return raw issue bodies. Accepted issue plans contain at most 20 tasks, each with up to 20 criteria. A changed goal requires restoring the reviewed goal or planning replacement work on a new issue; existing writers are never silently retasked.

## Agree the work once

Use the selected issue's `revision` to prepare `plan.json`:

```json
{
  "issue": 42,
  "issueRevision": "REPLACE_WITH_THE_RETURNED_64_CHARACTER_DIGEST",
  "tasks": [
    {
      "id": "handle-empty-results",
      "title": "Show an empty result state",
      "paths": ["src/search/**"],
      "dependsOn": [],
      "acceptanceCriteria": [
        "An empty result displays the agreed message and a working retry action."
      ]
    }
  ]
}
```

The human repository operator reviews the concrete scope and criteria, then accepts it through the already configured [team operator](team-operator.md):

```sh
CHANGEPLANE_TEAM_OPERATOR=true changeplane team accept-issue OWNER/REPO plan.json --human-reviewed
```

This also requires `CHANGEPLANE_TEAM_WRITE=true`, exact `CHANGEPLANE_TEAM_REPOSITORY`, the operator's scoped credential, and trusted default-branch `team.enabled=true`. Credentials belong in the trusted operator process, separate from the coding sandbox. The flag records the operator's explicit action; it is not authentication of a person. Do not expose this command or credential to a proposing model. Plan acceptance and delivery confirmation are absent from model-facing MCP tools.

Acceptance re-reads the issue and refuses a changed revision. The accepted plan is immutable. Schema 3 retains older task records; upgrade every participating writer before accepting issue plans, because older runtimes intentionally reject the newer schema. The plan is metadata on the existing coordination branch, not a source-write grant. Unknown writers are not fenced.

## Assign, work and follow through GitHub

Claim a ready accepted task with `team claim OWNER/REPO TASK OWNER`, then create its worktree once with `team worktree`. The existing team MCP supplies the same reservation and workspace path for operator-configured members. Dependencies and overlapping reservations hold conflicting work. See [repository teamwork](repository-team.md) for configuration and the observer template.

The assigned person or enabled coding agent develops in that workspace and opens its task PR. `team next` refreshes PR/CI/review handoffs and returns the same writer's unfinished work after a restart. Acknowledge the exact handoff, investigate feedback within scope, and reassess each new commit. Protected changes retain human review. GitHub's normal review and merge process controls integration. A reservation or copied prompt is not agent execution; use the existing client's authorized runtime to start or resume it.

The optional trusted Actions observer keeps coordination outcomes current without a ChangePlane database or queue. It is a consumer template under `examples/`, not another active workflow in ChangePlane's own repository.

## Verify delivery and accept the result

```sh
changeplane team delivery OWNER/REPO 42
```

The equivalent read-only team tool is `changeplane_delivery({issue:42})`. Delivery reads every task in the accepted plan, including archived tasks, and verifies current PR identity, merged heads, merge ancestry and trusted policy. It returns blockers, each criterion and an exact delivery `digest`. Green CI, a merged PR or GitHub's automatic issue closure does not itself satisfy the criteria.

After checking every criterion, the human operator prepares `acceptance.json`:

```json
{
  "issue": 42,
  "digest": "REPLACE_WITH_THE_CURRENT_DELIVERY_DIGEST",
  "acceptedCriteria": [{"task": "handle-empty-results", "criterion": 0}]
}
```

Include every criterion exactly once; `criterion` is its zero-based position. Then:

```sh
CHANGEPLANE_TEAM_OPERATOR=true changeplane team confirm-delivery OWNER/REPO acceptance.json --human-reviewed
```

`CHANGEPLANE_TEAM_MEMBER` attributes the operator's receipt; it is not independent identity authentication. Confirmation records a durable receipt on the coordination branch and repeats the live verification. Changed issues, tasks, PR revisions or default/policy revisions invalidate the pending digest. Read fresh delivery and explicitly review again; older receipts remain historical.

Optional issue closure is separate:

```sh
CHANGEPLANE_TEAM_OPERATOR=true CHANGEPLANE_ISSUE_WRITE=true \
  changeplane team close-issue OWNER/REPO 42 DELIVERY_DIGEST --human-reviewed
```

The trusted default-branch policy must additionally enable `team.issueCloseEnabled:true`, and the operator needs Issues write permission. Only the confirmed, freshly revalidated issue may be closed as completed. No PR merge, source write, approval or comment is submitted. After an uncertain write, read current state before deciding whether to repeat; the controller never blindly retries a mutation.

## Maintain and prepare the next release

To sync a confirmed delivery to an existing GitHub Projects v2 item, enable trusted `team.projectSyncEnabled:true` through the configuration PR. In the separate operator environment set `CHANGEPLANE_PROJECT_WRITE=true`, the exact `CHANGEPLANE_PROJECT_ID`, `CHANGEPLANE_PROJECT_FIELD_ID` and `CHANGEPLANE_PROJECT_OPTION_ID`, plus `CHANGEPLANE_PROJECT_TOKEN` from the operator's secret manager with the required Project write and issue read access. The field must be single-select and the issue must already belong to that Project; the controller never adds items or creates Projects.

```sh
CHANGEPLANE_TEAM_OPERATOR=true \
  changeplane team sync-project OWNER/REPO 42 DELIVERY_DIGEST --human-reviewed
```

This verifies the confirmed receipt and exact issue/repository/item/field/option before changing one field. An already matching value is a read-only no-op. Changed state, incomplete pagination or uncertain writes require inspection; GitHub's field API does not provide an atomic lock across delivery and Project changes. This operator-only command is not exposed to MCP or ChatGPT. See GitHub's [Project update API](https://docs.github.com/en/graphql/reference/mutations#updateprojectv2itemfieldvalue).

Return to repository activity for existing dependency PRs, documentation or flaky-test issues identified by repository labels, and failed default-branch workflows. These are investigation candidates, not automatic diagnoses. Select a candidate and use the same accepted-plan flow; labels or failed CI do not authorize repair.

Release preparation summarizes a bounded window of merged PRs and identifies the observed target SHA. It does not choose a version, claim a complete tag-to-tag changelog, create a tag, publish a release or deploy. Review the draft through the repository's existing release policy. Every omitted or unavailable source remains visible.

## Qualification

Automated fixtures exercise intake, state transitions, stale inputs, metadata permissions and delivery failure cases without real customer data. Browser journeys exercise connected activity using synthetic GitHub responses. These establish tested software behavior, not live qualification of every GitHub App installation, agent runtime or organization policy. Hosted writes remain gated by the existing rollout and production provenance controls.

Issue closure and Projects synchronization are available through the explicit open-source operator controller. The hosted workspace and ChatGPT expose reads and handoffs; they do not expose these operator decisions. Live Project writes have not been qualified against a customer installation. Tests exercise the actual delivery verifier and mocked GitHub API, including 20 archived tasks within the shared request budget.
