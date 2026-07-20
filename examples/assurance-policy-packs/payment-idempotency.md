# Payment idempotency

## Repository invariants

- A retry for the same checkout intent must reuse the original idempotency key.
- A successful charge must be recorded once before retry state is advanced.

## Security boundaries

- Provider credentials and payment tokens must not appear in logs, fixtures, review findings, or receipts.

## Compatibility commitments

- Existing idempotency keys remain valid across a rolling deployment.

## Operational checks

- Bind the exact duplicate-charge race test and its GitHub App publisher in `.changeplane.json`.
- Require a rollback path for schema or queue changes that affect charge state.

