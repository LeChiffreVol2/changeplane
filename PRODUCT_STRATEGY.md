# ChangePlane product strategy

## Market thesis

The winning position is **autonomy with proof**.

Coding agents are becoming capable of planning, editing, testing, reviewing, and opening pull requests. GitHub and emerging agentic forges are adding more of that work directly to the forge. ChangePlane should not compete by becoming another IDE, coding agent, or Git host. It should be the independent assurance layer that any of them can call before code ships.

The durable promise is:

> The authoring agent may propose a change. Trusted evidence and a separately credentialed controller decide what the exact revision has proved.

That keeps the product compatible with Codex, Cursor, Trae, Copilot, OpenSWE, and future agents while preserving GitHub as the system of record.

## Competitive map

| Product | Primary job | What it does well | ChangePlane opportunity |
| --- | --- | --- | --- |
| GitHub + Copilot | Forge, collaboration, coding and review agents | Native repository context, pull requests, rulesets, required checks, suggested fixes, cloud coding agent | Publish independent, exact-commit assurance through GitHub's existing control surface; never claim GitHub lacks review |
| Cursor + Bugbot / Origin | IDE, agentic review, emerging agent-native forge | Fast in-editor loop, review rules, learned guidance, author-to-fix flow | Remain forge-independent and prove results from Cursor-authored changes without asking teams to migrate |
| Trae Solo | Autonomous planning, building, and deployment | One task can drive a long-running build-and-ship workflow while the user reviews results | Accept the resulting pull request automatically, run assurance without a handoff, and return only bounded failures or a verified receipt |
| Deep Agents / OpenSWE | Open coding-agent infrastructure | Sandboxes, subagents, skills, async task execution, pull request creation | Integrate as proposal workers behind one contract; do not fork or own the agent runtime |
| OpenSWE Review | Automated review worker | Diff-bound findings, severity, deduplication, restricted review tools | Add an independent review plane whose findings are valid only on the inspected diff and never become PASS by themselves |
| OpenWiki | Repository knowledge and generated documentation | Maintained codebase context and repository-owned documentation updates | Use reviewed, repository-owned assurance memory for invariants and runbooks; generated knowledge is context, not proof |

