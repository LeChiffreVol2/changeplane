# Free preparation now; USD 100 ceiling when scaling

The founder clarified on **2026-09-08 (Asia/Bangkok)** that the current phase must cost **USD 0**. The **USD 100 per month** infrastructure ceiling applies only when scaling; it is not authorization to spend now. It includes tax and contingency when activated. Customer-owned GitHub usage and optional BYOK remain customer costs. Founder compensation, legal/entity formation and customer acquisition are outside that later infrastructure estimate. No paid subscription upgrade or spend-control setting has been applied.

## Current phase: USD 0

| Surface | Current use and boundary |
| --- | --- |
| Local development and PostgreSQL | Reproducible tests, clean builds, synthetic fixtures and failure drills; no hosted customer dependency |
| GitHub | Protected source pull request and existing synthetic canary; use included capacity and stop new test work at a limit |
| Vercel Hobby | Existing controlled engineering deployment and preview validation; no plan upgrade or customer rollout implied |
| Supabase Free | Isolated Guard preparation quoted at USD 0; no real repository enrollment or Production connection yet. The owner approved retaining the Free project; credential and CA staging completed without deployment. Do not change other projects or organization settings. |
| Models, billing and add-ons | No managed model spend, billing service, paid database add-on or new subscription |

The Free project quote is USD 0 per month and the selected Supabase organization remains Free. Both earlier disposable qualification projects have been deleted; [their runtime exercise](../evidence/changeplane-free-runtime-qualification.json) also removed its test credentials and confirmed the existing inventory was unchanged. Following the owner's continuation approval, a new separate Guard service passed [eight runtime checks](../evidence/changeplane-guard-service-qualification.json). Its synthetic enrollment is disabled and no real repository is enrolled. The owner subsequently approved retaining the Free service and staging its credential plus explicit CA in Vercel Production. A further [three-check halt drill and staged-secret cleanup](../evidence/changeplane-guard-halt-and-staging.json) completed without deployment; both retained synthetic lanes remain occupied. The separately approved GitHub Free organization and synthetic repository must be deleted after testing. Keep synthetic data and test credentials separate from the existing project. At a free quota limit, stop new work; do not upgrade, resume or resize other projects, or remove occupied authority records to continue.

