import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from "node:crypto";

import { matchesPathRule, normalizeRepoPath } from "../src/lib/changeplane.js";

const DOMAIN = "changeplane:repair-ledger:v2\0";
const BUDGET_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 2;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const { RSA_PKCS1_PSS_PADDING, RSA_PSS_SALTLEN_DIGEST } = constants;
const ENTRY_KEYS = [
  "allowedPaths",
  "attempt",
  "authorizationId",
  "baseRef",
  "baseSha",
  "campaignId",
  "contractDigest",
  "controllerSha",
  "deadlineAt",
  "declaredScope",
  "firstIssuedAt",
  "generation",
  "headRef",
  "headRepository",
  "headSha",
  "inputDigest",
  "instructions",
  "issuedAt",
  "issuer",
  "maxAttempts",
  "nonce",
  "policyDigest",
  "priorEntryDigest",
  "protectedPaths",
  "pullRequestNumber",
  "repairKind",
  "repository",
  "schemaVersion",
  "evaluatorVersion",
].sort();
const RESERVED_REPAIR_RULES = [".github/**", ".changeplane.json", "changeplane/**"];

function plainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const actual = Object.keys(plainObject(value, name)).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`${name} contains an unknown or missing field`);
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Repair ledger values must be JSON-compatible");
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function publicKeyObject(key) {
  const publicKey = key?.type === "public"
    ? key
    : typeof key === "string" && !key.includes("BEGIN")
      ? createPublicKey({ key: Buffer.from(key, "base64"), type: "spki", format: "der" })
      : createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "rsa") throw new TypeError("Repair ledger keys must be RSA keys");
  return publicKey;
}

export function repairLedgerKeyId(key) {
  const der = publicKeyObject(key).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

export function repairLedgerPublicKeyValue(key) {
  return publicKeyObject(key).export({ type: "spki", format: "der" }).toString("base64");
}

function signedBytes(entry) {
  return Buffer.from(`${DOMAIN}${canonicalJson(entry)}`);
}

function dateMs(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error(`${name} must be an exact UTC timestamp`);
  }
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`${name} must be a valid timestamp`);
  return result;
}

function validDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function validateRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(value)) {
    throw new Error("Repair ledger repository is invalid");
  }
}

function validateRule(rule) {
  if (typeof rule !== "string" || rule.length > 300) throw new Error("Repair path rule is invalid");
  const prefix = rule.endsWith("/**") ? rule.slice(0, -3) : rule;
  if (prefix.includes("*")) throw new Error("Repair path rule is invalid");
  if (normalizeRepoPath(prefix) !== prefix) throw new Error("Repair path rule is not normalized");
}

function validateRules(rules, name, { allowEmpty = false } = {}) {
  const minimum = allowEmpty ? 0 : 1;
  if (!Array.isArray(rules) || rules.length < minimum || rules.length > 50 || new Set(rules).size !== rules.length) {
    throw new Error(`${name} must contain ${minimum}-50 unique paths`);
  }
  rules.forEach(validateRule);
}

function rulesOverlap(left, right) {
  const leftPrefix = left.endsWith("/**");
  const rightPrefix = right.endsWith("/**");
  if (!leftPrefix && !rightPrefix) return left === right;
  if (leftPrefix && !rightPrefix) return matchesPathRule(right, left);
  if (!leftPrefix && rightPrefix) return matchesPathRule(left, right);
  const leftRoot = left.slice(0, -3);
  const rightRoot = right.slice(0, -3);
  return leftRoot === rightRoot || leftRoot.startsWith(`${rightRoot}/`) || rightRoot.startsWith(`${leftRoot}/`);
}

function validateRef(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._/-]{1,255}$/u.test(value)
    || value.startsWith("/") || value.endsWith("/") || value.endsWith(".lock")
    || value.includes("..") || value.includes("//")) {
    throw new Error(`${name} is invalid`);
  }
}

