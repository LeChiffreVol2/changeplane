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

The public product tells this story through a RouteThai production-informed shadow pilot. One synthetic stop falls outside its service window after an agent changes a routing heuristic. The replay shows the failing head, Luna proposal, clean validation, trusted apply, new head, and independent PASS without connecting a RouteThai repository or exposing operational data.

**How we used OpenAI**

- Codex collaborated on architecture, implementation, tests, security review, product copy, and competition packaging.
- GPT-5.6 Luna is the real default in the shared runtime contract, live adapter canary, and autonomous disposable-repository canary.
- The native Responses API request uses high reasoning effort and disables storage.
- Terra and Sol are available through the same trusted config-PR path.
- The model never receives GitHub credentials or result authority.

**Four judging pillars**

- **Technical:** a real GPT-5.6 Responses adapter behind a patch-only boundary, exact-head grants, clean validation, a live signed attempt ledger, one-time App push authority, and fresh exact-head PASS.
- **Design:** a signed-out public walkthrough with one event and one primary action, preserving a quiet operational interface rather than exposing a technical dashboard.
- **Impact:** production-informed RouteThai constraints make the failure concrete while synthetic data keeps the pilot safe and reproducible.
- **Novelty:** model proposes; deterministic harness decides; trusted controller applies. The same agent or model can never create its own PASS.

**Honest limitations**

The public RouteThai workspace is a recorded replay. Connected BYOK onboarding is self-serve for one GitHub.com repository per setup; GitHub Enterprise Server is not supported. Observe mode cannot block merge or deploy. Autonomous mode can create only bounded repair commits after one exact behavioral check fails; GitHub remains the merge and ruleset authority. Managed execution, billing, and GitHub merge-queue support are not enabled. The disposable canary proves the App-authored push and fresh exact-head PASS, but it is owner-controlled lab evidence rather than customer production enforcement.

**Links**

- Product: `https://changeplane.vercel.app/`
- Repository: `https://github.com/LeChiffreVol2/changeplane`
- Judge guide: `https://github.com/LeChiffreVol2/changeplane/blob/main/JUDGE_GUIDE.md`
- Video: **add public YouTube URL**
- Codex Session ID: **add value from `/feedback`**

## Video storyboard — target 2:45

| Time | Visual | Voiceover point |
| --- | --- | --- |
| 0:00–0:15 | ChangePlane title and one-line positioning | An agent that writes code should never certify itself. |
| 0:15–0:35 | RouteThai entry screen | Route planning has deterministic constraints; this is a production-informed shadow pilot with synthetic data and no production repository access. |
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

- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Browser QA passes on desktop and mobile.
- [ ] Security/data scan passes for tracked source and `dist`.
- [ ] Public signed-out RouteThai path works with one enabled primary CTA.
- [ ] Product, README, judge guide, and video use the same authority-boundary language.
- [ ] Release commit matches Vercel readiness provenance.
- [ ] YouTube video is public and under three minutes.
- [ ] `/feedback` Codex Session ID is added here, README/Devpost, and video notes where appropriate.
- [ ] Devpost is submitted at least two hours before the deadline.
