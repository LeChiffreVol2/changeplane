import { matchesPathRule, normalizeRepoPath } from "./changeplane.js";

export const RUNTIME_PROVIDER = "openai";
export const DEFAULT_PROPOSAL_MODEL = "gpt-5.6-luna";
export const PROPOSAL_REASONING_EFFORT = "high";
export const BYOK_SECRET_NAME = "OPENAI_API_KEY";
const MAX_PATCH_BYTES = 256 * 1024;
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

function utf8Length(value) {
  return new TextEncoder().encode(value).byteLength;
}

function boundedPatchRules(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error("A repair proposal requires 1–50 allowed path rules.");
  }
  return value.map((rule) => {
    if (typeof rule !== "string") {
      throw new Error("Every allowed path rule must be a string.");
    }
    const candidate = rule.trim();
    const isPrefix = candidate.endsWith("/**");
    const base = isPrefix ? candidate.slice(0, -3) : candidate;
    if (base.includes("*") || (candidate.includes("/**") && !isPrefix)) {
      throw new Error("Only exact paths and terminal /** rules are supported.");
    }
    const normalized = normalizeRepoPath(base);
    return isPrefix ? `${normalized}/**` : normalized;
  });
}

/**
 * Validate the provider's raw patch before a controller can write it anywhere.
 * The caller supplies its trusted evidence-control predicate so this pure
 * boundary can be reused by the installed harness and the public Assurance Lab.
 */
export function validateBoundedPatchProposal(value, rules, { isProtectedPath = () => false } = {}) {
  if (typeof isProtectedPath !== "function") {
    throw new TypeError("isProtectedPath must be a function");
  }
  const content = String(value ?? "").trim();
  const fenced = content.match(/^```(?:diff)?\n([\s\S]*?)\n```$/u);
  const patch = (fenced ? fenced[1] : content).trim();
  if (!patch || utf8Length(patch) > MAX_PATCH_BYTES || patch.includes("\0") || patch.includes("\r")) {
    throw new Error("The proposal patch is empty or exceeds the bounded patch format.");
  }
  if (!patch.startsWith("diff --git ") || /^\*\*\* (?:Begin|End) Patch$/mu.test(patch)) {
    throw new Error("The proposal must contain only a unified Git patch.");
  }
  if (/^(?:new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|copy from|copy to|GIT binary patch|Binary files )/mu.test(patch)) {
    throw new Error("Repair proposals may modify existing text files only.");
  }

  const allowed = boundedPatchRules(rules);
  const sections = patch.split(/(?=^diff --git )/mu).filter(Boolean);
  const paths = [];
  for (const section of sections) {
    const lineEnd = section.indexOf("\n");
    const firstLine = section.slice(0, lineEnd === -1 ? undefined : lineEnd);
    const match = firstLine.match(/^diff --git a\/([^\s]+) b\/([^\s]+)$/u);
    if (!match || match[1] !== match[2]) {
      throw new Error("Repair proposals cannot add, delete, copy, or rename files.");
    }
    const filePath = normalizeRepoPath(match[1]);
    if (paths.includes(filePath)) throw new Error(`The proposal repeats a patch section for ${filePath}.`);
    if (!allowed.some((rule) => matchesPathRule(filePath, rule))) {
      throw new Error(`The proposal edits a path outside its repair grant: ${filePath}.`);
    }
    if (isProtectedPath(filePath)) {
      throw new Error(`The proposal edits protected evidence or test control: ${filePath}.`);
    }
    if (!section.includes(`\n--- a/${filePath}\n+++ b/${filePath}\n`) || !/^@@ /mu.test(section)) {
      throw new Error(`The proposal for ${filePath} is not a standard text modification patch.`);
    }
    paths.push(filePath);
  }
  if (paths.length === 0) throw new Error("The proposal patch contains no file modifications.");
  return { patch: `${patch}\n`, paths };
}
