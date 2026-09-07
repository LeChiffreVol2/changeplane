# Retention and deletion contract — approval draft

**Status:** Not yet effective. This contract describes the design-partner alpha and must be reconciled with provider contracts and approved for one exact protected Production release.

## Alpha data locations

GitHub is the operational record for repositories, pull requests, workflows, Checks, comments, artifacts, deployments, Rulesets, and Actions Secrets. The controlled-canary deployment does not establish a deployed customer alpha or activate the candidate commercial PostgreSQL store. The source now includes bounded pilot admission accounting, but no live commercial database or paid launch is established. The hosted API processes connector data per request and does not intentionally persist request bodies, repository source, prompts, patches, provider responses, cookies, OAuth tokens, installation tokens, or plaintext provider keys in application storage or logs.

Vercel and GitHub may retain infrastructure, request, security, workflow, and audit records under their own customer agreements and settings. Optional OpenAI processing follows the customer's provider account and applicable provider terms. ChangePlane therefore does not promise zero retention.

## Product retention targets

- Sealed browser session: expires after the configured bounded session lifetime; key rotation invalidates all existing sessions.
- GitHub installation and repository access: ends when the customer revokes authorization or uninstalls the relevant App, subject to GitHub retention.
- Repository BYOK: stored only as the GitHub Actions Secret `OPENAI_API_KEY`; deleting or rotating it uses the repository-admin flow. Suspected leaked keys must also be revoked at the provider.
- Candidate commercial data: detailed telemetry and pilot admission receipts have a proposed maximum of 90 days; monthly aggregate counters have a proposed 13-month period. These are design targets pending legal and operating review, not active retention guarantees. Receipts contain pseudonymous GitHub identity bindings, revision fingerprint, generation, contract/version, allowance snapshot, verified workflow-attempt start, admission time/UTC period and counter ordinal; they contain no source or credentials.
- Pilot receipt pruning: the server obtains the exact attempt's start time from authenticated live GitHub metadata, never a caller timestamp. New admission requires that start and database admission time inside an active contract lasting at most 30 days. A workflow behind a 90-day receipt therefore cannot qualify again under a current contract, including renewal. A separate operator must close the relevant contract/enrollment while holding its tenant contract `FOR UPDATE` in the same transaction, and verify clock handling, replay rejection and the pruning procedure before activation. The hosted runtime cannot prune, refund or reset accounting. Deleting telemetry must never change admission usage.
- Guard publication journal: commercial deletion and retention jobs never remove unresolved authority or its enrollment. Its separate [operating design](guard-publication-journal.md#retention-and-deletion) requires prior-writer fencing and has no automatic expiry; the commercial receipt cap does not apply to it.
- Support and design-partner records: [RETENTION PERIOD AND SYSTEM OF RECORD — REQUIRED BEFORE APPROVAL].
- Security and billing records required by law: [RETENTION PERIOD AND LEGAL BASIS — REQUIRED BEFORE APPROVAL].

## Deletion request

An authorized organization owner may request deletion at [PRIVACY EMAIL]. ChangePlane will verify the requester's identity and repository/organization authority, revoke active ChangePlane access under its control, delete ChangePlane-controlled records within [NUMBER] days, and identify records that remain in GitHub, OpenAI, Vercel, backups, legal holds, or the customer's own systems. The customer remains responsible for removing repository files, workflow history, comments, Checks, artifacts, and secrets it controls in GitHub.

Deletion completion must be recorded without copying deleted customer content into the record. The candidate commercial store may not be enabled until tenant-scoped deletion, replay closure before receipt pruning, retention expiry, backup restoration, forced-RLS isolation, and credential-rotation drills pass on the exact release. Legal entity, privacy contact, legal basis, billing-record obligations and the effective deletion deadline remain unresolved approval requirements. Admission receipts alone must not be treated as automatically billable records or used to invent a legal retention obligation.
