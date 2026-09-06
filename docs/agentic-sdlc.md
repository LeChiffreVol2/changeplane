# Agentic SDLC assurance

ChangePlane supports agentic software delivery as a GitHub-native **assurance plane**, not as a general SDLC orchestrator. Coding agents may plan, author, and repair a pull request in the tools a team already uses. ChangePlane binds the resulting GitHub revision to repository-owned policy and behavioral evidence, then explains where the work sits across the lifecycle without taking ownership of planning, merge, deployment, or production operations.

This design keeps one invariant across every surface:

> Model proposes; deterministic harness decides; trusted controller applies.

The lifecycle view is derived and read-only. It is not a second evaluator, does not publish a Check, does not persist workflow state, and never contributes to `PASS`.

## Two views, one authority model

### Repository readiness

`GET /api/github?action=runtime&repository=owner/name` returns a top-level `sdlc` projection after the installed profile and live repository controls have been verified. It classifies each repository-level checkpoint as:

- `controlled`: the required existing control is present;
- `supported`: ChangePlane can carry or display exact-revision evidence without owning the decision;
- `scope_only`: revision and paths are bound without a behavioral claim;
- `action_required`: a named Check or strict GitHub merge rule is missing or could not be proved;
- `setup_required`: the managed installation is not verified; or
- `external`: the responsibility remains in another customer system.

Malformed profiles, modes, Check counts, or enforcement data fail closed. The projection cannot turn an incomplete installation into a controlled checkpoint.

### Exact-revision explainer

The signed-out RouteThai workspace reconstructs seven checkpoints for one synthetic current head. This is a fixture-backed product explainer, not a stored production-run replay. Its pure, fail-closed projection helper is not yet serialized into the hosted API or managed Action receipt and is never presented as live customer evidence:

| Checkpoint | What ChangePlane can state | Authority that remains outside the view |
| --- | --- | --- |
| Intent | Repository-declared goal and allowed scope are bound for the revision; requirement correctness is not claimed. | Product owner and repository policy |
| Change | GitHub diff and head SHA are observed. Agent identity remains context. | Coding agent authorship |
| Review | Advisory changed-line review may be shown in Full; protected capabilities still need an authorized exact-revision human approval. | GitHub reviewers |
| Verify | Repository-owned behavioral evidence is evaluated on the exact head. | Only the deterministic harness can produce ChangePlane PASS |
| Delivery | An existing GitHub Deployment may be shown only when its SHA equals the evaluated head. | Deployment provider; this evidence is informational |
| Merge | A passing guard can be ready for GitHub policy or pass on a separate merge-group revision. | GitHub branch policy, queue, and merge decision |
| Operate | No runtime-health, incident, SLO, promotion, or rollback claim is made. | Customer observability and incident-response systems |

The helper returns `onNewRevision: "RESTART_ALL_ASSURANCE"` and requires intent, diff observation, and a passing behavioral-evidence result that are each bound to the same full 40-character SHA as the current revision. A boolean or abbreviated SHA cannot establish any checkpoint. Review and deployment metadata are independently compared to that full SHA as well. Its unit-tested invariant never aggregates verified, reviewed, approved, or deployment state across commits. A merge-group revision is evaluated independently in the helper and carries no pull-request review, approval, repair, or handback state. Publishing this projection in a live receipt would require a separate reviewed integration.

## Product profiles

The SDLC posture explains the authority already present in each managed profile:

| Profile / mode | Verify | Release gate | Repair loop |
| --- | --- | --- | --- |
| Observe / Verify Lite | Scope only; no behavioral claim | Not active | Customer-agent handback only |
| Verify / Verify Lite | Named exact-head behavioral Check | Strict Head is active when one no-bypass strict default-branch Ruleset contains the bound App guard and every bound behavioral evidence Check; Merge Queue adds Queue Certified | Customer-agent handback only |
| Observe / Full | Scope only; Full files remain installed | Not active | Repair disabled; customer-agent handback only |
| Verify / Full | Named exact-head behavioral Check; advisory review may remain available with BYOK | Same Strict Head / Queue Certified distinction | Repair disabled; customer-agent handback only |
| Autonomous / Full | Same deterministic exact-head behavioral evidence | Requires the complete Queue Certified contract, including Merge Queue | At most two controller-applied attempts inside one immutable 15-minute campaign, after every existing activation prerequisite passes |

