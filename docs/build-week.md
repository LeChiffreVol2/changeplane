# OpenAI Build Week implementation record

This appendix contains competition-specific provenance for ChangePlane. Product installation, architecture, security, and operations remain in the main [README](../README.md) and linked product documentation.

## Submission identity

- **Category:** Developer Tools
- **One-liner:** Independent, exact-revision assurance for code written and repaired by AI agents.
- **Positioning:** Keep GitHub. Let agents ship.
- **Repository:** [github.com/LeChiffreVol2/changeplane](https://github.com/LeChiffreVol2/changeplane)
- **Hosted product:** [changeplane.vercel.app](https://changeplane.vercel.app/)
- **Evaluation path:** [EVALUATION.md](../EVALUATION.md)
- **Codex `/feedback` Session ID:** `019f7ebd-79a5-73b1-b93e-42349c652ce3`

## How Codex was used

Codex worked as the implementation and verification partner across the repository. It:

- inspected and preserved the independent-assurance boundary;
- implemented the native Responses API proposal and advisory-review adapters;
- built repository-scoped GitHub App onboarding, installation-bound repository discovery, BYOK handling, and protected configuration pull requests;
- implemented the signed repair ledger, trusted controller, exact-repository push credential, fresh-head recheck, and fail-closed paths;
- added unit, integration, browser, security, data, and production-readiness verification;
- maintained the product's existing visual system while completing the signed-out RouteThai example and connected onboarding; and
- exercised the disposable repository canary and reconciled redacted release evidence with the deployed source revision.

The product owner retained the decisions that materially define ChangePlane: GitHub remains the merge authority; models never certify themselves; RouteThai private code and operating data remain private; GPT-5.6 Luna is the default; autonomous repair stays bounded; and the product does not add a database, queue, proprietary workspace, or merge service.

## How GPT-5.6 was used

GPT-5.6 Luna is the default proposal and advisory-review model in the shared runtime contract, installer, trusted policy, BYOK verification, workflow, UI, tests, and live canary. GPT-5.6 Terra and Sol are allowlisted alternatives.

The OpenAI adapter uses the Responses API through native `fetch` with:

- the model selected by trusted default-branch policy;
- `reasoning.effort: "high"`;
- `store: false`;
- exact deterministic failure evidence;
- source context only from controller-granted paths; and
- a strict structured field containing a raw unified diff.

Provider output is treated as untrusted data. A separate clean job validates syntax, exact head, path grant, protected-path policy, evidence integrity, campaign budget, clean application, and deterministic behavior. The model receives no GitHub credential and cannot publish `ChangePlane / guard` or PASS.

## Build provenance

There were no repository commits before the competition eligibility window. The implementation history begins during OpenAI Build Week.

| Boundary | Date | Public evidence | Scope |
| --- | --- | --- | --- |
| Pre-competition baseline | Before July 13, 2026 | No repository commit | Product concept only; no implementation is claimed |
| First repository provenance | July 19, 2026 | [`b0191ea`](https://github.com/LeChiffreVol2/changeplane/commit/b0191ea2ff832e60461f1f27c66e01a80c62eed9) | Initial repository and launch provenance |
| Last baseline before GPT-5.6 work | July 19, 2026 | [`44edc14`](https://github.com/LeChiffreVol2/changeplane/commit/44edc14ec0f32aaf6db89e08a9ec3c2a23d1739e) | Exact-revision observation and provider boundary |
| GPT-5.6 RouteThai adapter | July 20, 2026 | [`routethai-luna-adapter-canary.json`](../evidence/routethai-luna-adapter-canary.json) | Live Luna request, bounded patch, clean apply, deterministic re-validation |
| Autonomous GitHub repair | July 20, 2026 | [`routethai-luna-github-canary.json`](../evidence/routethai-luna-github-canary.json) | Signed ledger, clean apply, App-authored push, fresh exact-head PASS |
| Autonomous runtime | July 20, 2026 | [`0e8e093`](https://github.com/LeChiffreVol2/changeplane/commit/0e8e093262a175d8ffa8284106c0c62ed2f68f65) | GitHub/BYOK onboarding, bounded harness, duplicate-trigger hardening |
| Assurance plane | July 20, 2026 | [Independent review and assurance memory](https://github.com/LeChiffreVol2/changeplane/pull/32) | Review Check, assurance memory, agent handback, exact-head preview, Merge Queue guard |
| Structured patch hardening | July 20, 2026 | [Raw-diff constraint](https://github.com/LeChiffreVol2/changeplane/pull/34) | Live fail-closed finding converted into a strict structured-output constraint |
| Production repair evidence | July 20, 2026 | [`changeplane-v9-production-release.json`](../evidence/changeplane-v9-production-release.json) | Provider metadata, clean validation, App-authored repair, synchronize event, new-head PASS |
| Self-serve GitHub release | July 21, 2026 | [`cfd8aee`](https://github.com/LeChiffreVol2/changeplane/commit/cfd8aeef79e1d612b2fe819b8f77278d8e75845e) · [`build-week-product-release.json`](../evidence/build-week-product-release.json) | Personal and organization onboarding plus exact Vercel source provenance |
| Production-data boundary | July 21, 2026 | [`019b0a6`](https://github.com/LeChiffreVol2/changeplane/commit/019b0a6) | RouteThai production use separated from the public sanitized workspace |
| Public repository release | July 21, 2026 | [`4a84443`](https://github.com/LeChiffreVol2/changeplane/commit/4a84443) | Public product documentation and judge-facing evaluation path |

The deployed release SHA is returned by `GET /api/github?action=readiness`. Documentation commits may advance the repository and deployment revision; the evidence files retain the exact runtime source and external request identifiers they verify.

## Reproducible evaluation

Judges can evaluate the complete product without credentials, infrastructure rebuild, private data, or a paid model request:

1. Open [changeplane.vercel.app](https://changeplane.vercel.app/) signed out.
2. Select **View RouteThai example**.
3. Follow the exact-head failure, Luna proposal, clean validation, trusted apply, new-head evidence, and guard result.
4. Open **New commit verified independently** to inspect the authority separation.
5. Follow [EVALUATION.md](../EVALUATION.md) for local tests and the implementation map.

The public example is synthetic and contacts no RouteThai repository or production system. Connected GitHub installation is optional for judging.

## Submission boundaries

- RouteThai is a real production use case; the public workspace is a sanitized replay with synthetic data.
- Repository BYOK is required for model-backed review and autonomous repair. Managed model spend is not available.
- Scope-only observe mode does not prove behavior and does not block merge or deploy.
- GitHub remains the merge authority; ChangePlane does not auto-merge.
- GitHub Enterprise Server, cross-repository repair, and fork pull requests are not supported.
- The public repository is proprietary and `UNLICENSED`; competition evaluation rights are defined in [EVALUATION_LICENSE.md](../EVALUATION_LICENSE.md).

## Competition requirements map

| Requirement | Location |
| --- | --- |
| Public or shared code repository | [Repository](https://github.com/LeChiffreVol2/changeplane) |
| README highlights Codex and GPT-5.6 | [Built with Codex and GPT-5.6](../README.md#built-with-codex-and-gpt-56) |
| Setup, supported platforms, and test instructions | [README installation](../README.md#install-on-github) and [EVALUATION.md](../EVALUATION.md) |
| Working product path | [Hosted product](https://changeplane.vercel.app/) |
| `/feedback` Session ID | Submission identity above |
| Evaluation rights | [EVALUATION_LICENSE.md](../EVALUATION_LICENSE.md) |
