# Commercial plan

ChangePlane sells independent behavioral merge assurance to individual developers and businesses using GitHub.com. A Customer Account is the personal account or organization that owns the protected repository. Business teams with 20–200 engineers, multiple coding agents and meaningful behavioral CI remain the initial assisted-sales segment; they are not an account-type eligibility requirement.

Both account types use the same Verify-first installation, exact-head evidence and protected setup pull request. Enterprise Cloud organizations are included. GitHub Enterprise Server, forks and cross-repository repair remain outside this release. Private repositories need a GitHub plan that supports the required Rulesets; unavailable protection must be explained before claiming Strict Head. Current engineering preparation costs USD 0; the USD 100 monthly ceiling is reserved for scale. See the [account support matrix and phase budget](operating-budget.md).

Verify is the core paid product. The Autonomous Assurance Agent runs the verification and handback loop without routine human interaction. Autonomous Repair is a separately priced controlled expansion and is not required for the core outcome.

ChangePlane Open Source is the Apache-2.0, read-only distribution described in [Open Source](community.md). It is free for individuals and businesses. Hosted customer activation remains paused after managed-v15 canary qualification, pending provider authority recovery, reliable automatic reconciliation and the exact-release legal pack. The [automated SDLC architecture](automated-sdlc-architecture.md) orders those dependencies. The [launch measurement contract](launch-measurement.md) makes the existing nine pilot targets executable without claiming production ingestion or customer outcomes that have not occurred.

## Candidate pilot admission

The current source adds a bounded admission path for operator-enrolled Verify Lite pull-request pilots using Strict Head. Each contract lasts at most 30 days and declares finite repository and monthly evaluation limits plus bounded grace. Enrollment binds the authenticated GitHub tenant, repository and Guard installation/App. This does not enable the public pricing catalog, Queue Certified, Autonomous Repair, or general plan enforcement.

The database admits one evaluation per tenant, repository, exact revision fingerprint and Evaluation Generation. A transaction checks the enrolled contract and consumes one unit; exact retries reuse the original receipt. Its UTC period comes from database admission time and never moves when telemetry arrives late or expires. New admission requires the exact workflow attempt's GitHub-verified start time to fall within the currently active contract window; callers cannot supply that timestamp. Completion and recovery do not consume another unit or recheck contract expiry; fresh GitHub authentication and assurance checks still apply. A lost database acknowledgement may leave a consumed unit, so retries deduplicate instead of issuing an automatic refund.

Before waiting on commercial admission, the controller retires earlier usable success and confirms the new generation's blocking Guard (`in_progress` initially or `action_required` on rerun) while holding journal ownership. Missing entitlement, exhausted allowance or unavailable admission storage then ends the Guard as `action_required`, subject to journal publication authority. A worker lost during the allowance wait leaves a blocking Guard and held journal lane. Neither quota nor storage failure can issue PASS. Admission units are resource accounting, not verified successful evaluations or automatic invoice items. A manually reviewed invoice remains separate from these records.

