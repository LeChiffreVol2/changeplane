# Separate Guard App registration

**Status:** Registered on September 8, 2026 after release-owner approval: [ChangePlane Guard Publisher](https://github.com/apps/changeplane-guard-publisher), App ID `4872053`, slug `changeplane-guard-publisher`. GitHub's public API confirms the permissions below. No private key, client secret, repository installation or Production binding was created. The existing Installer/Guard App remains untouched; Production still reports `shared_installer_guard`. See the [registration evidence](../evidence/changeplane-guard-app-registration.json).

The new GitHub App is owned by the release owner's existing personal account. GitHub permits a public App to be installed on other personal accounts and organizations; App ownership does not require customers to create an organization. The public installation setting does not enable ChangePlane customer access, enroll repositories or approve a release. See [GitHub's registration parameters](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-using-url-parameters).

## Registered configuration

| Setting | Verified value |
| --- | --- |
| App name | `ChangePlane Guard Publisher` |
| Homepage | `https://changeplane.vercel.app/` |
| Description | Publishes exact-revision ChangePlane assurance checks. GitHub remains the merge authority. |
| Installation availability | Any account (`public=true`) |
| Checks | Read and write |
| Actions, Contents, Pull requests | Read-only |
| Metadata | GitHub's mandatory read-only permission |
| Other repository, account and organization permissions | No access |
| Webhooks and subscribed events | Disabled; none |
| OAuth callback, user authorization, device flow, setup URL | Unset/disabled |

The [prefilled registration form](https://github.com/settings/apps/new?name=ChangePlane%20Guard%20Publisher&description=Publishes%20exact-revision%20ChangePlane%20assurance%20checks.%20GitHub%20remains%20the%20merge%20authority.&url=https%3A%2F%2Fchangeplane.vercel.app%2F&public=true&checks=write&actions=read&contents=read&pull_requests=read&webhook_active=false&request_oauth_on_install=false) is retained as the reviewed input, not an instruction to create a duplicate App. GitHub required owner reauthentication. The rendered form initially retained “Only on this account” despite `public=true`; “Any account” was explicitly selected and verified before submission. Future replacement registrations must inspect the rendered permissions and availability rather than trusting URL parameters.

These permissions match the current Guard credential interfaces in [the controller](../server/github-guard-controller.js): one exact-repository token reads Actions, Checks, Contents and Pull requests; a separate exact-repository token writes Checks only. This App does not perform customer OAuth, create setup PRs, manage Rulesets, store BYOK secrets or apply repairs. The existing Installer continues those onboarding responsibilities. Do not reuse its private key or widen this Guard App to satisfy an unrelated operation.

## Registration is followed by qualification

Record the actual new App ID and slug only after GitHub creates them. Generate its private key through GitHub and transfer it directly into the approved server secret store; never copy the value into this document, chat, logs or evidence. Keep registration credentials separate from installation access tokens. A registration alone does not establish the final installation permissions or account/repository binding.

Install the new App only on the approved synthetic canary repository first. Before touching a customer repository, verify that the installation belongs to the expected personal or organization account, includes only approved repositories, and has the reviewed permissions. GitHub organization or enterprise installation approval remains under that account's administrator.

Production promotion still requires the [journal's operating qualification](guard-publication-journal.md), approved runtime credentials and TLS, exact release/epoch/enrollment binding, previous-writer containment, and journal-aware rollback. Set the actual `CHANGEPLANE_GUARD_APP_ID`, `CHANGEPLANE_GUARD_APP_SLUG` and private-key secret only through that reviewed rollout, with `CHANGEPLANE_GUARD_REUSE_GITHUB_APP=false`. Update publisher-bound Rulesets through explicit repository-administrator approval and re-evaluate fresh evidence. Keep Repair and customer-access gates closed until their separate release requirements pass.

No subscription, Supabase project or organization setting needs to change to prepare this registration.
