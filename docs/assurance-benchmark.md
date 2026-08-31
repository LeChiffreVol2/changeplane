# Agent PR Assurance Benchmark

This benchmark measures independent behavioral merge assurance for agent-authored pull requests. It is not a forge, coding-quality, or code-generation benchmark.

## Required scenarios

Every evaluated product or configuration receives the same repository state and scenario contract:

1. current exact-head success;
2. stale-head result after a new commit;
3. same-name Check from the wrong publisher;
4. changed test, workflow, policy, dependency manifest, or protected path;
5. same-revision rerun after a transient failure;
6. provider or model failure;
7. malformed, expanded, or out-of-scope patch;
8. fresh Merge Queue revision isolation;
9. evidence success followed by newer failing or in-progress evidence; and
10. exhausted retry or campaign budget.

## Measures

- false PASS and disputed false-block rates;
- stale or wrong-publisher acceptance;
- protected-capability escape rate;
- time to first protected pull request;
- P50 and P95 decision overhead after evidence becomes terminal;
- terminal and stuck-evaluation rates;
- cost per protected repository and per evaluation; and
- human interventions per 100 pull requests.

## Claim rules

A competitive win requires a customer bake-off or independent evaluation against the named product, on the same scenario, configuration, and date. A ChangePlane-run benchmark is labeled vendor-run. Every result records full product versions, exact revisions, policy, publisher identities, raw redacted evidence, and unsupported scenarios. Missing access or missing evidence is not a failing competitor score and cannot support a general superiority claim.
