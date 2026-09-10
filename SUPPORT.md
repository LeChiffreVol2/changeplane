# Support

The public installation is [ChangePlane Open Source](docs/community.md): a dependency-free CLI and read-only GitHub Action, plus opt-in [team coordination and MCP](docs/repository-team.md), for personal and organization accounts. Maintainer support is best effort. GitHub.com same-repository PRs targeting the default branch are the operating path. Fork diagnosis and the GitLab reader have separate candidate boundaries in the [recovery core](docs/recovery-core.md); fork team writes, GitHub Enterprise Server, Bitbucket, cross-repository repair, managed model billing and automatic merge are outside this release. Hosted customer installations remain closed.

For non-sensitive Open Source defects, open a GitHub issue with the release version, Node/Git versions, OS, redacted error code and a synthetic reproduction. For hosted product issues, include the browser version, affected step and request ID. Include no private repository content or credentials.

An accepted design partner receives one private support channel, named owner, business hours, time zone, and escalation path in its signed order form. Until those fields are complete, only community support is offered and the legal release gate remains closed. Support staff request redacted request IDs and state transitions only; customers must not paste private source, prompts, patches, cookies, tokens, provider keys, or upstream response bodies into the channel.

For suspected vulnerabilities, use the repository's private security-advisory channel or contact the repository owner privately as described in [SECURITY.md](SECURITY.md). Do not place tokens, provider keys, cookies, private source, prompts, patches, customer data, or full upstream responses in a public issue.

## Safe first checks

- For Open Source assessment, check the default-branch policy, exact behavioral job identity and read-only token permissions. No App installation or model key is required.
- For team operations, check the exact repository opt-in, target checkout, separate Git authentication and current reservation before retrying. Organization rules may require App approval or SSO. Do not weaken those rules to make an operation succeed.

The following checks apply only to the hosted controlled canary:

- Confirm the selected repository belongs to a GitHub App installation visible to the signed-in user.
- Confirm the repository is active, writable, and has no repository-owned changes under ChangePlane reserved paths.
- Confirm the exact behavioral Check name and expected GitHub App publisher are correct.
- Confirm the setup or configuration pull request is merged before expecting automation.
- Confirm `OPENAI_API_KEY` is configured for model-backed work and the selected model is available to that OpenAI project.
- Use the request ID from the product response when reporting an API failure.

Do not weaken branch protection, expose a provider key, bypass a protected-path stop, rerun against a stale head, or grant broader GitHub access to recover from an error. A blocked state is designed to leave the repository unchanged.

No uptime SLA, emergency response time, or 24/7 support commitment is offered in this release.
