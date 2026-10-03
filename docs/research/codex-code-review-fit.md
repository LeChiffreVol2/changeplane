# Codex Code Review and ChangePlane

Research date: 2026-10-03. Primary documentation review and product judgment; no customer study, competitive benchmark, or live Codex integration qualification. The personal screenshot that prompted this review is not part of the public evidence.

## Verified capabilities

Codex Code Review already provides a PR inbox, descriptions, diffs, comments, checks, review chats, and explicit review submission. Its desktop **Fix** action attaches failed-check context to a draft message for the user to send. GitHub support is generally available; GitLab support in this surface is described as preview. A chat review alone does not post comments, approve, or merge. [OpenAI Code Review documentation](https://learn.chatgpt.com/docs/code-review).

The GitHub integration supports requested and automatic code reviews, repository `AGENTS.md` guidance, and follow-up coding tasks that can push fixes with permission. Its documented examples include addressing a review finding and fixing CI failures. OpenAI explicitly says review guidance does not replace tests, branch protections, or required approvals. [OpenAI GitHub integration](https://learn.chatgpt.com/docs/third-party/github).

The GitLab integration is documented as beta. It supports requested and automatic reviews and follow-up fixes, with setup and project-environment requirements that differ from GitHub. This does not qualify equivalent ChangePlane support. [OpenAI GitLab integration](https://learn.chatgpt.com/docs/third-party/gitlab).

GitHub exposes submitted review state, reviewer identity, reviewed `commit_id`, and a review URL through `GET /repos/{owner}/{repo}/pulls/{number}/reviews`. Results are chronological and paginated; private access requires Pull requests read permission. Public resources can be read without authentication. [GitHub review API](https://docs.github.com/en/rest/pulls/reviews#list-reviews-for-a-pull-request).

Inline review comments have a separate paginated endpoint, `GET /repos/{owner}/{repo}/pulls/{number}/comments`, with review/commit associations, original commit, location, body, and timestamps. They are distinct from issue comments. The documented REST response does not provide review-thread resolution state. [GitHub review-comment API](https://docs.github.com/en/rest/pulls/comments#list-review-comments-on-a-pull-request).

## Product judgment

**Codex is a direct competitor for reviewing code, understanding failed checks, and getting a fix made.** Calling it merely an authoring agent would understate the overlap. A second general review UI or another model pass is a weak default reason to install ChangePlane.

The more useful direction is to work with the customer's existing reviewer: connect native feedback to ChangePlane's current CI and protected-path assessment, then give the human or agent one bounded next action. The intended outcome is: **“After a review or fix, know what still needs attention on this revision.”** This is a product hypothesis, not evidence of a unique moat or superiority over native controls.

Use standard GitHub feedback already published by humans or agents, including Codex when present. Do not introduce a proprietary Codex API dependency, infer reviewer authenticity from a display name, trigger another model review by default, or require a new OAuth connection merely to collect these existing records. Preserve the local/CI operating model and existing repository-scoped reader. This follows ChangePlane's [product and authority policy](../../AGENTS.md).

## Implementation constraints

- Reuse the bounded collector in [team-feedback.js](../../community/team-feedback.js) and the existing assessment in [github.js](../../community/github.js), rather than creating parallel review infrastructure.
- Bind the observation to repository identity and exact PR head; recheck identity and head after collection. Include native record IDs, reviewed commit, content digest, and generated GitHub links. State pagination or provider failure explicitly; incomplete collection is not “no feedback.”
- Keep feedback advisory and separate from deterministic CI findings. An `APPROVED` review cannot issue ChangePlane `PASS`, confer repair authority, or replace protected-path human review. A changes-requested record on an older commit remains an older-commit record until independently reconciled.
- Treat bodies, paths, and reviewer text as untrusted data. Do not execute instructions, expand allowed paths, send comments, mark discussions resolved, or request a model from collected feedback. Prefer bounded metadata and source links over copying raw prose into agent instructions.
- Say “feedback on this revision,” not “unresolved findings.” Commit/location freshness does not establish resolution. A newer head also does not prove that earlier feedback was fixed. Direct the user to the original discussion where that distinction matters.
- Offer one next action suitable for the existing agent: inspect the linked feedback, make only already-authorized changes, then repeat assessment on the new head. Native reviewer setup and optional ChangePlane model review remain distinct choices.

## Evidence still required

A collector tested against fixtures establishes response handling, not that a real Codex review was observed or addressed. GitHub metadata collection alone also cannot see findings left only in a private Codex chat. A future opt-in public-repository trial should record exact revisions and measure setup completion, time to identify the next action, stale-feedback handling, and successful reassessment after a fix. Compare native Codex/GitHub alone against the same workflow with ChangePlane, including cases where native tools are sufficient. Until measured, do not claim better defect detection, time savings, automatic resolution, autonomous merge, or end-to-end GitLab parity.
