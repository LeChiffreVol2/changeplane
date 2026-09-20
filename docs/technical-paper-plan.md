# Research plan: revision-bound assurance for agent-authored changes

Status: research proposal, 2026-09-20. No new experimental result, novelty claim, competitive superiority or publication acceptance is asserted here. Finish and qualify the product's live read/decision/handoff path before beginning the study.

## Honest scope

A reproducible technical report or systems/tool paper is plausible. A strong research-conference submission additionally requires a defensible contribution, independent baselines, representative data and results that survive adversarial review. Connecting ChatGPT, adding MCP, combining a reviewer with CI, and separating proposer from verifier do not by themselves establish novelty.

Candidate contribution: a precise assurance state machine that binds a decision to repository identity, policy, target/head revision, workflow identity and evaluation generation, with explicit invalidation and separately credentialed application. The public collector establishes **revision association only**, not cryptographic proof that a test executed exactly the intended source. Keep advisory observations, managed Guard publication and bounded repair as separate capability claims and experiments.

## Questions and preregistered measurements

| Question | Measurement | Comparison and controls |
| --- | --- | --- |
| RQ1: Does the protocol reject stale or misbound evidence? | Unsafe acceptance and unnecessary hold rates over labeled event traces; retain inconclusive outcomes. | Correctly configured native GitHub required checks/strict rules versus the additional ChangePlane assessment; identical revision, CI and permissions. |
| RQ2: Which binding checks matter? | Repeat RQ1 with one constraint removed at a time. | Ablate head, policy, workflow/publisher, generation and protected-scope checks individually. Never deploy weakened variants. |
| RQ3: How much human effort does the workflow save? | Hands-on diagnosis/recovery minutes, intervention count, time to actionable result, unresolved tasks and false blocks. | Paired or randomized tasks with the same authoring agent/reviewer; counterbalance order and report assistance and learning effects. |
| RQ4: What does optional model review add? | Independently adjudicated actionability, known-defect recall, coverage, latency and actual API cost including failures/retries. | Freeze model/engine/prompt/budget; compare the existing reviewer with and without ChangePlane handoff, not an unfairly weaker model. |
| RQ5: What breaks under interruption or concurrency? | Invariant violations, recovery time and unavailable outcomes under reordered events, timeouts, token revocation and same-SHA reruns. | Deterministic trace replay plus isolated real-forge canaries; report platform scheduling uncertainty separately. |

The unit of analysis must be a unique task/PR or independently generated trace, not every tool call. Avoid counting retries as independent samples. Cluster uncertainty by repository/operator; use paired intervals or clustered bootstrap where appropriate. Determine sample size after a pilot and a power/precision analysis, before the held-out study. Do not choose a sample count because it yields significance.

## Formalization and threat model

Define states, events and principals before instrumentation. Specify safety invariants (no stale PASS, no model-issued authority, no mutation outside scope, no inherited assurance after revision/generation changes) separately from liveness objectives. GitHub availability, scheduling delay, credential revocation and human review affect liveness. A finite test suite is not a universal proof; any model checking must name its abstraction and bounds.

Include malicious PR text, policy/test tampering, forged review receipts, wrong publishers, same-SHA reruns, new commits during collection, mixed-generation completions, provider failure, partial review and cancellation. Trusted forge/API behavior, default-branch ownership, secret management and the independent test oracle are explicit assumptions. The system cannot prove requirements are correct or that tests find every behavioral defect.

## Related work to review before claiming novelty

- [in-toto, USENIX Security 2019](https://www.usenix.org/conference/usenixsecurity19/presentation/torres-arias): software supply-chain integrity across actors. Distinguish its cryptographic attestations from our public observation receipts.
- [SLSA provenance](https://slsa.dev/spec/v1.2/provenance): artifact/build provenance and verification. Do not claim a SLSA level through revision matching alone.
- [SWE-bench, ICLR 2024](https://arxiv.org/abs/2310.06770): real-repository issue-resolution evaluation. Useful authoring context; task resolution is not an assurance-protocol benchmark.
- Native forge checks/rules, agent workflows, repair/verification systems and reviewer quality research require a systematic primary-source search. These three references are a starting bibliography, not a completed literature review.

## Artifacts and sequence

1. Freeze the implementation SHA and capability matrix. Record real ChatGPT/forge qualification separately from stubs and local tests.
2. Write the formal model, assumptions and related-work matrix; revise the claimed contribution if prior work already covers it.
3. Publish a protocol and synthetic adversarial trace generator with expected outcomes reviewed independently of implementation.
4. Run a small pilot to validate instrumentation and adjudication. Freeze the evaluation protocol and held-out split before the main study.
5. Collect consented real tasks across independent repositories/operators, including failures and abandoned tasks. Private RouteThai code and operating data must never enter the public dataset or paper.
6. Run baselines/ablations under equal budgets; disclose missing results and uncertainty. The offline `report:review-quality` and adoption report can aggregate operator labels without telemetry.
7. Release a reproducible artifact: source pin, environment/lockfiles, licensed sanitized data, trace seeds, exact commands, raw permitted outcomes and plotting scripts. Have an independent operator reproduce it.
8. Write introduction, model, implementation, evaluation, related work, limitations and artifact appendix. Choose the venue after the evidence supports the scope; a technical report can precede peer-reviewed submission.

Stop or narrow the claim if native controls already handle the tested scenarios equally well, improvements disappear under realistic baselines, missed defects increase, or user effort shifts into setup/operation. Negative findings remain useful research results. No customer outcome should be fabricated from synthetic fixtures or unit-test counts.
