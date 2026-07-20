# ChangePlane assurance policy packs

These are small, reviewable starters for `.changeplane/assurance.md`. Copy only the invariants that the repository can actually prove, name the exact test or runbook, and merge the change through the repository's normal protected pull-request path.

Assurance memory is context for `ChangePlane / review`; it is not evidence and can never publish `PASS`. `ChangePlane / guard` still decides from exact-head deterministic evidence.

- `payment-idempotency.md` — duplicate-charge and retry boundaries
- `api-compatibility.md` — public contract and migration boundaries
- `deployment-safety.md` — preview, rollout, and rollback boundaries
- `service-windows.md` — synthetic route-planning time constraints

