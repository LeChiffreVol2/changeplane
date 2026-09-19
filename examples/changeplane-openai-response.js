import { Buffer } from "node:buffer";
import { PROPOSAL_REASONING_EFFORT, proposalModel } from "../src/lib/runtime.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const RESPONSE_LIMITS = Object.freeze({
  proposal: { bytes: 512 * 1024, tokens: 16_384, empty: "patch proposal" },
  review: { bytes: 128 * 1024, tokens: 4_096, empty: "review envelope" },
});

async function boundedResponseText(response, maximumBytes, invalidResponse) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) throw invalidResponse;
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (!raw || Buffer.byteLength(raw) > maximumBytes) throw invalidResponse;
    return raw;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      try { await reader.cancel(); } catch { /* keep provider errors redacted */ }
      throw invalidResponse;
    }
    chunks.push(Buffer.from(value));
  }
  if (bytes === 0) throw invalidResponse;
  return Buffer.concat(chunks, bytes).toString("utf8");
}

/** Bounded transport only. Proposal and advisory-review adapters validate their own envelopes. */
export async function requestOpenAIResponse({
  purpose,
  apiKey,
  model,
  messages,
  format,
  fetchImpl = fetch,
  onResponseMetadata,
}) {
  if (!Object.hasOwn(RESPONSE_LIMITS, purpose)) throw new Error("The model response purpose is invalid.");
  const limits = RESPONSE_LIMITS[purpose];
  const provider = `The ${purpose} provider`;
  if (typeof apiKey !== "string" || apiKey.length < 20 || /[\s\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw new Error(`A valid ${purpose} provider credential is required.`);
  }
  const selectedModel = proposalModel(model);
  if (!Array.isArray(messages) || messages.length !== 2) throw new Error(`The ${purpose} prompt is invalid.`);
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
        max_output_tokens: limits.tokens,
        text: { format },
        store: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error(`${provider} is temporarily unavailable.`);
  }
  if (!response.ok) throw new Error(`${provider} rejected the request (${response.status}).`);
  const invalidResponse = new Error(`${provider} returned an empty or oversized response.`);
  let raw;
  try {
    raw = await boundedResponseText(response, limits.bytes, invalidResponse);
  } catch (error) {
    if (error === invalidResponse) throw error;
    throw new Error(`${provider} is temporarily unavailable.`);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${provider} returned invalid JSON.`);
  }
  if (typeof onResponseMetadata === "function") {
    onResponseMetadata({
      model: selectedModel,
      requestId: response.headers?.get?.("x-request-id") ?? null,
      status: payload?.status === "completed" ? "completed" : "incomplete",
    });
  }
  if (payload?.status !== "completed") throw new Error(`${provider} returned an incomplete response.`);
  const content = (Array.isArray(payload.output) ? payload.output : [])
    .filter((item) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content)
    .filter((part) => part?.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  if (!content) throw new Error(`${provider} returned no ${limits.empty}.`);
  if (content.includes(apiKey)) throw new Error(`${provider} returned unsafe credential material.`);
  return content;
}
