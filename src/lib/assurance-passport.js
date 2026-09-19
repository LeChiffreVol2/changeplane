// Assured Revision passport encoding and verification. This module performs no I/O.
// Local integrity and summary binding never establish live publisher authority.
import { createHash } from "node:crypto";
import { AUTONOMOUS_DECISION } from "./changeplane.js";

const CHECK_NAME = "ChangePlane / guard";
export const MAX_ASSURANCE_PASSPORT_ENCODED_LENGTH = 20_000;
const MAX_ASSURANCE_EVIDENCE = 20;
const MAX_ASSURANCE_CHECK_NAME_LENGTH = 100;
const MAX_ASSURANCE_PUBLISHER_LENGTH = 100;
const MAX_ASSURANCE_POLICY_PATH_LENGTH = 300;
const MAX_ASSURANCE_TIMESTAMP_LENGTH = 40;
const LEGACY_COMMIT_STATUS = "LEGACY_COMMIT_STATUS";
const UNKNOWN_ASSURANCE_VALUE = "Unknown";
const ANY_ASSURANCE_PUBLISHER = "Any";
const ASSURANCE_EVIDENCE_STATUSES = new Set([
  "MISSING",
  "QUEUED",
  "IN_PROGRESS",
  "COMPLETED",
  "WAITING",
  "PENDING",
  "REQUESTED",
]);
const ASSURANCE_EVIDENCE_CONCLUSIONS = new Set([
  UNKNOWN_ASSURANCE_VALUE,
  "ACTION_REQUIRED",
  "CANCELLED",
  "ERROR",
  "FAILURE",
  "NEUTRAL",
  "SKIPPED",
  "STALE",
  "STARTUP_FAILURE",
  "SUCCESS",
  "TIMED_OUT",
]);
const GITHUB_APP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u;

const RECEIPT_STATE = /<!-- changeplane-receipt:v2 contract=([a-f0-9]{64}) input=([a-f0-9]{64}) head=([a-f0-9]{40}) -->/u;
const ASSURANCE_PASSPORT_STATE = /<!-- changeplane-assurance-passport:v1 digest=([a-f0-9]{64}) payload=([A-Za-z0-9_-]+) -->/u;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validAssurancePolicyPath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ASSURANCE_POLICY_PATH_LENGTH
    && !value.startsWith("/")
    && !value.includes("\\")
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

export function validateAssurancePolicyPath(value) {
  if (!validAssurancePolicyPath(value)) {
    throw new Error(`policy_path must be a repository-relative path of at most ${MAX_ASSURANCE_POLICY_PATH_LENGTH} characters.`);
  }
  return value;
}

function assuranceAuthorityMap() {
  return {
    authoringAgent: {
      owns: "CHANGE",
      propose: true,
      decide: false,
      apply: false,
      publishGuard: false,
      merge: false,
    },
    proposalModel: {
      owns: "PROPOSE",
      propose: true,
      decide: false,
      apply: false,
      publishGuard: false,
      merge: false,
    },
    deterministicHarness: {
      owns: "DECIDE",
      propose: false,
      decide: true,
      apply: false,
      publishGuard: true,
      merge: false,
    },
    trustedController: {
      owns: "APPLY",
      propose: false,
      decide: false,
      apply: true,
      publishGuard: false,
      merge: false,
    },
    github: {
      owns: "MERGE",
      propose: false,
      decide: false,
      apply: false,
      publishGuard: false,
      merge: true,
    },
  };
}

function assurancePassportDigest(value) {
  return createHash("sha256")
    .update("changeplane:assurance-passport:v1\0")
    .update(canonicalJson(value))
    .digest("hex");
}

