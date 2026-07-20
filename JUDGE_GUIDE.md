# ChangePlane judge guide

## 90-second path

Open [https://changeplane.vercel.app/](https://changeplane.vercel.app/) in a signed-out browser.

1. Confirm the primary action is **Connect GitHub** and the page explains the one-repository autonomous setup.
2. Select **View RouteThai example**. No sign-in is required.
3. Read the boundary banner: production-informed shadow pilot, synthetic data, public replay, no repository access.
4. The recorded autonomous run starts automatically.
5. Watch the exact sequence: bound head `71b04c2` → deterministic service-window failure → GPT-5.6 Luna proposal → clean validation → trusted apply → new head `9fc82a1` → `ChangePlane / guard` PASS.
6. Open **New commit verified independently** to inspect the authority separation.
7. Confirm the model has no Check, push, approval, merge, or PASS authority.

The replay lasts about five seconds and makes no live OpenAI or GitHub request.

## What is live and what is recorded

| Surface | Status | Evidence |
| --- | --- | --- |
| Self-serve GitHub onboarding | Public autonomous setup | Personal and organization installations; exact test + repository BYOK + one protected setup PR |
| Public RouteThai workspace | Public recorded replay | Synthetic data; no authentication or repository access |
| GPT-5.6 Luna API adapter | Live verified | [`evidence/routethai-luna-adapter-canary.json`](evidence/routethai-luna-adapter-canary.json) |
| Structured patch boundary | Live verified | Official Responses API schema; one extracted patch field; one allowed file; patch hash recorded |
| Clean apply and deterministic re-validation | Live verified | Original fixture failed; patched temporary worktree passed |
| App-signed attempt ledger and one-time push credential | Live verified | [`evidence/routethai-luna-github-canary.json`](evidence/routethai-luna-github-canary.json) plus controller tests |
| App-authored GitHub push and exact-head PASS | Live verified | Initial head `a9d2058` → controller repair `9f9efd6` → Check Run `88461760023` |
| `ChangePlane / review` | Available in managed setup | BYOK-gated, exact-diff advisory findings; never PASS or approval |
| Assurance memory and agent handback | Available in managed setup | Trusted `.changeplane/assurance.md` plus vendor-neutral Action output and receipt payload |
| Preview and Merge Queue binding | Available in managed setup | Exact-head preview receipt; exact-`merge_group` guard-only evaluation |

This distinction is deliberate. The model adapter result alone is never represented as proof of GitHub write or Check authority.

## Run the judge tests

No database, queue, cloud rebuild, or GitHub installation is required.

```sh
npm ci --cache .npm-cache
npm test
npm run build
```

The suite covers the runtime and harness allowlists, Luna default, Terra/Sol acceptance, pre-network model rejection, Responses API structured success/refusal/malformed/empty/oversized cases, BYOK encryption and deletion, exact-diff advisory review validation, repository isolation, stale heads, path grants, handback, exact-head preview binding, `merge_group` guard evaluation, immutable two-attempt/15-minute ledgers, trusted controller separation, one-time exact-repository push tokens, and production build.

To see the deterministic RouteThai failure before repair:

```sh
node --test examples/routethai-synthetic/service-window.test.js
```

The failing exit is expected and proves the fixture starts in the rejected state. The live adapter runner creates a temporary copy, obtains a Luna patch, validates it, requires the patched test to pass, then deletes the copy:

```sh
node scripts/run-openai-route-canary.mjs
```

That final command requires the judge's own `OPENAI_API_KEY` with access to `gpt-5.6-luna`. Never paste a key into an issue, log, screenshot, or committed file.

## Technical files

- Shared model contract: [`src/lib/runtime.js`](src/lib/runtime.js)
- Trusted harness contract: [`src/lib/harness.js`](src/lib/harness.js)
- OpenAI Responses adapter: [`examples/changeplane-provider-openai.js`](examples/changeplane-provider-openai.js)
- Patch-only harness: [`examples/changeplane-proposal.js`](examples/changeplane-proposal.js)
- Trusted workflow boundary: [`examples/changeplane-repair.yml`](examples/changeplane-repair.yml)
- GitHub/BYOK/runtime API: [`api/github.js`](api/github.js)
- Independent review validator: [`src/lib/review.js`](src/lib/review.js)
- GPT-5.6 review adapter: [`examples/changeplane-review-openai.js`](examples/changeplane-review-openai.js)
- Synthetic RouteThai fixture: [`examples/routethai-synthetic`](examples/routethai-synthetic)
- Redacted Luna evidence: [`evidence/routethai-luna-adapter-canary.json`](evidence/routethai-luna-adapter-canary.json)
- Redacted autonomous GitHub evidence: [`evidence/routethai-luna-github-canary.json`](evidence/routethai-luna-github-canary.json)

## Known limitations

- The public experience is a replay, not live browser execution.
- BYOK is available per connected repository and stored only as a GitHub Actions Secret.
- Scope-only observe mode cannot block merge or deploy.
- Managed model execution, billing, and GitHub Enterprise Server are not enabled. GitHub remains merge authority.
- `ChangePlane / review` requires repository BYOK, is advisory, and never certifies or contributes PASS.
- Merge Queue support is guard-only on the exact `merge_group`; it never dispatches repair or model review.
- The disposable canary is owner-controlled lab evidence on GitHub Free, not a claim of customer production enforcement or branch protection.
- RouteThai is a production-informed shadow pilot, not a customer claim or production-connected integration.

## Submission identity

- Category: Developer Tools
- Repository: `https://github.com/LeChiffreVol2/changeplane`
- Public product: [https://changeplane.vercel.app/](https://changeplane.vercel.app/)
- Codex Session ID: **add the value returned by `/feedback` before submitting Devpost**
