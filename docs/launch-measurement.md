# Measuring the founder-led pilot

Run `npm run report:launch -- /absolute/private/path/launch-evidence.json` to calculate the nine existing 30-day commercial gates. With no argument it reads the empty public template and reports `not_started`. Exit code `0` means the operator-attested numerical gate is met, `2` means not started, collecting, unmet or missing evidence, and `1` means invalid input. No network call or repository mutation occurs.

Keep the filled ledger and its supporting records outside the public repository. The output contains aggregate metrics only. The template in `examples/launch-evidence.template.json` contains no fabricated installations or customer results. All evidence is explicitly **operator-attested**; the report cannot verify an invoice, legal signature, GitHub export or customer interview. It never authorizes launch, accepts a payment or contributes to PASS.

## Collection contract

Use canonical UTC timestamps such as `2026-09-07T00:00:00.000Z`, nonnegative integer USD cents and random version-4 UUIDs for every identifier. Identifiers are pseudonyms, not hashes of customer names. Maintain the mapping privately. Each `evidenceId` refers to supporting records in the operator's private evidence system; no URL, name, source, diff, provider response, customer business data, email or credential belongs in this ledger. Unknown fields are rejected.

| Collection | Allowed fields and meaning |
| --- | --- |
| `installations` | `id` = one repository pseudonym; `organizationId` = customer pseudonym; `installedAt`; `firstProtectedPrAt` = first live PR governed by active Strict Head, or `null`; `evidenceId` |
| `evaluations` | `id` = one immutable generation pseudonym; `repositoryId`; `startedAt`; `terminalAt` or `null`; `outcome` = `pass`, `action_required`, `error`, `pending`; `audit` = `confirmed`, `false_pass`, `disputed_block`, `unreviewed`; `customerConfirmedValuable` = boolean; `evidenceId` |
| `payments` | `id` = unique payment record; `organizationId`; `occurredAt`; `netRevenueUsdCents` = recognized revenue after refunds/credits, excluding tax; `evidenceId` |
| `costs` | `id` = unique cost record; `occurredAt`; `variableCostUsdCents` = allocated hosting, payment, support delivery and other variable service cost; `evidenceId` |

Record one final, reconciled net-revenue amount per payment for the experiment window, not a payment plus a duplicate refund event. A fully refunded payment has zero net revenue and does not establish a paying organization. Use a consistent documented USD conversion basis for any non-USD invoices. This reporting convention is not accounting or tax advice.

Set `startedAt` when the first external customer installation starts the experiment, after rollout authorization. The window is exactly 30 UTC days, start inclusive and end exclusive. Owner canaries and synthetic runs do not belong in the customer ledger. Installation count is distinct repositories; paying organization count is distinct customer organizations with positive net revenue in the window. Median activation time includes successful activations only; the separate activation-count gate prevents a single quick activation from satisfying adoption.

Each generation must appear once, including error and still-pending Guards. The collector reconciles duplicates against the private GitHub identity before assigning its UUID. Export every admitted generation, not only successful ones. The scorecard catches duplicate supplied IDs; it cannot detect the same underlying generation disguised under different UUIDs. Supporting audits must detect missing generations and misattribution.

Set `coverage.through` and a private `coverage.evidenceId` only after reconciling the collection against the operational record. `evaluationsComplete: true` attests that every generation and its outcome is present through that instant; `costsComplete: true` attests the cost allocation is complete. Coverage must reach the 30-day endpoint before reliability and margin can be met. Review each PASS and block against customer-confirmed requirements; use `unreviewed` when the evidence is insufficient. No observed blocks yields an unknown dispute rate, not a measured zero.

Reliability includes every evaluation interval overlapping the window, including a Guard that started earlier and is still pending or completes inside it. Export the associated older installation as well; it is excluded from the new-installation cohort but retained for reliability attribution. The maximum Guard age includes a pending Guard through the observation cutoff and a terminal event after the window as still open at the cutoff. Any observed Guard above ten minutes fails the target even if it eventually passes. False PASS is an incident even during the collecting period. Customer value counts only terminal decisions explicitly confirmed valuable, with private confirmation evidence.

## Weekly operating rhythm

During the approved pilot, collect installation/activation timestamps at onboarding; reconcile GitHub generations and stuck Guards daily; review disputed blocks and valuable decisions with the customer weekly; reconcile net payments and variable costs before closing the window. Review the report with the release owner. A numerical result never waives the publication, legal, support or customer-enforcement gates in [the architecture plan](automated-sdlc-architecture.md).
