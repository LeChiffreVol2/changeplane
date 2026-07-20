export const RUNTIME_PROVIDER = "openai";
export const DEFAULT_PROPOSAL_MODEL = "gpt-5.6-luna";
export const PROPOSAL_REASONING_EFFORT = "high";
export const BYOK_SECRET_NAME = "OPENAI_API_KEY";
export const SUPPORTED_PROPOSAL_MODELS = Object.freeze([
  DEFAULT_PROPOSAL_MODEL,
  "gpt-5.6-terra",
  "gpt-5.6-sol",
]);

export function proposalModel(value = DEFAULT_PROPOSAL_MODEL) {
  const model = String(value ?? "");
  if (!SUPPORTED_PROPOSAL_MODELS.includes(model)) {
    throw new TypeError("The proposal model must be GPT-5.6 Luna, Terra, or Sol.");
  }
  return model;
}
