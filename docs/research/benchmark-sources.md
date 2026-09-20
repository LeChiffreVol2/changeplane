# Primary sources for the public assurance experiment

Research notes, 2026-09-20. This document records source facts and proposed evaluation choices; it does not report experimental results. Recommendations below are study-design judgments, not claims endorsed by the cited authors. See the [technical paper plan](../technical-paper-plan.md) for the product's intended research scope.

## Recommended first benchmark: QuixBugs

QuixBugs contains 40 small algorithmic programs with defects, corresponding Python and Java implementations, tests, and corrected Python implementations. Its authors describe the original defects as single-line defects and the collection as a program-repair benchmark. That makes it suitable for obtaining actual public test executions before injecting assurance faults; it does not make the collection representative of production pull requests. [Original project](https://jkoppel.github.io/QuixBugs/), [upstream source](https://github.com/jkoppel/QuixBugs).

The Python suite supports testing the buggy version by default and the reference version with `--correct`. Upstream documents slow cases skipped by default, a permanently skipped Levenshtein case, and possible nontermination requiring timeouts. Preserve these outcomes rather than treating skipped tests or timeouts as successful tests. [Upstream usage](https://jkoppel.github.io/QuixBugs/#using-pytest-tests), [test selection implementation](https://github.com/jkoppel/QuixBugs/blob/4257f44b0ff1181dedaedee6a447e133219fcebf/conftest.py).

The repository publishes an MIT license with copyright attributed to James Koppel, 2017–2019. It also includes historical provenance notes describing uncertainty around the original Quixey intellectual-property rights and the original creator's support for use. Preserve both notices when redistributing relevant material; do not describe this as a separate legal clearance. A runner that downloads a pinned upstream checkout and publishes execution records avoids unnecessary vendoring. [License](https://github.com/jkoppel/QuixBugs/blob/4257f44b0ff1181dedaedee6a447e133219fcebf/LICENSE), [upstream legal notes](https://github.com/jkoppel/QuixBugs/blob/4257f44b0ff1181dedaedee6a447e133219fcebf/legal_notes.txt).

The selected source revision is [`4257f44b0ff1181dedaedee6a447e133219fcebf`](https://github.com/jkoppel/QuixBugs/tree/4257f44b0ff1181dedaedee6a447e133219fcebf), verified from the local checkout used for this study. To obtain that source independently:

```sh
git clone https://github.com/jkoppel/QuixBugs.git /tmp/changeplane-quixbugs
git -C /tmp/changeplane-quixbugs checkout --detach 4257f44b0ff1181dedaedee6a447e133219fcebf
git -C /tmp/changeplane-quixbugs rev-parse HEAD
```

The runner's manifest should pin Python dependencies separately; the upstream commit alone does not identify the execution environment.

**Proposed execution protocol:** freeze the upstream full Git commit SHA, record the SHA-256 of all executed source/test files, and run all 40 Python programs in both modes. Keep candidate, test suite and environment identities separate. Save command, Python/pytest versions, exit status, test counts, skips, timeout classification and permitted raw output for every invocation. Report 40 paired programs and 80 candidate suites, not 80 independent defects. If a reference fails, retain the result and investigate; the word “reference” is not permission to overwrite observed failure.

**Proposed assurance experiment:** use the measured test receipts unchanged for ordinary success/failure controls. Separately alter one protocol association at a time: target revision, repository identity, producer identity, evaluation generation, policy digest or evidence completeness. Label these transformations as synthetic fault injection. The observed program behavior comes from a public benchmark; the event schedule and injected protocol faults come from ChangePlane's authors. Neither component supplies an independently adjudicated end-to-end product verdict.

Passing finite benchmark tests supports only those tested behaviors. Prior QuixBugs research explicitly studies test-adequate patches that overfit, using additional correctness-assessment techniques. This is a direct reason to report “suite passed,” not “program proved correct” or “all bugs found.” [Ye et al., *A Comprehensive Study of Automatic Program Repair on the QuixBugs Benchmark*, Journal of Systems and Software 2021](https://arxiv.org/abs/1805.03454v4).

## A fair simulated GitHub baseline

The comparison should be named a **simulation of specified GitHub controls**, with its assumptions visible. It is not a measurement of GitHub's running service. These native capabilities must not be removed to create an apparent ChangePlane advantage:

| Control | Primary-source behavior | Consequence for this experiment |
| --- | --- | --- |
| Revision | Earlier-commit checks do not satisfy latest-commit requirements; where test-merge checks exist, the test-merge commit must pass. [Required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks) | A stale-success case should be rejected by both systems. Distinguish head and merge-test identities. |
| Up-to-date branch | Strict required checks require an up-to-date branch; loose mode does not. [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | Configure strict mode or explicitly report that the comparison is against loose mode. |
| Publisher | An expected GitHub App can be required as the source of a check. [Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging) | Both systems should reject a same-name check from a different App. |
| Conclusions | GitHub accepts `success`, `skipped`, and `neutral` for required checks. A workflow skipped by filtering remains pending; a conditionally skipped job can report success. [Required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks) | Do not silently define GitHub as success-only; disclose any stricter ChangePlane evidence policy. |
| Trigger | Eligible workflow events matter for PR checks; `workflow_dispatch` checks alone do not satisfy a PR ruleset requirement. [Required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks) | Either model the event restriction or delimit every generated check to an eligible event. |
| Merge queue | `merge_group` has its own SHA/ref and needs a separate workflow trigger. [Workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group) | Do not use a successful PR-head receipt as a queue receipt. |

GitHub also supports stale-review dismissal, approval of the latest reviewable push, and code-owner review requirements. Enterprise organization/enterprise rulesets can require designated workflows. A comparison limited to required-check name/App matching is consequently not a comparison against every native GitHub governance capability. [Protected-branch review controls](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-pull-request-reviews-before-merging), [required workflows](https://docs.github.com/en/enterprise-cloud%40latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-workflows-to-pass-before-merging).

**Study-design recommendation:** use the same test executions, expected App, selected revision and strict-base assumption for both sides. Report common native failures separately from additional ChangePlane-policy holds. For example, a same-SHA receipt rejected for a changed ChangePlane policy digest is a difference under that policy, not by itself a vulnerability in GitHub. Before calling a native acceptance unsafe, state the safety predicate independently and explain whether native mechanisms could enforce it with equivalent configuration.

Do not infer undocumented GitHub rerun ordering, same-context duplicate resolution, propagation timing or bypass behavior from a locally convenient implementation. Either exclude those cases from the GitHub comparison or record them as unqualified until a separate controlled live-forge experiment measures them. Native API state and a ChangePlane observation snapshot are also different observations: synthetic snapshot corruption is not evidence that GitHub accepted corrupted internal state.

## SWE-bench: useful later, not a metadata substitute

SWE-bench Verified is a 500-instance subset whose card includes repository/base-commit identity, problem text, reference patches, test patches and test-name lists. Its intended task is issue resolution, with execution-based verification. [Verified dataset card](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified/blob/main/README.md). The official evaluation harness applies candidate patches to task repositories and executes tests in Docker environments. [Evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/).

**Inference:** replaying only those repository names, SHAs or test labels through ChangePlane adds realistic identifiers, but no newly observed behavioral ground truth. It cannot produce a SWE-bench resolution score, independent defect-detection score or repair result. Executing public QuixBugs candidates is a stronger immediate behavioral control than relabeling synthetic traces with SWE-bench metadata.

The official SWE-bench harness repository supplies an MIT license. The inspected Verified dataset card does not independently specify a dataset-wide license field; do not automatically transfer the harness license to every third-party issue, patch and repository represented in the dataset. [Harness license](https://github.com/SWE-bench/SWE-bench/blob/main/LICENSE), [dataset card](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified/blob/main/README.md).

If used later, pin the dataset repository revision, harness commit, task instance IDs, task repositories and container image digests; keep predictions separate from reference patches. Report installation failures, unresolved instances, timeouts, hardware and all costs. A successful replay of a supplied reference patch validates the local harness path, not ChangePlane's ability to generate a repair. This is a proposed reporting protocol based on the harness's distinct patch-application and execution stages. [Official evaluation workflow](https://www.swebench.com/SWE-bench/guides/evaluation/).

## Related work and formal-model boundary

| Primary work | Relevant established idea | What the paper still needs to establish |
| --- | --- | --- |
| [in-toto, USENIX Security 2019](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias) | Cryptographic integrity across software supply-chain actors and steps. | Explain how an observation receipt differs from signed supply-chain attestation; do not imply equivalent guarantees. |
| [SLSA v1.2 provenance](https://slsa.dev/spec/v1.2/provenance) | Verifiable artifact/build/source provenance. | Map exactly which identities are associated, authenticated or merely observed. |
| [SLSA v1.2 source requirements](https://slsa.dev/spec/v1.2/source-requirements#two-party-review) | Source controls include final-revision review and context-specific approvals. | Revision binding alone is not an established novel contribution. Investigate implementation, failure behavior and workflow cost. |
| [Lamport, *Specifying Systems*](https://lamport.azurewebsites.net/tla/book.html) | State-machine specification, safety/liveness reasoning and TLC model checking. | State the abstraction, finite domains and explored bounds. A JavaScript bounded enumerator is not automatically a TLA+ model or an unbounded proof. |
| [QuixBugs repair study](https://arxiv.org/abs/1805.03454v4) | Test adequacy and overfitting are separate from full patch correctness. | Separate evidence acceptance from semantic correctness and authoring ability. |

**Proposed formalization:** model target revision, trusted policy/workflow identity, generation, submitted evidence, acceptance and application as distinct state. State the trusted actors and exclude a malicious forge or stolen trusted-controller key unless those threats are actually modeled. Explore stale deliveries, reordered completion, cancellation and target advancement. Include a liveness control that current complete evidence can become acceptable; an implementation that rejects every trace is not a successful assurance layer.

Keep three evaluations separately named: (1) actual public program execution; (2) synthetic protocol fault injection against the shipped evaluator and literal temporary ablations; (3) bounded exploration of an abstract transition model. Agreement among them is supporting evidence, not a demonstrated refinement proof linking the abstraction to production code.

## Reporting method and defensible claims

ACM SIGSOFT's engineering-research standard recognizes benchmarking and quantitative simulation as empirical evaluation methods, asks authors to identify the chosen method, and calls for comparison with alternatives or an explanation of why comparison is impractical. The human-participant experiment standard is a different standard. [Engineering research standard](https://github.com/acmsigsoft/EmpiricalStandards/blob/master/docs/standards/EngineeringResearch.md), [human experiment standard](https://github.com/acmsigsoft/EmpiricalStandards/blob/master/docs/standards/Experiments.md).

For this first author-run pilot, the following reporting choices are recommended:

- Publish the complete generated-case manifest, not just the passing subset. State which expected labels were authored by ChangePlane's developers.
- Keep program count, candidate-suite count, fault-template count and generated-trace count separate. Reusing one program with many protocol transformations does not produce many independently sampled real-world defects.
- Report exact descriptive counts for the finite constructed corpus. Do not attach population confidence claims to exhaustive enumeration of author-selected templates. Any future generalization needs a defensible sampling design; the SIGSOFT sampling supplement distinguishes sample, population and sampling frame. [Sampling standard](https://github.com/acmsigsoft/EmpiricalStandards/blob/master/docs/supplements/Sampling.md).
- Publish misses, false holds, inconclusive results and setup failures. Record environment and all run parameters. Do not choose held-out cases after inspecting their outcomes.
- Compare native controls and additional product policy in separate tables. Report equal performance honestly when native checks already cover the event.
- Preserve a clean reproduction command and immutable input hashes. A second run by the same authors verifies repeatability only; arrange reproduction by another operator before claiming independent validation. ACM distinguishes artifact availability/evaluation from results validated through a separate study. [ACM artifact-review policy](https://www.acm.org/publications/policies/artifact-review-and-badging-current).

The narrowly defensible result is: **under the stated local environment, public test suites produced the recorded outcomes, and the evaluated ChangePlane implementation accepted or rejected the specified associated evidence and injected faults as reported**. No customer data, model-quality score, autonomous repair success, live GitHub qualification, human time savings, industry-wide safety rate, novelty claim or competitor superiority follows from that result alone.
