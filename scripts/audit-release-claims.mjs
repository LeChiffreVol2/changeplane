import { readFileSync } from "node:fs";

import { auditReleaseClaims } from "../src/lib/release-claims.js";

const paths = [
  "README.md",
  "SECURITY.md",
  "docs/agentic-sdlc.md",
  "docs/cursor-origin-boundary.md",
  "docs/hosted-service.md",
  "docs/production-runbook.md",
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
