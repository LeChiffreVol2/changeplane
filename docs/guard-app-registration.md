# Separate Guard App registration

**Status:** The separate [ChangePlane Guard Publisher](https://github.com/apps/changeplane-guard-publisher), App ID `4872053`, slug `changeplane-guard-publisher`, is installed only on the approved synthetic personal-account canary. A verified replacement private key is stored as a Production-only Secret in the existing ChangePlane Vercel project; its downloaded file was deleted and the inaccessible first key was revoked after explicit approval. App JWT identity and an exact-repository read token passed live verification; the temporary token was immediately revoked. The runtime still uses the existing Installer/Guard App and reports `shared_installer_guard`. See the final [credential staging evidence](../evidence/changeplane-guard-credential-staging.json). The earlier [registration](../evidence/changeplane-guard-app-registration.json) and [installation](../evidence/changeplane-guard-app-installation.json) records remain immutable snapshots of their respective stages.

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

## Canary installation and credential delivery

Installation `160044778` belongs to `LeChiffreVol2` (personal account). GitHub's saved installation UI confirms **Only select repositories**, exactly one selected repository, `LeChiffreVol2/changeplane-v13-public-canary-20260901` (repository ID `1352819427`), and the permissions above. No Ruleset, workflow, existing installation or repository content was changed. This personal installation is not organization or Merge Queue qualification.

The first private-key record `4392242` was created at `2026-09-08T12:43:17Z`, with public fingerprint `SHA256:dsCrTjz4TKoKQc4aOFeMYmK0ymQzfQ6D6INfrgwdDZk=`. The in-app browser exposed no download path, targeted filename searches found no matching PEM, and the owner also reported seeing no file. That observation did not prove where the key bytes went. After the replacement below was verified and stored, explicit owner approval authorized revocation of this first key. GitHub's refreshed settings now show only the replacement key.

Chrome saved replacement key `4392437` under a generated filename in its temporary download directory. The 2,048-bit RSA key's derived public fingerprint matched GitHub: `SHA256:I1sKsuiOvIGTAbWRxBL+Fz//YdzAKDHtBphVBiDyCnU=`. The file was restricted to `0600`, validated through GitHub App JWT authentication, and passed to Vercel CLI through stdin without placing its value in arguments, chat, logs or evidence. Vercel's saved project inventory confirms `CHANGEPLANE_GUARD_APP_PRIVATE_KEY`, type Secret, Production only. This verifies the transfer and metadata; write-only secret storage was not read back.

The new key authenticated App `4872053` and installation `160044778`. A temporary installation token requested read-only Actions, Checks, Contents, Metadata and Pull requests for repository ID `1352819427` only. GitHub returned the exact permissions, and authenticated repository enumeration returned exactly that active, unarchived repository under the expected personal owner. The token was revoked with HTTP 204. No Check or repository content was written. The verified downloaded key file was then deleted; this is a specific file-cleanup result, not a secure-erasure or zero-retention claim.

The saved secret is staged and does not establish runtime activation. No Guard App ID/slug binding, reuse-switch change or redeployment occurred. Both the current protected source and the candidate select the existing App's complete credential tuple while `CHANGEPLANE_GUARD_REUSE_GITHUB_APP=true`; the staged key is not mixed into that tuple. Production readiness remains the protected `ddccd7ab7721` controlled canary with shared authority and Repair disabled.

## Registration is followed by qualification

Record the actual new App ID and slug only after GitHub creates them. Generate its private key through GitHub and transfer it directly into the approved server secret store; never copy the value into this document, chat, logs or evidence. Keep registration credentials separate from installation access tokens. A registration alone does not establish the final installation permissions or account/repository binding.

Install the new App only on the approved synthetic canary repository first. Before touching a customer repository, verify that the installation belongs to the expected personal or organization account, includes only approved repositories, and has the reviewed permissions. GitHub organization or enterprise installation approval remains under that account's administrator.

Production promotion still requires the [journal's operating qualification](guard-publication-journal.md), approved runtime credentials and TLS, exact release/epoch/enrollment binding, previous-writer containment, and journal-aware rollback. Set the actual `CHANGEPLANE_GUARD_APP_ID`, `CHANGEPLANE_GUARD_APP_SLUG` and private-key secret only through that reviewed rollout, with `CHANGEPLANE_GUARD_REUSE_GITHUB_APP=false`. Update publisher-bound Rulesets through explicit repository-administrator approval and re-evaluate fresh evidence. Keep Repair and customer-access gates closed until their separate release requirements pass.

No subscription, Supabase project or organization setting needs to change to prepare this registration.
