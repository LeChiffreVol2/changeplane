# Revision-bound observations for agent-assisted pull requests

**A public-oracle and synthetic-protocol pilot of ChangePlane**  
ChangePlane maintainers · 2026-09-20 · Preliminary technical report, not peer-reviewed

## Abstract

An agent can produce a useful change while a surrounding workflow associates its evidence with the wrong revision, publisher or evaluation. We evaluate a narrow part of ChangePlane: the public read-only GitHub collector and supplied-observation evaluator. We execute all 40 QuixBugs Python programs in buggy and supplied-reference variants using unmodified upstream tests. Of the 40 buggy suites, 37 fail and 3 encounter test timeouts; all 40 reference suites pass, with upstream slow-test skips retained. We then replay 14 explicit evidence/fault templates per measured candidate through the production collector, yielding 1,120 dependent constructed cases, and enumerate 3,584 configurations of a bounded observation abstraction. No false eligibility or unnecessary hold is observed relative to the declared oracle. Six isolated evaluator ablations each introduce one false-eligibility counterexample. A simulation of correctly configured native required checks agrees with ChangePlane in all shared cases. These results support reproducibility and specified observation handling within the tested boundaries; they do not establish a new verification theorem, competitive superiority, live-forge behavior, program-repair capability or customer benefit.

## 1. Question and scope

The research question is whether the implemented public observation path preserves the declared associations between evidence and a change, including when supplied observations are stale, incomplete or inconsistent. The study does not ask whether ChangePlane can invent a patch, replace an authoring agent, prove tests complete, or decide what a maintainer should merge.

ChangePlane separates model proposals, deterministic evaluation and trusted application. This experiment reaches only the public advisory portion: `inspectPullRequest` collects declared CI observations, and `assessObservation` checks a supplied normalized observation. Managed Guard publication, credential isolation, repair application, campaign budgets and actual merge authority are outside the exercised code paths. They require separate experiments.

GitHub already supports revision-associated required checks, expected App publishers and strict up-to-date requirements. These are capabilities to preserve in a fair baseline, not omissions that can be assumed. SLSA's source requirements also discuss approval of the final revision and context-specific approvals. Revision binding alone therefore does not establish novelty. The present contribution is an inspectable experimental artifact and a limited empirical characterization of an implementation. [GitHub required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [SLSA source requirements](https://slsa.dev/spec/v1.2/source-requirements).

## 2. Observation contract and assumptions

Let an observation contain an observed/current head pair H, policy pair P, evaluation generation pair G, required producer U, execution subject S, collection completeness C, collection stability T, control-path completeness K, protected-change disposition R and execution outcome E. For the finite experiment, eligibility is the conjunction:

```text
eligible = current(H) AND current(P) AND current(G)
           AND producer_matches(U) AND subject_matches(S)
           AND complete(C) AND stable(T) AND complete(K)
           AND no_unreviewed_protected_change(R)
           AND completed_successfully(E)
```

This definition is written in the protocol independently of the evaluator's returned decisions and reason codes. Its labels are nevertheless authored by the maintainers, not independently adjudicated. The evaluator's `OBSERVED_SUCCESS` means consistency of supplied observations; its authority flags remain false. It cannot authenticate arbitrary caller-supplied producer identities or prove that a runner executed the declared bytes.

The collector reads a trusted default-branch policy, reads current CI evidence twice and rechecks repository, policy revision and PR identity. A change detected during collection returns unavailable evidence. A mutation immediately after the last read is still possible: this public point-in-time observation is not a linearizable merge gate. Authenticated forge behavior, an adequate test oracle and correct operator policy are assumptions, not conclusions of this study.

The fault model includes wrong-revision/publisher/workflow observations, newer pending or failing executions, changes during reads, incomplete pagination, protected files and provider failure. It excludes compromised forge infrastructure, malicious model execution, kernel/process isolation, secret exfiltration, network scheduling, distributed Guard publication and unbounded liveness. The finite enumeration is state enumeration, not a temporal model checker or implementation-refinement proof.

## 3. Reproducible method

### 3.1 Public test oracle

