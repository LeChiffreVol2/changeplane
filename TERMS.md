# Design Partner Terms — approval draft

This draft concerns the ChangePlane-operated hosted service. Use of the open-source software is governed by [Apache-2.0](LICENSE); Community CLI/Action do not call that service.

**Status:** Not yet effective. ChangePlane must not set `CHANGEPLANE_LEGAL_RELEASE_APPROVED=true` until the operator has filled every bracketed field below, obtained qualified legal review, approved these terms for one exact protected Production release, and made the approved version available to each design partner before installation.

**Provider:** [LEGAL ENTITY AND REGISTERED ADDRESS]  
**Legal contact:** [LEGAL CONTACT EMAIL]  
**Effective date:** [DATE]  
**Governing law and venue:** [JURISDICTION]

## 1. Service

ChangePlane provides a hosted GitHub-native assurance service for agent-authored pull requests. GitHub remains the source of truth, policy surface, and merge authority. The design-partner alpha supports GitHub.com and only the repositories expressly selected during installation. GitHub Enterprise Server, automatic merge, managed model spend, contractual uptime, and any capability marked unavailable in the product or order form are excluded.

## 2. Customer authority and accounts

The customer represents that it may install the GitHub Apps, authorize the requested repository permissions, submit repository content for processing, and bind its organization to these terms. The customer controls its GitHub account, repository access, branch policy, evidence Checks, coding agents, provider accounts, and merge decisions. Account credentials and provider keys must not be shared with ChangePlane personnel.

## 3. Alpha conditions

The service is pre-release and may change, fail closed, or be withdrawn. A non-successful or missing Guard may block a merge when the customer configures GitHub to require it. ChangePlane does not guarantee that the service finds every defect, prevents every unsafe merge, or replaces code review, testing, security review, incident response, backup, or professional judgment. No service-level agreement or 24/7 support applies unless a signed order form expressly says otherwise.

## 4. Acceptable use

The customer must follow the [Acceptable Use Policy](ACCEPTABLE_USE.md), applicable law, and GitHub and provider terms. The customer must not use the service to violate rights, bypass authorization, process prohibited data, attack systems, or rely on the service for safety-critical decisions.

## 5. Customer data and security

Data handling is described in the [Privacy Notice](PRIVACY.md), [Subprocessor List](SUBPROCESSORS.md), [Retention and Deletion Policy](docs/retention-deletion.md), and [Security Policy](SECURITY.md). Each party will use reasonable safeguards appropriate to its role. The customer must promptly revoke any credential exposed outside its designated secret store.

## 6. Fees

Fees, limits, term, and payment method are stated in a signed order form. Pricing outside a signed order form is an offer for testing and may change before general availability. Taxes, refunds, renewals, late payment, and termination charges must be stated in the approved order form before any payment is accepted.

## 7. Intellectual property and feedback

Each party retains its pre-existing intellectual property. The customer retains its repository content. Subject to payment and these terms, ChangePlane grants the customer a limited, non-exclusive, non-transferable right to use the hosted service during the agreed term. The customer grants ChangePlane only the rights needed to operate the service and may provide feedback without an obligation to use it.

## 8. Confidentiality

Each party will protect non-public information received from the other and use it only for the design-partner engagement. Repository source, credentials, security reports, and non-public product information are confidential. Custom confidentiality terms require a signed order form or NDA.

## 9. Suspension and termination

Either party may terminate the alpha as stated in the order form, or immediately for material security risk, unlawful use, or material breach. ChangePlane may fail closed or suspend a repository when authority, evidence, provider, quota, or platform state is ambiguous. Removal and deletion follow the Retention and Deletion Policy.

## 10. Warranties, liability, and legal completion

**Counsel must supply the jurisdiction-appropriate warranty disclaimer, limitation of liability, indemnity, dispute, notice, export, assignment, force-majeure, survival, and entire-agreement clauses before these terms become effective.** This draft is an engineering release control, not legal advice and not a customer agreement.