function validateInstructions(entry) {
  const { instructions } = entry;
  if (!Array.isArray(instructions) || instructions.length < 1 || instructions.length > 50) {
    throw new Error("Repair instructions must contain 1-50 items");
  }
  for (const instruction of instructions) {
    plainObject(instruction, "Repair instruction");
    if (typeof instruction.code !== "string" || typeof instruction.path !== "string" || typeof instruction.pathKind !== "string") {
      throw new Error("Repair instruction is incomplete");
    }
    if (entry.repairKind === "evidence") {
      if (instruction.action !== "RESTORE_FAILED_EVIDENCE_WITHIN_DECLARED_SCOPE" || !/^check:[^\s]{1,200}$/u.test(instruction.path)) {
        throw new Error("Evidence repair instruction is invalid");
      }
    } else if (instruction.action !== "REVERT_OR_MOVE_INTO_DECLARED_SCOPE" || normalizeRepoPath(instruction.path) !== instruction.path) {
      throw new Error("Scope repair instruction is invalid");
    }
  }
  if (entry.repairKind === "evidence") {
    if (canonicalJson(entry.allowedPaths) !== canonicalJson(entry.declaredScope)) {
      throw new Error("Evidence repair may edit only the declared scope");
    }
  } else {
    const instructionPaths = [...new Set(instructions.map(({ path }) => path))];
    if (canonicalJson(entry.allowedPaths) !== canonicalJson(instructionPaths)) {
      throw new Error("Scope repair paths must exactly match the signed instructions");
    }
  }
}

export function validateRepairLedgerEntry(entry, {
  now = Date.now(),
  expectedRepository,
  expectedPullRequestNumber,
  expectedContractDigest,
  expectedGeneration,
  expectedHeadSha,
  expectedBaseRef,
  expectedControllerSha,
  allowExpired = false,
} = {}) {
  exactKeys(entry, ENTRY_KEYS, "Repair ledger entry");
  if (entry.schemaVersion !== 2 || entry.issuer !== "changeplane-guard") throw new Error("Repair ledger schema or issuer is invalid");
  for (const [name, value] of [
    ["campaignId", entry.campaignId],
    ["authorizationId", entry.authorizationId],
    ["contractDigest", entry.contractDigest],
    ["inputDigest", entry.inputDigest],
    ["policyDigest", entry.policyDigest],
    ["nonce", entry.nonce],
  ]) if (!validDigest(value)) throw new Error(`${name} is invalid`);
  if (entry.priorEntryDigest !== null && !validDigest(entry.priorEntryDigest)) throw new Error("priorEntryDigest is invalid");
  validateRepository(entry.repository);
  if (entry.headRepository !== entry.repository) throw new Error("Cross-repository repair is forbidden");
  if (!Number.isSafeInteger(entry.pullRequestNumber) || entry.pullRequestNumber < 1) throw new Error("pullRequestNumber is invalid");
  if (!validSha(entry.baseSha) || !validSha(entry.headSha) || !validSha(entry.controllerSha)) throw new Error("Repair ledger revision is invalid");
  validateRef(entry.baseRef, "Repair ledger base ref");
  validateRef(entry.headRef, "Repair ledger head ref");
  if (typeof entry.evaluatorVersion !== "string" || !/^[A-Za-z0-9._-]{1,64}$/u.test(entry.evaluatorVersion)) {
    throw new Error("Repair ledger evaluator version is invalid");
  }
  if (!Number.isSafeInteger(entry.generation) || entry.generation < 1) throw new Error("Repair ledger generation is invalid");
  if (![1, 2].includes(entry.attempt) || entry.maxAttempts !== MAX_ATTEMPTS) throw new Error("Repair ledger attempt is invalid");
  if (!['scope', 'evidence'].includes(entry.repairKind)) throw new Error("Repair kind is invalid");
  validateRules(entry.declaredScope, "declaredScope");
  validateRules(entry.allowedPaths, "allowedPaths");
  validateRules(entry.protectedPaths, "protectedPaths", { allowEmpty: true });
  const protectedPaths = [...RESERVED_REPAIR_RULES, ...entry.protectedPaths];
  if (entry.allowedPaths.some((allowed) => protectedPaths.some((protectedPath) => rulesOverlap(allowed, protectedPath)))) {
    throw new Error("Repair grant overlaps a protected or reserved path");
  }
  validateInstructions(entry);

  const firstIssuedAt = dateMs(entry.firstIssuedAt, "firstIssuedAt");
  const issuedAt = dateMs(entry.issuedAt, "issuedAt");
  const deadlineAt = dateMs(entry.deadlineAt, "deadlineAt");
  if (deadlineAt - firstIssuedAt !== BUDGET_MS || issuedAt < firstIssuedAt || issuedAt >= deadlineAt) {
    throw new Error("Repair ledger deadline is invalid");
  }
  if (entry.attempt === 1 && (issuedAt !== firstIssuedAt || entry.priorEntryDigest !== null)) {
    throw new Error("First repair attempt must start the campaign");
  }
  if (entry.attempt === 2 && entry.priorEntryDigest === null) throw new Error("Second repair attempt must continue the signed ledger");
  if (!Number.isFinite(now) || issuedAt > now + MAX_CLOCK_SKEW_MS) throw new Error("Repair ledger entry is issued in the future");
  if (!allowExpired && now >= deadlineAt) throw new Error("Repair ledger campaign is expired");

  if (expectedRepository != null && entry.repository !== expectedRepository) throw new Error("Repair ledger repository does not match");
  if (expectedPullRequestNumber != null && entry.pullRequestNumber !== expectedPullRequestNumber) throw new Error("Repair ledger pull request does not match");
  if (expectedContractDigest != null && entry.contractDigest !== expectedContractDigest) throw new Error("Repair ledger contract does not match");
  if (expectedGeneration != null && entry.generation !== expectedGeneration) throw new Error("Repair ledger kill-switch generation does not match");
  if (expectedHeadSha != null && entry.headSha !== expectedHeadSha) throw new Error("Repair ledger head does not match");
  if (expectedBaseRef != null && entry.baseRef !== expectedBaseRef) throw new Error("Repair ledger base ref does not match");
  if (expectedControllerSha != null && entry.controllerSha !== expectedControllerSha) throw new Error("Repair ledger controller revision does not match");
  return entry;
}

