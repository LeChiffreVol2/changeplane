# Service-window routing

## Repository invariants

- Every synthetic stop must be scheduled no later than its declared service-window end.
- Route fallback behavior must preserve the same constraint as the primary heuristic.

## Security boundaries

- Use synthetic stop identifiers and times only; do not include customer names, coordinates, map URLs, or production workbooks.

## Compatibility commitments

- A heuristic change must preserve the public route result schema used by downstream clients.

## Operational checks

- Bind the deterministic service-window test and its GitHub App publisher.
- Treat stale heads, expanded paths, provider failure, and exhausted repair attempts as fail-closed outcomes.

