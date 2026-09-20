# Agent PR Assurance Benchmark

This is the roadmap for evaluating assurance of agent-authored pull requests. The first executable [public experiment](../benchmarks/assurance/README.md) runs QuixBugs Python programs, then separately tests synthetic evidence handling in the public read-only collector and observation evaluator. Its [technical report](research/technical-report.md) and raw records are maintainer-run evidence, not independent certification, a repair leaderboard score, or live merge assurance.

The scenarios and measures below describe the broader intended benchmark. The current pilot does not measure customer setup/effort, paid model quality, live merge queues, managed Guard publication or repair campaigns. Capability gaps remain unmeasured; they are not successful benchmark rows.

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
