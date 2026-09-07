# Use GitHub identity with a managed PostgreSQL commercial plane

ChangePlane uses the immutable GitHub repository-owner account ID as Customer Account identity. The owner may be a personal account (`User`) or an organization (`Organization`), including an Enterprise Cloud organization. Installation identity remains an authorization binding and repository identity remains the metered resource. The signed-in human may administer several Customer Accounts; their session identity must not combine those accounts' allowances or visibility.

Human sessions continue to authenticate through GitHub only. A managed PostgreSQL store attached to the hosted Vercel product records append-only Evaluation Events and derived Fleet Posture behind row-level Customer Account isolation; the domain model does not depend on a database vendor. The journal and pilot adapters already bind `tenantId` to the authenticated repository owner and matching installation account. The earlier unintegrated telemetry schema's `organization_id`/`organizationId` names remain legacy terminology; they do not justify excluding personal accounts or trusting caller-selected account IDs when ingestion is connected.

## Consequences

No GitHub access token, source, diff, prompt, patch, provider response, credential, or customer business data enters the store. Installation tokens are minted just in time. Entitlements are enforced on the server as well as projected in the UI. The production adapter requires migrations, backup and restore evidence, tenant-isolation tests, deletion workflows, cost budgets, and an in-memory adapter for deterministic contract tests before activation.

Both account types follow the same Verify-first onboarding and exact-head authority rules. Repository protection depends on the customer's GitHub plan and actual Ruleset configuration, not on whether the customer is an individual or a business. Internal organization-owned canaries are release evidence, not a requirement for every customer to create an organization. See the [supported account and budget plan](../operating-budget.md).
