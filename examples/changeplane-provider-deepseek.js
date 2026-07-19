const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const MAX_RESPONSE_BYTES = 512 * 1024;
const INVALID_RESPONSE = "The proposal provider returned an empty or oversized response.";

function proposalModel(value) {
  const model = String(value ?? DEFAULT_MODEL).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u.test(model)) {
    throw new Error("The proposal model identifier is invalid.");
  }
  return model;
}

async function boundedResponseText(response) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(INVALID_RESPONSE);
  }
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (!raw || Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
      throw new Error(INVALID_RESPONSE);
    }
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
      try { await reader.cancel(); } catch { /* keep the provider error redacted */ }
      throw new Error(INVALID_RESPONSE);
    }
    chunks.push(Buffer.from(value));
  }
  if (bytes === 0) throw new Error(INVALID_RESPONSE);
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export async function requestDeepSeekProposal({
  apiKey,
  model = DEFAULT_MODEL,
  messages,
  fetchImpl = fetch,
}) {
  if (typeof apiKey !== "string" || apiKey.length < 20 || /[\s\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw new Error("A valid proposal provider credential is required.");
  }
  const selectedModel = proposalModel(model);
  let response;
  try {
    response = await fetchImpl(DEEPSEEK_CHAT_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        max_tokens: 4_096,
        stream: false,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error("The proposal provider is temporarily unavailable.");
  }
  if (!response.ok) {
    throw new Error(`The proposal provider rejected the request (${response.status}).`);
  }
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
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("The proposal provider returned no patch proposal.");
  return content;
}
