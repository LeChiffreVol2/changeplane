import assert from "node:assert/strict";
import test from "node:test";

import {
  BYOK_SECRET_NAME,
  DEFAULT_PROPOSAL_MODEL,
  PROPOSAL_REASONING_EFFORT,
  RUNTIME_PROVIDER,
  SUPPORTED_PROPOSAL_MODELS,
  proposalModel,
} from "./runtime.js";

test("GPT-5.6 runtime defaults stay explicit and allowlisted", () => {
  assert.equal(RUNTIME_PROVIDER, "openai");
  assert.equal(DEFAULT_PROPOSAL_MODEL, "gpt-5.6-luna");
  assert.equal(PROPOSAL_REASONING_EFFORT, "high");
  assert.equal(BYOK_SECRET_NAME, "OPENAI_API_KEY");
  assert.deepEqual(SUPPORTED_PROPOSAL_MODELS, [
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol",
  ]);
});

test("proposal model validation rejects unsupported values", () => {
  assert.equal(proposalModel(), "gpt-5.6-luna");
  assert.equal(proposalModel("gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(proposalModel("gpt-5.6-sol"), "gpt-5.6-sol");
  for (const value of ["gpt-5.6", "deepseek-v4-flash", "gpt-5.6-luna\n", ""]) {
    assert.throws(() => proposalModel(value), /Luna, Terra, or Sol/u);
  }
});
