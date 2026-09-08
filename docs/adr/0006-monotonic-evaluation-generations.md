# Allow safe same-revision recovery through evaluation generations

One Assured Revision may have multiple monotonically increasing Evaluation Generations so a transient failure can recover without a no-op commit. Beginning a generation immediately blocks the stable Guard, re-fetches trusted policy, target, evidence, and publisher identities, and supersedes every older generation. Only the latest generation may complete the Guard; delayed or replayed completion from an older generation fails closed.

## Consequences

The Guard remains bound to one exact commit while its latest evaluation state may change. Receipts, proof locators, Evaluation Events, audit presentation, and reconciliation identify both the Assured Revision and Evaluation Generation. A same-revision rerun never inherits an older PASS without fresh deterministic evaluation.

## Completed GitHub Check reevaluation

Two live same-SHA canaries rejected reopening an already completed Check: a status-only PATCH retained success, and explicitly clearing terminal fields did not produce a usable begin response. The latter did retire the old success to `action_required` before failure.

Managed v15 keeps the same Check ID and exact-revision external ID. A first evaluation uses GitHub's `in_progress` state. Reevaluating a completed Check leaves it `completed/action_required` with a fresh start time, a `phase=begin` marker and no old assurance passport. GitHub therefore blocks merge while ChangePlane evaluates fresh evidence. The authenticated generation marker identifies ongoing evaluation independently of GitHub's terminal presentation.

The Action validates both blocked presentations. Begin replay, frozen-contract verification and reconciliation recognize the same pending generation. Only its fresh deterministic completion may publish success; an older completion remains rejected. Recovery can close a timed-out blocked generation and surface a failed workflow notification without granting PASS. Managed v14 bytes remain pinned for protected upgrade classification; prior runtimes fail closed until upgraded.

Live requalification is required before claiming the revised behavior works on GitHub.
