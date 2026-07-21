# Support

ChangePlane currently supports the hosted GitHub.com product described in the [README](README.md). GitHub Enterprise Server, GitLab, Bitbucket, fork pull requests, cross-repository repair, managed model billing, and automatic merge are outside the supported release.

For product questions or non-sensitive defects, open a GitHub issue with the browser version, affected product step, request ID, and a description that contains no private repository content or credentials.

For suspected vulnerabilities, use the repository's private security-advisory channel or contact the repository owner privately as described in [SECURITY.md](SECURITY.md). Do not place tokens, provider keys, cookies, private source, prompts, patches, customer data, or full upstream responses in a public issue.

## Safe first checks

- Confirm the selected repository belongs to a GitHub App installation visible to the signed-in user.
- Confirm the repository is active, writable, and has no repository-owned changes under ChangePlane reserved paths.
- Confirm the exact behavioral Check name and expected GitHub App publisher are correct.
- Confirm the setup or configuration pull request is merged before expecting automation.
- Confirm `OPENAI_API_KEY` is configured for model-backed work and the selected model is available to that OpenAI project.
- Use the request ID from the product response when reporting an API failure.

Do not weaken branch protection, expose a provider key, bypass a protected-path stop, rerun against a stale head, or grant broader GitHub access to recover from an error. A blocked state is designed to leave the repository unchanged.

No uptime SLA, emergency response time, or 24/7 support commitment is offered in this release.
