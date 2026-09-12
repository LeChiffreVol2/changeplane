# Measure open-source adoption

Run `npm run report:adoption -- /absolute/private/path/adoption-evidence.json` from a current source checkout. With no argument it reads the empty [template](../examples/adoption-evidence.template.json) and reports `not_started`. No records are collected automatically, no network request is made, and no model is called. This maintainer tool is separate from the shipped public runtime and the hosted [commercial scorecard](launch-measurement.md).

The report measures an OSS experiment, not product-market fit, certification or permission to launch. All evidence is **operator-attested**. It cannot authenticate customers, verify a live PR, detect omitted incidents or prove counterfactual time savings. Keep the filled ledger and supporting records outside the public repository; output contains aggregates only.

## What counts

Start the 30-day window when an external operator begins setup. Include abandoned and unsuccessful attempts. One installation ID represents one repository's initial attempt; retries update its evidence rather than creating installations. Owner and synthetic cohorts never count as external adoption. Record GitHub personal (`User`) and organization (`Organization`) ownership explicitly. Several repositories in one account do not create several customers.

Activation is the first **live GitHub API assessment, checked against the current revision and confirmed correct by the operator**, whose outcome is not `UNAVAILABLE`. A legitimate `BLOCKED` or `REVIEW_REQUIRED` can activate. Fixtures, clones, stars, website visits and errors cannot. Keep complete reports and exact revision/run/policy identities in private supporting evidence referenced by `evidenceId`.

Week-four retention means another confirmed live assessment during days 21–28 after setup began, start inclusive and end exclusive. Only installations observed for all 28 days enter the denominator. Young installations remain in the setup cohort. Incomplete collection produces a `null` retention rate. Useful findings are counted separately; repeated use alone does not prove value.

The window is 30 UTC days, start inclusive and end exclusive. Later events do not change it. `coverage.complete` and `coverage.through` attest reconciliation of **all attempts, assessments, errors and comparisons** through that instant. Review correctness independently of acceptance. An incorrect observed assessment immediately produces `review_required`; a rejected suggestion alone does not establish incorrectness.

## Private ledger schema

Use schema 1, canonical UTC timestamps such as `2026-09-13T00:00:00.000Z`, and random UUID v4 pseudonyms. Maintain mappings privately. No names, URLs, diffs, raw reports, emails or keys belong in this ledger. Unknown/missing fields, invalid enums, duplicate IDs within a collection, inconsistent account ownership/cohorts and future timestamps are rejected. Underlying events disguised under different IDs cannot be detected; reconcile before assigning identities.

| Object | Required fields |
| --- | --- |
| Root | `schemaVersion`, `startedAt` (timestamp or `null`), `coverage`, `installations`, `assessments`, `comparisons` |
| Coverage | `through` (timestamp or `null`), `complete` (boolean), `evidenceId` (UUID or `null`) |
| Installation | `id`, `accountId`, `accountType` (`User`, `Organization`), `cohort` (`external`, `owner`, `synthetic`), `channel` (`founder`, `github`, `agent`, `community`, `referral`, `unknown`), `startedAt`, `evidenceId` |
| Assessment | `id`, `installationId`, `occurredAt`, `source` (`github-api`, `fixture`), `outcome` (`EVIDENCE_SATISFIED`, `REVIEW_REQUIRED`, `BLOCKED`, `UNAVAILABLE`), `feedback` (`useful`, `not_useful`, `unreviewed`), `correctness` (`confirmed`, `incorrect`, `unreviewed`), `evidenceId` |
| Comparison | `id`, `installationId`, `occurredAt`, `kind` (`ci_recovery`, `coordination`), `basis` (`observed`, `estimate`), `baselineMinutes`, `assistedMinutes`, `evidenceId` |

Useful assessments must be confirmed correct and available. Unclear or disputed correctness remains `unreviewed`. `UNAVAILABLE` stays in the observed count even if its error behavior was correct. This experiment measures GitHub adoption; GitLab and native Origin retain separate live qualification requirements.

For time comparisons, pair comparable observed incidents in the same repository and category. Privately record selection criteria, PR/head identities, timers, severity and confounders such as a different model or CI system. Include hands-on diagnosis, retries, ChangePlane operation and follow-up; record initial setup separately. Both time fields are nonnegative integer minutes. Set `basis: estimate` if either side is estimated; estimates never enter observed savings. Negative savings remain visible. Report sample size and unresolved/unmatched incidents alongside results. Matched observations do not establish causal or competitor superiority claims.

## Interpreting the report

Results separate personal/organization cohorts and acquisition channels. They show unactivated attempts, activation time, week-four eligible/retained installations, unavailable/unreviewed/incorrect assessments, useful findings, and observed/estimated effort comparisons. Zero observed incorrect findings is not a zero-false-PASS claim. No reviewed observations produces a `null` error rate.

Initial targets: five external repository attempts across at least three accounts, four activations, median activation under ten minutes, three retained installations in week four, and three confirmed useful findings. `pilot_targets_met` also requires the full window, complete coverage and all observed assessments reviewed without an incorrect result. These are learning targets, not a PMF definition. Demand, willingness to pay, support effort and repeatability need interviews and further cohorts.

Exit `0` means those attested pilot targets were met. Exit `2` means not started, collecting, evidence required, review required or unmet targets. Exit `1` means invalid input. None grants launch, payment, Guard or merge authority. The CLI bounds input to five MB and redacts errors; each collection is bounded to 10,000 records.

Reconcile weekly with operators. Optional [first-use feedback](https://github.com/LeChiffreVol2/changeplane/issues/new?template=adoption_feedback.yml) can identify obstacles; never copy comments into policy automatically. See the [product and distribution experiment](agentic-product-plan.md).
