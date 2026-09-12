# Agentic SDLC: product and distribution experiment

Research date: 2026-09-13. Baseline: `2d440b7213842934f2cecf9d61cfd48c6e97680d`. These are hypotheses and planned work, not customer results. The [source review](agent-feedback-research.md) covers DevFlow, the feedback tutorial, ExpeL, Alibaba Open Code Review and GitNexus. The supplied Facebook and official KBTG LinkedIn posts were read in the browser after direct web fetches failed. Their workflow descriptions are separated from measured product outcomes.

## Product decision

Test one outcome: **less human work diagnosing and recovering agent-authored PRs in an existing repository**. Keep existing coding agents and GitHub review/merge controls. Recruit individual maintainers running parallel agents and product teams of approximately 2–10 developers with behavioral CI and recurring PR/CI rescue work. These are recruitment hypotheses; personal and organization accounts remain equally eligible. KBTG-scale platform teams are potential later adopters.

DevFlow's ticket-to-code generation, codebase retrieval and specialized roles are upstream of our assessment/handback loop. A shared task identity and independently checked outcome are the useful connection. Our [task contract](../community/team.js) already has issue references, scoped paths, dependencies, writer/workspace identity and PR feedback. Reuse those before adding Jira ingestion or an agent runner.

Alibaba OCR already offers model review with deterministic selection, structured output, revision-bound resume, partial-coverage accounting, agent entry points and a published benchmark. GitNexus supplies graph-based context and change impact, with explicit freshness and incomplete-result handling. Those capabilities make another general reviewer or graph engine a weak next investment. Investigate the remaining handoff and recovery work when operators already use these tools. Neither revision binding nor a hybrid model/deterministic architecture alone is a unique advantage. [Pinned implementation and benchmark review](agent-feedback-research.md)

The intended workflow is: an existing agent develops a scoped task; its existing reviewer supplies advice; ChangePlane assesses the current PR evidence, returns a bounded next action to the assigned writer and reassesses the resulting revision; GitHub retains approval and merge control. If a reviewer or graph source is added later, its advice cannot enter the Guard decision or confer write authority. Current public capabilities and managed-controller qualification remain distinct. No Alibaba or GitNexus integration is shipped by this increment.

Agent independence and permission separation are not unique inventions. GitHub Agentic Workflows supports multiple engines, default read-only execution and separate safe outputs. Cursor Origin offers a forge, PRs, team sharing and mirroring; GitHub remains authoritative for mirrored repositories. A generic agent-manager pitch overlaps substantially. Our advantage must be measured usefulness with lower setup and supervision cost in the customer's existing workflow. [GitHub introduction](https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/), [Origin](https://cursor.com/docs/origin)

