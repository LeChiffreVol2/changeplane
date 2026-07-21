# Evaluate ChangePlane

ChangePlane is independent, exact-revision assurance for code written and repaired by AI agents. The fastest evaluation path is public, requires no credentials, and does not access a production repository.

## Public product path

Open [changeplane.vercel.app](https://changeplane.vercel.app/) in a signed-out browser, then select **View RouteThai example**.

The workspace automatically shows one complete assurance run:

1. A coding-agent change is bound to exact head `71b04c2` and its allowed paths.
2. Deterministic evidence finds a synthetic stop outside its service window.
3. GPT-5.6 Luna proposes a bounded patch from only the allowed source context and failure evidence.
4. A clean harness validates the patch, path boundary, current head, and attempt budget.
5. A separately credentialed controller applies the accepted patch.
6. Fresh evidence passes on head `9fc82a1`, then `ChangePlane / guard` publishes PASS.

Open **New commit verified independently** to inspect the authority boundary. The proposal model has no Check, push, approval, merge, or PASS authority. The public workspace uses synthetic data and makes no live OpenAI, GitHub, or RouteThai production request.

## Product and evidence boundaries

| Surface | Current boundary | Reproducible evidence |
| --- | --- | --- |
| GitHub onboarding | Self-serve for GitHub.com personal accounts and organizations | Repository-scoped App, writable-repository selection, safety preflight, and one setup pull request |
| RouteThai use case | Tested with the real production workflow; private code and operations remain private | Signed-out sanitized replay and [`examples/routethai-synthetic`](examples/routethai-synthetic) |
| GPT-5.6 proposal adapter | Luna is the default; Terra and Sol share the same allowlisted contract | [`evidence/routethai-luna-adapter-canary.json`](evidence/routethai-luna-adapter-canary.json) |
| Autonomous repair | Two attempts within 15 minutes; stale, expanded, protected, failed, or exhausted work stops | [`evidence/changeplane-v9-production-release.json`](evidence/changeplane-v9-production-release.json) |
| GitHub authority separation | App-signed grant, one-time repository token, fresh exact-head recheck | Initial head `7b670f3` → controller repair `e053526` → Check Run `88504854987` |
| Advisory review | Exact-diff findings only; review never approves or contributes PASS | [`src/lib/review.js`](src/lib/review.js) and the automated review contract |

Provider evidence alone is never treated as proof of GitHub write access or a passing Check.

## Local verification

Requirements: Node.js `>=22.18 <23`.

```sh
npm ci --cache .npm-cache
npm test
npm run build
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

## Current production boundaries

- BYOK is configured per connected repository and stored only as a GitHub Actions Secret.
- Scope-only observe mode reports evidence but cannot block merge or deploy.
- Autonomous mode requires the repository-scoped App, one exact behavioral Check and publisher, repository BYOK, and a reviewed setup pull request.
- GitHub remains the merge authority; ChangePlane never auto-merges.
- Managed model billing and GitHub Enterprise Server are not available in this release.
- Merge Queue support is guard-only for the exact `merge_group`; queue events never dispatch model review or repair.
- The public RouteThai workspace is a sanitized replay. It does not expose or contact RouteThai's private repository, routes, customers, or operating data.