QuixBugs supplies small algorithmic programs, buggy and corrected Python implementations, and tests. We pin upstream commit `4257f44b0ff1181dedaedee6a447e133219fcebf` and run every Python program suite in both variants. No upstream program, test or candidate patch is changed. The reference implementations are supplied solutions, not ChangePlane-generated repairs. [QuixBugs project and paper](https://jkoppel.github.io/QuixBugs/), [pinned source](https://github.com/jkoppel/QuixBugs/tree/4257f44b0ff1181dedaedee6a447e133219fcebf).

The environment is Python 3.14.6, macOS/arm64, pytest 8.4.2 and pytest-timeout 2.4.0, with all Python package versions recorded. Both variants receive the same 2-second per-test and 60-second per-suite limits. The default slow knapsack and Levenshtein cases remain skipped, as documented upstream. The runner strips inherited credentials/configuration and disables automatic pytest plugins; it is a local runner, not a sandbox for arbitrary code. Each suite records source/test hashes, exit status, individual test outcomes, skips, versions and elapsed time. [Upstream pytest instructions](https://github.com/jkoppel/QuixBugs/blob/4257f44b0ff1181dedaedee6a447e133219fcebf/README.md#using-pytest-tests).

The unit of analysis is 40 paired programs; statistical independence between those programs is not assumed. The 80 suites, repeated invocations and individual tests are not independent defects. Passing this finite oracle establishes test adequacy, not general correctness. Prior QuixBugs research examines test-adequate patches that overfit; this experiment performs no additional correctness adjudication. [Ye et al., QuixBugs repair study](https://arxiv.org/abs/1805.03454v4).

### 3.2 Collector replay and baseline

The existing production collector receives a local GET-reader implementation returning explicitly constructed GitHub-shaped payloads. The measured suite conclusion is used for the ordinary observation; fault/policy scenarios may deliberately override it. Each row preserves the original measured outcome, effective evidence, transformation and transcript hash. Complete request/response transcripts are published in compressed JSONL.

The baseline is a simulation of required checks with exact subject, expected App, strict current base and accepted native conclusions. Clean, stale-head and wrong-publisher cases are shared comparisons. Newer failing/pending rows additionally assume a mapping from the latest modeled workflow execution to the current required check and are labeled separately. The base stays current and no test-merge subject is used in these replays: strict-base/test-merge rules have harness sanity tests only. This is neither GitHub's implementation nor live qualification of rerun ordering.

Workflow identity, protected paths and collection/policy consistency are outside the simplified native comparison; advanced native required-workflow rules and CODEOWNERS can provide related controls. They are not scored as native failures. Skipped/neutral jobs are reported as a deliberate policy difference because native required checks accept these conclusions and ChangePlane's declared evidence policy requires success. A skipped test case inside a successful pytest suite is distinct from an entirely skipped CI job. [GitHub check conclusions](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks), [rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

The stale-success template deliberately injects a wrong-revision response into a head-filtered API seam. It tests defensive handling of supplied data; it is not evidence that GitHub emits that response. In shared cases the required job and aggregate workflow have the same outcome. A failing unrelated job with a passing required job is not evaluated. Only declared provider/race errors become unavailable results; an unexpected harness or collector exception terminates the experiment.

### 3.3 Enumeration and ablations

Nine Boolean conditions and seven execution outcomes form 2^9 × 7 = 3,584 configurations. Exactly one configuration is eligible under the conjunction. All combinations are checked against the shipped observation evaluator and six in-memory copies, each removing one binding/protected-path constraint through exact source substitutions. The original source is never edited. Each substitution, mutated source hash and first counterexample is recorded. The complete enumeration is published.

This deliberately adversarial space is dominated by held states. Zero false eligibility over its 3,583 ineligible states is a finite conformance observation, not a population error-rate estimate. The 40 positive reference controls in the separate replay help prevent an always-reject implementation from appearing useful. Repeated application of a template does not add independent scientific evidence for its correctness.

### 3.4 Protocol history

Protocol and driver commit `41f796c8ed6c1abf14380133eb0c418e2f839acf` preceded the first public execution. That pilot exposed a recorder bug: timeout failures in JUnit were mislabeled as ordinary test failures. The pilot remains published and excluded from scoring. The correction and regression tests were frozen in `0a4cb0e2343d27dde68ddbef252a1e8b5574f2c8` before the two reported full runs. No production evaluator, benchmark selection, timeout or expected eligibility label changed in response to the pilot. The evaluated runtime modules and their transitive local imports match protected-main commit `3cbfc5594820b9515d8f013b9cd233742b57a6fb` byte for byte; their hashes are recorded separately from the experiment checkout commit. This is a documented exploratory pilot, not independently registered preregistration.

## 4. Results

### 4.1 Actual public program execution

| Variant | Suites | Successful suites | Failed suites | Suites with test timeout | Unavailable suites |
| --- | ---: | ---: | ---: | ---: | ---: |
| Buggy | 40 | 0 | 37 | 3 | 0 |
| Supplied reference | 40 | 40 | 0 | 0 | 0 |

Per recorded run, buggy programs produce 89 passing test cases, 170 failing cases, 17 timeout cases and 2 skipped cases. Reference programs produce 276 passing cases and 2 skipped cases. The three buggy suites with timeouts are `bitcount`, `find_first_in_sorted` and `sqrt`. A timed-out suite can also contain other outcomes; it is not relabeled as an assertion-detected defect. No suite reaches the outer 60-second timeout. Every program and both upstream skips are retained.

These observations are about the upstream oracle. They do not imply that ChangePlane found or repaired 40 bugs, or that all possible defects would be rejected. Both systems receive the same test outcomes in the shared comparison.

### 4.2 Synthetic collector replay

| Group | Constructed cases | ChangePlane eligible | Simulated native eligible | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Measured candidate outcomes | 80 | 40 | 40 | Agreement; current successful evidence remains usable |
| Wrong revision or publisher | 160 | 0 | 0 | Agreement in the shared robustness scenarios |
| Newer failing/pending run | 160 | 0 | 0 | Agreement under the explicit current-check mapping assumption |
| Collection race/failure, workflow mismatch, protected tests | 560 | 0 | Not scored | ChangePlane contract tests; advanced native rules not modeled |
| Skipped or neutral CI job | 160 | 0 | 160 | Declared policy difference, not a GitHub safety defect |

Across 1,120 constructed replays, the collector reports 40 eligible observations, 1,080 holds and no eligibility disagreement with the declared ChangePlane oracle. Of those holds, **400 are unavailable outcomes** from injected read races, missing data or provider failure; they are retained as unavailable rather than relabeled as completed assessments. No public result grants Guard, repair or merge authority. Authority flags are fixed false by the public profile, so this checks a product boundary rather than proving credential security.

There are no disagreements in the 240 shared cases, nor in the 160 additionally assumed rerun cases. Consequently this experiment supplies **no evidence of superiority over correctly configured native GitHub controls**. It shows that the measured public test signal is preserved and that the authored fault contracts are handled as specified.

### 4.3 Bounded observation configurations

| Evaluator | Configurations | False eligibility | Unnecessary hold |
| --- | ---: | ---: | ---: |
| Intact public evaluator | 3,584 | 0 | 0 |
| Remove current-head binding | 3,584 | 1 | 0 |
| Remove policy-revision binding | 3,584 | 1 | 0 |
| Remove generation binding | 3,584 | 1 | 0 |
| Remove publisher binding | 3,584 | 1 | 0 |
| Remove subject binding | 3,584 | 1 | 0 |
| Remove protected-path evaluation | 3,584 | 1 | 0 |

Each counterexample has otherwise acceptable evidence with only the ablated condition violated. For example, the head-binding mutant accepts evidence for observed head `aaaa…` after current head advances to `cccc…`. This demonstrates that each constraint is causally active for the authored contract, not that the constraint is novel or that all unknown attacks are covered. The exact inputs and decisions are in the summary, not reconstructed from aggregate totals.

### 4.4 Repeatability and runtime

The two complete reported runs have identical source/test hashes, exit codes, test-level outcomes and counts. They take 60.054 and 57.486 seconds respectively on the same machine; this is same-environment repeatability, not independent replication. Both produce the same deterministic collector-replay and enumeration fingerprints. The first analysis records local collector replay P50/P95 overhead of 0.118/0.245 milliseconds. This excludes network, CI scheduling and model latency, so it is not a product latency promise or native-GitHub speed comparison. No statistical significance or population confidence interval is inferred from these dependent constructed cases. The [reproducibility record](../../benchmarks/assurance/results/2026-09-20/reproducibility.json) preserves both timings and protocol commits.

## 5. Threats to validity and negative evidence

- **Maintainer-authored contract.** Source research and a separate agent's methodological review improved the design, but neither is independent adjudication or independent reproduction. The expected-label conjunction closely reflects the intended contract; independent review remains necessary.
- **Small algorithmic corpus.** QuixBugs supplies an external behavioral oracle, not realistic PR metadata, production task size, user behavior or unknown-defect prevalence. Protocol perturbations are authored, and most overwrite rather than reuse the measured conclusion. The experiment provides no customer PMF evidence.
- **Incomplete oracle and timeout dependence.** Two tests are skipped per variant under upstream defaults. Passing finite tests does not prove correctness. Noncompletion depends on the specified timeout/platform; other environments may differ.
- **Simulation gap.** API replies, revisions, events, producer IDs and all fault schedules are synthetic. No live branch protection, merge queue, OAuth session, Check publisher, races after final read or remote replay attacker is exercised. GitHub's advanced policies are not an absent capability.
- **Narrow execution path.** The public evaluator cannot grant merge authority or authenticate arbitrary supplied observations. Results do not qualify managed Guard, source repair, two-attempt campaigns or credential isolation. The 3,584-state abstraction omits temporal liveness and unbounded interleavings.
- **No competitive advantage observed.** Agreement with the native model is the result on common cases. Skipped/neutral disagreement reflects different policies and is not scored as superiority. Ablations are deliberately weakened copies, not competitors.
- **Exploratory correction.** The recorder changed after a pilot revealed a defect. Its original record and amendment are published, and the corrected complete experiment is repeated. This history precludes portraying the process as a flawless untouched preregistration.

## 6. Artifact and next study

The [reproduction guide](../../benchmarks/assurance/README.md) provides commands. The [summary](../../benchmarks/assurance/results/2026-09-20/summary.json) links numerically to complete raw suites, compressed API transcripts, all finite states, checksums and counterexamples in the same directory. `npm run benchmark:verify` reproduces deterministic analysis offline in protected CI; it does not rerun Python. The public Python commands reproduce program execution without a customer account or model key. External QuixBugs source remains at its pinned repository with its own license/provenance notices.

The next credible steps are (1) independent review/reproduction of this artifact; (2) a temporal specification with named abstraction bounds and separately checked safety/liveness; (3) isolated live-forge tests of the modeled races and native rules; and (4) a larger public real-repository corpus under equal test/agent budgets. Human-effort and paid-review-quality studies need separate protocols. Paper positioning should follow those findings, not precede them. The [research plan](../technical-paper-plan.md) and [primary-source review](benchmark-sources.md) retain those requirements.
