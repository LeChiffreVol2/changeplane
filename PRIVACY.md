# Privacy Notice — approval draft

This draft concerns the ChangePlane-operated hosted service. Use of the open-source software is governed by [Apache-2.0](LICENSE); Community CLI/Action do not call that service.

**Status:** Not yet effective. This notice requires legal review, the provider identity and contact details below, and approval bound to one exact protected Production release before public self-service may open.

**Controller/provider:** [LEGAL ENTITY AND ADDRESS]  
**Privacy contact:** [PRIVACY EMAIL]  
**Effective date:** [DATE]

## Scope

This notice covers the ChangePlane hosted website and GitHub App. The signed-out RouteThai experience uses synthetic data. A customer's use of GitHub, OpenAI, Vercel, and other connected services is also governed by those providers' terms and privacy notices.

## Data processed in the design-partner alpha

- GitHub account and installation identifiers needed to authenticate a user and restrict repository selection.
- Repository, pull-request, commit, Check, Ruleset, workflow, deployment, and App-publisher metadata needed to evaluate one exact revision and operate the GitHub integration.
- A bounded, redacted operational request ID and service outcome for support and reliability diagnosis.
- Contact, organization, plan, invoice, and support information exchanged directly with a design partner.
- Repository content only when a customer enables an optional BYOK model-backed capability; the supported alpha does not enable Autonomous Repair.

ChangePlane does not intentionally collect consumer profiling data, advertising identifiers, precise location, payment-card data, or special-category personal data. Customers must not place secrets or unnecessary personal data in prompts, comments, evidence, support reports, or configuration.

## Purpose and legal basis

The data is used to provide and secure the service, authenticate authorized users, bind assurance to an exact revision, prevent abuse, support customers, meet contractual obligations, and comply with law. **Counsel must finalize the applicable legal bases and required regional disclosures before approval.** ChangePlane does not sell personal information or use customer repository content for advertising.

## Credentials and model requests

Session state is sealed in a secure HTTP-only cookie. Short-lived GitHub tokens stay server-side. A repository BYOK value is processed only long enough to verify the selected model, encrypt the key with GitHub's repository public key, and store it as the repository Actions Secret `OPENAI_API_KEY`; the browser field is cleared after each attempt. Model requests use the customer's selected provider account and `store: false`, but ChangePlane does not claim that third-party provider retention is zero.

## Sharing and subprocessors

Data is disclosed only to personnel and service providers who need it to operate the service, respond to a customer, meet legal obligations, or protect rights and security. Current service providers and their functions are listed in [SUBPROCESSORS.md](SUBPROCESSORS.md). ChangePlane does not authorize an authoring model to approve, merge, issue `PASS`, or receive GitHub App credentials.

## Retention, deletion, and security

The design-partner alpha uses GitHub as the operational record and does not activate the candidate commercial event database. Detailed retention and deletion behavior is stated in [docs/retention-deletion.md](docs/retention-deletion.md). Security boundaries and reporting are described in [SECURITY.md](SECURITY.md). No SOC 2, GDPR-compliance, or other certification claim is made.

## Rights, transfers, and changes

Requests to access, correct, export, object to, restrict, or delete personal information should be sent to the privacy contact above. Identity and authority will be verified before action. **Counsel must complete regional rights, international-transfer, regulator, children's-data, and notice-change language before approval.** Material changes require a new effective date and release review.

