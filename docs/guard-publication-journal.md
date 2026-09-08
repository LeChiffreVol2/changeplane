# Guard publication journal — candidate operating design

**Status:** A candidate operating design for review. The two disposable Supabase qualification projects were deleted. A new isolated Free Guard project has now been provisioned for activation preparation and passed [eight runtime checks](../evidence/changeplane-guard-service-qualification.json), including the explicit per-pool CA adapter. Server TLS enforcement is enabled; no real repository is enrolled and Production is not connected. The owner approved retaining the Free service and staging its credential plus explicit CA in Vercel Production. The subsequent [three-check halt drill and credential transfer](../evidence/changeplane-guard-halt-and-staging.json) passed, and temporary transfer material was removed. No new deployment occurred. This is not production approval, a measured capacity report, or a customer release. Customer access stays closed until the implementation, integration, and operating drills below pass for the exact protected release. This document does not override `guardPublicationSerialized`, legal approval, principal separation, or commercial-runtime gates.

Hosted Production requires the journal for every Guard mutation, including the owner canary. Missing, disabled, unhealthy, or mismatched journal configuration stops publication; disabling the journal never restores the unjournaled publisher. Do not promote this candidate before the dedicated database enrollment and a separate new Guard App principal are ready. The customer capability gate remains false until live serialized-canary evidence passes. Only non-hosted tests may retain legacy behavior when no journal was requested; that path is not a supported Production fallback.

The [engineering policy](../AGENTS.md) permits a database expansion only with reviewed isolation, metering, budgets, billing, and incident controls. This journal exists solely to exclude overlapping Guard writes. GitHub remains the forge, Check surface, policy surface, and merge authority. The deterministic evaluator decides assurance; a journal claim cannot authorize PASS, broaden a patch, or replace fresh exact-revision evidence.

## Authority boundary

Every Guard begin, completion, and reconciliation mutation must pass through the same journal adapter after GitHub authentication and repository binding. A durable lane is keyed by the authenticated repository ID and a revision fingerprint. The fingerprint must identify the shared GitHub Check mutation target consistently across all three operations; generation or operation must not create a second lane for the same target. The trusted server derives this scope, its installation binding, and its deployment release. Request fields and models cannot select a different tenant, epoch, release, or lane.

Claiming a lane is a short database transaction. The committed row survives connection loss and process death. GitHub writes happen only after confirmed acquisition, with the lane held durably throughout every awaited external write and response validation. The same owner may release a reservation when no write has begun, or release a successful operation after all writes and validation finish. Any failure after a write starts, a pending write when the handler exits, or an ambiguous database acknowledgement leaves the lane occupied or poisoned. A conflicting request stops safely; it does not wait in a new ChangePlane queue.

There is no lease expiry, timer takeover, retry that clears another owner, or automatic poison recovery. An abandoned `reserved` row may also need incident recovery because elapsed time cannot prove its owner will never resume. A GitHub Actions cancellation, Vercel timeout, token-rotation request, or observed Check state is not by itself proof that a previously dispatched request cannot still finish.

PostgreSQL row locks end with their transaction, and advisory locks can end with a session. They coordinate the transition that writes the durable lane; they are insufficient by themselves to fence an external GitHub request after a process or connection failure. See PostgreSQL's [explicit locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html).

## Candidate schema and metadata

The candidate [migration](../database/002_guard_publication_journal.sql) uses a separate `changeplane_guard` schema. Enrollment is keyed by `repository_id` and binds `tenant_id`, `installation_id`, `guard_app_id`, an epoch UUID, the exact 40-character protected release SHA, enabled state, and `max_lanes`. A lane includes that enrollment binding, its revision fingerprint, a private owner UUID, operation (`begin`, `complete`, or `reconcile`), phase (`reserved`, `writing`, or `poisoned`), and claim/update timestamps. Enrollment references restrict deletion rather than cascading unresolved authority away.

