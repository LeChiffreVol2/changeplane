# Evaluate ChangePlane

ChangePlane is independent, exact-revision assurance for code written and repaired by AI agents. The fastest evaluation path is public, requires no credentials, and does not access a production repository.

The hosted product is the supported deployment. Evaluators and customers do not need a Vercel account or a self-hosted ChangePlane instance.

## Public product path

Open [changeplane.vercel.app](https://changeplane.vercel.app/) in a signed-out browser, then select **View RouteThai example**.

The workspace opens one synthetic assurance-contract reconstruction. It is not a stored production run, and every revision, event, and result below is generated from fixed fixture data:

1. A coding-agent change is bound to exact head `71b04c2` and its allowed paths.
2. Deterministic evidence finds a synthetic stop outside its service window.
3. The reconstruction projects the bounded patch that GPT-5.6 Luna would be allowed to propose from only the allowed source context and failure evidence; it makes no model request.
4. It projects the clean-harness result for the patch, path boundary, current head, and attempt budget.
5. It shows where a separately credentialed controller would apply an accepted patch; it invokes no controller and writes no repository.
6. It displays reconstructed synthetic evidence on head `9fc82a1` and a guard-eligible result; it publishes no GitHub Check.

Open **Reconstructed exact-head assurance** to inspect the authority boundary. The proposal model has no Check, push, approval, merge, or PASS authority. The public workspace uses synthetic data and makes no live OpenAI, GitHub, or RouteThai production request.

## Product and evidence boundaries

| Surface | Current boundary | Reproducible evidence |
| --- | --- | --- |
| GitHub onboarding | Invite-only founder-led alpha until the exact Production release has reviewed legal approval; the runtime otherwise fails closed to controlled-canary access | Repository-scoped App, writable-repository selection, safety preflight, and one setup pull request |
| RouteThai use case | Public evaluation is limited to a synthetic contract reconstruction; private production use is outside this proof | Signed-out reconstruction and [`examples/routethai-synthetic`](examples/routethai-synthetic) |
| GPT-5.6 proposal adapter | Luna is the default; Terra and Sol share the same allowlisted contract | [`evidence/routethai-luna-adapter-canary.json`](evidence/routethai-luna-adapter-canary.json) |
| Historical v9 repair-controller separation | Two attempts within 15 minutes; stale, expanded, protected, failed, or exhausted work stops | [`evidence/changeplane-v9-production-release.json`](evidence/changeplane-v9-production-release.json); this does not prove the v13 dedicated guard publisher |
| Historical v9 GitHub authority separation | App-signed grant, one-time repository token, fresh exact-head recheck | Initial head `7b670f3` → controller repair `e053526` → legacy `github-actions` Check Run `88504854987` |
| v13 dedicated guard publisher | GitHub OIDC plus separate exact-repository read and `checks:write` App credentials | The protected baseline canary is recorded in [`evidence/changeplane-v13-production-release.json`](evidence/changeplane-v13-production-release.json); later source changes require a new protected release and do not inherit that proof |
| Advisory review | Exact-diff findings only; review never approves or contributes PASS | [`src/lib/review.js`](src/lib/review.js) and the automated review contract |

Provider evidence alone is never treated as proof of GitHub write access or a passing Check.

## Local verification

Requirements: Node.js `>=22.18 <23`.

```sh
npm ci --cache .npm-cache
npm run verify
npm run test:e2e
npm run audit:prod
```

The suite verifies the shared model allowlist, Luna default, Responses API failures, BYOK encryption and deletion, exact-diff review validation, repository isolation, stale-head rejection, path grants, two-attempt/15-minute ledgers, trusted controller separation, one-time exact-repository push tokens, and the production build.

The RouteThai synthetic fixture intentionally starts in a failing state:

```sh
node --test examples/routethai-synthetic/service-window.test.js
```

The non-zero result is expected. A live adapter canary is optional and requires the operator's own `OPENAI_API_KEY` with access to `gpt-5.6-luna`:

```sh
node scripts/run-openai-route-canary.mjs
```

Never paste a provider key into an issue, log, screenshot, or committed file.

## Implementation map

- Shared model contract: [`src/lib/runtime.js`](src/lib/runtime.js)
- Trusted harness contract: [`src/lib/harness.js`](src/lib/harness.js)
- OpenAI Responses adapter: [`examples/changeplane-provider-openai.js`](examples/changeplane-provider-openai.js)
- Patch-only validation: [`examples/changeplane-proposal.js`](examples/changeplane-proposal.js)
- Trusted workflow boundary: [`examples/changeplane-repair.yml`](examples/changeplane-repair.yml)
- GitHub App, BYOK, and runtime API: [`api/github.js`](api/github.js)
- Independent review validator: [`src/lib/review.js`](src/lib/review.js)
- Production operations: [`docs/production-runbook.md`](docs/production-runbook.md)
- Hosted/Vercel boundary: [`docs/hosted-service.md`](docs/hosted-service.md)
- Data handling: [`docs/data-handling.md`](docs/data-handling.md)

## Current production boundaries

- BYOK is configured per connected repository and stored only as a GitHub Actions Secret.
- Scope-only observe mode reports evidence but cannot block merge or deploy.
- Autonomous mode requires the repository-scoped App, a repository administrator, repository BYOK, the reviewed Full-profile setup, and one independently complete no-bypass default-branch Ruleset. That Ruleset must require Merge Queue, strict up-to-date checks, the dedicated-App `ChangePlane / guard`, and every configured behavioral evidence Check from its expected publisher. The GitHub-owned `ChangePlane guard` job is operational liveness only and is never ChangePlane merge authority.
- GitHub remains the merge authority; ChangePlane never auto-merges.
- Managed model billing and GitHub Enterprise Server are not available in this release.
- Merge Queue support is guard-only for the exact `merge_group`; queue events never dispatch model review or repair.
- The public RouteThai workspace is a synthetic contract reconstruction, not a production-run replay. It does not expose or contact RouteThai's private repository, routes, customers, or operating data.
- Existing Vercel previews are included only through an exact-SHA GitHub Deployment; ChangePlane requests no customer Vercel credential.