function validAssuranceTimestamp(value) {
  if (value === "") return true;
  if (typeof value !== "string" || value.length > MAX_ASSURANCE_TIMESTAMP_LENGTH
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const canonical = parsed.toISOString();
  return value === canonical || value === canonical.replace(".000Z", "Z");
}

function validPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function assuranceEvidencePassed(evidence) {
  return evidence.length > 0 && evidence.every((item) => (
    item.status === "COMPLETED"
    && item.conclusion === "SUCCESS"
    && item.actualPublisher !== UNKNOWN_ASSURANCE_VALUE
    && (item.expectedPublisher === ANY_ASSURANCE_PUBLISHER
      || item.actualPublisher === item.expectedPublisher)
  ));
}

export function expectedGuardConclusion(passport) {
  if (passport.decision.mode === "observe") return "neutral";
  return passport.decision.outcome === AUTONOMOUS_DECISION.PASS ? "success" : "action_required";
}

export function verifyAssurancePassportIntegrity(passport, markerDigest = passport?.digest) {
  if (!passport || typeof passport !== "object" || Array.isArray(passport)) {
    throw new Error("The ChangePlane assurance passport is invalid.");
  }
  const { digest: claimedDigest, ...unsigned } = passport;
  const target = passport.target;
  const binding = passport.binding;
  const decision = passport.decision;
  const exactKeys = (value, keys) => (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
  const validTarget = target
    && exactKeys(target, ["type", "repository", "repositoryId", "pullRequestNumber", "baseSha", "headSha"])
    && ["pull_request", "merge_group"].includes(target.type)
    && typeof target.repository === "string"
    && target.repository.length > 0
    && target.repository.length <= 200
    && Number.isSafeInteger(target.repositoryId)
    && target.repositoryId > 0
    && /^[a-f0-9]{40}$/u.test(target.baseSha)
    && /^[a-f0-9]{40}$/u.test(target.headSha)
    && (target.type === "merge_group"
      ? target.pullRequestNumber === null
      : Number.isInteger(target.pullRequestNumber) && target.pullRequestNumber > 0);
  const validBinding = binding
    && exactKeys(binding, [
      "inputDigest",
      "contractDigest",
      "policyPath",
      "policyDigest",
      "policySourceRevision",
      "approvalDigest",
      "evaluatorVersion",
      "trustedControllerSha",
    ])
    && validSha256(binding.inputDigest)
    && validSha256(binding.contractDigest)
    && validAssurancePolicyPath(binding.policyPath)
    && validSha256(binding.policyDigest)
    && validSha256(binding.approvalDigest)
    && /^[a-f0-9]{40}$/u.test(binding.policySourceRevision)
    && /^[a-f0-9]{40}$/u.test(binding.trustedControllerSha)
    && binding.policySourceRevision === target?.baseSha
    && binding.trustedControllerSha === target?.baseSha
    && typeof binding.evaluatorVersion === "string"
    && binding.evaluatorVersion.length > 0
    && binding.evaluatorVersion.length <= 50;
  const validDecision = decision
    && exactKeys(decision, ["mode", "outcome", "reason", "evidenceCount", "assuranceLevel", "behavioralEvidencePassed"])
    && ["observe", "enforce"].includes(decision.mode)
    && Object.values(AUTONOMOUS_DECISION).includes(decision.outcome)
    && typeof decision.reason === "string"
    && decision.reason.length > 0
    && decision.reason.length <= 200
    && Number.isInteger(decision.evidenceCount)
    && decision.evidenceCount >= 0
    && decision.evidenceCount <= MAX_ASSURANCE_EVIDENCE
    && decision.assuranceLevel === (decision.evidenceCount > 0 ? "BEHAVIORAL" : "SCOPE_ONLY")
    && typeof decision.behavioralEvidencePassed === "boolean";
  const validEvidence = Array.isArray(passport.evidence)
    && passport.evidence.length === decision?.evidenceCount
    && passport.evidence.every((item) => (
      exactKeys(item, [
        "checkName",
        "expectedPublisher",
        "actualPublisher",
        "checkRunId",
        "publisherAppId",
        "status",
        "conclusion",
        "completedAt",
        "headSha",
      ])
      && typeof item.checkName === "string"
      && item.checkName.length > 0
      && item.checkName.length <= MAX_ASSURANCE_CHECK_NAME_LENGTH
      && typeof item.expectedPublisher === "string"
      && item.expectedPublisher.length <= MAX_ASSURANCE_PUBLISHER_LENGTH
      && (item.expectedPublisher === ANY_ASSURANCE_PUBLISHER || GITHUB_APP_SLUG.test(item.expectedPublisher))
      && typeof item.actualPublisher === "string"
      && item.actualPublisher.length <= MAX_ASSURANCE_PUBLISHER_LENGTH
      && ([UNKNOWN_ASSURANCE_VALUE, LEGACY_COMMIT_STATUS].includes(item.actualPublisher)
        || GITHUB_APP_SLUG.test(item.actualPublisher))
      && typeof item.status === "string"
      && ASSURANCE_EVIDENCE_STATUSES.has(item.status)
      && typeof item.conclusion === "string"
      && ASSURANCE_EVIDENCE_CONCLUSIONS.has(item.conclusion)
      && typeof item.completedAt === "string"
      && validAssuranceTimestamp(item.completedAt)
      && ((item.checkRunId === null && item.publisherAppId === null)
        || (validPositiveId(item.checkRunId) && validPositiveId(item.publisherAppId)))
      && (item.checkRunId === null
        ? [UNKNOWN_ASSURANCE_VALUE, LEGACY_COMMIT_STATUS].includes(item.actualPublisher)
        : GITHUB_APP_SLUG.test(item.actualPublisher))
      && (item.actualPublisher !== LEGACY_COMMIT_STATUS || item.expectedPublisher === ANY_ASSURANCE_PUBLISHER)
      && (decision?.mode !== "enforce" || (
        item.expectedPublisher !== ANY_ASSURANCE_PUBLISHER
        && GITHUB_APP_SLUG.test(item.expectedPublisher)
        && item.actualPublisher !== LEGACY_COMMIT_STATUS
      ))
      && (item.status !== "MISSING" || (
        item.actualPublisher === UNKNOWN_ASSURANCE_VALUE
        && item.checkRunId === null
        && item.conclusion === UNKNOWN_ASSURANCE_VALUE
      ))
      && (item.status !== "COMPLETED" || item.conclusion !== "SUCCESS" || (
        item.actualPublisher !== UNKNOWN_ASSURANCE_VALUE
        && (item.expectedPublisher === ANY_ASSURANCE_PUBLISHER
          || item.actualPublisher === item.expectedPublisher)
      ))
      && item.headSha === target?.headSha
    ));
  const evidencePassed = Array.isArray(passport.evidence)
    ? assuranceEvidencePassed(passport.evidence)
    : false;
  const decisionSemanticsValid = decision?.mode !== "enforce"
    || decision.outcome !== AUTONOMOUS_DECISION.PASS
    || (
      decision.reason === "ALL_GUARANTEES_SATISFIED"
      && decision.evidenceCount > 0
      && decision.assuranceLevel === "BEHAVIORAL"
      && decision.behavioralEvidencePassed === true
      && evidencePassed
    );
  if (
    !exactKeys(passport, ["schemaVersion", "type", "target", "binding", "decision", "evidence", "authority", "verification", "digest"])
    || passport.schemaVersion !== 1
    || passport.type !== "changeplane.assurance-passport"
    || !validTarget
    || !validBinding
    || !validDecision
    || !validEvidence
    || decision?.behavioralEvidencePassed !== evidencePassed
    || !decisionSemanticsValid
    || canonicalJson(passport.authority) !== canonicalJson(assuranceAuthorityMap())
    || canonicalJson(passport.verification) !== canonicalJson({
      localIntegrity: "SHA256_ONLY",
      authenticity: "REQUIRES_LIVE_GITHUB_CHECK",
      checkName: CHECK_NAME,
      agentIdentityUsedForDecision: false,
    })
    || !validSha256(claimedDigest)
    || claimedDigest !== markerDigest
    || assurancePassportDigest(unsigned) !== claimedDigest
  ) {
    throw new Error("The ChangePlane assurance passport is invalid.");
  }
  return passport;
}

export function parseAssurancePassportIntegrity(markdown) {
  if (typeof markdown !== "string") throw new TypeError("markdown must be a string");
  const matches = [...markdown.matchAll(new RegExp(ASSURANCE_PASSPORT_STATE.source, "gu"))];
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw new Error("The ChangePlane assurance passport is invalid.");
  const match = matches[0];
  if (match[2].length > MAX_ASSURANCE_PASSPORT_ENCODED_LENGTH) {
    throw new Error("The ChangePlane assurance passport is too large.");
  }
  let passport;
  try {
    passport = JSON.parse(Buffer.from(match[2], "base64url").toString("utf8"));
  } catch {
    throw new Error("The ChangePlane assurance passport is invalid.");
  }
  return verifyAssurancePassportIntegrity(passport, match[1]);
}

function summaryMatchesPassport(verifiedPassport, summary) {
  const expectedMarker = assurancePassportMarker(verifiedPassport);
  const passportMarkers = typeof summary === "string"
    ? [...summary.matchAll(new RegExp(ASSURANCE_PASSPORT_STATE.source, "gu"))]
    : [];
  const receiptMarkers = typeof summary === "string"
    ? [...summary.matchAll(new RegExp(RECEIPT_STATE.source, "gu"))]
    : [];
  const liveMarker = passportMarkers[0]?.[0] ?? null;
  const receiptMarkerValid = verifiedPassport.target.type === "merge_group"
    ? receiptMarkers.length === 0
    : receiptMarkers.length === 1
      && receiptMarkers[0][1] === verifiedPassport.binding.contractDigest
      && receiptMarkers[0][2] === verifiedPassport.binding.inputDigest
      && receiptMarkers[0][3] === verifiedPassport.target.headSha;
  return typeof summary === "string" && passportMarkers.length === 1
    && liveMarker === expectedMarker && receiptMarkerValid;
}

/** Validate only the local summary envelope; this grants no publisher authority. */
export function verifyAssurancePassportSummary(passport, summary) {
  const verifiedPassport = verifyAssurancePassportIntegrity(passport);
  if (!summaryMatchesPassport(verifiedPassport, summary)) {
    throw new Error("The summary does not bind this exact assurance passport and receipt.");
  }
  return verifiedPassport;
}

export function verifyAssurancePassportAgainstCheck(passport, liveCheck, expectedPublisher) {
  const verifiedPassport = verifyAssurancePassportIntegrity(passport);
  if (
    !expectedPublisher
    || typeof expectedPublisher !== "object"
    || Array.isArray(expectedPublisher)
    || Object.keys(expectedPublisher).sort().join("\0") !== ["appId", "appSlug"].sort().join("\0")
    || !validPositiveId(expectedPublisher.appId)
    || typeof expectedPublisher.appSlug !== "string"
    || !GITHUB_APP_SLUG.test(expectedPublisher.appSlug)
  ) {
    throw new Error("The expected GitHub Check publisher is invalid.");
  }
  if (
    !validPositiveId(liveCheck?.id)
    || liveCheck.name !== CHECK_NAME
    || liveCheck.head_sha !== verifiedPassport.target.headSha
    || liveCheck.status !== "completed"
    || liveCheck.conclusion !== expectedGuardConclusion(verifiedPassport)
    || liveCheck.app?.id !== expectedPublisher.appId
    || liveCheck.app?.slug !== expectedPublisher.appSlug
    || !summaryMatchesPassport(verifiedPassport, liveCheck?.output?.summary)
  ) {
    throw new Error("The live GitHub Check does not authenticate this assurance passport.");
  }
  return {
    authenticity: "VERIFIED_LIVE_GITHUB_CHECK",
    passport: verifiedPassport,
    checkRunId: liveCheck.id,
    publisherAppId: liveCheck.app.id,
    publisherAppSlug: liveCheck.app.slug,
  };
}

export function assurancePassportOutputs(passport, liveCheckPublished = false) {
  if (!liveCheckPublished) return {};
  const verifiedPassport = verifyAssurancePassportIntegrity(passport);
  return {
    assurance_passport: canonicalJson(verifiedPassport),
    assurance_passport_digest: verifiedPassport.digest,
  };
}

export function buildProofLocator(passport, publishedCheck) {
  const verifiedPassport = verifyAssurancePassportIntegrity(passport);
  if (
    !validPositiveId(publishedCheck?.id)
    || publishedCheck.name !== CHECK_NAME
    || publishedCheck.head_sha !== verifiedPassport.target.headSha
  ) {
    throw new Error("The published GitHub Check cannot locate this assurance proof.");
  }
  return {
    schemaVersion: 1,
    type: "changeplane.assurance-proof-locator",
    repositoryId: verifiedPassport.target.repositoryId,
    targetType: verifiedPassport.target.type,
    pullRequestNumber: verifiedPassport.target.pullRequestNumber,
    headSha: verifiedPassport.target.headSha,
    checkRunId: publishedCheck.id,
    passportDigest: verifiedPassport.digest,
  };
}

function passportEvidence(item, headSha) {
  const bounded = (value, fallback, maximum, label) => {
    const result = String(value ?? fallback);
    if (result.length > maximum) {
      throw new Error(`Assurance passport ${label} exceeds ${maximum} characters.`);
    }
    return result;
  };
  const passportId = (value, label) => {
    if (value == null) return null;
    if (!validPositiveId(value)) throw new Error(`Assurance passport ${label} must be a positive safe integer.`);
    return value;
  };
  const checkRunId = passportId(item?.checkRunId, "Check Run ID");
  const publisherAppId = passportId(item?.publisherAppId, "publisher App ID");
  const actualPublisher = checkRunId === null && publisherAppId === null && item?.source
    ? LEGACY_COMMIT_STATUS
    : bounded(item?.source, UNKNOWN_ASSURANCE_VALUE, MAX_ASSURANCE_PUBLISHER_LENGTH, "actual publisher");
  return {
    checkName: bounded(item?.name, "", MAX_ASSURANCE_CHECK_NAME_LENGTH, "Check name"),
    expectedPublisher: bounded(item?.expectedSource, ANY_ASSURANCE_PUBLISHER, MAX_ASSURANCE_PUBLISHER_LENGTH, "expected publisher"),
    actualPublisher,
    checkRunId,
    publisherAppId,
    status: bounded(item?.status, "", 30, "evidence status"),
    conclusion: bounded(item?.conclusion, UNKNOWN_ASSURANCE_VALUE, 30, "evidence conclusion"),
    completedAt: bounded(item?.completedAt, "", MAX_ASSURANCE_TIMESTAMP_LENGTH, "evidence completion time"),
    headSha,
  };
}

export function buildAssurancePassport(receipt) {
  validateAssurancePolicyPath(receipt?.policy?.path);
  if (!Array.isArray(receipt.evidence ?? [])) throw new Error("Assurance passport evidence must be an array.");
  if ((receipt.evidence ?? []).length > MAX_ASSURANCE_EVIDENCE) {
    throw new Error(`Assurance passports support at most ${MAX_ASSURANCE_EVIDENCE} evidence entries.`);
  }
  const evidence = (receipt.evidence ?? []).map((item) => passportEvidence(item, receipt.headSha));
  const payload = {
    schemaVersion: 1,
    type: "changeplane.assurance-passport",
    target: {
      type: receipt.targetType ?? "pull_request",
      repository: receipt.repository,
      repositoryId: receipt.repositoryId,
      pullRequestNumber: receipt.targetType === "merge_group" ? null : receipt.pullRequestNumber,
      baseSha: receipt.baseSha,
      headSha: receipt.headSha,
    },
    binding: {
      inputDigest: receipt.inputDigest,
      contractDigest: receipt.boundContractDigest ?? receipt.contractDigest,
      policyPath: receipt.policy.path,
      policyDigest: receipt.policy.digest,
      policySourceRevision: receipt.policy.sourceRevision ?? receipt.baseSha,
      approvalDigest: receipt.approvalDigest,
      evaluatorVersion: receipt.evaluatorVersion,
      trustedControllerSha: receipt.baseSha,
    },
    decision: {
      mode: receipt.mode,
      outcome: receipt.decision,
      reason: receipt.reason,
      evidenceCount: evidence.length,
      assuranceLevel: evidence.length > 0 ? "BEHAVIORAL" : "SCOPE_ONLY",
      behavioralEvidencePassed: assuranceEvidencePassed(evidence),
    },
    evidence,
    authority: assuranceAuthorityMap(),
    verification: {
      localIntegrity: "SHA256_ONLY",
      authenticity: "REQUIRES_LIVE_GITHUB_CHECK",
      checkName: CHECK_NAME,
      agentIdentityUsedForDecision: false,
    },
  };
  const passport = { ...payload, digest: assurancePassportDigest(payload) };
  verifyAssurancePassportIntegrity(passport);
  encodedAssurancePassport(passport);
  return passport;
}

function encodedAssurancePassport(passport) {
  const encoded = Buffer.from(canonicalJson(passport)).toString("base64url");
  if (encoded.length > MAX_ASSURANCE_PASSPORT_ENCODED_LENGTH) {
    throw new Error("The ChangePlane assurance passport is too large.");
  }
  return encoded;
}

export function assurancePassportMarker(passport) {
  return `<!-- changeplane-assurance-passport:v1 digest=${passport.digest} payload=${encodedAssurancePassport(passport)} -->`;
}