This is candidate source only. Complete commercial outcome ingestion and general entitlements are still absent, so `commercialRuntimeIntegrated` and `commercialReady` remain false. No live commercial database, billing/provider service, paid launch, effective agreement or legal entity has been established by this work. The [commercial database contract](../database/README.md#commercial-plane) and [draft retention contract](retention-deletion.md) describe the remaining operating gates.

## Plans

The table below is a post-alpha pricing hypothesis, not a currently available public offer. During the invite-only design-partner alpha, ChangePlane offers only Verify Lite plus Strict Head under a reviewed order form. Queue Certified may be exercised in an owner-controlled canary but is not sold to alpha customers; Autonomous Repair, Fleet history, aggregate metrics, and service-level commitments remain unavailable.

| Plan | Monthly price | Included use | History and support |
| --- | ---: | --- | --- |
| Free | $0 | 1 repository and 100 evaluations | Strict Head, 7-day detailed history, community support |
| Starter | $99 per Customer Account | 3 repositories and 2,500 evaluations | Strict Head, 30-day detailed history, email support |
| Team | $399 per Customer Account | 15 repositories and 20,000 evaluations | Strict Head and Queue Certified, 90-day detailed history |
| Scale | $999 per Customer Account | 50 repositories and 100,000 evaluations | 13-month aggregate metrics and priority support |
| Enterprise | From $2,000 per contracted Customer Account | Contracted volume | Offered only with the promised DPA, SLA, and security-review support |
| Autonomous Repair | $149 per protected repository | BYOK bounded repairs | Controlled beta only |

Post-alpha Free and Starter do not include founder-led onboarding. The design-partner Starter experiment does include founder-led onboarding and may use a legally reviewed manual invoice or payment link; a billing system is not a prerequisite for willingness-to-pay evidence. No payment is accepted before the exact order form and legal pack are approved. A paid plan does not launch until measured variable cost supports at least 80% gross margin. Quota exhaustion never produces an unevaluated success: the product provides a bounded grace window and then reports `usage_action_required` explicitly.

## Pilot service targets

These are targets to measure during pilots, not a contractual uptime SLA or a 24/7 promise:

- 99.5% monthly publisher and readiness availability.
- P95 under 45 seconds from terminal Behavioral Evidence to a terminal Guard.
- 99% of Guards terminal within five minutes.
- Stuck evaluations detected and reconciled within ten minutes.
- General support response within four business hours and Severity-1 response within one business hour through a private channel.
- A public status surface, synthetic monitoring, and a monthly reliability report before paid rollout.

## Evidence gates

The first 30-day Design Partner Alpha gate is narrower: 5 hands-on installations, at least 4 successful activations, median time to first protected pull request under ten minutes, at least 2 paying Customer Organizations, zero false PASS, fewer than 2% disputed false blocks, no Guard observed stuck longer than ten minutes, at least 3 customer-confirmed valuable blocks or agent-autonomy decisions, and at least 80% gross margin. Missing this gate changes the ICP, wedge, or operating design before feature breadth expands.

Progress is evidence-gated rather than date-gated:

1. **Demand**: 20 qualified interviews, 5 hands-on installations, and at least 2 paying Customer Organizations.
2. **Activation**: 10 external activations, median time to first protected pull request under ten minutes, and more than 90% completion without founder repository access.
3. **Reliability**: 10,000 external evaluations, zero false PASS decisions, fewer than 2% disputed false blocks, 99% terminal within five minutes, and no Guard stuck longer than ten minutes.
4. **Retention**: 5 paying Customer Organizations active for at least four consecutive weeks and at least 3 renewals.
5. **Value**: at least 10 customer-confirmed prevented bad merges or decisions to enable more agent autonomy because ChangePlane was present.
6. **Business**: at least 80% gross margin and support effort that does not require custom engineering for every activation.

If 30 qualified interviews and 5 hands-on installations produce no payment, ChangePlane changes its ICP or wedge before adding feature breadth. “YC-grade” describes repeatable activation, retained paid use, reliable operation, and favorable unit economics; it is not a code-completeness or feature-count claim.

## Legal release gate

Free rollout requires reviewed Terms of Service, Privacy Policy, Acceptable Use Policy, subprocessor list, security and responsible-disclosure page, and a retention/deletion contract consistent with the product. A paid pilot additionally requires a reviewed order form; customers that require it receive a reviewed DPA. ChangePlane makes no SOC 2, GDPR-compliance, enterprise-SLA, or 24/7-support claim without the corresponding audited control or measured commitment.

## Distribution

Distribution includes individual developers as well as founder-led outreach to 50 GitHub organizations matching the business ICP. The Free plan and public benchmark provide product-led proof, while assisted customer bake-offs test the paid value proposition against each account's existing GitHub-native controls. The business evidence gate still requires paying organizations; individual purchases must not be relabeled as business validation. GitHub Marketplace follows ten successful external activations. Agent-specific landing pages explain compatibility with Cursor, Codex, Copilot, and Claude Code without claiming a native integration that has not been live-proven. Broad paid acquisition waits until the Demand Gate passes.
