# Retention and deletion contract — approval draft

**Status:** Not yet effective. This contract describes the design-partner alpha and must be reconciled with provider contracts and approved for one exact protected Production release.

## Alpha data locations

GitHub is the operational record for repositories, pull requests, workflows, Checks, comments, artifacts, deployments, Rulesets, and Actions Secrets. ChangePlane's deployed alpha does not activate the candidate commercial PostgreSQL event store. The hosted API processes connector data per request and does not intentionally persist request bodies, repository source, prompts, patches, provider responses, cookies, OAuth tokens, installation tokens, or plaintext provider keys in application storage or logs.

Vercel and GitHub may retain infrastructure, request, security, workflow, and audit records under their own customer agreements and settings. Optional OpenAI processing follows the customer's provider account and applicable provider terms. ChangePlane therefore does not promise zero retention.

## Product retention targets

- Sealed browser session: expires after the configured bounded session lifetime; key rotation invalidates all existing sessions.
- GitHub installation and repository access: ends when the customer revokes authorization or uninstalls the relevant App, subject to GitHub retention.
- Repository BYOK: stored only as the GitHub Actions Secret `OPENAI_API_KEY`; deleting or rotating it uses the repository-admin flow. Suspected leaked keys must also be revoked at the provider.
- Support and design-partner records: [RETENTION PERIOD AND SYSTEM OF RECORD — REQUIRED BEFORE APPROVAL].
- Security and billing records required by law: [RETENTION PERIOD AND LEGAL BASIS — REQUIRED BEFORE APPROVAL].

## Deletion request

An authorized organization owner may request deletion at [PRIVACY EMAIL]. ChangePlane will verify the requester's identity and repository/organization authority, revoke active ChangePlane access under its control, delete ChangePlane-controlled records within [NUMBER] days, and identify records that remain in GitHub, OpenAI, Vercel, backups, legal holds, or the customer's own systems. The customer remains responsible for removing repository files, workflow history, comments, Checks, artifacts, and secrets it controls in GitHub.

Deletion completion must be recorded without copying deleted customer content into the record. The candidate commercial store may not be enabled until tenant-scoped deletion, retention expiry, backup restoration, forced-RLS isolation, and credential-rotation drills pass on the exact release.