export function signRepairLedgerEntry(entry, privateKey) {
  validateRepairLedgerEntry(entry, { now: Date.parse(entry.issuedAt), allowExpired: true });
  const key = privateKey?.type === "private" ? privateKey : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "rsa") throw new TypeError("Repair ledger signing key must be RSA");
  const publicKey = createPublicKey(key);
  const signature = sign("sha256", signedBytes(entry), {
    key,
    padding: RSA_PKCS1_PSS_PADDING,
    saltLength: RSA_PSS_SALTLEN_DIGEST,
  });
  return {
    schemaVersion: 1,
    entry,
    signature: {
      algorithm: "PS256",
      keyId: repairLedgerKeyId(publicKey),
      value: signature.toString("base64url"),
    },
  };
}

export function verifyRepairLedgerEnvelope(envelope, publicKeys, options = {}) {
  exactKeys(envelope, ["entry", "schemaVersion", "signature"], "Repair ledger envelope");
  exactKeys(envelope.signature, ["algorithm", "keyId", "value"], "Repair ledger signature");
  if (envelope.schemaVersion !== 1 || envelope.signature.algorithm !== "PS256" || !validDigest(envelope.signature.keyId)) {
    throw new Error("Repair ledger signature metadata is invalid");
  }
  const publicKeyValue = publicKeys instanceof Map
    ? publicKeys.get(envelope.signature.keyId)
    : plainObject(publicKeys, "Repair ledger public keys")[envelope.signature.keyId];
  if (!publicKeyValue) throw new Error("Repair ledger signing key is not trusted");
  const publicKey = publicKeyObject(publicKeyValue);
  if (repairLedgerKeyId(publicKey) !== envelope.signature.keyId) throw new Error("Repair ledger key ID does not match the public key");
  if (typeof envelope.signature.value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(envelope.signature.value)) {
    throw new Error("Repair ledger signature value is invalid");
  }
  const valid = verify("sha256", signedBytes(envelope.entry), {
    key: publicKey,
    padding: RSA_PKCS1_PSS_PADDING,
    saltLength: RSA_PSS_SALTLEN_DIGEST,
  }, Buffer.from(envelope.signature.value, "base64url"));
  if (!valid) throw new Error("Repair ledger signature verification failed");
  return validateRepairLedgerEntry(envelope.entry, options);
}

export function repairLedgerEntryDigest(envelope) {
  return digest(envelope);
}

