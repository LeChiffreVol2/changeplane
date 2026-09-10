# Repository usability research

Research date: 2026-09-11. Public source review and local read-only CLI examples; no competitor installations, comparative live benchmarks, or external repository mutations. Links reference mutable default branches. Recommendations are interpretations, not release or qualification claims.

The strongest opportunity is to make ChangePlane's existing deterministic assessment and assigned-writer recovery easier to adopt. The reviewed projects expose clearer installable and agent-facing entrypoints. ChangePlane has a small offline runtime, but real-repository setup and operator isolation still need work; no comparative usability or safety win has been measured.

| Project | Consumer entry | Most useful pattern |
| --- | --- | --- |
| [GitHub Agentic Workflows](https://github.com/github/gh-aw) | CLI extension and workflow wizard | Task-specific agent links; reusable workflow packages |
| [OpenAI Symphony](https://github.com/openai/symphony) | Specification or reference runtime | Contract separated from implementation |
| [Google Jules SDK](https://github.com/google-labs-code/jules-sdk) | TypeScript package and MCP package | Explicit task lifecycle and package boundaries |
| [OpenAI Codex](https://github.com/openai/codex) | Installed CLI or SDK | Product installation separated from contributor build |

## GitHub: Agentic Workflows

**Public surface.** `github/gh-aw` is GitHub Next's open-source GitHub CLI extension for compiling Markdown workflows into GitHub Actions. Its scope includes reasoning-driven repository automation alongside conventional deterministic CI. The documented engines include Copilot, Claude Code, Codex, Gemini, and Pi. [Project overview](https://github.github.com/gh-aw/about/), [repository README](https://github.com/github/gh-aw)

**Organization.** The root exposes `cmd/`, `pkg/`, `actions/`, `schemas/`, `specs/`, `docs/`, and maintenance scripts. Alongside contributor policy, the README links directly to task-oriented agent entry points: `install.md`, `create.md`, and `package.md`. An agent need not infer the consumer entry point from the source tree. [Repository tree and README](https://github.com/github/gh-aw)

`AGENTS.md` explicitly limits initial context to itself and the short root `SKILL.md`, then routes specialized tasks into lazily loaded local skills. The two files distinguish using the workflow product from developing its compiler. This is a useful separation between consumer instructions and contributor instructions. [Agent routing](https://github.com/github/gh-aw/blob/main/AGENTS.md), [capability summary](https://github.com/github/gh-aw/blob/main/SKILL.md)

**First useful result.** The quickstart installs the extension, then uses `gh aw add-wizard` with a named sample workflow. The wizard checks prerequisites, chooses an engine, configures authentication, adds reviewed source plus compiled workflow files, and can trigger the first run. The guide names the resulting repository report issue and explains where to inspect failures. It still requires GitHub access, enabled Actions, and engine authentication. [Quickstart](https://github.github.com/gh-aw/setup/quick-start/)

**Reuse and verification.** Its package guide defines one canonical root and an `aw.yml` inventory, separates reusable from repository-local workflows, and removes hardcoded consumer assumptions. Contributor documentation supplies unit and full-suite commands. [Package guide](https://github.com/github/gh-aw/blob/main/package.md), [testing guide](https://github.com/github/gh-aw/blob/main/CONTRIBUTING.md)

**Competitive implication.** Agent independence and permission separation are already competing capabilities: the security architecture describes minimally privileged agent execution and separate scoped jobs for external writes. ChangePlane should not claim those concepts are unique. The relevant question is whether its revision-bound assurance and recovery results are easier to adopt and measurably reduce operator intervention. [Security architecture](https://github.github.com/gh-aw/introduction/architecture/)

## OpenAI: Symphony

**Public surface.** The official `openai/symphony` repository separates a language-independent `SPEC.md` from an Elixir reference implementation. The README offers two routes: ask an agent to implement the specification or set up the reference implementation. It explicitly presents the project as an engineering preview for trusted environments. [Repository and README](https://github.com/openai/symphony)

**Organization.** The small root routes readers to the contract and implementation. Inside `elixir/`, `lib/`, `test/`, configuration, `WORKFLOW.md`, `AGENTS.md`, and build manifests are grouped together. The runtime project has a specific directory and its own entry-point documentation. [Implementation tree](https://github.com/openai/symphony/tree/main/elixir)

**First useful result.** The setup explains tracker configuration, per-issue workspaces, Codex execution, and a repository-owned workflow document. The current implementation documents Linear, GitHub Issues, Jira Cloud, Asana, and GitLab adapters. These are tracker adapters, not evidence that every forge assurance or merge capability is qualified. The implementation README labels the runtime prototype software intended for evaluation. [Implementation setup and boundaries](https://github.com/openai/symphony/blob/main/elixir/README.md)

**Packaging and verification.** `mix.exs` identifies the CLI entry point and four executable build targets. The Makefile provides build, formatting, lint, coverage, static analysis, and an explicitly enabled live E2E target. This makes local validation discoverable while distinguishing it from work that launches an external agent session. [Build manifest](https://github.com/openai/symphony/blob/main/elixir/mix.exs), [validation targets](https://github.com/openai/symphony/blob/main/elixir/Makefile)

**Boundary worth preserving.** The specification defines a scheduler/runner and tracker reader. It makes approval and sandbox choices implementation-specific, and leaves detailed ticket/PR behavior to workflow policy and agent tooling. That is a different contract from an independently enforced assurance decision. [Specification: goals, non-goals, and trust posture](https://github.com/openai/symphony/blob/main/SPEC.md)

**Reusable pattern.** Maintain one canonical contract and route directly to runnable implementation instructions. Do not copy Symphony's orchestration breadth merely to resemble it. A ChangePlane adapter can expose an assurance result to an orchestrator without ChangePlane becoming that orchestrator.

## Google: Jules SDK

**Public surface.** `google-labs-code/jules-sdk` identifies itself as Google's TypeScript SDK and its manifest names Google LLC. It is public client tooling for Jules cloud sessions; the presence of this repository does not establish that the hosted agent service can be self-hosted. [Root manifest](https://github.com/google-labs-code/jules-sdk/blob/main/package.json), [SDK README](https://github.com/google-labs-code/jules-sdk)

**Organization.** The workspace separates `packages/core`, `packages/mcp`, `packages/fleet`, and `packages/merge`, with examples and documentation outside those package boundaries. The root manifest includes both packages and examples as workspaces and exposes build, test, smoke-test, and type-check tasks. [Package tree](https://github.com/google-labs-code/jules-sdk/tree/main/packages), [workspace manifest](https://github.com/google-labs-code/jules-sdk/blob/main/package.json)

**First useful result.** The README starts with creating a session, observing progress, and retrieving an eventual pull-request URL. It then covers installation and batch work with explicit concurrency controls. The examples make the task lifecycle visible, but require a Jules API key and invoke cloud work. [SDK README](https://github.com/google-labs-code/jules-sdk)

**Agent consumption.** The MCP package has a copyable client configuration and groups tools by session control, code review, and querying. Its state interface includes last activity and a pending plan, so agents can inspect an ongoing task instead of treating dispatch as completion. Its README also explicitly states that the package is not an officially supported Google product. Vendor ownership and support guarantees must remain separate claims. [MCP package README](https://github.com/google-labs-code/jules-sdk/blob/main/packages/mcp/README.md)

**Packaging and verification.** The core manifest declares a typed export surface and limits published files to built output and the README. It exposes a Vitest test command. The contribution guide separately describes contribution requirements, testing, and documentation updates. [Core package manifest](https://github.com/google-labs-code/jules-sdk/blob/main/packages/core/package.json), [contribution guide](https://github.com/google-labs-code/jules-sdk/blob/main/CONTRIBUTING.md)

**Reusable pattern.** Package by an actual consumption boundary and show a complete lifecycle: start, observe, finish, inspect artifacts. A ChangePlane tool response should distinguish an assessment, a scheduled recovery, and verified completion. Introducing a monorepo build framework is not necessary to achieve that.

## OpenAI: Codex

**Public surface.** `openai/codex` is a useful agent-usability reference rather than a direct assurance-layer equivalent. Its README identifies the local CLI, routes IDE/desktop/cloud users separately, and puts installation and first launch before contributor setup. It offers platform installers, package-manager installation, and downloadable binaries. [README](https://github.com/openai/codex)

**Organization.** The tree distinguishes `codex-rs`, `codex-cli`, `sdk`, `docs`, and repository-maintenance tooling. The root package is private; the SDK has its own publishable package manifest. A private repository-root manifest is therefore not itself a usability defect: the decisive issue is whether a supported consumer artifact is clearly exposed elsewhere. [Repository tree](https://github.com/openai/codex), [root manifest](https://github.com/openai/codex/blob/main/package.json), [SDK manifest](https://github.com/openai/codex/blob/main/sdk/typescript/package.json)

**Agent/programmatic consumption.** The TypeScript SDK wraps the CLI through JSONL events. Its own README documents a short first call, streaming events, structured output, resuming a thread, working-directory control, and process-environment control. SDK users do not need to understand the Rust workspace to integrate it. [SDK entry point](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)

**Verification and contribution.** The SDK manifest exposes focused build, lint, test, and coverage commands. Root agent instructions carry code and testing conventions for contributors. The current contribution guide accepts issue reports and analysis but explicitly declines external code PRs; open source is not evidence of an unrestricted contribution process. [SDK scripts](https://github.com/openai/codex/blob/main/sdk/typescript/package.json), [agent instructions](https://github.com/openai/codex/blob/main/AGENTS.md), [contribution policy](https://github.com/openai/codex/blob/main/docs/contributing.md)

**Reusable pattern.** Separate installation of the product from building the product, keep one runtime contract behind human and programmatic interfaces, and make continuation and failure outcomes explicit.

## Patterns to evaluate for ChangePlane

1. **One obvious start.** Recommend a default, then route local, CI, and agent consumers separately from hosted operators and contributors.
2. **A small agent index.** Publish exact commands, expected results, and links to task-specific guidance without duplicating policy.
3. **One complete example.** Show revision, diagnosis, safe next action, and evidence. Reuse the existing evaluator across CLI, Action, and MCP.
4. **A consumer artifact.** Local assurance should not need web-app dependencies. Test the distributed artifact as well as the source checkout.
5. **Visible authority.** Distinguish local assessment, authenticated reads, and separately privileged controller actions.
6. **Measure adoption.** Track first meaningful diagnosis, undocumented steps, agent clarifications, manual rescue time, and revision correctness in clean environments.

ChangePlane's potential advantage is independently checkable assurance and bounded recovery that fits existing workflows with less setup and fewer manual rescues. It requires user and incident evidence before any superiority claim; directory counts and skill files do not establish it.

## ChangePlane: direct code and first-use observations

Inspected local source at `f6ac9af0689d14269fd8edaa620ec0cbb70def26` on 2026-09-11. This is a repository and onboarding inspection, not a comparative runtime benchmark. Counts exclude this research note: 239 tracked paths and 29 documents directly under `docs/`.

| Evidence in ChangePlane | Advantage or friction for a new user/agent |
| --- | --- |
| [README](../README.md), [CLI](../community/cli.js): the offline example executed successfully without npm installation, credentials or model calls | A small deterministic first run is an actual strength. It teaches a supplied-snapshot format; it is not a connected repository activation. |
| [Public core](../community/core.js) imports the shared evaluator, harness validation and protected-path rules | Preserve one evaluator across interfaces. Stale heads and ambiguous evidence produce findings; advisory success never becomes Guard or merge authority. This is a specific useful contract, not proof of unique industry safety. |
| [Reader guide](community.md): reviewed default-branch policy, exact job/publisher/workflow selection, fixed-origin read-only API collection | Strong revision/evidence semantics. Real setup still requires the user to understand CI identity and prepare configuration manually. A passing CI job alone does not establish product correctness. |
| [Root Action](../action.yml) is the managed Guard; the supported public Action lives at [community/action.yml](../community/action.yml) | Someone guessing `uses: LeChiffreVol2/changeplane@SHA` reaches a different capability. The documented public subpath works; discovery should make this distinction unavoidable. Preserve existing Action paths and pins. |
| [Root package](../package.json) and [generated archive package](../scripts/package-community.py) are private and have no `bin` entry | The documented interface is `node community/cli.js ...`, not a packaged `changeplane` command. No npm installation route is established by these files. |
| [Team help](../community/team-cli.js) lists 15 commands; the top-level CLI prints these alongside assessment commands | Complete reference, but weak progressive disclosure. A first-time user sees operational controls before completing basic assessment. |
| [MCP server](../community/team-mcp.js) has eight coordination/doctor tools and input schemas | Agent callers get structured data and bounded tools. Plain `inspect`/`evaluate` assessment is not exposed as an MCP tool, and tools declare no output schema. Do not claim a general read-only PR MCP integration already exists. |
| No tracked `SKILL.md`; [agent loop](../examples/changeplane-team-agent.md) is a manually discovered Markdown example | Useful instructions already exist but are not packaged as a discoverable consumer skill. Root [AGENTS.md](../AGENTS.md) governs development of ChangePlane; it is not an installation skill for another repository. |
| [Team setup](team-operator.md) requires reviewed policy, two workflow templates, operator settings and separately supplied credentials | Configuration and operator isolation are the largest remaining barriers to genuine agent onboarding. A copied MCP JSON snippet does not create a credential boundary. |
| [Qualification](repository-team-qualification.md) records two simulated members on a disposable GitHub repo | Evidence exists for cooperative reservation, workspace and handback behavior. It does not prove long-running multi-person operation, live Cursor integration, repair quality or fewer human interventions. |

The existing README already separates Individual and Teams, provides an offline example, links troubleshooting and marks capability boundaries. Improve the transition from that example to one real repository; do not restart the product or duplicate its runtime.

## Cursor and Origin: compare the documented surface, not private implementation

Cursor's [Skills documentation](https://cursor.com/docs/skills) lists a built-in `/autopilot` that follows a PR and handles feedback, conflicts and failed checks. It also documents automatic skill discovery from `.agents/skills/` and `.cursor/skills/`. These overlap directly with a generic promise to follow PRs for a developer; the reusable packaging pattern is a discoverable, narrowly scoped skill with references loaded on demand.

[Origin](https://cursor.com/docs/origin) is documented as an early-beta Git forge with native repositories, pull requests, GitHub mirroring, apps and integrations with cloud agents. GitHub remains authoritative for mirrored repositories. Code storage is available on listed paid plans, with staged access. This research inspected its public documentation, not Origin's internal repository structure or a live account. Native ChangePlane/Origin integration remains unqualified.

Cursor's [MCP documentation](https://cursor.com/docs/mcp) provides configuration, authentication and distribution instructions. A comparable ChangePlane guide needs one actually qualified client setup, with explicit operator isolation when writes are enabled; wire-protocol tests alone are insufficient.

## Defensible positioning

ChangePlane can currently offer a small, operator-owned assessment and cooperation layer: no model call to assess evidence, no ChangePlane account for the CLI/Action, exact observed revisions and workflow attempts, retained workspace identity, and Git-owned coordination history. The source and operating guides support these properties. They are useful differences from buying an integrated coding/hosting service, not a measured superiority claim over all its workflows.

Do not position agent independence, read-only execution, separate write permissions, worktrees, MCP or PR monitoring as exclusive inventions. Competitors implement parts of this space. The more specific hypothesis is: **existing coding agents can cooperate in one repository and recover their own PRs with less manual supervision, while outdated or ambiguous evidence never becomes a current success.** The intervention reduction still needs measurement.

## Smallest useful improvements, in order

These are proposed changes, not installed capabilities or new release commitments.

1. **Make the existing entrypoints unambiguous.** Add a short `community/README.md` for the public runtime and a `docs/README.md` routing index. Point to existing assessment, team-operator, troubleshooting and contributor guides. Label root Guard versus public Action, current operating guides versus historical qualification, and read-only versus credentialed operations. Keep the Individual/Teams choice and immutable release guidance. Do not move runtime files or rename published Action subpaths.
2. **Provide one stable public command and guided setup.** Add a thin executable wrapper and appropriate bundle metadata over the existing CLI, preserving existing invocations. Start with explicit `init --dry-run`/setup planning: read the trusted repository state, present candidate CI identities, and generate a reviewable policy/workflow change without overwriting existing policy. A human selects meaningful behavioral evidence. No auto-approval, direct default-branch write, token in generated files, new server or package-registry dependency is needed for the first increment. Any registry publication needs an actual tested distribution path before documentation promises `npx` installation.
3. **Give agents a complete read-only first path.** Package one consumer `skills/changeplane/SKILL.md` based on the existing task loop, separate from maintainer AGENTS.md. Add a repository-bound read-only PR assessment tool to the current MCP surface using the existing collector; expose compact stable result fields and schemas. Keep diagnostic reads usable without enabling coordination writes. Have setup place a reviewed skill/config entry into the user's supported client location, preserving existing instructions. Do not give the coding sandbox the operator's write credential.
4. **Reduce manual team setup, then qualify one client.** Extend the existing doctor and configuration generator instead of building another orchestrator. Validate pins, paths, Git origin, selected workflow and operator settings, and return one next action. Test one documented agent-runtime setup with two independent tasks, a scoped overlap, stale CI, feedback and a restarted writer. A resumed task must retain its assigned workspace; terminal/unknown outcomes must not create a second writer. Skill text or MCP startup is not evidence of OS/process credential isolation.
5. **Optimize results for both readers.** Preserve existing JSON and exit contracts; add an explicit concise human view and an opt-in compact agent view rather than silently changing output defaults. Summaries still carry revision, freshness, reason, next action and advisory authority, with full evidence available when needed. Expose advanced team operations under command-specific help. Keep all interfaces thin adapters around the shared engine.

Suggested additive map (new paths are proposals):

```text
README.md                         Choose Individual/Teams; human and agent starts
AGENTS.md                         Existing maintainer policy
community/
  README.md                       NEW: public CLI/Action/MCP entry map
  cli.js                          Existing public CLI
  team-mcp.js                     Existing server; add read-only assessment path
  action.yml                      Existing public read-only Action
skills/changeplane/SKILL.md        NEW: consumer skill; no duplicate business logic
docs/
  README.md                       NEW: task-based index and document status
  community.md                    Existing assessment guide
  team-operator.md                 Existing operator/isolation guide
  repository-team.md              Existing contract and integration detail
action/, server/, api/            Existing managed/controller boundary
src/lib/                          Existing shared deterministic core
examples/                         Existing reviewed consumer templates
```

Copy the large projects' clear entrypoints and packaging, not their directory count or orchestration infrastructure. This codebase does not yet need a multi-package monorepo, another database, another scheduler, a new IDE or deployment-provider integrations.

## How to decide whether it is easier or better

Run the same repository exercises against current named competitor configurations. Record source/version, date, client/runtime, permissions, costs and raw redacted outcomes. Missing access is **not tested**, not a competitor failure. Follow [ADR 0005](adr/0005-scenario-scoped-competitive-claims.md).

- Human onboarding: fresh user reaches the first useful real-PR assessment; record elapsed time, commands, documentation jumps and help requests. Offline fixtures are a separate metric.
- Agent onboarding: existing agent discovers and uses ChangePlane without a maintainer crafting a bespoke prompt; record failed tool calls, configuration repairs and context size. Starting MCP is not successful repository activation.
- Team recovery: two writers, overlapping scope, changed head, same-head rerun, stale feedback, restart after acknowledgement and changed default branch. Record duplicate writers, outdated evidence accepted and recovery interventions per PR.
- Product value: compare time from a CI failure to a correctly routed next action, total manual interventions, false blocks and accepted stale success. Check a meaningful behavioral test before attributing a benefit to ChangePlane.

Suggested internal targets are under five minutes to a useful read-only assessment after prerequisite CI access, and under fifteen minutes for a qualified two-task operator setup. These are unmeasured product targets, not promises or current results. Prefer a small observed cohort of fresh users and two independently operated teams over another synthetic feature-count comparison.