Reference material: [Cursor Origin](https://cursor.com/origin), [Cursor Bugbot](https://docs.cursor.com/bugbot), [GitHub code review](https://github.com/features/code-review), [Trae](https://www.trae.ai/), [Deep Agents Code](https://docs.langchain.com/oss/python/deepagents/code/overview), [OpenSWE](https://github.com/langchain-ai/open-swe), [OpenSWE reviewer](https://github.com/langchain-ai/open-swe/blob/main/agent/reviewer.py), and [OpenWiki](https://github.com/langchain-ai/openwiki).

## Product surface to ship now

These features establish a complete, credible wedge without expanding into a forge or agent platform:

1. **Self-serve GitHub App onboarding**
   - Personal accounts and GitHub organizations, including Enterprise Cloud organizations.
   - A returning user may choose repositories across every eligible installation they can access.
   - One repository, one protected setup pull request, no direct default-branch write.
   - Bind one exact behavioral check and BYOK to enable the autonomous harness; scope-only remains observe mode.
   - GitHub Enterprise Server remains unsupported until a separate deployment and authentication model exists.

2. **Bring your own OpenAI key**
   - Available to personal and organization users.
   - The browser submits the key once; ChangePlane verifies the selected model, encrypts with GitHub's repository public key, and stores only `OPENAI_API_KEY` in GitHub Actions.
   - No key in localStorage, logs, responses, cookies, screenshots, or a ChangePlane database.
   - Luna is the default; Terra and Sol remain reviewable configuration choices.

3. **Exact-commit assurance receipt**
   - Every result names the inspected head SHA, allowed paths, bound test publisher, and receipt source.
   - Any new commit invalidates the previous decision and starts a fresh run.
   - Observe mode reports without changing merge rules; GitHub remains merge authority.

4. **Autonomous handback contract**
   - Every pull-request event enters an exact-head harness without a web-app handoff.
   - When evidence fails, issue one App-signed, machine-readable repair grant for the current revision and allowed paths.
   - Allow at most two bounded repair attempts inside one immutable 15-minute campaign.
   - GPT-5.6 proposes; a clean job validates; the trusted controller applies with a one-time exact-repository token; a fresh run alone may publish PASS.
   - The proposal model never receives Check, push, approval, merge, or PASS authority.

5. **Public proof path**
   - A signed-out RouteThai synthetic replay tells the complete failed-head → Luna proposal → clean validation → new-head verification story.
   - The disposable GitHub repository remains the release canary; RouteThai production code is never connected.

6. **Independent Review Plane**
   - `ChangePlane / review` inspects only the exact changed diff and publishes at most five validated, deduplicated findings on changed lines.
   - The worker is read-only, treats pull-request instructions as untrusted input, and has no approval, repair, Check-PASS, push, or merge authority.
   - Review runs only with repository BYOK and remains advisory evidence separate from `ChangePlane / guard`.

7. **Repository-owned assurance memory and policy packs**
   - `.changeplane/assurance.md` keeps reviewed invariants and operating constraints beside the code.
   - Security, migrations, API compatibility, payment idempotency, deployment, and domain-specific packs are source-controlled templates, not remotely learned enforcement.
   - The trusted default-branch version may guide review and handback. It never certifies behavior.

8. **Vendor-neutral handback and preview proof**
   - The Action output and exact-head receipt comment carry one machine-readable bounded finding format to Codex, Cursor, Trae Solo, Copilot, OpenSWE, or another agent.
   - Existing GitHub Deployments and Vercel previews appear in the receipt only when their SHA matches the evaluated head.
   - ChangePlane owns neither the coding workspace nor preview hosting.

9. **GitHub Merge Queue exact revision guard**
   - Every `merge_group` is a new exact revision and receives an independent guard decision.
   - Queue evaluation performs no repair or model dispatch. GitHub owns queue order and merge.

## Shipped assurance extensions

### Independent review plane

The read-only review worker follows the useful OpenSWE Review constraints while keeping review separate from certification:

- prepare the repository and compute changed lines before the first model call;
- allow findings only on changed lines;
- validate location and severity when each finding is created;
- deduplicate repeated findings and publish one concise review;
- expose no commit, push, PR-approval, Check-write, or merge tools;
- reconcile re-reviews against the new exact head;
- treat pull request comments and instructions as untrusted input.

The deterministic test gate and exact-head receipt remain the decision layer. Model review is advisory evidence.

### Assurance memory

The OpenWiki-style repository-owned `.changeplane/assurance.md` captures invariants such as “a stop must remain inside its service window” or “checkout retries must be idempotent.” Changes arrive through a protected pull request with provenance. Generated documentation may guide review, but cannot independently certify behavior.

### Agent handback integrations

The handback contract returns the same bounded finding to Codex, Cursor, Trae Solo, Copilot coding agent, OpenSWE, or another agent through the Action output and exact-head receipt comment. Vendor-specific APIs remain deferred until a design partner needs them.

### Preview-to-revision binding

An existing GitHub Deployment or Vercel preview URL is bound to the exact head SHA in the receipt. The receipt omits a preview unless the deployment belongs to that revision. ChangePlane does not build a preview-hosting product.

### Policy packs and merge queue

Reviewed [repository policy-pack templates](examples/assurance-policy-packs) cover service windows, API compatibility, payment idempotency, and deployment checks. GitHub Merge Queue evaluates `merge_group` as its own exact revision and publishes the guard Check; queue evaluation never dispatches repair or model review.

## Features to defer

- A new Git forge or Origin competitor.
- An IDE, terminal coding agent, or Trae Solo competitor.
- A general-purpose orchestration platform for agent tasks.
- A hosted wiki product or automatic promotion of generated documentation into policy.
- Managed model spend before budgets, metering, billing, and isolation are live.
- A ChangePlane database, queue, or cross-repository dashboard before measured repository-native limits justify them.
- Learned rules that silently change enforcement. Any promoted rule must be reviewable, versioned, and attributable.

## Release gates

Self-serve onboarding and the bounded harness may be public while every stronger claim remains evidence-gated:

- **Independent review:** diff-location validation, prompt-injection cases, and no-write-tool tests pass.
- **Autonomous repair:** live App-signed ledger, bounded patch, trusted apply, synchronize event, fresh exact-head verification, and Check publication are captured.
- **Enforcement:** dedicated App identity is required by branch rules and negative stale-head, path-expansion, provider-failure, and exhausted-budget cases fail closed.
- **Managed execution:** isolation, budgets, metering, billing, and incident controls exist.

This sequencing keeps ChangePlane small enough to ship and specific enough to defend: every agent can move fast, but no agent certifies its own work.
