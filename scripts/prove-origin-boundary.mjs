import { runOriginBoundaryProof } from "../src/lib/assurance-lab.js";

const proof = runOriginBoundaryProof();
const asJson = process.argv.includes("--json");

if (asJson) {
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
} else {
  process.stdout.write([
    `Cursor Origin boundary proof: ${proof.summary.passed}/${proof.summary.total} assertions`,
    `Executable contract cases: ${proof.summary.executableCasesPassed}/${proof.summary.executableCases}`,
    `GitHub-mirrored path: ${proof.compatibility.githubMirroredOrigin}`,
    `Standalone Origin: ${proof.compatibility.standaloneOrigin}`,
    ...proof.assertions.map((assertion) => `${assertion.passed ? "PASS" : "FAIL"} ${assertion.id}: ${assertion.observed}`),
    "Scope: synthetic ChangePlane contract; no GitHub or Origin API request.",
  ].join("\n") + "\n");
}

if (!proof.summary.allPassed || proof.summary.executableCasesPassed !== proof.summary.executableCases) {
  process.exitCode = 1;
}
