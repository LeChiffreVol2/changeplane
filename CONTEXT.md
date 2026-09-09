# ChangePlane Assurance

ChangePlane's domain is independent behavioral assurance and recovery for change requests. Each change request has an authoritative forge that owns its repository state and merge decision.

## Market and product

**Independent Behavioral Merge Assurance**:
The product category in which an authority independent from the authoring agent verifies trusted behavioral evidence for one exact revision under the authoritative forge's merge policy.
_Avoid_: Agentic SDLC platform, AI code review, agent workspace

**Customer Account**:
A personal or organizational account that owns repositories assessed by ChangePlane on an authoritative forge. Its owner or authorized administrators choose the assurance and recovery policy.
_Avoid_: Signed-in user, workspace, customer organization when including individuals

**Customer Organization**:
A Customer Account representing an organization rather than an individual. It is the business-customer subset used by the business validation gate.
_Avoid_: Every customer, personal account, enterprise account

**Change Request**:
A proposed repository change reviewed and merged through its authoritative forge, such as a pull request or merge request. Its identity belongs to that forge and repository, regardless of which tool authored it.
_Avoid_: Agent session, branch name, globally unique PR number

**Agent-Authored Change Request**:
A Change Request whose code was created or materially changed by one or more coding agents, regardless of vendor.
_Avoid_: AI task, agent session

**Authoritative Forge**:
The service that owns a Change Request's canonical repository state and merge authority.
_Avoid_: Mirror, authoring tool, evidence producer

**Authoring Surface**:
The tool through which a person or agent prepares or updates a Change Request. It may be separate from, or part of, the Authoritative Forge.
_Avoid_: Necessarily the forge, assurance authority

**Open Source Core**:
The independently operable ChangePlane assessment and recovery capabilities that a personal or organization account can run under its own authority without a hosted-service subscription.
_Avoid_: Community edition, hosted trial, source availability alone

**Assurance Operator**:
The person or organization responsible for an independently operated ChangePlane installation and its publication and recovery authority.
_Avoid_: Coding agent, signed-in user, necessarily ChangePlane's maintainer

**Hosted Service**:
An optional ChangePlane installation operated for Customer Accounts by a service provider. Its operating commitments are separate from the software license.
_Avoid_: Open Source Core, prerequisite for open-source use

## Assurance

**Assured Revision**:
The exact proposed Git revision within an identified Change Request to which an assurance decision applies. The subject actually tested may also depend on a target revision or a merge batch.
_Avoid_: Latest code, current branch

**Tested Subject**:
The exact code or artifact evaluated by an evidence-producing execution, such as a source revision, temporary integration revision, merge batch, or built artifact. Its relationship to the Assured Revision is part of the evidence claim.
_Avoid_: Associated commit, necessarily the PR head

**Policy Revision**:
The exact trusted revision defining the assurance requirements and permitted recovery scope for an evaluation.
_Avoid_: Diff base, current target branch, policy proposed by the change

**Evidence Association**:
A provider's reported link between an execution and a Change Request or revision. Association alone does not prove which code the execution tested.
_Avoid_: Execution provenance, proof of tested subject

**Behavioral Evidence**:
A trusted observation demonstrating required behavior for a Tested Subject, with an accepted producer identity and a verified relationship to the Assured Revision.
_Avoid_: Model opinion, review comment, green status alone

**Guard**:
A result published under qualified independent authority that reports ChangePlane's deterministic assurance decision for one Assured Revision. The Authoritative Forge's policy determines its effect on merging.
_Avoid_: Approval, merge decision, arbitrary same-named status

**Verify**:
The core product mode in which ChangePlane evaluates Behavioral Evidence and returns a fixable handback without model or repository-mutation authority.
_Avoid_: Verify Lite, verify-only product

**Recovery Handback**:
A portable, revision-bound statement of observed failure, trusted scope and permitted next action for a Change Request. It conveys work to an author or agent without granting publication, repository-write or merge authority.
_Avoid_: Unscoped repair prompt, approval, arbitrary execution instructions

**Autonomous Assurance Agent**:
The always-on product actor that discovers evidence, evaluates new revisions, publishes Guard state, returns agent handbacks, and reconciles incomplete evaluations without receiving PASS, repository-write, or merge authority.
_Avoid_: Orchestrator, coding agent, repair agent

**Autonomous Repair**:
An explicitly enabled, repository-specific recovery capability in which a bounded proposal may be applied by a separate trusted controller before a new Assured Revision is evaluated.
_Avoid_: Autonomous, default mode, autonomous merge

**Deliberate Approval**:
An explicit human decision granting or expanding repository authority, such as accepting a protected setup change, enabling Autonomous Repair, or adopting an exact enforcement policy.
_Avoid_: Click, confirmation

## Enforcement levels

**Strict Head**:
The GitHub assurance contract requiring strict up-to-date, no-bypass, publisher-bound checks for an Assured Revision without claiming Merge Queue coverage.
_Avoid_: Basic assurance, partial assurance

**Queue Certified**:
The GitHub assurance contract adding fresh Merge Queue revision evaluation to every Strict Head requirement.
_Avoid_: Enterprise mode, fully safe

## Commercial operations

**Fleet Posture**:
The customer-visible state of assurance level, activation, configuration drift, and recent Guard outcomes across a Customer Account's repositories.
_Avoid_: Dashboard, analytics page

**Evaluation Event**:
A source-free commercial record of an assurance transition, reason, and latency for one Assured Revision.
_Avoid_: Receipt, log, repository event

**Evaluation Generation**:
The monotonically increasing evaluation of one Assured Revision. Starting a newer generation invalidates completion authority from every older generation without requiring a new commit.
_Avoid_: Retry, workflow attempt

**Entitlement**:
The server-enforced commercial allowance for a Customer Account to use a named assurance level, repository count, evaluation volume, history window, and support class.
_Avoid_: Feature flag, subscription status

**Design Partner Alpha**:
The invite-only, founder-led launch stage for three to five qualified Customer Accounts using Verify Lite and Strict Head under an approved order form, private support path, measured activation, and explicit pre-release boundaries. Both individual and business accounts are eligible; business validation retains its separate Customer Organization target.
_Avoid_: Public launch, self-serve GA, enterprise-ready

**Launch Evidence Gate**:
The thirty-day outcome contract requiring five hands-on installations, four successful activations, median time to first protected pull request under ten minutes, two paying Customer Organizations, zero false PASS, fewer than two percent disputed false blocks, no Guard stuck longer than ten minutes, three customer-confirmed valuable blocks, and at least eighty percent gross margin.
_Avoid_: YC-grade code, feature complete, launch ready

**Launch Scorecard**:
A reproducible summary of the Launch Evidence Gate from operator-attested customer outcomes. Missing coverage remains unknown; meeting numerical targets does not authorize customer access or establish assurance for a revision.
_Avoid_: Launch approval, certification, live telemetry
