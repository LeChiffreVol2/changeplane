import { readFileSync } from "node:fs";

import { auditReleaseClaims } from "../src/lib/release-claims.js";

const paths = [
  "ACCEPTABLE_USE.md",
  "README.md",
  "community/README.md",
  "docs/README.md",
  "skills/changeplane/SKILL.md",
  "CONTRIBUTING.md",
  "docs/community.md",
  "docs/community-positioning.md",
  "docs/community-roadmap.md",
  "docs/recovery-core.md",
  "docs/repository-team.md",
  "docs/team-operator.md",
  "docs/repository-team-qualification.md",
  "docs/open-source-qa-audit.md",
  "docs/managed-product.md",
  "PRIVACY.md",
  "SECURITY.md",
  "SUBPROCESSORS.md",
  "SUPPORT.md",
  "TERMS.md",
  "EVALUATION.md",
  "docs/agentic-sdlc.md",
  "docs/automated-sdlc-architecture.md",
  "docs/guard-publication-journal.md",
  "docs/guard-app-registration.md",
  "database/README.md",
  "docs/launch-measurement.md",
  "docs/adoption-measurement.md",
  "docs/agentic-product-plan.md",
  "docs/agent-feedback-research.md",
  "docs/commercial-plan.md",
  "docs/operating-budget.md",
  "docs/cursor-origin-boundary.md",
  "docs/data-handling.md",
  "docs/design-partner-order-form.md",
  "docs/hosted-service.md",
  "docs/product-roadmap.md",
  "docs/production-runbook.md",
  "docs/retention-deletion.md",
  "docs/release-checklist.md",
];
const findings = auditReleaseClaims(paths.map((path) => ({
  path,
  content: readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
})));

if (findings.length > 0) {
  for (const finding of findings) {
    process.stderr.write(`${finding.path}:${finding.line} [${finding.rule}] ${finding.message}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Release claim audit passed for ${paths.length} public contract documents.\n`);
}
