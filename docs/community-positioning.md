# Where ChangePlane fits

**Keep GitHub. Let agents ship.** ChangePlane connects repository work from an accepted issue plan to assigned people/agent tasks, PR evidence and delivery verification. PR assurance remains the verification core. The [repository lifecycle](repository-lifecycle.md) uses existing GitHub state and coding clients; intake, maintenance and release preparation remain proposals until the appropriate operator decision.

## Compare responsibilities

| Existing tool | Its job | ChangePlane's additional question |
| --- | --- | --- |
| GitHub CI and branch policy | Run jobs and enforce configured merge requirements | Is this evidence from the expected workflow and latest observed attempt, and were evidence controls changed? |
| Coding agents and review assistants | Author changes and suggest fixes or review findings | Do deterministic checks support this exact revision independently of the author's explanation? |
| SAST, dependency and secret scanners | Find their supported classes of security defects | Does the selected scanner/test result match the declared source and revision? |
| CI runner hardening | Limit or observe workflow execution behavior | What can this result establish about the pull request after the run? |

These tools can be combined. The assessment does not replace behavioral tests, GitHub merge policy, code review, SAST or runtime isolation. It cannot prove that tests cover the right behavior. Its live reader is an advisory point-in-time assessment, with no independent Guard publisher.

For context, [GitHub documents required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [Semgrep describes its Community SAST engine](https://semgrep.dev/products/community-edition), and [StepSecurity describes Harden-Runner's network/file/process monitoring](https://docs.stepsecurity.io/harden-runner). This is a comparison of responsibilities, not a benchmark or a claim that those tools lack their own freshness or policy controls. Source review: 2026-09-09.

## Work with native review

Codex Code Review directly overlaps PR review, check investigation and follow-up fixes; a second review UI is not a defensible differentiation by itself. The current direction is to consume published GitHub feedback alongside ChangePlane’s revision-bound CI and protected-scope assessment, then return one next action to the existing agent. Use [existing reviewer mode](community.md#use-your-existing-reviewer) without starting another model. This is a product hypothesis, not a proven advantage over native controls. See the [2026-10-03 primary-source review and remaining qualification](research/codex-code-review-fit.md).

## Reproduce the useful differences

Run `node --test community/core.test.js`. The suite covers satisfied evidence, failed/skipped/pending checks, a newer same-SHA run, stale heads, wrong publishers/workflows, protected-file renames, missing policy, incomplete API results, ambiguous jobs, revision drift and read-only transport. Offline fixtures are synthetic. Live release qualification is bounded to the exact fixtures and revisions recorded in release notes.

The useful customer experiment is one existing behavioral job on one active repository. Measure setup completion, repeat assessments, actionable findings and whether the finding changes a real decision. Record false blocks as well as successes. Stars, downloads and synthetic passing cases are not customer outcome evidence.

## Launch message

See what needs attention across your repository and who should act next. ChangePlane Open Source provides repository intake, scoped accepted plans, cooperative task workspaces, PR feedback and CI assessment, delivery receipts, and maintenance/release preparation. No model key, ChangePlane account or hosted database is needed for the core. The existing agent performs development; humans accept plans and criteria; GitHub keeps merge authority. Start with the [agent setup prompt](../README.md#start-with-your-agent). Bounded observations and synthetic tests establish specific behaviors, not a proven advantage over native GitHub workflows.

## Agent-first distribution, human-controlled authority

The primary entry is the user's existing coding agent, with CLI or MCP returning structured findings. The website helps the person hand off setup and inspect exceptions; hosted onboarding remains optional. Individual and Teams are configuration choices after the entry point, not competing first actions.

This is a distribution and usability hypothesis, not evidence of a global advantage. GitHub already provides [agents that author PRs](https://docs.github.com/en/copilot/responsible-use/agents), and Cursor provides [review-triggered autofix](https://cursor.com/changelog/02-26-26). Their capabilities support the workflow direction while making generic review/autofix positioning less distinctive. These references do not establish that either product lacks independent checks or policy controls. Source review: 2026-09-20.

Evaluate ChangePlane by whether an existing agent can reach its first current-PR assessment, how much operator intervention setup needs, whether findings change a real decision, and whether operators return. Use the existing [adoption and effort report](adoption-measurement.md) with opt-in operator evidence; prompt copies and opened drawers are not activations. No automatic telemetry is added.
