# ChangePlane Assurance

ChangePlane provides independent behavioral merge assurance for AI-authored pull requests while GitHub remains the source of truth and merge authority.

## Market and product

**Independent Behavioral Merge Assurance**:
The product category in which an authority independent from the authoring agent verifies trusted behavioral evidence for one exact revision before GitHub may merge it.
_Avoid_: Agentic SDLC platform, AI code review, agent workspace

**Customer Organization**:
A GitHub organization whose platform, application-security, or engineering leader owns the policy for agent-authored pull requests.
_Avoid_: Account, workspace, tenant

**Agent-Authored Pull Request**:
A GitHub pull request whose code was created or materially changed by one or more coding agents, regardless of vendor.
_Avoid_: AI task, agent session

## Assurance

**Assured Revision**:
The single exact Git commit to which one ChangePlane evaluation, its evidence, and its guard result are bound.
_Avoid_: Latest code, current branch

**Behavioral Evidence**:
A trusted, publisher-bound Check that demonstrates required behavior for an Assured Revision.
_Avoid_: Model opinion, review comment, green check

**Guard**:
The ChangePlane-owned GitHub Check that reports the deterministic assurance decision for one Assured Revision. GitHub policy, not the Guard itself, decides whether the revision may merge.
_Avoid_: Approval, certification, merge decision

**Verify**:
The core product mode in which ChangePlane evaluates Behavioral Evidence and returns a fixable handback without model or repository-mutation authority.
_Avoid_: Verify Lite, verify-only product

**Autonomous Assurance Agent**:
The always-on product actor that discovers evidence, evaluates new revisions, publishes Guard state, returns agent handbacks, and reconciles incomplete evaluations without receiving PASS, repository-write, or merge authority.
_Avoid_: Orchestrator, coding agent, repair agent

**Autonomous Repair**:
An optional controlled expansion in which a bounded proposal may be applied by a separate trusted controller before a new Assured Revision is evaluated.
_Avoid_: Autonomous, default mode, autonomous merge

**Deliberate Approval**:
One of the small number of explicit human decisions that grants or expands repository authority: installing the App, merging the protected setup pull request, or accepting an exact Ruleset plan.
_Avoid_: Click, confirmation

## Enforcement levels

**Strict Head**:
An assurance level requiring strict up-to-date, no-bypass, publisher-bound checks for an Assured Revision without claiming Merge Queue coverage.
_Avoid_: Basic assurance, partial assurance

**Queue Certified**:
The highest assurance level, adding fresh Merge Queue revision evaluation to every Strict Head requirement.
_Avoid_: Enterprise mode, fully safe

## Commercial operations

**Fleet Posture**:
The customer-visible state of assurance level, activation, configuration drift, and recent Guard outcomes across a Customer Organization's repositories.
_Avoid_: Dashboard, analytics page

**Evaluation Event**:
A source-free commercial record of an assurance transition, reason, and latency for one Assured Revision.
_Avoid_: Receipt, log, repository event

**Evaluation Generation**:
The monotonically increasing evaluation of one Assured Revision. Starting a newer generation invalidates completion authority from every older generation without requiring a new commit.
_Avoid_: Retry, workflow attempt

**Entitlement**:
The server-enforced commercial allowance for a Customer Organization to use a named assurance level, repository count, evaluation volume, history window, and support class.
_Avoid_: Feature flag, subscription status

**Design Partner Alpha**:
The invite-only, founder-led launch stage for three to five qualified Customer Organizations using Verify Lite and Strict Head under an approved order form, private support path, measured activation, and explicit pre-release boundaries.
_Avoid_: Public launch, self-serve GA, enterprise-ready

**Launch Evidence Gate**:
The thirty-day outcome contract requiring five hands-on installations, four successful activations, median time to first protected pull request under ten minutes, two paying Customer Organizations, zero false PASS, fewer than two percent disputed false blocks, no Guard stuck longer than ten minutes, three customer-confirmed valuable blocks, and at least eighty percent gross margin.
_Avoid_: YC-grade code, feature complete, launch ready

**Launch Scorecard**:
A reproducible summary of the Launch Evidence Gate from operator-attested customer outcomes. Missing coverage remains unknown; meeting numerical targets does not authorize customer access or establish assurance for a revision.
_Avoid_: Launch approval, certification, live telemetry
