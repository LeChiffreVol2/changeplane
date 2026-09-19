import { DEFAULT_PROPOSAL_MODEL } from "../src/lib/runtime.js";
import { requestOpenAIResponse } from "./changeplane-openai-response.js";

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

export async function requestOpenAIProposal({
  apiKey,
  model = DEFAULT_PROPOSAL_MODEL,
  messages,
  fetchImpl = fetch,
  onResponseMetadata,
}) {
  const content = await requestOpenAIResponse({
    purpose: "proposal", apiKey, model, messages, format: PATCH_FORMAT, fetchImpl, onResponseMetadata,
  });
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
