# Contributing to ChangePlane

Start with a reproducible problem and a small pull request. English is the shared language for documentation and issue discussions; clear reports in other languages are welcome. We maintain the project on a best-effort basis and do not promise a response time.

## Setup

The CLI and read-only Action need Node 22.18+ and no dependencies. Full product development uses Node `>=22.18 <23`:

```sh
npm ci
node --test community/*.test.js
npm test
npm run verify
npm run test:e2e
```

Chromium may need `npx playwright install chromium`. CI additionally exercises disposable local PostgreSQL for journal, admission and TLS behavior. Never point tests at a production database. No live GitHub credentials or model key is required for the ordinary test suite. The required CI check also gates on dependency-free release tests on Ubuntu 24.04, macOS 14 and Windows 2025, with Node 22.18.0 and 24.13.0. These exercise real local Git worktrees and MCP framing; they do not qualify every credential helper or IDE client.

## Find your way around

| Path | Responsibility |
| --- | --- |
| `bin/`, `skills/` | Public command wrapper and consumer agent instructions |
| `community/` | Public CLI, provider readers, opt-in repository coordination, MCP, Action and tests |
| `src/lib/changeplane.js` | Shared deterministic evaluator |
| `examples/changeplane-evidence-policy.js` | Shared protected-evidence rules |
| `action/`, `server/`, `api/` | Hosted managed runtime and trusted controllers |
| `src/App.jsx`, `src/styles.css` | Public product and synthetic replay |
| `docs/README.md` | Task-based documentation index; distinguishes current guides and historical evidence |
| `docs/`, `evidence/` | Contracts and bounded historical observations |

For interface changes, follow the [shared UI roles and design QA](docs/ui-design.md). Reuse `src/tokens.css` and the existing controls and drawers, and check narrow layouts as well as desktop.

## Pull requests

Forking this project to contribute is welcome under Apache-2.0. Read-only fork assessment is a separate candidate capability; team writes to fork PRs remain unsupported. This does not restrict contributions to this project.

Explain the user-visible problem, final behavior and validation. Add a regression test for substantive behavior changes. Keep changes to evidence, dependencies, managed runtime, policy and workflows explicit for human review. Never add a second evaluator or allow a model, report, comment or workflow job to grant Guard authority.

Only `.github/workflows/ci.yml` is active here. New customer workflows belong in `examples/` until reviewed and installed elsewhere. Avoid network-dependent tests; inject bounded GitHub responses and prove drift/failure behavior. Source changes go through protected PRs with `CI / verify`; maintainers do not bypass it.

Routine fixes, UI polish and documentation updates do not need a version bump or a new release tag. Version changes are reserved for major product changes. Identify routine builds by their full commit SHA; routine updates do not move published tags or replace release assets. The owner-authorized consolidation to the single 0.4.1 release is a one-time exception, documented in its release notes. Preserve full commit pins when updating installed workflows.

By intentionally submitting a contribution, you offer it under this project's Apache-2.0 license, as described in section 5 of that license. Submit only work you have the right to contribute and retain third-party notices. No CLA or copyright assignment is required by this project at present.

## Community conduct

Be respectful, discuss ideas and code rather than people, and welcome newcomers. Harassment, threats, doxxing and disclosure of another person's private information are unacceptable. Maintainers may edit/remove harmful public content and restrict participation. Do not post personal details publicly.

## Reporting

For setup or usefulness feedback, use the optional [first-use form](https://github.com/LeChiffreVol2/changeplane/issues/new?template=adoption_feedback.yml). It asks what happened and how much work remained, without requiring private reports. Maintainers can measure aggregate adoption using the offline [experiment guide](docs/adoption-measurement.md).

Use the issue templates for ordinary defects and proposals. Include a synthetic reproduction, release version, Node version, OS, redacted error code and expected behavior. Do not upload real private assessment JSON, source, tokens or screenshots containing repository secrets. Report vulnerabilities using [SECURITY.md](SECURITY.md).
