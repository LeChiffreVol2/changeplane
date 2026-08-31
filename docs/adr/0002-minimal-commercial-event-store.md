# Add a privacy-preserving commercial event store

ChangePlane will add a minimal commercial event store because a repeatable hosted product needs organization entitlement, activation state, usage metering, fleet posture, audit events, reliability measurement, and customer-visible ROI. The store may contain pseudonymous organization, installation, and repository identifiers; plan and entitlement; evaluation state, reason, and latency; activation and audit events; and usage counters. It must never contain source, diffs, prompts, patches, provider responses, credentials, or customer business data.

## Consequences

The store requires a reviewed tenancy model, access controls, metering budgets, incident handling, and a migration path before production customer data is written. Detailed evaluation and audit events are retained for 90 days, aggregated usage and ROI counters for 13 months, and customer-requested deletion completes within 30 days. The initial service uses a US region without making a data-residency claim. GitHub remains the source of truth for repositories, revisions, Checks, policy, and merge authority.

The first customer surface is Fleet Posture: repository assurance level, activation and configuration drift, current or stuck Guards, weekly assured pull requests, terminal latency, false-block feedback, and customer-confirmed valuable blocks.
