# Product roadmap

ChangePlane advances by dependency and evidence, not by feature count or a calendar promise.

## Managed-v14 candidate — 2026-09-07

The protected production baseline remains `ddccd7ab7721c28542a0e4a36956cbc307832672`. The current candidate adds installed scheduled recovery, safe profile-preserving upgrades, same-SHA contract retention, truthful launch gates, an [offline pilot scorecard](launch-measurement.md), and a [PostgreSQL publication journal candidate](guard-publication-journal.md). These changes have not inherited live deployment evidence.

The source now holds durable journal ownership across begin, completion and reconciliation to address the earlier unjournaled shared-Check race. An uncertain write holds or poisons its lane without timer takeover. The candidate still keeps `guardPublicationSerialized: false` and pauses external alpha/self-service pending live authority durability, restore/failover and adversarial organization-canary evidence. Every hosted Guard write, including the owner canary, requires valid journal configuration and enrollment; missing or disabled authority never restores the earlier publisher. Do not promote this candidate before the dedicated database and a separate new Guard App are enrolled for its exact source SHA and epoch. Configuration readiness is not operational proof. See the [architecture and ordered release gates](automated-sdlc-architecture.md).

The next product milestone is a paid founder-led Verify Lite / Strict Head pilot with measured activation, customer value and reliability. A manual invoice under a reviewed order form can test payment demand without adding a billing platform; the separate publication authority journal remains mandatory. No live journal database has been provisioned or deployed, and legal entity details and agreements remain unresolved drafts. Automated commercial readiness stays false while authenticated ingestion, entitlements and operational database controls are incomplete.

## Status on 2026-09-01

| Release | Repository proof | External activation still required |
| --- | --- | --- |
| Trust | Implemented and tested: monotonic same-SHA Evaluation Generations, Strict Head / Queue Certified, separated-principal readiness, and public-claim audit | Configure distinct production Installer and Guard Apps and repeat the protected live canary |
| Autonomous activation | Implemented and browser-tested: automatic publisher discovery plus exact-SHA, inventory-bound, digest-approved Ruleset plan/apply | Complete organization-owned Strict Head and Queue Certified activations; Administration write is needed only to create the Ruleset through ChangePlane |
| Commercial plane | Implemented and unit-tested as a tenant-scoped event contract, PostgreSQL schema/RLS adapter, tier ladder, quota disposition, and deletion seam | Provision the managed database, connect event ingestion and Fleet UI, validate restore/deletion, and approve legal release |
| Operations | Implemented and integration-tested: the vendored five-minute OIDC reconciliation sweep is exact-workflow/repository bound and can only close an expired Guard as `action_required` | Activate it in the organization canary, connect failed-run notification, publish status, and measure scheduler delay plus service targets |
| Proof | Deterministic Origin-boundary suite and benchmark contract pass locally | Run customer or independent same-scenario bake-offs; a real Cursor Origin mirror remains unavailable without a subscription |

These statuses prove executable contracts in this repository. They do not represent a production rollout or a general competitive-superiority result.

1. **Trust release**: reconcile product claims, separate GitHub App principals, introduce Strict Head and Queue Certified, and add safe same-revision Evaluation Generations.
2. **Autonomous activation release**: discover evidence automatically, present an exact Ruleset plan, apply it only after Deliberate Approval, and reduce onboarding to the three approved human decisions.
3. **Commercial plane release**: introduce GitHub-derived Customer Organization identity, the managed Evaluation Event store, Entitlements, the Free-to-Enterprise plan ladder, Fleet Posture, and deletion lifecycle.
4. **Operations release**: add synthetic monitoring, stuck-evaluation reconciliation, a public status surface, and measured service-target reporting.
5. **Proof release**: complete organization-owned Strict Head and Merge Queue canaries, live Assurance Passport verification, tenant-isolation and recovery evidence, and the public Agent PR Assurance Benchmark.
6. **Rollout**: publish reviewed legal documents, onboard founder-led design partners, and enter GitHub Marketplace only after the activation gate.
7. **Autonomous Repair expansion**: activate only after at least three paying Customer Organizations request it and its separately credentialed live canary, rollback, budget, and incident controls pass.

Repository implementation can prepare each release, but production activation that requires new GitHub Apps, a managed database, legal review, or external customer evidence remains explicitly gated on those external prerequisites.
