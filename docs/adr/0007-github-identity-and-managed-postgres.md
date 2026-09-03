# Use GitHub identity with a managed PostgreSQL commercial plane

ChangePlane will use the GitHub organization ID as Customer Organization identity, the GitHub installation ID as its authorization boundary, and the GitHub repository ID as its metered resource. Human sessions continue to authenticate through GitHub only. A managed PostgreSQL store attached to the hosted Vercel product records append-only Evaluation Events and derived Fleet Posture behind row-level organization isolation; the domain model does not depend on a database vendor.

## Consequences

No GitHub access token, source, diff, prompt, patch, provider response, credential, or customer business data enters the store. Installation tokens are minted just in time. Entitlements are enforced on the server as well as projected in the UI. The production adapter requires migrations, backup and restore evidence, tenant-isolation tests, deletion workflows, cost budgets, and an in-memory adapter for deterministic contract tests before activation.