The [server adapter](../server/guard-publication-journal.js) exposes `withPublication(scope, callback)` and `callback({ write })`. Every mutable Guard read belongs inside the callback. Every external mutation belongs inside an awaited `write` operation, and response validation must finish before the publication callback returns and releases ownership. Detached work and transport retries must not outlive that boundary. SQL transitions use `changeplane_guard.transition` with `claim`, `write`, `release_reserved`, `release_written`, or `poison`; release matches the private owner and exact scope. Disabling enrollment rejects all transitions, including release and poison annotation. It is a hard halt: an already-held row remains held, rather than draining automatically.

| Stored item | Purpose and restriction |
| --- | --- |
| Numeric tenant, installation, repository, and Guard App IDs | Authorization binding; derive from authenticated GitHub identity and approved enrollment. They are pseudonymous identifiers, not anonymous data. |
| Revision fingerprint | Identify one exact Check target without storing customer source or repository names. Preserve the same derivation across operations and releases. |
| Protected source release SHA and epoch UUID | Reject unenrolled deployments and old enrollment epochs. These do not fence a GitHub write already in flight. |
| Private lane-owner UUID | Match the active server operation during transitions. Treat it as an internal capability; never expose it to the browser, model, public response, or logs. |
| Operation, phase, timestamps, enabled state, finite lane cap | Enforce exclusion, contain ambiguous work, and measure bounded operational usage. |

Do not store GitHub credentials, App private keys, database passwords, OAuth sessions, provider keys, source, diffs, prompts, patches, provider responses, repository names, customer business data, or complete GitHub request/response bodies. Credentials remain in the separately controlled server environment and short-lived request memory. Journal errors and metrics contain request IDs, bounded reason codes, counts, and redacted metadata only.

Successful lane release removes the live exclusion row. The candidate is not an append-only event history, cached-result service, billing ledger, or Fleet database. Operational audit evidence must not be invented from rows that no longer exist.

## Isolation and database roles

Use a dedicated authority database and credentials with no commercial-store access. A separate schema name alone does not isolate shared backups, privileged operators, failure domains, or credentials. Reuse of a managed database service requires a separate reviewed isolation decision before activation; the default operating design is a separate authority database.

| Role | Required boundary |
| --- | --- |
| Migration/enrollment operator | Applies reviewed schema and enrollment changes through controlled operations. Credentials are absent from the hosted request runtime. It may not erase uncertain lanes as routine maintenance. |
| Transition-function owner | `changeplane_guard_journal_owner`: `NOLOGIN`, no superuser or `BYPASSRLS`, fixed trusted function search path, and only the authority needed by reviewed transitions. The runtime cannot assume this role or replace its functions. |
| Hosted runtime | `changeplane_guard_journal_runtime`: execute-only access to reviewed state transitions and tenant-scoped enrollment reads; no direct table DML, enrollment, reset, deletion, schema creation, role administration, or arbitrary recovery. A provisioned login receives only this role's approved privileges. |
| Monitoring reader | Redacted operational counts with no lane-owner capability or customer content. No write, takeover, or enrollment authority. |
| Backup/recovery operator | Separate privileged operational identity. Proves complete authority-state backup and restoration; credentials are never supplied to the web runtime or customer. |

Require forced row-level security with `changeplane.guard_tenant_id` scoped to each transaction; missing or wrong context must fail closed. Revoke public function execution and unneeded schema privileges. A `SECURITY DEFINER` transition function must use a fixed search path and validated arguments. The service sets tenant context only after authenticating the GitHub installation/repository binding; a custom database setting is not authentication by itself. Monitoring and recovery access are separate provisioning requirements, not roles automatically granted by this candidate migration.

