import assert from "node:assert/strict";
import test from "node:test";

import {
  assertWorkspaceHead,
  buildProposalMessages,
  readTrustedRuntimeModel,
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

test("requests GPT-5.6 Luna through Responses API without returning the credential", async () => {
  const apiKey = `provider-${"k".repeat(32)}`;
  const result = await requestPatchProposal({
    apiKey,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
    fetchImpl: async (url, options) => {
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      assert.equal(options.headers.authorization, `Bearer ${apiKey}`);
      assert.equal(options.redirect, "error");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-5.6-luna");
      assert.deepEqual(body.reasoning, { effort: "high" });
      assert.equal(body.max_output_tokens, 16_384);
      assert.deepEqual(body.text, {
        format: {
          type: "json_schema",
          name: "bounded_patch",
          strict: true,
          schema: {
            type: "object",
            properties: {
              patch: {
                type: "string",
                description: "Raw git diff output only. Start with diff --git and end on a hunk line; never use Markdown or apply_patch markers.",
                minLength: 1,
                maxLength: 256 * 1024,
                pattern: "^diff --git ",
              },
            },
            required: ["patch"],
            additionalProperties: false,
          },
        },
      });
      assert.equal(body.store, false);
      assert.match(body.instructions, /not the verifier/u);
      assert.match(body.input, /expected one charge but observed two/u);
      assert.match(body.input, /End Patch.*invalid/u);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "completed",
            output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ patch }) }] }],
          });
        },
      };
    },
  });
  assert.deepEqual(result.paths, ["src/payments/retry.js"]);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test("describes the raw Git diff contract and rejects apply_patch markers locally", async () => {
  const wrapped = `${patch}\n*** End Patch`;
  await assert.rejects(requestPatchProposal({
    apiKey: `provider-${"k".repeat(32)}`,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
    fetchImpl: async (_url, options) => {
      const schema = JSON.parse(options.body).text.format.schema.properties.patch;
      assert.match(schema.description, /Raw git diff output only/u);
      assert.equal(schema.pattern, "^diff --git ");
      return new Response(JSON.stringify({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ patch: wrapped }) }] }],
      }));
    },
  }), /corrupt patch|unified Git patch|standard text modification patch/u);
});

test("reads only an allowlisted model from a trusted runtime policy", () => {
  assert.equal(readTrustedRuntimeModel(new URL("./fixtures/runtime-luna.json", import.meta.url)), "gpt-5.6-luna");
  assert.throws(
    () => readTrustedRuntimeModel(new URL("./fixtures/runtime-unsupported.json", import.meta.url)),
    /GPT-5\.6 Luna, Terra, or Sol/u,
  );
});

test("rejects unsupported models before an OpenAI network call", async () => {
  let called = false;
  await assert.rejects(requestPatchProposal({
    apiKey: `provider-${"k".repeat(32)}`,
    model: "gpt-5.6",
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
    fetchImpl: async () => { called = true; },
  }), /GPT-5\.6 Luna, Terra, or Sol/u);
  assert.equal(called, false);
});

test("rejects Responses API refusal, incomplete, malformed, and empty outputs", async () => {
  const cases = [
    "not-json",
    JSON.stringify({ status: "incomplete", output: [] }),
    JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }),
    JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "" }] }] }),
    JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ answer: patch }) }] }] }),
  ];
  for (const responseBody of cases) {
    await assert.rejects(requestPatchProposal({
      apiKey: `provider-${"k".repeat(32)}`,
      request,
      files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
      fetchImpl: async () => new Response(responseBody, { status: 200 }),
    }), /invalid JSON|incomplete response|no patch proposal|malformed patch envelope/u);
  }
});

test("keeps provider transport behind the common bounded-patch harness", async () => {
  let messages;
  const provider = async (input) => {
    messages = input.messages;
    return patch;
  };
  const result = await requestPatchProposal({
    provider,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
  });
  assert.match(messages[0].content, /not the verifier/u);
  assert.deepEqual(result.paths, ["src/payments/retry.js"]);

  await assert.rejects(requestPatchProposal({
    provider: async () => patch.replaceAll("src/payments/retry.js", ".github/workflows/release.yml"),
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
  }), /outside its repair grant/u);
});

test("rejects exact credential reflection before a provider patch can leave the harness", async () => {
  const apiKey = `provider-${"r".repeat(32)}`;
  const reflectedPatch = patch.replace("+return chargeOnce(order)", `+return "${apiKey}"`);
  await assert.rejects(requestPatchProposal({
    apiKey,
    provider: async () => reflectedPatch,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
  }), (error) => /unsafe credential material/u.test(error.message) && !error.message.includes(apiKey));
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

test("provider timeout and network failures stay redacted and fail closed", async () => {
  const reflected = "network-secret";
  await assert.rejects(requestPatchProposal({
    apiKey: `provider-${"k".repeat(32)}`,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
    fetchImpl: async () => { throw new Error(reflected); },
  }), (error) => /temporarily unavailable/u.test(error.message) && !error.message.includes(reflected));
});

test("stops reading an oversized provider response before parsing it", async () => {
  await assert.rejects(requestPatchProposal({
    apiKey: `provider-${"k".repeat(32)}`,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
    fetchImpl: async () => new Response("x".repeat((512 * 1024) + 1)),
  }), /empty or oversized response/u);
});

test("redacts provider stream failures", async () => {
  const reflected = "provider-stream-secret";
  const body = new ReadableStream({
    start(controller) { controller.error(new Error(reflected)); },
  });
  await assert.rejects(requestPatchProposal({
    apiKey: `provider-${"k".repeat(32)}`,
    request,
    files: [{ path: "src/payments/retry.js", content: "return charge(order)" }],
    fetchImpl: async () => new Response(body),
  }), (error) => /temporarily unavailable/u.test(error.message) && !error.message.includes(reflected));
});