Vercel explicitly restricts Hobby to **personal, non-commercial use**. A free price for customers does not itself establish that a commercial product pilot fits those terms. Accordingly, the current milestone is engineering qualification, not customer activation or a public SaaS launch. Confirm an eligible hosting arrangement before external product use; do not migrate the hosted control plane away from Vercel or weaken deployment provenance to avoid that decision. See [Vercel Hobby eligibility](https://vercel.com/docs/plans/hobby).

Free preparation is complete when the candidate has reviewed code and reproducible safety evidence, remaining live/provider boundaries are recorded, temporary resources and credentials are removed, and existing projects and plans are unchanged. It does not require effective legal documents, payments, customer installations or a paid production topology. Those remain separate launch gates in the [architecture](automated-sdlc-architecture.md).

## Individual and business support

| Customer | GitHub ownership | Supported path after release activation |
| --- | --- | --- |
| Individual developer | Personal account | Verify-first install, repository-owned behavioral Check and Strict Head when eligible |
| Business or team | Organization | The same path, with organization administrator approval where required |
| Enterprise Cloud business | Organization within an enterprise | The same path, subject to enterprise App and repository policies |

A signed-in person may administer several accounts. Usage and authorization belong to the repository-owner account and matching App installation, not to that human's login or a shared billing label. A personal account is not required to create a GitHub organization. GitHub Enterprise Server, forks and cross-repository repair remain outside the release.

GitHub supports repository Rulesets for public repositories on Free, including Free organizations, and private repositories on Pro, Team and Enterprise Cloud. Therefore a personal private repository may need GitHub Pro, while an organization private repository may need Team or Enterprise Cloud. Missing Ruleset eligibility cannot be presented as active Strict Head. These are customer GitHub plan costs, not seats on ChangePlane's Vercel team. See [GitHub Ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).

Internal release proof needs both personal and organization canaries. Use a public repository containing only synthetic fixtures for the organization canary where feasible; it does not require every customer to own an organization or publish private code. An account's eligibility does not bypass the current private-alpha, legal or serialization gates.

## Later scale phase: conditional allocation, not a purchase plan

Public prices checked on 2026-09-08. The founder selected the existing Supabase billing organization, with a billing-impact review before any change. The earlier inventory contained one active and one inactive project. A fresh inventory before the authorized qualification contained only one active existing project; the inactive project's absence preceded this work. The same existing project remained healthy afterward and the organization stayed Free. The qualification project was quoted at USD 0 per month and was deleted after testing; see the [redacted record](../evidence/changeplane-supabase-guard-qualification.json). This is not a quote for a production Pro topology. Authenticated dashboard access is available, but no upgrade or invoice-impact approval has been obtained.

Retain the earlier estimate only for a future scale decision. It reserves room for three to four charged Micro projects, including the existing project, separate authority and accounting databases and possible temporary operating capacity, plus one Vercel deploying developer. This is not a minimum required to prepare the product or a verified launch topology. It assumes usage inside included allowances; upgrade breakdown, credits and tax remain to be verified. It does not authorize changes to the existing project's compute or availability. Account and unrelated-project names are kept out of this public plan.

| Item | Monthly allocation (USD) | Assumption |
| --- | ---: | --- |
| Vercel Pro | 20 | One deploying seat; no paid add-ons |
| Shared Supabase Pro organization | 45–55 | 25 plan + 30–40 compute - 10 credit; 3–4 charged Micro projects |
| Metered usage and temporary operating drills | 10 | Controlled reserve, not an allowance already purchased |
| Tax and contingency | 15–25 | Remaining reserve depends on the confirmed baseline |
| Total ceiling | **100** | Revised fixed estimate **65–75**, subject to the upgrade quote and technical qualification |

Vercel Pro includes one deploying seat and USD 20 usage credit at a USD 20 monthly platform fee. The connected hosting team was still Hobby when inspected; commercial rollout requires an appropriate plan. See [Vercel Pro pricing](https://vercel.com/docs/plans/pro-plan) and [plan use cases](https://vercel.com/pricing).

Supabase Pro starts at USD 25 with USD 10 compute credit; an additional Micro project is approximately USD 10 monthly. The proposal uses separate projects and credentials for publication authority and pilot accounting. The earlier USD 55 combined-hosting estimate assumed a dedicated organization with only those two projects; it does not cover the selected shared account. Upgrading affects the entire organization. Do not change, resume, transfer or resize its existing projects as a side effect. See [Supabase pricing](https://supabase.com/pricing) and [organization-based billing](https://supabase.com/docs/guides/platform/billing-on-supabase).

Supabase documents that paused projects do not incur compute charges and illustrates three Micro projects on Pro at USD 45 monthly. The fourth-project allocation is conservative temporary-capacity headroom, not a claim that an inactive project is currently present or billed. Separate current invoice/proration from the recurring total. See [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq).

## Conditions before any scale spending or activation

The database price does **not** qualify a provider for Guard authority. Daily backup retention does not establish zero loss of acknowledged journal decisions. Before choosing this topology, prove durable acknowledgments and old-writer fencing across its actual failure modes, or prove a publication halt and new-Guard-principal recovery. A restore must never silently reopen a lane. If the provider cannot satisfy that boundary within the ceiling, do not provision it for publication or weaken assurance to fit the price; revise the provider choice first. The [journal operating design](guard-publication-journal.md) remains binding.

Test the exact runtime login and TLS endpoint from the Vercel region, transaction-scoped tenant policies, connection limits, concurrent admission, backup completeness, restore, deletion and rotation. Pooling must preserve each transaction's tenant context. Paid IP, replica, branching, PITR or observability additions need a revised cost calculation; none is assumed in the revised baseline.

Review the shared organization's Spend Cap with its owner before changing it, since restrictions can affect existing projects. For ChangePlane, propose two fixed Micro projects with optional paid add-ons disabled. The Spend Cap excludes compute and several opt-in charges; it is not a universal USD ceiling. See [Supabase cost controls](https://supabase.com/docs/guides/platform/cost-control).

Vercel spend controls can pause every project on a team and are checked periodically, so usage can continue briefly after a threshold. Apply such controls only in a dedicated ChangePlane billing scope or after reviewing their effect on the existing team. See [Vercel Spend Management](https://vercel.com/docs/spend-management).

Proposed operator thresholds are: review committed costs at USD 60; stop expansion at USD 70; stop new paid-pilot admission at USD 80 while retaining headroom for existing work and authority preservation. These are not deployed automatic controls. Never delete occupied journal rows, cancel accounting history or issue PASS to meet a budget. Confirm provider metering, alert delivery and the safe halt before activation. No exact USD 100 invoice guarantee is established by this source plan.

Use existing GitHub Actions and Vercel operational surfaces for the first pilot. Verify needs no model key. Optional review or repair remains BYOK, with managed model spend disabled. Do not add a hosted queue, new agent runtime, paid preview service or automatic billing system to this budget.

The database billing account is selected for evaluation, but an upgrade is deferred until scale and requires a fresh spending decision. Before that change, obtain the authenticated invoice breakdown and review effects on existing projects. The owner created a disposable Free organization and both Apps are installed on its one synthetic canary, alongside the existing personal installation. Organization enforcement proof remains outstanding. Guard credentials are staged in Vercel; [live Production binding and journal qualification remain outstanding](guard-app-registration.md). The founder has reported no legal entity; legal documents remain draft. Complete exact-release review, operating drills and customer activation evidence before accepting a payment.
