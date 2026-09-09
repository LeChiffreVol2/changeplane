---
status: accepted
---

# Make independently operable recovery the open-source product direction

ChangePlane will prioritize measurably reducing human intervention in failed change-request/CI recovery while preserving deterministic assurance and the authoritative forge's merge authority. Individuals and organizations must be able to operate the assessment and recovery core under their own authority; the hosted service is an optional operating choice, rather than the only supported path to the eventual recovery capability. This trades a simpler vendor-controlled deployment boundary for explicit operator isolation, installation and recovery qualification; it is an accepted target architecture, not a claim that the currently shipped read-only distribution already provides that capability.

## Decision record

The owner selected both priorities in the 2026-09-10 design interview. The current budget remains USD 0; the USD 100 ceiling applies only to a later scaling decision. Existing separation of proposal, deterministic decision and trusted application authority remains mandatory.

The owner subsequently selected repository-by-repository Auto-repair opt-in (Q6). The intended default is diagnosis and bounded transient recovery; source proposals and application require that separate opt-in. Repair retains two attempts within an immutable fifteen-minute campaign, independent controller credentials, fresh validation, and human review for protected evidence, tests, workflows and manifests. Enabling a repository cannot make an unqualified provider or deployment eligible for writes.

The owner selected CI-first operation with a local evaluator and a separately authorized controller when writing or publishing Guard is enabled (Q7). Diagnostic reports and evidence stay in the operator's machine/CI by default, with no automatic telemetry to ChangePlane (Q8). Explicitly enabled model features may send filtered failure evidence and permitted source context to the configured provider under the user's key; benchmark incident sharing is voluntary. These are requirements for the target design, not claims of zero retention by CI or model providers.

The Verify-first and assurance-level distinctions in [ADR-0001](0001-verify-first-and-two-assurance-levels.md) remain relevant, but its original commercial-first adoption priority does not govern this open-source milestone. The hosted commercial design in [ADR-0007](0007-github-identity-and-managed-postgres.md) remains specific to the optional hosted service. [ADR-0009](0009-multi-forge-assurance-boundaries.md) records platform and fork scope. The bounded proposal is recorded in the [design review](../agentic-sdlc-design-review.md); the owner confirmed the combined design and authorized implementation.
