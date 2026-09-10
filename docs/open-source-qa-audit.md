# Open Source QA and DevOps audit — 2026-09-10

The audit reviewed release 0.3.0 and the 0.3.1 fixes in [PR60](https://github.com/LeChiffreVol2/changeplane/pull/60). No critical or high-severity defect was found in the exercised scope. This is a maintainer audit with reproducible tests, not an independent security certification or a guarantee that every repository and client works.

## Findings and fixes

| Priority | Reproduction / impact | Resolution |
| --- | --- | --- |
| P2 | Launching the CLI from the release bundle ignored `CHANGEPLANE_TEAM_CHECKOUT`; worktree creation failed with `TEAM_LOCAL_REPOSITORY_MISMATCH` even after configuring the target clone. | CLI and MCP now honor the same target checkout. The real-Git regression failed before the fix and passes afterward, including paths with spaces, disabled checkout filters, preserved dirty files and duplicate-writer rejection. |
| P2 | The source assessment template still pinned the first alpha runtime; support instructions also mixed hosted App/model requirements with dependency-free Open Source setup. | Pin the published 0.3.0 reader and document separate assessment/team/hosted requirements. New release assets pin their own exact source revision. Previous immutable assets are retained. |
| P2 | Release CI exercised Linux, but public Node-based setup did not clearly establish macOS/Windows portability. | The required `CI / verify` now explicitly depends on six archive jobs: Ubuntu 24.04, macOS 14 and Windows 2025, each with Node 22.18.0 and 24.13.0. A failed or cancelled matrix fails the required check instead of leaving it skipped. |
| P3 | Archive tests did not independently enforce the asset inventory, checksums, source manifest, documentation links and workflow source pins. Text-mode asset output could also introduce Windows line endings. | Validate these before executing the extracted tests; emit workflow/checksum assets as explicit UTF-8 bytes. A corrupted archive was rejected before extraction or code execution. |

## Evidence

- Baseline: protected `main` at `4ed25070bda8ad73cb8d374fc14607050c099c7d`. Downloaded public 0.3.0 assets matched `SHA256SUMS`; all 41 manifest entries matched and all 98 shipped tests passed outside the source checkout, without npm installation.
- Runtime candidate: `2ab060d89af04de2b5651449e46062eab78ae4bb`. [CI run 34467655487](https://github.com/LeChiffreVol2/changeplane/actions/runs/34467655487) passed all six platform/Node combinations, with 98 archive tests each, and the required full verification job. PR60 carries the final verification after documentation and verifier hardening.
- Local full suite: 593 tests passed; Chromium onboarding: 13/13 passed. Production build, public-data scan and release-claim audit passed. CI also exercised scratch PostgreSQL journal/admission/TLS controls and the synthetic Origin boundary. No production database or other Supabase project was used.
- Live read-only collection of PR60 bound its exact candidate head, current default branch, CI run and attempt. Despite passing CI, it returned `REVIEW_REQUIRED` for protected test/workflow changes, with Guard, repair and merge authority all false.
- Production dependency audit: zero reported vulnerabilities. GitHub open Dependabot and secret-scanning alerts: zero at audit time. A supplementary scan of 226 tracked files found only four intentionally invalid PEM test placeholders, none parseable as a private key. Scanning is not proof that every possible secret format is absent.
- `main` retained strict `CI / verify`, administrator enforcement and disabled force-push/deletion. Secret scanning, push protection and Dependabot security updates were enabled. Only `ci.yml` is active in the source repository; consumer observers remain templates.

## Who can use it

| Surface | Qualified scope and prerequisites |
| --- | --- |
| Offline evaluator | Linux/macOS/Windows on the tested Node 22/24 versions; no package dependencies, token, model key or hosted account. |
| GitHub.com personal and organization repositories | Same-repository PRs targeting the default branch; reviewed policy and appropriate read access. Public reads can use unauthenticated API access within GitHub limits. Private repositories require scoped access; organization approval/SSO and repository rules still apply. No individual-versus-business license restriction. |
| Team CLI and observer | Explicit per-repository opt-in; authorized operator; Contents-write metadata access plus read permissions; trusted target checkout and separate Git authentication for worktrees. Cooperative reservations do not fence arbitrary Git writers. |
| MCP | Tested stdio protocol through 2025-11-25 and the bounded seven-tool surface. A real Cursor installation and native Origin are not qualified by these protocol tests. Keep credentials outside model/client access. |
| Read-only fork / GitLab | GitHub fork collection and GitLab.com reader have synthetic fixture coverage. Automatic fork event installation and live GitLab installation remain unqualified. No fork or GitLab team writes. |
| Hosted website and controllers | Separate controlled canary; customer activation, paid readiness and autonomous repair remain closed. Open Source does not require this service. Full website development uses Node 22.18–22.x, rather than the broader CLI matrix. |

The matrix exercises standard runner images, not every OS edition, CPU architecture, credential helper, Git configuration or IDE. Conditional Git includes are deliberately refused; Git LFS and other checkout filters are disabled during worktree creation. Repository setup and filtered asset hydration need the operator's separately trusted workflow.

## Remaining operating limits

The coordinator records at most 200 tasks and allows 1–20 active tasks, with a 500 KB state ceiling and bounded API collection. Large evidence sets can exceed the reader budget and return unavailable. Abandoned active writers require owner containment and manual recovery; reservations never expire automatically. These limits are material for long-running or large teams.

An existing coding agent must keep its task loop running; MCP does not wake a closed IDE or launch another agent. Path separation cannot eliminate semantic conflicts. GitHub still handles required reviews, branch policies and merge. Native Origin, GHES, self-managed GitLab, a fully self-operated Guard controller and autonomous cross-repository repair have no supported qualification here.

The release adds no paid infrastructure. Standard GitHub-hosted runners in this public repository are free under [GitHub's documented billing model](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Users' private CI and optional model usage remain subject to their own provider plans. OSS license availability is broader than live integration qualification.