DORA describes AI as amplifying organizational strengths and weaknesses. That supports investigating integration/recovery bottlenecks; it does not establish a ChangePlane improvement. [DORA 2025](https://dora.dev/research/2025/dora-report/)

## Technical sequence

| Priority | Work | Gate for further work |
| --- | --- | --- |
| Now | Offline adoption/effort report and redacted first-use feedback | Preserve failures, missing outcomes, estimates and owner/fixture exclusions |
| First observed obstacle | Fix repeated setup or diagnosis failures through the existing collector, generator and handback | Two independent operators reproduce the obstacle; regression case and successful retry |
| Repeated review friction | Draft repository-owned advisory lessons | Ten reviewed incidents across three operators show a recurring problem |
| Learning experiment | Compare baseline guidance with a frozen, reviewed lesson set | Held-out evaluation; no increased missed defects or invalid authority outcomes |
| Cross-file coordination | Reproduce failures between tasks with disjoint paths; compare optional structural hints | Observed incidents, supported-language coverage and fresh combined-revision CI; no graph-based all-clear |
| Integration expansion | Qualify a client/forge workflow retained users request | Live installation, stale-revision, permission and recovery evidence |

A future lesson needs source incident/revision/policy identity, applicability, a counterexample, reviewer, expiry and a superseded record. Approve it through a repository PR. A rejected model comment cannot suppress deterministic findings, protected paths or human review. Learned advice never grants approval, Guard or write authority. Retrieval must enforce repository and policy applicability. Vector storage and automatic customer-memory sharing are not part of this increment.

Freeze guidance before evaluation. Split training and held-out incidents by repository or time. Include behavioral/infrastructure failures, stale heads, protected changes, ambiguous evidence, misleading comments and unknown causes. Measure diagnosis/action correctness, missed defects, review burden, human time and cost. Keep acceptance separate from correctness; fewer comments or objections alone cannot establish improvement. [Tutorial and ExpeL findings](agent-feedback-research.md)

For an optional external advisory input, validate repository identity, source/index revision, changed-input digest, tool/version, covered paths/languages and complete/partial/unknown status. Missing graph edges cannot establish independence. Compare producer/consumer contract changes, unsupported syntax, stale indexes and two individually green PRs whose combination fails. Keep all ordinary evidence requirements. GitNexus's pinned PolyForm Noncommercial license also prevents treating it as a universally available commercial-use dependency; retain the dependency-free Apache-2.0 core and qualify any separately selected tool. [GitNexus findings](agent-feedback-research.md#gitnexus-structural-context-for-parallel-changes)

No new authoring engine, deployment integration, database, model spend or paid infrastructure is needed. Public source repair and native Origin do not become qualified through this plan.

## PMF and monetization

Public repository counters were zero stars and zero forks at this snapshot. Counts and clones do not establish activation; owner work, CI and automation contaminate traffic. No external-customer evidence was supplied. The empty [adoption report](adoption-measurement.md) starts at `not_started`. YC describes PMF through demand and usage pulling the product forward, not code completeness. [YC](https://www.ycombinator.com/blog/the-real-product-market-fit)

Recruit operators with at least weekly agent-PR intervention, a recent incident they can describe without private code, and willingness to try one repo. Interview maintainers and engineering leads separately. Ask about the last failure, hands-on time, current workaround, problem owner and what would make the tool worth keeping. Do not rely on whether the idea sounds useful.

Keep OSS free. Test demand for bounded assisted setup, upgrades and operational ownership separately. The existing $99 hosted Starter amount remains a hypothesis, not a current offer. Ask whether the budget owner would sponsor a defined one-repository service and what outcome they require. Explicit interest is not payment, renewal or revenue. No payment collection is included: legal entity, effective agreements and service readiness remain outstanding. [Commercial gates](commercial-plan.md)

After ten comparable observed incidents across three accounts, inspect whether median human effort fell after including operation and follow-up, and whether users chose to continue. A small observational improvement remains preliminary. If five installations yield little repeat use or value, change workflow/ICP before adding features. If retained users will not pay for operational ownership, test a different service hypothesis. The free product does not depend on those paid-service gates.

## First 30 days and distribution

Start at the first external setup attempt. The founder owns interviews/recruitment and weekly review; engineering owns reproductions/fixes. Keep participant mappings and interview notes private.

| Stage | Action and prepared asset | Signal |
| --- | --- | --- |
| Days 1–7 | Ten qualified conversations; one-minute quickstart and optional first-use form | Five real setup attempts across three accounts; record every blocker |
| Days 8–14 | Observe four first assessments; fix repeated friction | Four activations; median under ten minutes; disclose founder assistance |
| Days 15–21 | Follow ordinary PRs and paired rescue incidents; ask users to run the next task | Three confirmed useful findings; observed effort including regressions and unresolved cases |
| Days 22–30 | Review repeat use and speak with budget owners | Three mature installations active in week four; paid interest recorded separately from revenue |

Use [the report](adoption-measurement.md) for denominators and missing evidence. Late installations need longer follow-up before retention is known. Targets justify another cohort; they do not establish PMF.

Prioritize GitHub README/search, existing coding-agent users, personal introductions and relevant developer communities. Route every channel to one quickstart and optional feedback path. Compare confirmed activation and retention by channel, not impressions or stars. This work prepares distribution assets; no social posts or unsolicited messages have been sent.

Drafts for future approved use:

- **Public post:** “Using coding agents but still spending time working out which PR checks matter? ChangePlane is an Apache-2.0 tool that checks evidence for the current GitHub PR revision and returns findings and a next action. It runs locally without a model key. Try the one-minute quickstart and tell us where setup stops or whether a finding helped.” Link the README and use synthetic screenshots only.
- **Interview:** “Walk me through the last agent PR you had to rescue. What failed, what did you check, and how much hands-on time did it take? Would you try an independent assessment on one repository while keeping your agents and merge rules?”

Marketplace/registry publication needs a packaging decision. GitHub automatically lists the root Action; our public Action is `/community`, while the root is managed Guard. Publishing the root as the OSS assessment would misrepresent it. The MCP Registry hosts metadata, not artifacts; its npm route requires a published package and ownership metadata. Resolve these constraints when retained users justify the channel, without replacing immutable 0.4.1 assets. [GitHub requirements](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace), [MCP Registry](https://modelcontextprotocol.io/registry/quickstart)

Continue when operators return without recurring founder rescue and identify useful decisions. Fix onboarding when interested operators cannot activate. Narrow the use case when installed users do not return. Pause learning/integration work if correctness worsens or supervision increases. Budget stays USD 0; USD 100 is a later scaling decision.
