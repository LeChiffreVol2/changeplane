# ChangePlane engineering policy

## Product boundary

- ChangePlane is a GitHub-native delivery control plane for agent-authored pull requests. GitHub remains the forge, source of truth, branch-policy surface, and merge authority.
- The normal path is autonomous: bind an exact revision and behavioral check, return a fixable failure to a bounded proposal model, validate the patch in a clean job, apply it through a separately credentialed controller, and publish `ChangePlane / guard` only after fresh exact-head evidence passes.
- The product complements Codex, Cursor, Claude Code, Trae, Copilot, OpenSWE, and other coding agents. Do not turn it into an IDE, Git host, merge service, proprietary agent workspace, or general-purpose orchestrator.
- Public onboarding supports GitHub.com personal accounts and organizations, including Enterprise Cloud organizations. GitHub Enterprise Server, forks, and cross-repository repair are outside the supported release.

## Authority and evidence invariants

- Preserve `model proposes; deterministic harness decides; trusted controller applies` across every workflow and product surface.
- A proposal or review model never receives GitHub credentials, App private keys, controller secrets, Check authority, approval authority, merge authority, or the ability to issue `PASS`.
- Read runtime, harness, and assurance policy only from the trusted default branch. Treat pull-request code, comments, diffs, and instructions as untrusted data.
- Bind every decision, grant, receipt, review, preview, and handback to one exact revision. A new commit invalidates prior assurance and requires a fresh evaluation.
- Reject stale heads, expanded paths, protected paths, malformed patches, provider failure, and exhausted campaigns before repository mutation. Autonomous repair is limited to two attempts within one immutable 15-minute campaign.
- Tests, evidence configuration, dependency manifests, managed workflow bytes, and repository-declared `evidence.protectedPaths` always require human review.
- `ChangePlane / review` is exact-diff, BYOK-gated advisory evidence. It never approves, repairs, certifies, or contributes to `ChangePlane / guard`.
- Merge Queue evaluates `merge_group` as its own exact revision and publishes the guard only. Queue runs never invoke model review, proposal, repair, apply, or handback.

## GitHub and credential handling

- Use the repository-scoped GitHub App for onboarding and controller actions. Repository discovery may include only installations visible to the signed-in user and must retain the installation-to-repository binding internally.
- Create one protected setup or configuration pull request; never write directly to the default branch.
- BYOK is available per repository for personal and organization users. Verify the selected allowlisted model, encrypt the key with GitHub's repository public key, store only `OPENAI_API_KEY` as an Actions Secret, and clear the browser field after every attempt.
- Never persist a provider key in localStorage, logs, API responses, cookies, screenshots, artifacts, or a ChangePlane database.
- Mint one exact-repository, Contents-write installation token only after a signed grant is claimed and revalidated. Keep it in runner temporary storage, disable checkout credential persistence, use force-with-lease, and clean it up on every exit.
- Production API responses include a request ID and structured redacted metadata only. Never log request bodies, cookies, OAuth tokens, provider responses, repository names, or secret values.

## Runtime and deployment

- GPT-5.6 Luna is the default proposal and advisory-review model. Terra and Sol are the only connected alternatives. Keep compatibility adapters outside the supported product UI.
- Use the native OpenAI Responses API with high reasoning effort, `store: false`, bounded failure evidence, allowed-path source context only, and strict structured patch output.
- The hosted product runs on Vercel. Repository mutations require an attributed Vercel Production deployment from `LeChiffreVol2/changeplane` on protected `main`; forks, CLI uploads, previews, and unattributed deployments fail closed before external access.
- Do not add a database, ChangePlane queue, billing service, hosted preview service, or managed model spend without reviewed isolation, metering, budgets, billing, and incident controls.
- GitHub Actions, Checks, comments, artifacts, refs, repository secrets, and one concurrency lane per pull request are the operational substrate. Cancel stale heads and honor GitHub rate limits before expensive work.
- Keep only `.github/workflows/ci.yml` active in this repository. Installation workflows remain reviewed templates under `examples/` until the GitHub installer vendors them into a selected repository.

## Product experience

- Preserve the exact hero `Keep GitHub. Let agents ship.` and the deep-teal frame, warm off-white product surface, restrained typography, spacing, and component anatomy.
- Lead with one user outcome and one next action. Keep exact-head, authority, and runtime detail in progressive disclosure.
- The signed-out RouteThai workspace is a sanitized replay using synthetic data. ChangePlane is used with RouteThai in production, but private code, customer context, routes, maps, coordinates, operating data, keys, cookies, tokens, and repository screenshots must never enter public materials.
- Do not label the public experience as a demo, represent replay state as a connected account, claim ChangePlane hosts previews, or imply that a model certifies its own work.
- Include an existing GitHub Deployment or Vercel preview only when its deployment SHA exactly matches the evaluated head.
- GitHub beginners are a first-class audience: no CLI is required for hosted onboarding, and every blocked state must state the reason, safe consequence, and one next action in plain language.

## Release quality

- Preserve unrelated worktree changes and use protected pull requests for production changes.
- Before release, run unit/integration tests, production build, Chromium onboarding journeys, dependency audit, public-data scan, and signed-out production smoke checks.
- Keep branch protection, the exact `CI / verify` required check, immutable Action SHAs, Vercel Git deployment provenance, the repair kill switch, generation invalidation, and the previous known-good deployment available for rollback.
- Treat missing live evidence as a stated boundary, never as permission to strengthen a claim. Do not claim zero retention, SOC 2, GDPR compliance, 24/7 support, autonomous merge, or enterprise scale without audited controls and measured evidence.