export function reduceVerifiedRepairLedger(envelopes, publicKeys, options = {}) {
  if (!Array.isArray(envelopes)) throw new TypeError("Repair ledger must be an array");
  if (envelopes.length === 0) return { attemptsUsed: 0, deadlineAt: null, tipDigest: null, campaignId: null, entries: [] };
  if (envelopes.length > MAX_ATTEMPTS) throw new Error("Repair ledger exceeds the attempt budget");

  const entries = envelopes.map((envelope) => ({
    envelope,
    entry: verifyRepairLedgerEnvelope(envelope, publicKeys, options),
    digest: repairLedgerEntryDigest(envelope),
  }));
  const first = entries.find(({ entry }) => entry.attempt === 1 && entry.priorEntryDigest === null);
  if (!first) throw new Error("Repair ledger has no valid first attempt");
  const campaign = first.entry;
  const seenNonces = new Set();
  const seenAuthorizations = new Set();
  for (const { entry } of entries) {
    for (const field of ["campaignId", "repository", "pullRequestNumber", "contractDigest", "policyDigest", "evaluatorVersion", "baseRef", "controllerSha", "firstIssuedAt", "deadlineAt", "generation"]) {
      if (entry[field] !== campaign[field]) throw new Error("Repair ledger campaign fork detected");
    }
    if (canonicalJson(entry.protectedPaths) !== canonicalJson(campaign.protectedPaths)) throw new Error("Repair ledger protected-path policy changed");
    if (seenNonces.has(entry.nonce) || seenAuthorizations.has(entry.authorizationId)) throw new Error("Repair ledger replay detected");
    seenNonces.add(entry.nonce);
    seenAuthorizations.add(entry.authorizationId);
  }

  const ordered = [first];
  while (ordered.length < entries.length) {
    const tip = ordered.at(-1);
    const next = entries.filter(({ entry }) => entry.priorEntryDigest === tip.digest);
    if (next.length !== 1) throw new Error("Repair ledger is forked or has a gap");
    if (next[0].entry.attempt !== ordered.length + 1) throw new Error("Repair ledger attempts are not monotonic");
    ordered.push(next[0]);
  }
  if (new Set(ordered.map(({ digest: value }) => value)).size !== entries.length) throw new Error("Repair ledger contains an unattached entry");
  return {
    attemptsUsed: ordered.length,
    deadlineAt: campaign.deadlineAt,
    tipDigest: ordered.at(-1).digest,
    campaignId: campaign.campaignId,
    entries: ordered.map(({ entry }) => entry),
  };
}

function randomDigest() {
  return randomBytes(32).toString("hex");
}

export async function issueRepairGrant({
  ledger,
  candidate,
  privateKey,
  publicKeys,
  generation,
  enabled,
  publishEntry,
  readEntries,
  now = new Date(),
  randomId = randomDigest,
}) {
  if (enabled !== true) throw new Error("Repair dispatch kill switch is off");
  if (typeof publishEntry !== "function" || typeof readEntries !== "function") throw new TypeError("Repair ledger persistence functions are required");
  const issuedAt = new Date(now);
  if (Number.isNaN(issuedAt.getTime())) throw new TypeError("now must be a valid date");
  const state = reduceVerifiedRepairLedger(ledger, publicKeys, {
    now: issuedAt.getTime(),
    expectedRepository: candidate.repository,
    expectedPullRequestNumber: candidate.pullRequestNumber,
    expectedContractDigest: candidate.contractDigest,
    expectedGeneration: generation,
  });
  if (state.attemptsUsed >= MAX_ATTEMPTS) throw new Error("Repair ledger attempt budget is exhausted");

  const firstIssuedAt = state.attemptsUsed === 0 ? issuedAt.toISOString() : state.entries[0].firstIssuedAt;
  const deadlineAt = state.attemptsUsed === 0
    ? new Date(issuedAt.getTime() + BUDGET_MS).toISOString()
    : state.deadlineAt;
  const entry = {
    schemaVersion: 2,
    issuer: "changeplane-guard",
    campaignId: state.campaignId ?? randomId(),
    generation,
    authorizationId: randomId(),
    repository: candidate.repository,
    pullRequestNumber: candidate.pullRequestNumber,
    contractDigest: candidate.contractDigest,
    policyDigest: candidate.policyDigest,
    evaluatorVersion: candidate.evaluatorVersion,
    inputDigest: candidate.inputDigest,
    firstIssuedAt,
    issuedAt: issuedAt.toISOString(),
    deadlineAt,
    attempt: state.attemptsUsed + 1,
    maxAttempts: MAX_ATTEMPTS,
    baseRef: candidate.baseRef,
    baseSha: candidate.baseSha,
    controllerSha: candidate.controllerSha,
    headSha: candidate.headSha,
    headRef: candidate.headRef,
    headRepository: candidate.headRepository,
    repairKind: candidate.repairKind,
    declaredScope: candidate.declaredScope,
    allowedPaths: candidate.allowedPaths,
    protectedPaths: candidate.protectedPaths,
    instructions: candidate.instructions,
    nonce: randomId(),
    priorEntryDigest: state.tipDigest,
  };
  const envelope = signRepairLedgerEntry(entry, privateKey);
  await publishEntry(envelope);
  const persisted = await readEntries();
  const nextState = reduceVerifiedRepairLedger(persisted, publicKeys, {
    now: issuedAt.getTime(),
    expectedRepository: candidate.repository,
    expectedPullRequestNumber: candidate.pullRequestNumber,
    expectedContractDigest: candidate.contractDigest,
    expectedGeneration: generation,
  });
  if (nextState.attemptsUsed !== state.attemptsUsed + 1 || nextState.tipDigest !== repairLedgerEntryDigest(envelope)) {
    throw new Error("Repair ledger publication did not become the unique signed tip");
  }
  return { envelope, state: nextState };
}
