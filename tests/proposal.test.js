import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWorkspaceHead,
  buildProposalMessages,
  requestPatchProposal,
  validatePatchProposal,
} from "../examples/changeplane-proposal.js";

const patch = [
  "diff --git a/src/payments/retry.js b/src/payments/retry.js",
  "index 1111111..2222222 100644",
  "--- a/src/payments/retry.js",
  "+++ b/src/payments/retry.js",
  "@@ -1 +1 @@",
  "-return charge(order)",
  "+return chargeOnce(order)",
].join("\n");

const request = {
  repairKind: "evidence",
  change: { headSha: "a".repeat(40) },
  allowedPaths: ["src/payments/**"],
  instructions: [{
    code: "EVIDENCE_FAILED",
    path: "check:checkout-race",
    action: "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE",
    diagnostic: "expected one charge but observed two",
  }],
};

test("accepts only bounded modifications inside the controller grant", () => {
  assert.deepEqual(validatePatchProposal(patch, request.allowedPaths), {
    patch: `${patch}\n`,
    paths: ["src/payments/retry.js"],
  });
  assert.throws(() => validatePatchProposal(
    patch.replaceAll("src/payments/retry.js", ".github/workflows/release.yml"),
    request.allowedPaths,
  ), /outside its repair grant/u);
  assert.throws(() => validatePatchProposal(`${patch}\nnew file mode 100644`, request.allowedPaths), /existing text files/u);
  assert.throws(() => validatePatchProposal("I fixed the race", request.allowedPaths), /only a unified Git patch/u);
});

test("marks diagnostics and source as untrusted and keeps the model out of verification", () => {
  const messages = buildProposalMessages({
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
  });
  assert.match(messages[0].content, /not the verifier/u);
  assert.match(messages[0].content, /untrusted data/u);
  assert.match(messages[0].content, /deterministic controller/u);
  assert.match(messages[1].content, /expected one charge but observed two/u);
});

test("binds provider context to the exact workspace head and controller path grant", async () => {
  assert.doesNotThrow(() => assertWorkspaceHead("a".repeat(40), () => Buffer.from(`${"a".repeat(40)}\n`)));
  assert.throws(
    () => assertWorkspaceHead("a".repeat(40), () => Buffer.from(`${"b".repeat(40)}\n`)),
    /bound exact head/u,
  );
  let providerCalled = false;
  await assert.rejects(requestPatchProposal({
    apiKey: `provider-${"k".repeat(32)}`,
    request,
    files: [{ path: ".env", content: "SECRET=value" }],
    fetchImpl: async () => { providerCalled = true; },
  }), /outside its repair grant/u);
  assert.equal(providerCalled, false);
});

test("requests a DeepSeek V4 Flash proposal without returning or reflecting the credential", async () => {
  const apiKey = `provider-${"k".repeat(32)}`;
  const result = await requestPatchProposal({
    apiKey,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
    fetchImpl: async (url, options) => {
      assert.equal(String(url), "https://api.deepseek.com/chat/completions");
      assert.equal(options.headers.authorization, `Bearer ${apiKey}`);
      assert.equal(options.redirect, "error");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "deepseek-v4-flash");
      assert.equal(body.temperature, 0);
      assert.equal(body.max_tokens, 4_096);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ choices: [{ message: { content: patch } }] });
        },
      };
    },
  });
  assert.deepEqual(result.paths, ["src/payments/retry.js"]);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test("provider failures stay body-redacted and fail closed", async () => {
  await assert.rejects(requestPatchProposal({
    apiKey: `provider-${"k".repeat(32)}`,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async text() { return "reflected-secret"; },
    }),
  }), (error) => /rejected the request \(429\)/u.test(error.message) && !error.message.includes("reflected-secret"));
});
