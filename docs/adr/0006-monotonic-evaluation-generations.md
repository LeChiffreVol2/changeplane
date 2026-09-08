# Allow safe same-revision recovery through evaluation generations

One Assured Revision may have multiple monotonically increasing Evaluation Generations so a transient failure can recover without a no-op commit. Beginning a generation immediately makes the stable Guard `in_progress`, re-fetches trusted policy, target, evidence, and publisher identities, and supersedes every older generation. Only the latest generation may complete the Guard; delayed or replayed completion from an older generation fails closed.

## Consequences

The Guard remains bound to one exact commit while its latest evaluation state may change. Receipts, proof locators, Evaluation Events, audit presentation, and reconciliation identify both the Assured Revision and Evaluation Generation. A same-revision rerun never inherits an older PASS without fresh deterministic evaluation.

## Completed GitHub Check restart

A live same-SHA canary showed that a status-only PATCH retained the completed Check's prior success and timestamps. Restarting now first retires any usable conclusion to `action_required`, then explicitly clears `conclusion` and `completed_at` and sets a fresh `started_at` with `in_progress`. Both responses are validated. A rejected restart must leave the previous result blocked; it cannot inherit PASS. The API regression reproduces retained fields and a refused restart. Live requalification is required before claiming the new restart behavior.
