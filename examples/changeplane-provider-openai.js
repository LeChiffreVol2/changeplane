import { Buffer } from "node:buffer";

import {
  DEFAULT_PROPOSAL_MODEL,
  PROPOSAL_REASONING_EFFORT,
  proposalModel,
} from "../src/lib/runtime.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_OUTPUT_TOKENS = 16_384;
const INVALID_RESPONSE = "The proposal provider returned an empty or oversized response.";
const PATCH_FORMAT = Object.freeze({
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
});

async function boundedResponseText(response) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error(INVALID_RESPONSE);
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (!raw || Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error(INVALID_RESPONSE);
    return raw;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      try { await reader.cancel(); } catch { /* keep provider errors redacted */ }
      throw new Error(INVALID_RESPONSE);
    }
    chunks.push(Buffer.from(value));
  }
  if (bytes === 0) throw new Error(INVALID_RESPONSE);
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function responseOutputText(payload) {
  if (payload?.status !== "completed" || !Array.isArray(payload?.output)) return "";
  return payload.output
    .filter((item) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((part) => part?.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export async function requestOpenAIProposal({
  apiKey,
  model = DEFAULT_PROPOSAL_MODEL,
  messages,
  fetchImpl = fetch,
  onResponseMetadata,
}) {
  if (typeof apiKey !== "string" || apiKey.length < 20 || /[\s\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw new Error("A valid proposal provider credential is required.");
  }
  const selectedModel = proposalModel(model);
  if (!Array.isArray(messages) || messages.length !== 2) throw new Error("The proposal prompt is invalid.");

  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        instructions: messages[0].content,
        input: messages[1].content,
        reasoning: { effort: PROPOSAL_REASONING_EFFORT },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: { format: PATCH_FORMAT },
        store: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error("The proposal provider is temporarily unavailable.");
  }
  if (!response.ok) throw new Error(`The proposal provider rejected the request (${response.status}).`);
  let raw;
  try {
    raw = await boundedResponseText(response);
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_RESPONSE) throw error;
    throw new Error("The proposal provider is temporarily unavailable.");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("The proposal provider returned invalid JSON.");
  }
  if (typeof onResponseMetadata === "function") {
    onResponseMetadata({
      model: selectedModel,
      requestId: response.headers?.get?.("x-request-id") ?? null,
      status: payload?.status === "completed" ? "completed" : "incomplete",
    });
  }
  if (payload?.status !== "completed") {
    throw new Error("The proposal provider returned an incomplete response.");
  }
  const content = responseOutputText(payload);
  if (!content) throw new Error("The proposal provider returned no patch proposal.");
  let envelope;
  try {
    envelope = JSON.parse(content);
  } catch {
    throw new Error("The proposal provider returned a malformed patch envelope.");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
    || Object.keys(envelope).length !== 1 || typeof envelope.patch !== "string") {
    throw new Error("The proposal provider returned a malformed patch envelope.");
  }
  return envelope.patch;
}
