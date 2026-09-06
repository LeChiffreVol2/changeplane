# Candidate databases

The commercial store and Guard publication journal have different authority, durability, and deletion requirements. Neither is activated by the presence of a migration or connection string.

## Guard publication journal

The candidate [002_guard_publication_journal.sql](002_guard_publication_journal.sql) migration and [server adapter](../server/guard-publication-journal.js) hold durable exclusive ownership for one authenticated repository and revision fingerprint during a Guard mutation. The `changeplane_guard` schema is an authority store, not the commercial event store. Enrollment binds tenant, installation, Guard App, exact protected source release and epoch. Occupied or poisoned lanes do not expire; uncertain writes remain blocked until prior writers are fenced. A successful operation releases its own lane only after all GitHub writes and response validation finish.

Read the [Guard publication journal operating design](../docs/guard-publication-journal.md) before applying a journal migration or enrolling a repository. It defines role isolation, metadata limits, finite admission/storage/cost budgets, operator billing ownership, credential rotation, retention, incident handling, and required drills. Use separate authority credentials and a dedicated authority database by default. Reusing commercial infrastructure requires a separate reviewed isolation decision.

Hosted Production requires the journal for all Guard writes, including owner-canary writes. `CHANGEPLANE_GUARD_JOURNAL_ENABLED`, `CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL`, `CHANGEPLANE_GUARD_JOURNAL_EPOCH`, and `CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE` must match the reviewed deployment and database enrollment. Missing, disabled, unhealthy, or mismatched configuration stops publication; it never falls back to the unjournaled publisher. Do not promote this candidate before database enrollment and a separate new Guard App are ready. A rollback must preserve the same authority boundary or leave publication paused. Customer serialization gates still require live evidence.

The parser requires enabled `true`, a PostgreSQL URL whose only query pair is `sslmode=verify-full` (not `require`), an epoch UUID, a distinct Guard App, and an exact 40-character verified release matching the current source SHA. Duplicate or extra URL options, fragments, and encoded hosts are rejected. Every `VERCEL=1` Guard path requires the journal; external access also requires Production provenance. Readiness's `guardJournalConfiguration` and `guardJournalConfigured` fields validate supplied configuration only. They do not connect to the database or establish enrollment, provider health, zero-loss authority history, or live serialization. `guardPublicationSerialized` remains false pending that evidence.

Authority recovery requires zero loss of acknowledged exclusion decisions, or a halt followed by a new Guard principal and freshly approved publisher binding. An old backup, changed epoch, cleared lane, or commercial-store restore test cannot prove that a previously dispatched GitHub write is fenced. Commercial deletion and retention jobs must never remove uncertain journal rows or their enrollment. Live customer gates remain closed until the exact implementation and operating environment are proven.

## Commercial plane

`001_commercial_plane.sql` is the reviewed PostgreSQL boundary for entitlements, append-only Evaluation Events, Fleet Posture, monthly usage, and organization deletion requests. GitHub remains the source of truth for repository names, code, revisions, Checks, Rulesets, and merge state.

This is a candidate adapter and schema, not connected production billing. `commercialReady` remains false while `commercialRuntimeIntegrated` and `guardPublicationSerialized` are false in code, regardless of the configuration below. Monthly candidate usage attributes a generation to its earliest retained occurrence in UTC; delayed events and retention can change that count. Do not use it for invoicing until immutable admission accounting and authenticated ingestion are integrated and tested.

Do not enable `CHANGEPLANE_COMMERCIAL_STORE_ENABLED` until all of these are true:

1. apply the migration to an isolated managed PostgreSQL database in the approved US region;
2. connect with a non-owner application role and verify forced row-level security with two GitHub organization IDs;
3. prove the application role cannot update or directly delete `evaluation_events`;
4. schedule detailed-event deletion after 90 days and aggregate deletion after 13 months;
5. run backup restore, credential rotation, cost alert, and organization-deletion drills;
6. review the data inventory against the prohibition on repository names, source, diffs, prompts, patches, provider responses, credentials, and customer business data; and
7. set `CHANGEPLANE_COMMERCIAL_STORE_VERIFIED_RELEASE` to the exact protected Production source SHA only after the drills above pass; and
8. set `CHANGEPLANE_LEGAL_RELEASE_APPROVED=true` plus `CHANGEPLANE_LEGAL_RELEASE_APPROVED_RELEASE` to that same SHA only after the legal release gate is complete.

The application sets `changeplane.organization_id` inside every transaction. Missing tenant context returns no rows and permits no inserts. Customer-requested deletion is recorded with a deadline no later than 30 days.
