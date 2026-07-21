# OpenAI Build Week submission package

## Devpost fields

**Project name**

ChangePlane

**Category**

Developer Tools

**One-liner**

Independent, exact-revision assurance for code written and repaired by AI agents.

**Tagline**

Keep GitHub. Let agents ship.

**Project description**

Coding agents can write and repair pull requests, but they should never certify their own output. ChangePlane adds independent, revision-bound assurance to GitHub. A deterministic harness binds policy and evidence to an exact head. GPT-5.6 Luna may propose one bounded unified diff using only failure evidence and allowed-path source. A clean job validates the candidate, and a separately credentialed trusted controller owns apply and Check publication. A new commit invalidates the old result and starts fresh evidence.

ChangePlane has been tested with RouteThai's real production workflow. Because its repository and operating data are private, the public product presents a sanitized replay of that production use case. One synthetic stop falls outside its service window after an agent changes a routing heuristic. The replay shows the failing head, Luna proposal, clean validation, trusted apply, new head, and independent PASS without contacting the production repository or exposing operational data.

**How we used OpenAI**

- Codex inspected the original architecture, implemented the OpenAI proposal/review adapters and GitHub App/BYOK paths, built the bounded controller and fail-closed tests, preserved the product design, exercised the disposable canary, and reconciled release evidence.
- The human owner made the durable product decisions: keep GitHub as merge authority, separate proposal from certification, limit autonomous repair to two attempts/15 minutes, validate the product with RouteThai in production while publishing only a sanitized replay, and avoid a proprietary agent workspace, queue, or database.
- GPT-5.6 Luna is the real default in the shared runtime contract, live adapter canary, and autonomous disposable-repository canary.
- The native Responses API request uses high reasoning effort and disables storage.
- Terra and Sol are available through the same trusted config-PR path.
- The model never receives GitHub credentials or result authority.

**Four judging pillars**

- **Technical:** a real GPT-5.6 Responses adapter behind a patch-only boundary, exact-head grants, clean validation, a live signed attempt ledger, one-time App push authority, and fresh exact-head PASS.
- **Design:** a signed-out public walkthrough with one event and one primary action, preserving a quiet operational interface rather than exposing a technical dashboard.
- **Impact:** RouteThai production use proves the assurance problem is operational, while the sanitized synthetic replay keeps public evaluation safe and reproducible.
- **Novelty:** model proposes; deterministic harness decides; trusted controller applies. The same agent or model can never create its own PASS.

**Honest limitations**

ChangePlane has been tested with RouteThai in production. The public RouteThai workspace is a recorded, sanitized replay that makes no request to the production repository and exposes no production data. Connected BYOK onboarding is self-serve for one GitHub.com repository per setup; GitHub Enterprise Server is not supported. Observe mode cannot block merge or deploy. Autonomous mode can create only bounded repair commits after one exact behavioral check fails; GitHub remains the merge and ruleset authority. Managed execution and billing are not enabled. Merge Queue has an implemented and tested exact-`merge_group` guard-only contract, but positive live evidence is not captured because the private personal-account canary is ineligible; queue events never dispatch review or repair. The published disposable canary proves the App-authored push and fresh exact-head PASS; it is public lab evidence separate from RouteThai's private production installation.

**Links**

- Product: `https://changeplane.vercel.app/`
- Repository: `https://github.com/LeChiffreVol2/changeplane`
- Judge guide: `https://github.com/LeChiffreVol2/changeplane/blob/main/JUDGE_GUIDE.md`
- Video: **add public YouTube URL**
- Codex Session ID: `019f7ebd-79a5-73b1-b93e-42349c652ce3`

## Video storyboard — target 2:45

| Time | Visual | Voiceover point |
| --- | --- | --- |
| 0:00–0:15 | ChangePlane title and one-line positioning | An agent that writes code should never certify itself. |
| 0:15–0:35 | RouteThai entry screen | We tested ChangePlane with RouteThai in production. This public view is a sanitized replay with synthetic data and no production repository or operational data access. |
| 0:35–0:50 | Open RouteThai workspace and show exact head `71b04c2` | A coding agent changed the heuristic; ChangePlane binds the exact head and allowed files. |
| 0:50–1:05 | Deterministic failure state | One synthetic stop lands after its service window. The failure is evidence, not a model opinion. |
| 1:05–1:20 | Luna proposal state | GPT-5.6 Luna sees bounded evidence and allowed-path source, then returns only a unified diff. |
| 1:20–1:35 | Clean validation and trusted apply | A separate harness validates paths, stale head, and attempt budget; a separately credentialed controller applies. |
| 1:35–1:50 | New head `9fc82a1` and PASS | Fresh evidence passes on the new exact head. Only ChangePlane publishes the Check. |
| 1:50–2:05 | Authority drawer | Luna cannot push, merge, approve, issue PASS, or publish the Check. |
| 2:05–2:25 | Code/evidence snippets | Show runtime allowlist, Responses request, and redacted live request ID/patch hash. |
| 2:25–2:35 | Git history/provenance | Codex helped build and verify the OpenAI adapter and the Build Week package during the eligible window. |
| 2:35–2:45 | Closing positioning | Keep GitHub. Let agents ship—with independent exact-revision assurance. |

Use English narration or burned-in English subtitles. Use the product name as text. Do not include unauthorized logos, music, customer names, coordinates, maps, production workbooks, private repository screenshots, provider keys, cookies, or tokens. Upload as a public YouTube video and verify it from a signed-out browser.

## Release checklist

- [x] `npm test` passes: 184 tests.
- [x] `npm run build` passes.
- [x] Browser QA passes on desktop and mobile: five Chromium end-to-end journeys.
- [x] Security/data scan passes for tracked source and `dist`: 138 files scanned.
- [x] Public signed-out RouteThai path works with one enabled primary CTA.
- [x] Product, README, and judge guide use the same authority-boundary language.
- [x] Production readiness reports the exact deployed Git commit; the release and rollback provenance is recorded in `evidence/build-week-product-release.json`.
- [ ] YouTube video is public and under three minutes.
- [x] `/feedback` Codex Session ID is added here, README, and judge guide; add the same value to Devpost and video notes when those artifacts are created.
- [ ] Devpost is submitted at least two hours before the deadline.
