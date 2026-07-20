import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { requestPatchProposal } from "../examples/changeplane-proposal.js";
import { DEFAULT_PROPOSAL_MODEL } from "../src/lib/runtime.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RELATIVE_DIRECTORY = "examples/routethai-synthetic";
const SOURCE_PATH = `${RELATIVE_DIRECTORY}/service-window.js`;
const TEST_PATH = `${RELATIVE_DIRECTORY}/service-window.test.js`;
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");

const failureEvidence = JSON.parse(readFileSync(path.join(ROOT, RELATIVE_DIRECTORY, "failure-evidence.json"), "utf8"));
const request = {
  repairKind: "evidence",
  change: { headSha: failureEvidence.head },
  allowedPaths: failureEvidence.allowedPaths,
  instructions: [{
    code: failureEvidence.failure.code,
    path: `check:${failureEvidence.failure.check}`,
    action: "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE",
    diagnostic: failureEvidence.failure.message,
  }],
};

const tempRoot = mkdtempSync(path.join(tmpdir(), "changeplane-route-canary-"));
let responseMetadata = null;
try {
  const tempFixture = path.join(tempRoot, RELATIVE_DIRECTORY);
  mkdirSync(tempFixture, { recursive: true });
  copyFileSync(path.join(ROOT, SOURCE_PATH), path.join(tempRoot, SOURCE_PATH));
  copyFileSync(path.join(ROOT, TEST_PATH), path.join(tempRoot, TEST_PATH));

  const failing = spawnSync(process.execPath, ["--test", TEST_PATH], { cwd: tempRoot, encoding: "utf8" });
  if (failing.status === 0) throw new Error("The synthetic fixture must fail before repair.");

  const proposal = await requestPatchProposal({
    apiKey,
    model: DEFAULT_PROPOSAL_MODEL,
    request,
    files: [{ path: SOURCE_PATH, content: readFileSync(path.join(ROOT, SOURCE_PATH), "utf8") }],
    onResponseMetadata(metadata) { responseMetadata = metadata; },
  });
  const patchPath = path.join(tempRoot, "candidate.patch");
  writeFileSync(patchPath, proposal.patch, { encoding: "utf8", mode: 0o600 });

  const check = spawnSync("git", ["apply", "--check", "--recount", patchPath], { cwd: tempRoot, encoding: "utf8" });
  if (check.status !== 0) throw new Error("The provider patch failed clean git apply validation.");
  const apply = spawnSync("git", ["apply", "--recount", patchPath], { cwd: tempRoot, encoding: "utf8" });
  if (apply.status !== 0) throw new Error("The validated provider patch could not be applied.");
  const passing = spawnSync(process.execPath, ["--test", TEST_PATH], { cwd: tempRoot, encoding: "utf8" });
  if (passing.status !== 0) throw new Error("The deterministic service-window evidence still fails after the patch.");

  const report = {
    recordedAt: new Date().toISOString(),
    fixture: failureEvidence.fixture,
    model: responseMetadata?.model ?? DEFAULT_PROPOSAL_MODEL,
    requestId: responseMetadata?.requestId ?? null,
    initialEvidence: "failed",
    allowedPaths: proposal.paths,
    patchBytes: Buffer.byteLength(proposal.patch),
    patchSha256: createHash("sha256").update(proposal.patch).digest("hex"),
    cleanGitApply: true,
    finalEvidence: "passed",
    modelForgeAuthority: false,
  };
  if (process.env.CHANGEPLANE_CANARY_REPORT_PATH) {
    writeFileSync(process.env.CHANGEPLANE_CANARY_REPORT_PATH, `${JSON.stringify(report)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
