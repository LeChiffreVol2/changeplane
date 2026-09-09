# Where ChangePlane fits

**Keep GitHub. Let agents ship.** ChangePlane Open Source asks whether a pull request's declared evidence applies to the exact change being assessed. Its narrow entry point is useful when teams use multiple coding agents but keep GitHub and existing CI.

## Compare responsibilities

| Existing tool | Its job | ChangePlane's additional question |
| --- | --- | --- |
| GitHub CI and branch policy | Run jobs and enforce configured merge requirements | Is this evidence from the expected workflow and latest observed attempt, and were evidence controls changed? |
| Coding agents and review assistants | Author changes and suggest fixes or review findings | Do deterministic checks support this exact revision independently of the author's explanation? |
| SAST, dependency and secret scanners | Find their supported classes of security defects | Does the selected scanner/test result match the declared source and revision? |
| CI runner hardening | Limit or observe workflow execution behavior | What can this result establish about the pull request after the run? |

These tools can be combined. The assessment does not replace behavioral tests, GitHub merge policy, code review, SAST or runtime isolation. It cannot prove that tests cover the right behavior. Its live reader is an advisory point-in-time assessment, with no independent Guard publisher.

For context, [GitHub documents required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [Semgrep describes its Community SAST engine](https://semgrep.dev/products/community-edition), and [StepSecurity describes Harden-Runner's network/file/process monitoring](https://docs.stepsecurity.io/harden-runner). This is a comparison of responsibilities, not a benchmark or a claim that those tools lack their own freshness or policy controls. Source review: 2026-09-09.

## Reproduce the useful differences

Run `node --test community/core.test.js`. The suite covers satisfied evidence, failed/skipped/pending checks, a newer same-SHA run, stale heads, wrong publishers/workflows, protected-file renames, missing policy, incomplete API results, ambiguous jobs, revision drift and read-only transport. Offline fixtures are synthetic. Live release qualification is bounded to the exact fixtures and revisions recorded in release notes.

The useful customer experiment is one existing behavioral job on one active repository. Measure setup completion, repeat assessments, actionable findings and whether the finding changes a real decision. Record false blocks as well as successes. Stars, downloads and synthetic passing cases are not customer outcome evidence.

## Launch message

ChangePlane Open Source is an Apache-2.0 CLI and GitHub Action for evidence assessment on agent-authored PRs. It reads trusted default-branch policy, checks the latest observed workflow attempt on the exact head, flags changes to tests and evidence controls, and returns JSON findings to your existing agent. No model key, ChangePlane account, or hosted database is needed. GitHub keeps merge authority. Try the three local examples, then connect one behavioral CI job.
