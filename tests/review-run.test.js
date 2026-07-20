import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  REVIEW_CHECK_NAME,
  REVIEW_JOB_STATE,
  decodeReviewJob,
  encodeReviewJob,
  parseAddedLines,
  proposeReviewJob,
  publishReviewJob,
  readTrustedReviewPolicy,
  runCli,
} from "../examples/changeplane-review-run.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const githubToken = `github-${"g".repeat(32)}`;
const openaiApiKey = `provider-${"k".repeat(32)}`;
const event = {
  number: 42,
  repository: { full_name: "acme/payments" },
  pull_request: {
    number: 42,
    base: { sha: baseSha, repo: { full_name: "acme/payments" } },
    head: { sha: headSha, repo: { full_name: "acme/payments" } },
  },
};
const patch = [
  "@@ -10,2 +10,3 @@ function charge(order) {",
  " const key = order.id",
  "+if (retry) return charge(order)",
  " return receipt",
  "@@ -30 +31,2 @@ function retry(order) {",
  "-return oldRetry(order)",
  "+return charge(order)",
  "+",
].join("\n");
const finding = {
  path: "src/payments/retry.js",
  line: 11,
  severity: "high",
  category: "correctness",
  title: "Retry can charge twice",
  evidence: "The added retry branch calls charge without the repository idempotency key.",
  suggestion: "Preserve the existing idempotency key when retrying.",
};

function json(value, init = {}) {
  return new Response(JSON.stringify(value), init);
}

function githubReadResponse(url, options, { stale = false, memory = false } = {}) {
  assert.equal(options.method, "GET");
  assert.equal(options.headers.authorization, `Bearer ${githubToken}`);
  if (url.endsWith("/pulls/42")) {
    return json({ base: { sha: baseSha }, head: { sha: stale ? "c".repeat(40) : headSha } });
  }
  if (url.includes("/pulls/42/files?per_page=41")) {
    return json([{ filename: "src/payments/retry.js", status: "modified", patch }]);
  }
  if (memory && url.includes("/contents/.changeplane/assurance.md?ref=")) {
    assert.match(url, new RegExp(`ref=${baseSha}$`, "u"));
    return json({
      type: "file",
      encoding: "base64",
      content: Buffer.from("Payment retries must preserve the existing idempotency key.").toString("base64"),
    });
  }
  assert.fail(`Unexpected GitHub request: ${url}`);
}

function openAIResponse(envelope) {
  return json({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(envelope) }] }],
  });
}

test("reconstructs only added exact-head line numbers from GitHub patches", () => {
  assert.deepEqual(parseAddedLines(patch), [
    { line: 11, text: "if (retry) return charge(order)" },
    { line: 31, text: "return charge(order)" },
    { line: 32, text: "" },
  ]);
  assert.throws(() => parseAddedLines("@@ broken"), /invalid hunk/u);
});

test("PROPOSE reads exact-head diff and trusted-base memory before calling OpenAI", async () => {
  const calls = [];
  const job = await proposeReviewJob({
    event,
    githubToken,
    openaiApiKey,
    policyPath: new URL("./fixtures/runtime-review.json", import.meta.url),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method });
      if (String(url).startsWith("https://api.github.com/")) {
        return githubReadResponse(String(url), options, { memory: true });
      }
      assert.equal(String(url), "https://api.openai.com/v1/responses");
      assert.equal(options.headers.authorization, `Bearer ${openaiApiKey}`);
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-5.6-luna");
      assert.equal(body.store, false);
      assert.equal(body.text.format.schema.properties.findings.maxItems, 2);
      assert.match(body.instructions, /trusted base revision/u);
      assert.match(body.input, /Payment retries must preserve/u);
      assert.match(body.input, new RegExp(headSha, "u"));
      return openAIResponse({ headSha, findings: [finding] });
    },
  });
  assert.equal(job.state, REVIEW_JOB_STATE.REVIEWED);
  assert.equal(job.review.authority, "ADVISORY_ONLY");
  assert.equal(calls.some(({ method }) => method === "POST"), true);
  assert.equal(calls.some(({ url }) => url.includes("check-runs")), false);
  assert.deepEqual(decodeReviewJob(encodeReviewJob(job)), JSON.parse(JSON.stringify(job)));
});

