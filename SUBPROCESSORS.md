# Subprocessor List — approval draft

This draft concerns the ChangePlane-operated hosted service. Use of the open-source software is governed by [Apache-2.0](LICENSE); the CLI and read-only GitHub Action do not call that service.

**Status:** Not yet effective. The operator must confirm the contracted service, processing region, legal entity, and notification process for every provider before legal approval.

| Provider | Purpose in the supported product | Data boundary | Provider information |
| --- | --- | --- | --- |
| GitHub, Inc. | Git forge, identity, App installation, repositories, pull requests, Actions, Checks, Rulesets, secrets, comments, artifacts, and merge authority | Customer-selected GitHub account and repositories | [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) |
| Vercel Inc. | Hosts the ChangePlane web application and API | HTTPS requests, sealed session cookie, redacted operational metadata, and transient connector processing | [Vercel legal documents](https://vercel.com/legal) and [security/subprocessors](https://security.vercel.com/) |
| OpenAI entity contracted by the customer | Optional BYOK model verification and model-backed processing when the customer separately enables it | Selected model, bounded evidence, and allowed-path context; no GitHub credential or PASS authority | [OpenAI business terms](https://openai.com/policies/business-terms/) and [DPA](https://openai.com/policies/data-processing-addendum/) |

The design-partner alpha supports Verify and Strict Head without enabling Autonomous Repair. A customer-controlled evidence publisher or coding agent is not a ChangePlane subprocessor merely because its Check is evaluated. Adding or materially changing a provider requires security, privacy, contract, and release review before customer data is sent to it.

**Change notice contact:** [PRIVACY EMAIL OR NOTICE URL]