Test role membership and actual grants, not just policy text. PostgreSQL documents that superusers and `BYPASSRLS` roles bypass row security; owners normally do too unless forced RLS applies. Backup completeness also needs separate verification because an RLS-filtered backup can omit rows. See [row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

### Migration operator privileges

The journal and pilot-admission migrations require PostgreSQL 16 or newer and a trusted operator with `CREATEROLE` and `CREATE` on its dedicated database. They do not require superuser or `BYPASSRLS`. For newly created roles, transaction-local `createrole_self_grant = 'set'` gives the operator explicit role-switching capability without inherited privileges. After creating the schema, `SET LOCAL ROLE` creates tables and functions as the unprivileged owner; the owner does not receive database-wide schema-creation rights. Commit or rollback restores the caller's role and session setting. PostgreSQL retains the creator's administrative memberships, so the operator remains privileged and must never be used as a hosted runtime credential. See [role creation grants](https://www.postgresql.org/docs/17/role-attributes.html) and [the self-grant setting](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT).

If roles already exist, review their attributes and memberships first. A role administrator must explicitly grant the operator `SET` on the owner with `INHERIT FALSE`; the migration rejects a missing grant rather than taking over an existing role. Owner and runtime roles must remain bare, unprivileged non-login roles, and runtime must never receive owner membership. Apply each reviewed migration once as one transaction; a failed attempt requires rollback before retry. Do not reset an installed schema to retry or migrate live authority data.

Both scratch PostgreSQL suites exercise fresh and precreated roles through a non-superuser operator, missing-privilege rollback, object ownership, restored session state, and runtime isolation. These are local PostgreSQL results. Supabase's default administrator is [not a superuser](https://supabase.com/docs/guides/database/postgres/roles-superuser); its deployed role controls, extensions, TLS and durability still require provider-specific verification before activation.

After applying the reviewed migration, run the [read-only catalog probe](../database/probes/guard_journal_catalog.sql) through the administrative SQL connection. It returns bounded booleans for ownership, forced RLS, function configuration and grants, without reading tenant rows. For Supabase, require `apiRolesInspected = 3` and all catalog checks true: `anon`, `authenticated` and `service_role` must have no schema, table or function access. The local suite verifies that accidental API/PUBLIC grants, runtime table writes and disabled RLS turn the report false. This is only a catalog check; it does not verify migration bytes, a provisioned runtime login, network/TLS access, transactional behavior on that provider or durability. Its `runtimeLoginVerified` and `providerDurabilityVerified` fields remain false. Do not use it to lift the publication or customer-access gates.

### Disposable Supabase qualification

The [redacted qualification record](../evidence/changeplane-supabase-guard-qualification.json) captures the September 8, 2026 test on a separately created Free project running PostgreSQL 17.6. The original migration and subsequent reviewed RLS policy deltas passed all ten catalog checks, including isolation from all three Supabase API roles. Synthetic transactions exercised claim exclusion, finite capacity, wrong-tenant and wrong-owner rejection, denied direct deletion, tenant switching, missing context, and committed poison across successive SQL calls. Those calls used the administrative SQL tool with `SET LOCAL ROLE`; they did not provision or authenticate a hosted runtime login.

The RLS policy now wraps `current_setting` in a scalar subquery so PostgreSQL can evaluate tenant context once per statement. The provider's two RLS performance warnings cleared, and the local suite verifies that a prepared query on a reused connection refreshes context when switching tenants and denies missing context. See Supabase's [RLS performance guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).

The final Security Advisor returned no findings. One [foreign-key index INFO](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) remains for capacity review: a foreign-key-equivalent lookup on the small synthetic fixture used the repository-leading `lanes_pkey` index. That observation does not establish throughput or justify a capacity claim. The final complete migration passed thirteen local journal checks; the managed project received the initial migration followed by policy deltas, as recorded by their names and source hashes.

The temporary project was deleted after testing. Provider inventory confirmed its absence and matched all pre-existing project identities and statuses; no operation changed another project or organization settings, and the organization remained Free. The incremental project quote was USD 0 per month. This first exercise did not test application TLS, an authenticated runtime pool, provider restore/failover, credential rotation, live GitHub publication, or production tenant deletion.

### Free runtime qualification

A second disposable Free project in `us-east-1` received the complete reviewed migration from scratch. The [runtime qualification record](../evidence/changeplane-free-runtime-qualification.json) captures a real least-privilege login from the operator's local Node.js process through Supavisor transaction pooling. The actual journal adapter passed concurrent exclusion, validated release and committed-poison persistence across a new authenticated pool. Transaction-scoped RLS refreshed between two synthetic tenants and denied missing context; direct mutation, enrollment, owner-role switching and the temporary credential operator were inaccessible to runtime.

Default Node trust rejected the provider chain with `SELF_SIGNED_CERT_IN_CHAIN`. The repeat run used the public CA downloaded from that project's Database Settings through process-scoped `NODE_EXTRA_CA_CERTS`, retaining `sslmode=verify-full` and verifying chain and hostname. No global trust setting or Production configuration changed. That record predates the explicit per-pool CA configuration below; it cannot establish that later adapter's hosted behavior. The deployed runtime still needs approved CA configuration and connectivity proof from its actual Vercel region; a valid URL alone is insufficient. See [Supabase SSL verification](https://supabase.com/docs/guides/platform/ssl-enforcement).

After password rotation, the old credential failed a fresh login with `28P01` and its replacement authenticated as the same restricted role. All test clients had closed before rotation: this proves replacement authentication, not containment of already-authenticated sessions or GitHub writers. The runtime login was then disabled, the temporary credential operator removed, the project deleted and local credential/transport-key files removed. Inventory returned to the same one existing healthy project and the organization remained Free. Security Advisor reported no findings; the earlier foreign-key index INFO remains a capacity-review item.

This historical disposable result does not establish Vercel connectivity, restore/failover durability, production tenant deletion, live Guard publication or organization enforcement. No GitHub request or customer activation occurred in that exercise, and both of its temporary services were deleted. The later isolated Guard service described above is a separate provisioning event; its synthetic enrollment is disabled and its uncertain lane retained. Keep all corresponding release gates closed.

## Admission, capacity, and cost

The candidate serializes admission on the enrollment row and counts occupied and poisoned lanes against that repository's `max_lanes`. The schema permits a finite cap from 1 to 1,000; this is an input bound, not evidence that any value supports a particular workload. Normal release of a successfully completed lane returns capacity. There is no stored backlog, automatic retry storm, or eviction of uncertain rows to create capacity.

The adapter currently limits each locally created pool to four connections, with a five-second connection timeout and ten-second idle timeout. Each transition sets a two-second lock timeout, five-second statement timeout, and synchronous commit. These are configuration bounds, not global service capacity, end-to-end request deadlines, or measured performance. A timeout never clears a previously held lane. The repository cap and pool settings do not implement global enrollment, physical storage, transaction-rate, or provider-spend enforcement; those remain activation requirements.

Before a canary, the release owner must record the selected cap and an operating budget for the exact deployment. Before any customer activation, the following limits must have measured enforcement and a named owner. Missing limits keep enrollment closed.

| Required budget | Measurement and action |
| --- | --- |
| Repository and tenant enrollment count | Admit only the explicitly reviewed repository set; start with the single owner canary. Record finite per-tenant and service-wide caps before expansion. |
| Occupied lanes and physical storage | Measure rows, indexes, table growth, WAL, and backup storage. A repository cap does not establish a global byte limit. Reserve capacity for finishing or poisoning work already admitted. |
| Database connections and transition duration | Bound the runtime pool, statement/lock waits, and request duration. A database timeout stops admission; it never releases or steals a durable lane. |
| Transaction rate and retries | Meter claim attempts, conflicts, transitions, and upstream attempts. Deny excess new admission and honor GitHub rate limits. Never replay an ambiguous external write to improve a success metric. |
| Monthly provider spend | Current preparation is USD 0; USD 100 per month is reserved for a later scale decision. The [phase budget](operating-budget.md) records a conditional future estimate. Do not upgrade or provision persistent authority during disposable qualification; actual production limits and metering remain unverified. |

The proposed operating target is to alert and stop expansion at 80% of an approved capacity or spend budget, and stop new admission at its hard limit. These thresholds are operating targets, not measured capacity or an availability promise. Reaching a budget never deletes a poisoned lane or returns an unevaluated success. If the provider cannot preserve already-admitted authority safely at the limit, halt publication and enter incident recovery.

Journal costs belong to ChangePlane's service operator. Lane claims, conflicts, poison events, and database transactions create no customer charge and are not customer Evaluation Events. Any paid product remains governed by a separately reviewed order form, cost evidence, and commercial ingestion/entitlements. The journal cannot turn `commercialReady` true.

## Durability, restore, and failover

Required authority RPO is zero: no acknowledged exclusion decision may disappear or move backward while an old writer could still affect the same Guard principal. This is a safety requirement, not a claim that a selected provider delivers it. Ordinary backups, a retention setting, or an available replica do not establish it.

PostgreSQL streaming replication is asynchronous by default and can lose transactions that have not reached the promoted standby. Therefore an unproven failover cannot admit new writers against the old Guard principal. See [standby and synchronous replication](https://www.postgresql.org/docs/current/warm-standby.html).

Require durable WAL acknowledgement for every authority transition and verify the actual primary, synchronous-standby, promotion, and storage configuration. PostgreSQL's `synchronous_commit` modes have different durability guarantees; a synchronous setting without configured synchronous standbys does not prove remote durability. `remote_write` is insufficient evidence of standby disk durability after an operating-system crash. See [WAL configuration](https://www.postgresql.org/docs/current/runtime-config-wal.html). Provider-specific failover and split-brain fencing still require their own evidence.

After restore, failover, point-in-time rollback, or suspected authority loss, halt all publication and new enrollment. Do not interpret a missing lane as a clean initial state. Resume the same principal only after proving complete, non-regressed authority state and fencing every prior writer. If either proof is unavailable, keep the old principal disabled, establish a new Guard App principal and epoch, and have repository administrators approve and verify fresh publisher-bound Ruleset requirements. Changing only an epoch, a database password, or the enabled flag does not fence an already-issued GitHub request.

The candidate has no automatic recovery that manufactures this proof. A restore drill for `001_commercial_plane.sql` does not satisfy an authority-journal restore drill.

## Release enrollment, rotation, and rollback

Enroll only an attributed Vercel Production deployment from the protected `LeChiffreVol2/changeplane` `main` revision. The stored release SHA must match the exact source commit, and the epoch must match the approved enrollment. Previews, forks, CLI uploads, unenrolled releases, changed principal/installation bindings, and disabled enrollments fail before a Check mutation.

| Server configuration | Required binding |
| --- | --- |
| `CHANGEPLANE_GUARD_JOURNAL_ENABLED` | Exact `true` for the reviewed adapter. Missing or disabled stops hosted Guard writes, including canary writes. |
| `CHANGEPLANE_GUARD_JOURNAL_DATABASE_URL` | Server-only `postgres:` or `postgresql:` connection for the dedicated authority database and least-privilege runtime role. The parser requires a host, username, database path, and exactly one query pair, `sslmode=verify-full`. It rejects `sslmode=require`, duplicate or extra options, fragments, and encoded hosts. Verify actual certificate handling, role grants, and provider configuration during enrollment; never return or log the URL. |
| `CHANGEPLANE_GUARD_JOURNAL_CA_CERT` | Optional server-only multiline PEM bundle with 1–4 CA certificates and a 16 KiB maximum. Obtain and verify it through the selected provider's official source. Omit for Node's trust roots; a present empty or malformed value fails closed. No leaf/client certificate, private key, path, URL or appended data is accepted. |
| `CHANGEPLANE_GUARD_JOURNAL_EPOCH` | Exact UUID of the approved enrollment epoch. A different epoch cannot inherit or clear occupied authority. |
| `CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE` | Exact protected source SHA approved for the journal deployment; the operation scope also carries `releaseSha` and must match the database enrollment. This setting cannot substitute for missing implementation or live canary evidence. |

Configuration additionally requires a distinct Guard App and an exact 40-character current source SHA matching `CHANGEPLANE_GUARD_JOURNAL_VERIFIED_RELEASE`; `development` is not a journal release binding. Every `VERCEL=1` environment requires this configuration, while external access still independently requires attributed Production provenance. Non-hosted fixtures may use the old test path only if no journal setting is present and no journal adapter was requested; even an empty `CHANGEPLANE_GUARD_JOURNAL_` setting requests validation.

The shared PostgreSQL connection module validates the external URL and CA, removes the already-validated URL TLS option, then supplies explicit TLS options to `pg`: certificate verification, the exact configured hostname and TLS 1.2 or newer. This avoids `pg` replacing an explicit CA when it reparses `sslmode` from a URL. Custom trust applies only to that database pool; it does not change GitHub/HTTPS or process-wide trust. The pilot store uses independently configured `CHANGEPLANE_DATABASE_CA_CERT`. See [node-postgres SSL configuration](https://node-postgres.com/features/ssl).

Changing either a connection URL or its CA replaces the cached pool; it never deletes a lane or fences an existing GitHub writer. Follow the same drain/containment procedure before credential or trust rotation. `npm run test:postgres-tls` generates ephemeral certificates and a loopback PostgreSQL cluster, verifies real runtime authentication through both adapters, rejects wrong/missing CA and hostname mismatches, and exercises a bounded CA rotation bundle. It cleans up its cluster and private test keys. These tests do not access Supabase or establish Vercel-region connectivity or production recovery.

Both database adapters handle connection errors while a client is checked out for a transaction. A pool's idle-client error handler does not cover this interval. A managed-provider preparation attempt exposed an unhandled `ECONNRESET` before any reservation or GitHub request; a local PostgreSQL reproduction confirmed that disconnecting between queries could terminate both adapter processes. The adapters now catch client error events, preserve their redacted failure/unknown-commit behavior and discard disconnected clients when returning them to the pool. Each scratch PostgreSQL suite runs a child-process regression that terminates the backend after `BEGIN` and after the domain query before `COMMIT`; the process must survive with no committed reservation or usage charge. This does not fence an already-issued GitHub request or establish provider recovery. See [node-postgres client error events](https://node-postgres.com/apis/client).

Readiness separates `checks.guardJournalConfiguration` (local configuration validation) from `checks.guardJournalConfigured` (a journal configuration was supplied). Invalid required configuration returns `configuration_required`; configuration success performs no database connection, enrollment query, health probe, durability check, or failover proof. `checks.guardPublicationSerialized` remains false in code pending the live operating evidence. The environment attestation, parser, and database enrollment are distinct checks, not interchangeable claims of safety.

A release or epoch change must not reset, delete, or orphan occupied lanes. First stop admission, prove known operations have finished, and inventory all unresolved lanes. Retain any unresolved ownership and choose incident recovery if an old writer cannot be fenced. A previous known-good code deployment is not automatically a safe database or Guard-authority rollback: it must use the same guarded protocol and an explicitly reviewed enrollment. If the rollback target cannot satisfy that boundary, keep Guard publication paused. Never clear `CHANGEPLANE_GUARD_JOURNAL_ENABLED` or roll back to an unjournaled writer to recover availability.

Rotate database credentials through a reviewed operation: halt admission, issue the new least-privilege credential, verify its grants and tenant restrictions, revoke the old credential, and confirm old sessions cannot admit new work. Database credential rotation does not invalidate already-minted GitHub tokens. Rotate App credentials separately, preserve lane state, and prove outstanding-writer containment; unresolved writes require the principal-recovery procedure above. Record secret identifiers, owners, rotation dates, and outcomes outside public materials; never record secret values.

## Retention and deletion

An occupied, `writing`, poisoned, or otherwise uncertain authority row has no automatic retention expiry. Commercial event deletion, tenant deletion, backup pruning, and administrative cascades must not remove it or its enrollment. Do not truncate the journal, reset an epoch, or recreate the schema as a deletion procedure.

Successful operations remove their lane through the verified owner transition. A customer deletion request first disables new admission and is reviewed against unresolved authority, issued credentials, required Guard bindings, and retained backups. Deletion can finish only after prior writers are fenced and deleting records cannot recreate an authorization gap. If that cannot be proven, keep the minimum authority state under restricted access and resolve the retention obligation through the approved legal/incident process; do not silently promise deletion that would reopen unsafe publication.

Before customer activation, the legal pack must explicitly cover this authority metadata and its exceptional retention. The commercial store's 90-day event target, aggregate retention, and deletion procedures do not apply automatically to the journal. Backup pruning must preserve all authority evidence needed for the approved zero-loss recovery path.

## Incident procedure

1. On a poisoned lane, ambiguous external write, unexpected ownership transition, durability alarm, or restore/failover event, stop affected admission. Expand to a service-wide halt if isolation or history is uncertain. Keep required GitHub Checks in force and Repair disabled.
2. Preserve the enrollment, lane owner/phase, exact release and epoch, and redacted request evidence. Do not retry the GitHub write, delete the lane, or mark it successful from an observation alone.
3. Determine whether the old writer or issued credentials can still affect GitHub. A timeout, cancellation, process restart, or clean-looking Check does not establish fencing.
4. Resume through a reviewed recovery operation only with complete authority-state and writer-fencing proof. Otherwise replace the Guard principal, obtain fresh administrator-approved publisher binding, and re-evaluate the exact revision.
5. Record cause, containment, capacity impact, recovery evidence, and an updated regression test. Customer notification follows the approved support/incident channel; this design does not promise an on-call rotation or response SLA.

## Activation evidence

All entries below remain live gates until evidence is recorded for the exact source release, schema, database configuration, enrollment epoch, and Guard principal.

| Drill | Required observation |
| --- | --- |
| Tenant and role isolation | Wrong/missing tenant, installation, App, epoch, and release cannot claim or transition; runtime cannot modify enrollment, perform table DML, assume the owner role, delete poison, or alter functions. |
| Concurrent publication | Interleave begin, complete, and reconcile for the same target across processes. Only the durable owner reaches GitHub; different approved targets remain isolated. |
| Crash and uncertain response | Interrupt before claim acknowledgement, after reservation, after marking a write, during a delayed GitHub response, and before release acknowledgement. No successor enters an unresolved lane; no automatic expiry occurs. |
| Fresh assurance within ownership | Superseding generations, new commits, changed policy/evidence, and stale requests remain rejected. Successful journal ownership alone never produces PASS. |
| Capacity and provider failure | Exercise the selected lane cap, connection/time budgets, unavailable database, and storage/spend admission controls while preserving active/poisoned authority. Measure, do not assume, capacity and latency. |
| Restore and failover | Demonstrate zero loss of acknowledged authority with old-primary/writer fencing, or demonstrate a halt followed by a fresh Guard principal and administrator-approved policy binding. No restored missing row is treated as new authorization. |
| Rotation, deletion, and rollback | Old credentials/releases cannot admit new work; occupied lanes survive rotation/deletion attempts; rollback cannot use an unguarded publisher. |
| Protected canary | Record organization-owned exact-revision Guard behavior, interleavings, recovery, notification delivery, and real timing without copying private repository content or credentials. |

Completing local adapter or SQL tests is necessary but does not complete these operational gates. No database provisioning, provider budget, customer charge, compliance certification, or measured availability is implied by this design.