Selecting Autonomous or installing Full does not activate repair by itself. The live enforcement, repository BYOK, verified managed tree, controller switch, repository binding, and generation checks still fail closed independently.

Verify and Autonomous also fail closed when `evidence.requiredChecks` is empty or when a Check is not bound to an exact lowercase GitHub App publisher. A `github-actions` Check must additionally bind the exact trusted `.github/workflows/*.yml` or `.yaml` path resolved from its canonical Actions run and exact head. The hosted runtime, repair controller, guard publisher, live verifier, and vendored harness enforce this contract; Observe alone may retain a legacy name-only Check while it makes no behavioral PASS claim.

The dedicated-App-owned `ChangePlane / guard` is ChangePlane's only authoritative guard. The repository job named `ChangePlane guard` is visible operational liveness only and cannot satisfy the guard or Ruleset requirement. Each exact SHA has a stable guard whose latest Evaluation Generation is identified by GitHub run ID and attempt. A newer generation may re-evaluate the same SHA, returns the guard to `in_progress`, and inherits no prior PASS; stale or duplicate completions fail closed. GitHub evaluates `merge_group` as a fresh exact revision with a fresh App-owned guard; it inherits no pull-request assurance state.

## Agent integration contract

ChangePlane remains downstream of Codex, Cursor, Claude Code, Copilot, Trae, OpenSWE, and other coding agents. Integration happens through the repository the team already trusts:

1. An agent authors or updates a same-repository pull request.
2. ChangePlane evaluates the exact GitHub revision from trusted default-branch policy.
3. A fixable failure returns bounded, credential-free findings through GitHub-native handback.
4. The agent may produce a new commit, which starts a fresh evaluation.
5. In controlled Autonomous mode only, a proposal model may suggest a bounded patch and a separately credentialed controller may apply it.
6. GitHub evaluates the fresh guard together with every other repository rule and remains the only merge authority.

No agent receives a provider key, GitHub App private key, controller secret, short-lived write token, Check authority, approval authority, merge authority, or the ability to issue `PASS`.

## Cursor Origin boundary

Cursor Origin is treated as an optional forge-facing authoring and mirror surface, not as the source of ChangePlane authority. In the candidate GitHub-mirrored architecture exercised synthetically here, Origin mirrors a GitHub repository while GitHub remains source of truth; ChangePlane reads the GitHub pull request, trusted policy, and evidence Checks and publishes its guard on GitHub. No Origin agent, Check, ruleset, review, or repository state contributes to `PASS`.

The public twelve-case proof exercises three Origin-mirror-shaped fixtures and six cross-surface assertions with no external requests or writes. Its passing cases are `guardEligible`; the proof itself publishes no Check. A separate authenticated verifier can re-fetch a dedicated-App guard, policy, evidence, and current pull-request head from GitHub after a real publisher run. Together they make the SDLC boundary executable while keeping two important limits visible: standalone Origin is unsupported and untested, and the v13 App/OIDC publisher plus mirrored-Origin path still need protected live canaries before either becomes a live interoperability claim. Historical v9 evidence does not close those v13 gates. See [Cursor Origin compatibility and proof boundary](cursor-origin-boundary.md).

## Explicit non-goals

This release does not add:

- a backlog, issue planner, sprint board, or requirements system;
- an IDE, agent workspace, proprietary repository, or Git host;
- a general workflow engine, queue, or cross-repository orchestrator;
- hosted previews, deployment promotion, release automation, or automatic merge;
- production telemetry, SLO evaluation, incident response, or rollback control; or
- a claim that a model, risk score, comment, preview, receipt, or offline passport certifies its own work.

Those boundaries are what let the lifecycle view remain useful without broadening ChangePlane's credentials or trust surface.
