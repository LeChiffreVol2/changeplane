# Account support and the USD 100 operating ceiling

The founder set a maximum of **USD 100 per month** for ChangePlane on 2026-09-08 (Asia/Bangkok). This plan treats it as the product's infrastructure ceiling, including tax and a contingency reserve. Customer-owned GitHub usage and optional BYOK model usage remain the customer's costs. Founder compensation, legal/entity formation and customer acquisition are outside this infrastructure estimate. No subscription upgrade, new database or spend-control setting has been purchased or applied.

## Individual and business support

| Customer | GitHub ownership | Supported path after release activation |
| --- | --- | --- |
| Individual developer | Personal account | Verify-first install, repository-owned behavioral Check and Strict Head when eligible |
| Business or team | Organization | The same path, with organization administrator approval where required |
| Enterprise Cloud business | Organization within an enterprise | The same path, subject to enterprise App and repository policies |

A signed-in person may administer several accounts. Usage and authorization belong to the repository-owner account and matching App installation, not to that human's login or a shared billing label. A personal account is not required to create a GitHub organization. GitHub Enterprise Server, forks and cross-repository repair remain outside the release.

GitHub supports repository Rulesets for public repositories on Free, including Free organizations, and private repositories on Pro, Team and Enterprise Cloud. Therefore a personal private repository may need GitHub Pro, while an organization private repository may need Team or Enterprise Cloud. Missing Ruleset eligibility cannot be presented as active Strict Head. These are customer GitHub plan costs, not seats on ChangePlane's Vercel team. See [GitHub Ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).

Internal release proof needs both personal and organization canaries. Use a public repository containing only synthetic fixtures for the organization canary where feasible; it does not require every customer to own an organization or publish private code. An account's eligibility does not bypass the current private-alpha, legal or serialization gates.

## Conditional monthly allocation

Public prices checked on 2026-09-08. The founder selected the existing Supabase billing organization, with a billing-impact review before any change. Read-only inspection found a Free plan, one active project and one inactive project. The create-project quote returned USD 0 on that current Free plan; it is not a quote for a production Pro topology. Browser access to the invoice and upgrade breakdown requires sign-in.

This revised estimate includes the existing projects, two additional separate Micro databases and one Vercel deploying developer, with usage inside included allowances. It assumes all charged projects use Micro; the actual upgrade breakdown, inactive-project behavior, credits and tax remain to be verified. Account and unrelated-project names are kept out of this public plan.

| Item | Monthly allocation (USD) | Assumption |
| --- | ---: | --- |
| Vercel Pro | 20 | One deploying seat; no paid add-ons |
| Shared Supabase Pro organization | 45–55 | 25 plan + 30–40 compute - 10 credit; 3–4 charged Micro projects |
| Metered usage and temporary operating drills | 10 | Controlled reserve, not an allowance already purchased |
| Tax and contingency | 15–25 | Remaining reserve depends on the confirmed baseline |
| Total ceiling | **100** | Revised fixed estimate **65–75**, subject to the upgrade quote and technical qualification |

Vercel Pro includes one deploying seat and USD 20 usage credit at a USD 20 monthly platform fee. The connected hosting team was still Hobby when inspected; commercial rollout requires an appropriate plan. See [Vercel Pro pricing](https://vercel.com/docs/plans/pro-plan) and [plan use cases](https://vercel.com/pricing).

Supabase Pro starts at USD 25 with USD 10 compute credit; an additional Micro project is approximately USD 10 monthly. The proposal uses separate projects and credentials for publication authority and pilot accounting. The earlier USD 55 combined-hosting estimate assumed a dedicated organization with only those two projects; it does not cover the selected shared account. Upgrading affects the entire organization. Do not change, resume, transfer or resize its existing projects as a side effect. See [Supabase pricing](https://supabase.com/pricing) and [organization-based billing](https://supabase.com/docs/guides/platform/billing-on-supabase).

Supabase documents that paused projects do not incur compute charges and illustrates three Micro projects on Pro at USD 45 monthly. An API `INACTIVE` status alone does not establish its post-upgrade billing behavior. Reserve for four charged projects until the upgrade screen establishes otherwise. Separate current invoice/proration from the recurring total. See [billing FAQ](https://supabase.com/docs/guides/platform/billing-faq).

## Conditions before this can become a deployment plan

The database price does **not** qualify a provider for Guard authority. Daily backup retention does not establish zero loss of acknowledged journal decisions. Before choosing this topology, prove durable acknowledgments and old-writer fencing across its actual failure modes, or prove a publication halt and new-Guard-principal recovery. A restore must never silently reopen a lane. If the provider cannot satisfy that boundary within the ceiling, do not provision it for publication or weaken assurance to fit the price; revise the provider choice first. The [journal operating design](guard-publication-journal.md) remains binding.

Test the exact runtime login and TLS endpoint from the Vercel region, transaction-scoped tenant policies, connection limits, concurrent admission, backup completeness, restore, deletion and rotation. Pooling must preserve each transaction's tenant context. Paid IP, replica, branching, PITR or observability additions need a revised cost calculation; none is assumed in the revised baseline.

Review the shared organization's Spend Cap with its owner before changing it, since restrictions can affect existing projects. For ChangePlane, propose two fixed Micro projects with optional paid add-ons disabled. The Spend Cap excludes compute and several opt-in charges; it is not a universal USD ceiling. See [Supabase cost controls](https://supabase.com/docs/guides/platform/cost-control).

Vercel spend controls can pause every project on a team and are checked periodically, so usage can continue briefly after a threshold. Apply such controls only in a dedicated ChangePlane billing scope or after reviewing their effect on the existing team. See [Vercel Spend Management](https://vercel.com/docs/spend-management).

Proposed operator thresholds are: review committed costs at USD 60; stop expansion at USD 70; stop new paid-pilot admission at USD 80 while retaining headroom for existing work and authority preservation. These are not deployed automatic controls. Never delete occupied journal rows, cancel accounting history or issue PASS to meet a budget. Confirm provider metering, alert delivery and the safe halt before activation. No exact USD 100 invoice guarantee is established by this source plan.

Use existing GitHub Actions and Vercel operational surfaces for the first pilot. Verify needs no model key. Optional review or repair remains BYOK, with managed model spend disabled. Do not add a hosted queue, new agent runtime, paid preview service or automatic billing system to this budget.

The database billing account is selected. The remaining external requirements include its authenticated upgrade and invoice breakdown, reviewed impact on existing projects, an internal organization-canary administrator and a separate Guard App. The founder has reported no legal entity; legal documents remain draft. Complete exact-release review, operating drills and customer activation evidence before accepting a payment.
