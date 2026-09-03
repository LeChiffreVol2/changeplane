# Commercial plane database

`001_commercial_plane.sql` is the reviewed PostgreSQL boundary for entitlements, append-only Evaluation Events, Fleet Posture, monthly usage, and organization deletion requests. GitHub remains the source of truth for repository names, code, revisions, Checks, Rulesets, and merge state.

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