test("PROPOSE emits a safe not-configured job without reading GitHub or OpenAI", async () => {
  let called = false;
  const job = await proposeReviewJob({
    event,
    githubToken,
    openaiApiKey: "",
    policyPath: new URL("./fixtures/runtime-review.json", import.meta.url),
    fetchImpl: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(job.state, REVIEW_JOB_STATE.NOT_CONFIGURED);
  assert.equal(job.review, null);
});

test("trusted policy explicitly gates BYOK review spend", async () => {
  assert.deepEqual(readTrustedReviewPolicy(new URL("./fixtures/runtime-review.json", import.meta.url)), {
    mode: "advisory",
    memoryPath: ".changeplane/assurance.md",
    maxFindings: 2,
  });
  for (const policyPath of [
    new URL("./fixtures/runtime-luna.json", import.meta.url),
    new URL("./fixtures/runtime-review-disabled.json", import.meta.url),
  ]) {
    let called = false;
    const job = await proposeReviewJob({
      event,
      githubToken,
      openaiApiKey,
      policyPath,
      fetchImpl: async () => { called = true; },
    });
    assert.equal(job.state, REVIEW_JOB_STATE.DISABLED);
    assert.equal(called, false);
  }
});

test("fork pull requests are rejected before GitHub or OpenAI access", async () => {
  let called = false;
  await assert.rejects(proposeReviewJob({
    event: {
      ...event,
      pull_request: {
        ...event.pull_request,
        head: { ...event.pull_request.head, repo: { full_name: "outside/fork" } },
      },
    },
    githubToken,
    openaiApiKey,
    policyPath: new URL("./fixtures/runtime-review.json", import.meta.url),
    fetchImpl: async () => { called = true; },
  }), /same-repository pull requests only/u);
  assert.equal(called, false);
});

test("a missing optional trusted-base assurance file does not block advisory review", async () => {
  let memoryRequests = 0;
  const job = await proposeReviewJob({
    event,
    githubToken,
    openaiApiKey,
    policyPath: new URL("./fixtures/runtime-review.json", import.meta.url),
    fetchImpl: async (url, options) => {
      const target = String(url);
      if (target.includes("/contents/.changeplane/assurance.md?ref=")) {
        memoryRequests += 1;
        assert.match(target, new RegExp(`ref=${baseSha}$`, "u"));
        return json({ message: "not found and body must stay redacted" }, { status: 404 });
      }
      if (target.startsWith("https://api.github.com/")) return githubReadResponse(target, options);
      return openAIResponse({ headSha, findings: [finding] });
    },
  });
  assert.equal(memoryRequests, 1);
  assert.equal(job.state, REVIEW_JOB_STATE.REVIEWED);

  await assert.rejects(proposeReviewJob({
    event,
    githubToken,
    openaiApiKey,
    policyPath: new URL("./fixtures/runtime-review.json", import.meta.url),
    fetchImpl: async (url, options) => {
      const target = String(url);
      if (target.includes("/contents/.changeplane/assurance.md?ref=")) {
        return json({ message: "upstream-secret" }, { status: 500 });
      }
      return githubReadResponse(target, options);
    },
  }), (error) => /rejected the request \(500\)/u.test(error.message) && !error.message.includes("upstream-secret"));
});

test("review job transport is bounded, strict, and cannot carry PASS authority", async () => {
  const notConfigured = await proposeReviewJob({ event, openaiApiKey: "" });
  const encoded = encodeReviewJob(notConfigured);
  assert.deepEqual(decodeReviewJob(encoded), notConfigured);
  assert.throws(() => decodeReviewJob(`${encoded}=`), /invalid or oversized/u);
  assert.throws(() => encodeReviewJob({
    ...notConfigured,
    state: REVIEW_JOB_STATE.REVIEWED,
    review: { authority: "PASS", headSha, findings: [] },
  }), /advisory review is invalid/u);
  assert.throws(() => encodeReviewJob({ ...notConfigured, decision: "PASS" }), /review job is invalid/u);
});

test("PUBLISH re-fetches the exact diff and creates only a neutral advisory Check", async () => {
  const reviewed = {
    version: 1,
    state: REVIEW_JOB_STATE.REVIEWED,
    pullRequestNumber: 42,
    baseSha,
    headSha,
    review: { authority: "ADVISORY_ONLY", headSha, findings: [finding] },
  };
  let checkPayload;
  const result = await publishReviewJob({
    event,
    encodedJob: encodeReviewJob(reviewed),
    githubToken,
    fetchImpl: async (url, options) => {
      const target = String(url);
      assert.equal(target.startsWith("https://api.openai.com"), false);
      if (target.endsWith("/check-runs")) {
        assert.equal(options.method, "POST");
        checkPayload = JSON.parse(options.body);
        return json({ id: 9001 });
      }
      return githubReadResponse(target, options);
    },
  });
  assert.deepEqual(result, {
    checkId: 9001,
    conclusion: "neutral",
    headSha,
    state: REVIEW_JOB_STATE.REVIEWED,
  });
  assert.equal(checkPayload.name, REVIEW_CHECK_NAME);
  assert.equal(checkPayload.head_sha, headSha);
  assert.equal(checkPayload.conclusion, "neutral");
  assert.equal(checkPayload.output.annotations.length, 1);
  assert.equal(checkPayload.output.annotations[0].path, finding.path);
  assert.match(checkPayload.output.summary, /cannot approve, merge, repair, or publish PASS/u);
  assert.equal("actions" in checkPayload, false);
});

test("PUBLISH shows missing OpenAI configuration neutrally", async () => {
  const job = await proposeReviewJob({
    event,
    openaiApiKey: "",
    policyPath: new URL("./fixtures/runtime-review.json", import.meta.url),
  });
  let checkPayload;
  await publishReviewJob({
    event,
    encodedJob: encodeReviewJob(job),
    githubToken,
    fetchImpl: async (url, options) => {
      if (String(url).endsWith("/check-runs")) {
        checkPayload = JSON.parse(options.body);
        return json({ id: 9002 });
      }
      return githubReadResponse(String(url), options);
    },
  });
  assert.equal(checkPayload.conclusion, "neutral");
  assert.match(checkPayload.output.title, /not configured/u);
  assert.match(checkPayload.output.summary, /does not approve/u);
  assert.deepEqual(checkPayload.output.annotations, []);
});

test("neutral publisher states verify the revision without rejecting a diff over 40 files", async () => {
  const job = await proposeReviewJob({
    event,
    openaiApiKey,
    policyPath: new URL("./fixtures/runtime-review-disabled.json", import.meta.url),
  });
  let checkPayload;
  const result = await publishReviewJob({
    event,
    encodedJob: encodeReviewJob(job),
    githubToken,
    fetchImpl: async (url, options) => {
      const target = String(url);
      if (target.endsWith("/pulls/42")) return githubReadResponse(target, options);
      if (target.includes("/pulls/42/files?per_page=41")) {
        return json(Array.from({ length: 41 }, (_, index) => ({
          filename: `src/file-${index}.js`,
          patch: "@@ -0,0 +1 @@\n+added",
        })));
      }
      if (target.endsWith("/check-runs")) {
        checkPayload = JSON.parse(options.body);
        return json({ id: 9003 });
      }
      assert.fail(`Unexpected request: ${target}`);
    },
  });
  assert.equal(result.state, REVIEW_JOB_STATE.DISABLED);
  assert.equal(checkPayload.conclusion, "neutral");
  assert.match(checkPayload.output.title, /disabled/u);
});

test("PUBLISH rejects stale heads and off-diff findings before creating a Check", async () => {
  const reviewed = {
    version: 1,
    state: REVIEW_JOB_STATE.REVIEWED,
    pullRequestNumber: 42,
    baseSha,
    headSha,
    review: { authority: "ADVISORY_ONLY", headSha, findings: [finding] },
  };
  let posts = 0;
  await assert.rejects(publishReviewJob({
    event,
    encodedJob: encodeReviewJob(reviewed),
    githubToken,
    fetchImpl: async (url, options) => {
      if (options.method === "POST") posts += 1;
      return githubReadResponse(String(url), options, { stale: true });
    },
  }), /stale for the current pull request revision/u);

  const offDiff = structuredClone(reviewed);
  offDiff.review.findings[0].line = 99;
  await assert.rejects(publishReviewJob({
    event,
    encodedJob: encodeReviewJob(offDiff),
    githubToken,
    fetchImpl: async (url, options) => {
      if (options.method === "POST") posts += 1;
      return githubReadResponse(String(url), options);
    },
  }), /outside the changed diff/u);
  assert.equal(posts, 0);
});

test("GitHub failures stay status-only and body-redacted", async () => {
  const job = await proposeReviewJob({ event, openaiApiKey: "" });
  await assert.rejects(publishReviewJob({
    event,
    encodedJob: encodeReviewJob(job),
    githubToken,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      async text() { return "github-reflected-secret"; },
    }),
  }), (error) => /rejected the request \(403\)/u.test(error.message) && !error.message.includes("github-reflected-secret"));

  await assert.rejects(publishReviewJob({
    event,
    encodedJob: encodeReviewJob(job),
    githubToken,
    fetchImpl: async () => { throw new Error("network-secret"); },
  }), (error) => /temporarily unavailable/u.test(error.message) && !error.message.includes("network-secret"));
});

test("CLI publisher environment excludes OpenAI and writes underscore outputs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "changeplane-review-"));
  const eventPath = join(directory, "event.json");
  const outputPath = join(directory, "output.txt");
  writeFileSync(eventPath, JSON.stringify(event));
  writeFileSync(outputPath, "");
  const job = await proposeReviewJob({
    event,
    openaiApiKey,
    policyPath: new URL("./fixtures/runtime-review-disabled.json", import.meta.url),
  });
  const env = {
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: outputPath,
    GITHUB_TOKEN: githubToken,
    CHANGEPLANE_REVIEW_JOB: encodeReviewJob(job),
  };
  assert.equal("OPENAI_API_KEY" in env, false);
  await runCli({
    argv: ["node", "changeplane-review-run.js", "publish"],
    env,
    fetchImpl: async (url, options) => {
      if (String(url).endsWith("/check-runs")) return json({ id: 9004 });
      return githubReadResponse(String(url), options);
    },
  });
  assert.equal(readFileSync(outputPath, "utf8"), "review_check_id=9004\nreview_state=disabled\n");
});
